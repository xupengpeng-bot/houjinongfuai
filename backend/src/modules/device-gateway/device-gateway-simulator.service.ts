import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { DeviceGatewayService } from './device-gateway.service';

type SimulatorStatus = 'stopped' | 'running' | 'error';
type SimulatorLogLevel = 'info' | 'warn' | 'error';

type SimulatorProfile = {
  protocol_version: string;
  heartbeat_interval_seconds: number;
  config_version: number;
  feature_modules: string[];
  hardware_sku: string;
  hardware_rev: string;
  firmware_family: string;
  firmware_version: string;
  iccid: string;
  battery_soc: number;
  signal_csq: number;
  pressure_mpa: number;
  flow_m3h: number;
  voltage_v: number;
  current_a: number;
  power_kw: number;
};

type SimulatorRuntime = {
  imei: string;
  bridgeId: string;
  status: SimulatorStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  lastHeartbeatAt: string | null;
  lastSnapshotAt: string | null;
  lastCommandAt: string | null;
  lastError: string | null;
  lastPendingCommandCount: number;
  seqNo: number;
  registeredOnce: boolean;
  busy: boolean;
  runtimeSeconds: number;
  totalM3: number;
  energyKwh: number;
  sessionRef: string | null;
  workflowState: string;
  pumpRunning: boolean;
  valveOpen: boolean;
  sessionActive: boolean;
  profile: SimulatorProfile;
  logs: Array<{
    id: string;
    ts: string;
    level: SimulatorLogLevel;
    kind: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
};

type QueueCommandItem = {
  command_token?: string;
  command_code?: string;
  session_ref?: string | null;
  request_payload?: Record<string, unknown>;
  wire_message?: Record<string, unknown> | null;
};

const MAX_LOGS = 40;
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 8;
const LOOP_INTERVAL_MS = 3000;

@Injectable()
export class DeviceGatewaySimulatorService implements OnModuleDestroy {
  private readonly logger = new Logger(DeviceGatewaySimulatorService.name);
  private readonly instances = new Map<string, SimulatorRuntime>();
  private loopHandle: NodeJS.Timeout | null = null;

  constructor(private readonly gatewayService: DeviceGatewayService) {}

  onModuleDestroy() {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
  }

  listInstances() {
    return {
      items: Array.from(this.instances.values())
        .sort((a, b) => a.imei.localeCompare(b.imei))
        .map((item) => this.toResponse(item)),
      total: this.instances.size,
      running_count: Array.from(this.instances.values()).filter((item) => item.status === 'running').length,
    };
  }

  async addInstances(input?: { imeis?: string[] | null; imei_text?: string | null; auto_start?: boolean | null }) {
    const imeis = this.normalizeImeis(input?.imeis, input?.imei_text);
    if (imeis.length === 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'at least one imei is required');
    }

    const createdOrUpdated: ReturnType<DeviceGatewaySimulatorService['toResponse']>[] = [];
    for (const imei of imeis) {
      const instance = this.ensureInstance(imei);
      this.appendLog(instance, 'info', 'instance_upserted', '已加入设备模拟器');
      createdOrUpdated.push(this.toResponse(instance));
    }

    if (input?.auto_start) {
      for (const imei of imeis) {
        await this.startInstance(imei);
      }
    }

    return {
      items: imeis.map((imei) => this.toResponse(this.instances.get(imei)!)),
      changed_count: createdOrUpdated.length,
    };
  }

  async startAll() {
    const items = Array.from(this.instances.keys());
    for (const imei of items) {
      await this.startInstance(imei);
    }
    return this.listInstances();
  }

  async stopAll() {
    const items = Array.from(this.instances.keys());
    for (const imei of items) {
      await this.stopInstance(imei);
    }
    return this.listInstances();
  }

  async startInstance(imei: string) {
    const instance = this.mustGetInstance(imei);
    if (instance.status === 'running') {
      return this.toResponse(instance);
    }

    instance.status = 'running';
    instance.startedAt = new Date().toISOString();
    instance.stoppedAt = null;
    instance.lastError = null;
    instance.updatedAt = new Date().toISOString();
    this.ensureLoop();

    try {
      await this.gatewayService.connectBridge({
        imei: instance.imei,
        bridge_id: instance.bridgeId,
        protocol_version: instance.profile.protocol_version,
        remote_addr: 'bs-device-simulator',
        remote_port: null,
      });
      await this.emitRegister(instance);
      await this.tickInstance(instance);
      this.appendLog(instance, 'info', 'simulator_started', '设备模拟器已启动');
    } catch (error) {
      this.markError(instance, error);
    }

    return this.toResponse(instance);
  }

  async stopInstance(imei: string) {
    const instance = this.mustGetInstance(imei);

    try {
      await this.gatewayService.disconnectBridge({
        imei: instance.imei,
        bridge_id: instance.bridgeId,
      });
    } catch (error) {
      this.logger.warn(`disconnect simulator bridge failed for ${instance.imei}: ${this.stringifyError(error)}`);
    }

    instance.status = 'stopped';
    instance.busy = false;
    instance.stoppedAt = new Date().toISOString();
    instance.updatedAt = instance.stoppedAt;
    instance.lastPendingCommandCount = 0;
    this.appendLog(instance, 'info', 'simulator_stopped', '设备模拟器已停止');

    return this.toResponse(instance);
  }

  async removeInstance(imei: string) {
    const instance = this.mustGetInstance(imei);
    if (instance.status === 'running') {
      await this.stopInstance(imei);
    }
    this.instances.delete(instance.imei);
    return { imei: instance.imei, removed: true };
  }

  async tickOnce(imei: string) {
    const instance = this.mustGetInstance(imei);
    await this.tickInstance(instance, true);
    return this.toResponse(instance);
  }

  private ensureLoop() {
    if (this.loopHandle) return;
    this.loopHandle = setInterval(() => {
      void this.tickAll();
    }, LOOP_INTERVAL_MS);
  }

  private async tickAll() {
    const items = Array.from(this.instances.values()).filter((item) => item.status === 'running');
    for (const instance of items) {
      await this.tickInstance(instance);
    }
  }

  private async tickInstance(instance: SimulatorRuntime, force = false) {
    if (instance.status !== 'running' || instance.busy) return;
    if (!force && !this.isHeartbeatDue(instance)) return;

    instance.busy = true;
    try {
      this.advanceCounters(instance);
      const result = await this.gatewayService.heartbeatBridge({
        imei: instance.imei,
        bridge_id: instance.bridgeId,
        session_ref: instance.sessionRef,
        payload: this.buildHeartbeatPayload(instance),
        dispatch_pending_commands: true,
        mark_sent: true,
        include_sent: false,
        limit: 20,
        remote_addr: 'bs-device-simulator',
        remote_port: null,
      });

      instance.lastHeartbeatAt = new Date().toISOString();
      instance.updatedAt = instance.lastHeartbeatAt;
      instance.lastPendingCommandCount = this.asNumber((result as Record<string, unknown>).pending_queue_total) ?? 0;
      instance.lastError = null;

      const pendingCommands = Array.isArray((result as Record<string, unknown>).pending_commands)
        ? (((result as Record<string, unknown>).pending_commands as unknown[]) as QueueCommandItem[])
        : [];

      if (pendingCommands.length > 0) {
        this.appendLog(instance, 'info', 'pending_commands_polled', `收到 ${pendingCommands.length} 条待执行命令`, {
          pending_count: pendingCommands.length,
        });
      }

      for (const command of pendingCommands) {
        await this.processPendingCommand(instance, command);
      }

      await this.emitSnapshot(instance);
    } catch (error) {
      this.markError(instance, error);
    } finally {
      instance.busy = false;
    }
  }

  private async processPendingCommand(instance: SimulatorRuntime, command: QueueCommandItem) {
    const wireMessage = this.asObject(command.wire_message);
    const payload = this.asObject(wireMessage.p ?? command.request_payload);
    const type = this.normalizeWireMsgType(wireMessage.t || command.command_code);
    const correlationId = this.asString(wireMessage.c || command.command_token) || randomUUID();
    const sessionRef = this.asString(wireMessage.r || command.session_ref) || instance.sessionRef || null;

    instance.lastCommandAt = new Date().toISOString();

    if (type === 'SYNC_CONFIG') {
      const nextConfigVersion = this.asNumber(payload.cv ?? payload.config_version);
      if (nextConfigVersion !== null) {
        instance.profile.config_version = nextConfigVersion;
      }
      const nextModules = this.normalizeFeatureModules(payload.fm ?? payload.feature_modules);
      if (nextModules.length > 0) {
        instance.profile.feature_modules = nextModules;
      }
      await this.emitCommandAck(instance, {
        correlationId,
        sessionRef,
        commandCode: 'SYNC_CONFIG',
      });
      this.appendLog(instance, 'info', 'command_sync_config', '已模拟应用配置版本', {
        config_version: instance.profile.config_version,
      });
      return;
    }

    if (type === 'QUERY') {
      const queryCode = this.normalizeQueryCode(payload.qc ?? payload.query_code) || 'query_common_status';
      await this.emitQueryResult(instance, {
        correlationId,
        sessionRef,
        queryCode,
        scope: this.normalizeScope(payload.sc ?? payload.scope) || null,
        moduleCode: this.normalizeModuleCode(payload.mc ?? payload.module_code) || null,
      });
      this.appendLog(instance, 'info', 'command_query', `已返回查询结果 ${queryCode}`);
      return;
    }

    if (type === 'EXECUTE_ACTION') {
      const actionCode = this.normalizeActionCode(payload.ac ?? payload.action_code);
      await this.applyAction(instance, actionCode, sessionRef);
      await this.emitCommandAck(instance, {
        correlationId,
        sessionRef,
        commandCode: this.resolveLogicalCommandCode(actionCode),
        actionCode,
        scope: this.normalizeScope(payload.sc ?? payload.scope) || null,
        moduleCode: this.normalizeModuleCode(payload.mc ?? payload.module_code) || null,
      });
      this.appendLog(instance, 'info', 'command_execute', `已模拟执行动作 ${actionCode || 'unknown'}`);
      if (!instance.sessionActive && instance.workflowState === 'ready_idle') {
        await this.emitRuntimeStopped(instance, sessionRef);
      } else {
        await this.emitSnapshot(instance);
      }
      return;
    }

    await this.emitCommandNack(instance, {
      correlationId,
      sessionRef,
      reasonCode: 'unsupported_command_type',
      commandCode: type || 'UNKNOWN',
    });
    this.appendLog(instance, 'warn', 'command_rejected', `未支持的模拟命令类型 ${type || 'unknown'}`);
  }

  private async applyAction(instance: SimulatorRuntime, actionCode: string, sessionRef: string | null) {
    const normalized = actionCode.trim().toLowerCase();
    if (normalized === 'pause_session') {
      instance.workflowState = 'paused';
      return;
    }
    if (normalized === 'resume_session') {
      if (instance.sessionActive || instance.pumpRunning || instance.valveOpen) {
        instance.workflowState = 'running';
      }
      return;
    }
    if (normalized === 'start_pump') {
      instance.pumpRunning = true;
      if (!instance.sessionRef && sessionRef) {
        instance.sessionRef = sessionRef;
      }
      if (!instance.sessionActive && instance.valveOpen) {
        instance.sessionActive = true;
        instance.workflowState = 'running';
      }
      return;
    }
    if (normalized === 'stop_pump') {
      instance.pumpRunning = false;
      if (!instance.valveOpen) {
        instance.sessionActive = false;
        instance.workflowState = 'ready_idle';
      }
      return;
    }
    if (normalized === 'open_valve') {
      instance.valveOpen = true;
      if (!instance.sessionRef && sessionRef) {
        instance.sessionRef = sessionRef;
      }
      if (!instance.sessionActive && instance.pumpRunning) {
        instance.sessionActive = true;
        instance.workflowState = 'running';
      }
      return;
    }
    if (normalized === 'close_valve') {
      instance.valveOpen = false;
      if (!instance.pumpRunning) {
        instance.sessionActive = false;
        instance.workflowState = 'ready_idle';
      }
      return;
    }
  }

  private async emitRegister(instance: SimulatorRuntime) {
    await this.gatewayService.ingestRuntimeEvent({
      v: 1,
      t: 'RG',
      i: instance.imei,
      m: this.nextMsgId(instance, 'register'),
      s: this.nextSeqNo(instance),
      ts: new Date().toISOString(),
      p: {
        iccid: instance.profile.iccid,
        hs: instance.profile.hardware_sku,
        hr: instance.profile.hardware_rev,
        ff: instance.profile.firmware_family,
        fv: instance.profile.firmware_version,
        cv: instance.profile.config_version,
        ri: {
          ai_count: 2,
          di_count: 2,
          do_count: 2,
          rs485_count: 1,
          relay_count: 2,
          pulse_count: 1,
          battery_monitor: 1,
          solar_monitor: 0,
          signal_monitor: 1,
        },
        fm: this.toWireFeatureModules(instance.profile.feature_modules),
      },
    });
    instance.registeredOnce = true;
    this.appendLog(instance, 'info', 'register_emitted', '已发送模拟注册');
  }

  private async emitSnapshot(instance: SimulatorRuntime) {
    const now = new Date().toISOString();
    await this.gatewayService.ingestRuntimeEvent({
      v: 1,
      t: 'SS',
      i: instance.imei,
      m: this.nextMsgId(instance, 'snapshot'),
      s: this.nextSeqNo(instance),
      ts: now,
      r: instance.sessionRef,
      p: {
        wf: this.toWireWorkflowState(instance.workflowState),
        rt: instance.runtimeSeconds,
        pr: instance.profile.pressure_mpa,
        fm: instance.sessionActive || instance.valveOpen || instance.pumpRunning ? instance.profile.flow_m3h : 0,
        fq: Number(instance.totalM3.toFixed(3)),
        ek: Number(instance.energyKwh.toFixed(3)),
        pw: instance.pumpRunning ? instance.profile.power_kw : 0,
        vv: instance.profile.voltage_v,
        ia: instance.pumpRunning ? instance.profile.current_a : 0,
      },
    });
    instance.lastSnapshotAt = now;
  }

  private async emitRuntimeStopped(instance: SimulatorRuntime, sessionRef: string | null) {
    await this.gatewayService.ingestRuntimeEvent({
      v: 1,
      t: 'ER',
      i: instance.imei,
      m: this.nextMsgId(instance, 'stopped'),
      s: this.nextSeqNo(instance),
      ts: new Date().toISOString(),
      r: sessionRef,
      p: {
        result: 'completed',
        final_flow_m3: Number(instance.totalM3.toFixed(3)),
        final_energy_wh: Math.round(instance.energyKwh * 1000),
        runtime_sec: instance.runtimeSeconds,
        event_code: 'simulator_runtime_stopped',
      },
    });
  }

  private async emitCommandAck(
    instance: SimulatorRuntime,
    input: {
      correlationId: string;
      sessionRef: string | null;
      commandCode: string;
      actionCode?: string | null;
      scope?: string | null;
      moduleCode?: string | null;
    },
  ) {
    await this.gatewayService.ingestRuntimeEvent({
      v: 1,
      t: 'AK',
      i: instance.imei,
      m: this.nextMsgId(instance, 'ack'),
      s: this.nextSeqNo(instance),
      ts: new Date().toISOString(),
      c: input.correlationId,
      r: input.sessionRef,
      p: {
        result: 'acked',
        command_code: input.commandCode,
        ac: input.actionCode ? this.toWireActionCode(input.actionCode) : null,
        action_code: input.actionCode ?? null,
        sc: input.scope ? this.toWireScope(input.scope) : null,
        scope: input.scope ?? null,
        mc: input.moduleCode ? this.toWireModuleCode(input.moduleCode) : null,
        module_code: input.moduleCode ?? null,
      },
    });
  }

  private async emitCommandNack(
    instance: SimulatorRuntime,
    input: {
      correlationId: string;
      sessionRef: string | null;
      reasonCode: string;
      commandCode: string;
    },
  ) {
    await this.gatewayService.ingestRuntimeEvent({
      v: 1,
      t: 'NK',
      i: instance.imei,
      m: this.nextMsgId(instance, 'nack'),
      s: this.nextSeqNo(instance),
      ts: new Date().toISOString(),
      c: input.correlationId,
      r: input.sessionRef,
      p: {
        result: 'nack',
        command_code: input.commandCode,
        rc: input.reasonCode,
        reason_code: input.reasonCode,
        retryable: false,
      },
    });
  }

  private async emitQueryResult(
    instance: SimulatorRuntime,
    input: {
      correlationId: string;
      sessionRef: string | null;
      queryCode: string;
      scope: string | null;
      moduleCode: string | null;
    },
  ) {
    const queryCode = input.queryCode.trim().toLowerCase();
    const payload: Record<string, unknown> = {
      qc: this.toWireQueryCode(queryCode),
      query_code: queryCode,
      sc: input.scope ? this.toWireScope(input.scope) : null,
      scope: input.scope,
      mc: input.moduleCode ? this.toWireModuleCode(input.moduleCode) : null,
      module_code: input.moduleCode,
    };

    if (queryCode === 'query_common_status') {
      payload.csq = instance.profile.signal_csq;
      payload.bs = instance.profile.battery_soc;
      payload.cv = instance.profile.config_version;
      payload.on = true;
      payload.rd = true;
    } else if (queryCode === 'query_workflow_state') {
      payload.wf = this.toWireWorkflowState(instance.workflowState);
      payload.workflow_state = instance.workflowState;
      payload.active_session_ref = instance.sessionRef;
      payload.active_session_started_at_utc = instance.startedAt;
      payload.stop_guard_remaining_ms = 0;
      payload.last_recovery_hint = null;
    } else if (queryCode === 'query_voice_state') {
      payload.voice_busy = false;
      payload.last_prompt_code = 'simulator_ready';
      payload.queue_depth = 0;
    } else if (queryCode === 'query_card_reader_state') {
      payload.reader_online = true;
      payload.reader_fault = false;
      payload.last_card_token = null;
      payload.stop_guard_remaining_ms = 0;
    } else if (queryCode === 'query_local_access_state') {
      payload.local_access_mode = 'card_or_local_token';
      payload.stop_guard_remaining_ms = 0;
      payload.active_token = null;
    } else if (queryCode === 'query_local_access_policy') {
      payload.local_access_mode = 'card_or_local_token';
      payload.global_debounce_ms = 250;
      payload.same_token_debounce_ms = 1500;
      payload.stop_guard_ms = 5000;
    } else if (queryCode === 'query_module_values') {
      const moduleCode = (input.moduleCode || '').trim().toLowerCase();
      if (moduleCode === 'pressure_acquisition') {
        payload.pr = instance.profile.pressure_mpa;
      } else if (moduleCode === 'flow_acquisition') {
        payload.fm = instance.profile.flow_m3h;
        payload.fq = Number(instance.totalM3.toFixed(3));
      } else if (moduleCode === 'electric_meter_modbus') {
        payload.pw = instance.pumpRunning ? instance.profile.power_kw : 0;
        payload.vv = instance.profile.voltage_v;
        payload.ia = instance.pumpRunning ? instance.profile.current_a : 0;
        payload.ek = Number(instance.energyKwh.toFixed(3));
      }
    } else {
      payload.result = 'ok';
    }

    await this.gatewayService.ingestRuntimeEvent({
      v: 1,
      t: 'QS',
      i: instance.imei,
      m: this.nextMsgId(instance, 'query-result'),
      s: this.nextSeqNo(instance),
      ts: new Date().toISOString(),
      c: input.correlationId,
      r: input.sessionRef,
      p: payload,
    });
  }

  private buildHeartbeatPayload(instance: SimulatorRuntime) {
    return {
      bridge_kind: 'bs_device_simulator',
      simulator_mode: 'backend_managed',
      on: true,
      rd: true,
      tc: true,
      cv: instance.profile.config_version,
      wf: this.toWireWorkflowState(instance.workflowState),
      csq: instance.profile.signal_csq,
      bs: instance.profile.battery_soc,
      ek: Number(instance.energyKwh.toFixed(3)),
      pw: instance.pumpRunning ? instance.profile.power_kw : 0,
      vv: instance.profile.voltage_v,
      ia: instance.pumpRunning ? instance.profile.current_a : 0,
      fm: this.toWireFeatureModules(instance.profile.feature_modules),
      ff: instance.profile.firmware_family,
      fv: instance.profile.firmware_version,
      hs: instance.profile.hardware_sku,
      iccid: instance.profile.iccid,
    };
  }

  private advanceCounters(instance: SimulatorRuntime) {
    const intervalSeconds = instance.profile.heartbeat_interval_seconds;
    if (!(instance.sessionActive || instance.pumpRunning || instance.valveOpen)) {
      return;
    }
    instance.runtimeSeconds += intervalSeconds;
    instance.totalM3 += (instance.profile.flow_m3h * intervalSeconds) / 3600;
    instance.energyKwh += (instance.profile.power_kw * intervalSeconds) / 3600;
  }

  private isHeartbeatDue(instance: SimulatorRuntime) {
    if (!instance.lastHeartbeatAt) return true;
    const elapsedMs = Date.now() - new Date(instance.lastHeartbeatAt).getTime();
    return elapsedMs >= instance.profile.heartbeat_interval_seconds * 1000;
  }

  private nextSeqNo(instance: SimulatorRuntime) {
    instance.seqNo += 1;
    return instance.seqNo;
  }

  private nextMsgId(instance: SimulatorRuntime, prefix: string) {
    return `${prefix}-${instance.imei}-${Date.now()}`;
  }

  private resolveLogicalCommandCode(actionCode: string) {
    const normalized = actionCode.trim().toLowerCase();
    if (normalized === 'start_pump') return 'START_PUMP';
    if (normalized === 'stop_pump') return 'STOP_PUMP';
    if (normalized === 'open_valve') return 'OPEN_VALVE';
    if (normalized === 'close_valve') return 'CLOSE_VALVE';
    if (normalized === 'pause_session') return 'EXECUTE_ACTION';
    if (normalized === 'resume_session') return 'EXECUTE_ACTION';
    if (normalized === 'play_voice_prompt') return 'EXECUTE_ACTION';
    return 'EXECUTE_ACTION';
  }

  private normalizeWireMsgType(value: unknown) {
    const normalized = this.asString(value).toUpperCase();
    if (normalized === 'RG') return 'REGISTER';
    if (normalized === 'HB') return 'HEARTBEAT';
    if (normalized === 'SS') return 'STATE_SNAPSHOT';
    if (normalized === 'ER') return 'EVENT_REPORT';
    if (normalized === 'QR') return 'QUERY';
    if (normalized === 'QS') return 'QUERY_RESULT';
    if (normalized === 'EX') return 'EXECUTE_ACTION';
    if (normalized === 'SC') return 'SYNC_CONFIG';
    if (normalized === 'RA') return 'REGISTER_ACK';
    if (normalized === 'RN') return 'REGISTER_NACK';
    if (normalized === 'AK') return 'COMMAND_ACK';
    if (normalized === 'NK') return 'COMMAND_NACK';
    return normalized;
  }

  private normalizeQueryCode(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'qcs') return 'query_common_status';
    if (normalized === 'qwf') return 'query_workflow_state';
    if (normalized === 'query_meter_snapshot') return 'query_electric_meter';
    if (normalized === 'qem') return 'query_electric_meter';
    if (normalized === 'qgs') return 'query_upgrade_status';
    if (normalized === 'qgc') return 'query_upgrade_capability';
    return normalized;
  }

  private normalizeActionCode(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'ppu') return 'play_voice_prompt';
    if (normalized === 'upg') return 'upgrade_firmware';
    if (normalized === 'pas') return 'pause_session';
    if (normalized === 'res') return 'resume_session';
    if (normalized === 'spu') return 'start_pump';
    if (normalized === 'tpu') return 'stop_pump';
    if (normalized === 'orl') return 'open_relay';
    if (normalized === 'crl') return 'close_relay';
    if (normalized === 'ovl') return 'open_valve';
    if (normalized === 'cvl') return 'close_valve';
    return normalized;
  }

  private normalizeScope(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'cm') return 'common';
    if (normalized === 'md') return 'module';
    if (normalized === 'wf') return 'workflow';
    return normalized;
  }

  private normalizeModuleCode(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'pvc') return 'pump_vfd_control';
    if (normalized === 'pdc') return 'pump_direct_control';
    if (normalized === 'rly') return 'relay_output_control';
    if (normalized === 'svl') return 'single_valve_control';
    if (normalized === 'dvl') return 'dual_valve_control';
    if (normalized === 'ebr') return 'electric_meter_modbus';
    if (normalized === 'bkr') return 'breaker_control';
    if (normalized === 'bkf') return 'breaker_feedback_monitor';
    if (normalized === 'prs') return 'pressure_acquisition';
    if (normalized === 'flw') return 'flow_acquisition';
    if (normalized === 'sma') return 'soil_moisture_acquisition';
    if (normalized === 'sta') return 'soil_temperature_acquisition';
    if (normalized === 'pwm') return 'power_monitoring';
    if (normalized === 'pay') return 'payment_qr_control';
    if (normalized === 'cdr') return 'card_auth_reader';
    if (normalized === 'vfb') return 'valve_feedback_monitor';
    if (normalized === 'rsg') return 'rs485_sensor_gateway';
    if (normalized === 'rvg') return 'rs485_vfd_gateway';
    return normalized;
  }

  private normalizeFeatureModules(value: unknown) {
    return this.asStringArray(value).map((item) => this.normalizeModuleCode(item)).filter((item) => Boolean(item));
  }

  private toWireScope(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'common') return 'cm';
    if (normalized === 'module') return 'md';
    if (normalized === 'workflow') return 'wf';
    return normalized;
  }

  private toWireQueryCode(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'query_common_status') return 'qcs';
    if (normalized === 'query_workflow_state') return 'qwf';
    if (normalized === 'query_electric_meter') return 'qem';
    return normalized;
  }

  private toWireActionCode(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'play_voice_prompt') return 'ppu';
    if (normalized === 'pause_session') return 'pas';
    if (normalized === 'resume_session') return 'res';
    if (normalized === 'start_pump') return 'spu';
    if (normalized === 'stop_pump') return 'tpu';
    if (normalized === 'open_relay') return 'orl';
    if (normalized === 'close_relay') return 'crl';
    if (normalized === 'open_valve') return 'ovl';
    if (normalized === 'close_valve') return 'cvl';
    return normalized;
  }

  private toWireModuleCode(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'pump_vfd_control') return 'pvc';
    if (normalized === 'pump_direct_control') return 'pdc';
    if (normalized === 'relay_output_control') return 'rly';
    if (normalized === 'single_valve_control') return 'svl';
    if (normalized === 'dual_valve_control') return 'dvl';
    if (normalized === 'electric_meter_modbus') return 'ebr';
    if (normalized === 'breaker_control') return 'bkr';
    if (normalized === 'breaker_feedback_monitor') return 'bkf';
    if (normalized === 'pressure_acquisition') return 'prs';
    if (normalized === 'flow_acquisition') return 'flw';
    if (normalized === 'soil_moisture_acquisition') return 'sma';
    if (normalized === 'soil_temperature_acquisition') return 'sta';
    if (normalized === 'power_monitoring') return 'pwm';
    if (normalized === 'payment_qr_control') return 'pay';
    if (normalized === 'card_auth_reader') return 'cdr';
    if (normalized === 'valve_feedback_monitor') return 'vfb';
    if (normalized === 'rs485_sensor_gateway') return 'rsg';
    if (normalized === 'rs485_vfd_gateway') return 'rvg';
    return normalized;
  }

  private toWireFeatureModules(value: string[]) {
    return value.map((item) => this.toWireModuleCode(item)).filter((item) => Boolean(item));
  }

  private toWireWorkflowState(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'booting') return 'BR';
    if (normalized === 'online_not_ready') return 'NR';
    if (normalized === 'ready_idle') return 'RI';
    if (normalized === 'starting') return 'ST';
    if (normalized === 'running') return 'RN';
    if (normalized === 'pausing') return 'PA';
    if (normalized === 'paused') return 'PS';
    if (normalized === 'resuming') return 'RS';
    if (normalized === 'stopping') return 'SP';
    if (normalized === 'stopped') return 'ED';
    if (normalized === 'error_stop') return 'ER';
    return value;
  }

  private ensureInstance(imei: string) {
    const existing = this.instances.get(imei);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const instance: SimulatorRuntime = {
      imei,
      bridgeId: `bs-sim-${imei}`,
      status: 'stopped',
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      stoppedAt: null,
      lastHeartbeatAt: null,
      lastSnapshotAt: null,
      lastCommandAt: null,
      lastError: null,
      lastPendingCommandCount: 0,
      seqNo: 1,
      registeredOnce: false,
      busy: false,
      runtimeSeconds: 0,
      totalM3: 0,
      energyKwh: 0,
      sessionRef: null,
      workflowState: 'ready_idle',
      pumpRunning: false,
      valveOpen: false,
      sessionActive: false,
      profile: {
        protocol_version: 'hj-device-v2',
        heartbeat_interval_seconds: DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
        config_version: 1,
        feature_modules: ['pump_vfd_control', 'single_valve_control', 'pressure_acquisition', 'flow_acquisition', 'electric_meter_modbus'],
        hardware_sku: 'SIM-CONTROLLER',
        hardware_rev: 'A1',
        firmware_family: 'hj-device-v2',
        firmware_version: 'sim-1.0.0',
        iccid: `SIM-ICCID-${imei.slice(-8)}`,
        battery_soc: 86,
        signal_csq: 24,
        pressure_mpa: 0.32,
        flow_m3h: 18.6,
        voltage_v: 380,
        current_a: 6.8,
        power_kw: 3.4,
      },
      logs: [],
    };
    this.instances.set(imei, instance);
    return instance;
  }

  private mustGetInstance(rawImei: string) {
    const imei = this.asString(rawImei);
    const instance = this.instances.get(imei);
    if (!instance) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'simulator instance not found', 404, { imei });
    }
    return instance;
  }

  private normalizeImeis(imeis?: string[] | null, imeiText?: string | null) {
    const values = [
      ...(Array.isArray(imeis) ? imeis : []),
      ...String(imeiText ?? '')
        .split(/[\s,;，；]+/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ];
    return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
  }

  private appendLog(
    instance: SimulatorRuntime,
    level: SimulatorLogLevel,
    kind: string,
    message: string,
    data?: Record<string, unknown>,
  ) {
    instance.logs.unshift({
      id: randomUUID(),
      ts: new Date().toISOString(),
      level,
      kind,
      message,
      ...(data ? { data } : {}),
    });
    if (instance.logs.length > MAX_LOGS) {
      instance.logs.length = MAX_LOGS;
    }
  }

  private markError(instance: SimulatorRuntime, error: unknown) {
    instance.status = 'error';
    instance.lastError = this.stringifyError(error);
    instance.updatedAt = new Date().toISOString();
    this.appendLog(instance, 'error', 'simulator_error', instance.lastError);
    this.logger.warn(`device simulator ${instance.imei} failed: ${instance.lastError}`);
  }

  private toResponse(instance: SimulatorRuntime) {
    return {
      imei: instance.imei,
      bridge_id: instance.bridgeId,
      status: instance.status,
      created_at: instance.createdAt,
      updated_at: instance.updatedAt,
      started_at: instance.startedAt,
      stopped_at: instance.stoppedAt,
      last_heartbeat_at: instance.lastHeartbeatAt,
      last_snapshot_at: instance.lastSnapshotAt,
      last_command_at: instance.lastCommandAt,
      last_error: instance.lastError,
      last_pending_command_count: instance.lastPendingCommandCount,
      session_ref: instance.sessionRef,
      workflow_state: instance.workflowState,
      pump_running: instance.pumpRunning,
      valve_open: instance.valveOpen,
      session_active: instance.sessionActive,
      runtime_seconds: instance.runtimeSeconds,
      total_m3: Number(instance.totalM3.toFixed(3)),
      energy_kwh: Number(instance.energyKwh.toFixed(3)),
      profile: instance.profile,
      recent_logs: instance.logs.slice(0, 12),
    };
  }

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private asStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.map((item) => this.asString(item)).filter((item) => Boolean(item))
      : [];
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'unknown simulator error';
  }
}
