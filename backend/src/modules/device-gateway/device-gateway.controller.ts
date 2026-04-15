import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ok } from '../../common/http/api-response';
import { DeviceGatewayMaintainerService } from './device-gateway-maintainer.service';
import { DeviceGatewaySimulatorService } from './device-gateway-simulator.service';
import {
  resolveExecuteActionDispatchPolicy,
  resolveQueryDispatchPolicy,
  resolveSyncConfigDispatchPolicy,
} from './device-command-dispatch-policy';
import { DeviceGatewayService } from './device-gateway.service';
import { TcpJsonV1Server } from './tcp-json-v1.server';

@Controller('ops/device-gateway')
export class DeviceGatewayController {
  constructor(
    private readonly service: DeviceGatewayService,
    private readonly maintainerService: DeviceGatewayMaintainerService,
    private readonly simulatorService: DeviceGatewaySimulatorService,
    private readonly tcpServer: TcpJsonV1Server,
  ) {}

  private normalizeDispatchMode(value: string | null | undefined, defaultMode: 'sync' | 'async') {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === 'async' ? 'async' : normalized === 'sync' ? 'sync' : defaultMode;
  }

  @Post('runtime-events')
  async ingestRuntimeEvent(@Body() body: Record<string, unknown>) {
    return ok(await this.service.ingestRuntimeEvent(body ?? {}));
  }

  @Get('events')
  async listRecentEvents(
    @Query('imei') imei?: string,
    @Query('session_ref') sessionRef?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listRecentEvents({
        imei,
        session_ref: sessionRef,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Get('scan-controller-register-spec')
  registerSpec() {
    return ok(this.service.getScanControllerTrialRegisterSpec());
  }

  @Get('logs')
  async listInteractionLogs(
    @Query('device_id') deviceId?: string,
    @Query('imei') imei?: string,
    @Query('direction') direction?: string,
    @Query('msg_type') msgType?: string,
    @Query('event_type') eventType?: string,
    @Query('session_ref') sessionRef?: string,
    @Query('command_id') commandId?: string,
    @Query('keyword') keyword?: string,
    @Query('start_at') startAt?: string,
    @Query('end_at') endAt?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listInteractionLogs({
        device_id: deviceId,
        imei,
        direction,
        msg_type: msgType,
        event_type: eventType,
        session_ref: sessionRef,
        command_id: commandId,
        keyword,
        start_at: startAt,
        end_at: endAt,
        cursor,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Get('logs/:id/raw')
  async downloadInteractionLogRaw(@Param('id') id: string, @Res() res: Response) {
    const raw = await this.service.getInteractionLogRaw(id);
    res.setHeader('Content-Type', `${raw.content_type}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${raw.file_name}"`);
    res.send(raw.body);
  }

  @Get('tcp-audits')
  async listTcpAudits(
    @Query('imei') imei?: string,
    @Query('connection_id') connectionId?: string,
    @Query('direction') direction?: string,
    @Query('parse_status') parseStatus?: string,
    @Query('ingest_status') ingestStatus?: string,
    @Query('keyword') keyword?: string,
    @Query('start_at') startAt?: string,
    @Query('end_at') endAt?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listTcpAuditLogs({
        imei,
        connection_id: connectionId,
        direction,
        parse_status: parseStatus,
        ingest_status: ingestStatus,
        keyword,
        start_at: startAt,
        end_at: endAt,
        cursor,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Get('card-audits')
  async listCardAudits(
    @Query('imei') imei?: string,
    @Query('event_code') eventCode?: string,
    @Query('reason_code') reasonCode?: string,
    @Query('audit_outcome') auditOutcome?: string,
    @Query('card_token_suffix') cardTokenSuffix?: string,
    @Query('keyword') keyword?: string,
    @Query('start_at') startAt?: string,
    @Query('end_at') endAt?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listCardAuditLogs({
        imei,
        event_code: eventCode,
        reason_code: reasonCode,
        audit_outcome: auditOutcome,
        card_token_suffix: cardTokenSuffix,
        keyword,
        start_at: startAt,
        end_at: endAt,
        cursor,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Get('runtime-shadow')
  async listRuntimeShadows(
    @Query('project_id') projectId?: string,
    @Query('block_id') blockId?: string,
    @Query('imei') imei?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listRuntimeShadows({
        project_id: projectId,
        block_id: blockId,
        imei,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Get('runtime-shadow/:imei')
  async runtimeShadowDetail(@Param('imei') imei: string) {
    return ok(await this.service.getRuntimeShadow(imei));
  }

  @Get('channel-latest')
  async listChannelLatest(
    @Query('device_id') deviceId?: string,
    @Query('imei') imei?: string,
    @Query('project_id') projectId?: string,
    @Query('block_id') blockId?: string,
    @Query('metric_code') metricCode?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listChannelLatest({
        device_id: deviceId,
        imei,
        project_id: projectId,
        block_id: blockId,
        metric_code: metricCode,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Get('queue-health')
  async queueHealth() {
    return ok(await this.service.getQueueHealth());
  }

  @Get('connection-health')
  async connectionHealth() {
    return ok(await this.service.getConnectionHealth());
  }

  @Get('recovery-health')
  async recoveryHealth() {
    return ok(this.maintainerService.getRecoveryHealth());
  }

  @Get('recovery-recommendations')
  async recoveryRecommendations() {
    return ok(await this.service.getRecoveryRecommendations());
  }

  @Get('dead-letters')
  async deadLetters(
    @Query('imei') imei?: string,
    @Query('session_ref') sessionRef?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listDeadLetters({
        imei,
        session_ref: sessionRef,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Post('sweep-retries')
  async sweepRetries() {
    return ok(await this.service.sweepRetries());
  }

  @Post('sweep-connections')
  async sweepConnections() {
    return ok(await this.service.sweepConnections());
  }

  @Post('query')
  async dispatchQuery(
    @Body()
    body?: {
      target_device_id?: string | null;
      imei?: string | null;
      session_id?: string | null;
      session_ref?: string | null;
      qc?: string | null;
      query_code?: string | null;
      scope?: string | null;
      module_code?: string | null;
      module_instance_code?: string | null;
      channel_code?: string | null;
      metric_codes?: string[] | null;
      payload?: Record<string, unknown> | null;
      source?: string | null;
      dispatch_mode?: string | null;
    }
  ) {
    const request = {
      ...(body ?? {}),
      query_code: body?.qc ?? body?.query_code ?? null,
    };
    const result = await this.service.dispatchQuery(request);
    const policy = resolveQueryDispatchPolicy(request.query_code);
    const requestedMode = this.normalizeDispatchMode(body?.dispatch_mode, policy.defaultDispatchMode);
    const dispatchMode = policy.allowAsync ? requestedMode : 'sync';
    const delivery =
      dispatchMode === 'sync'
        ? await this.tcpServer.dispatchQueuedCommandNow(result.command.command_token)
        : {
            attempted: false,
            delivered: false,
            mode: 'queued',
            reason: 'async_dispatch_requested'
          };
    return ok({
      ...result,
      dispatch_mode: dispatchMode,
      dispatch_policy: policy,
      delivery
    });
  }

  @Post('execute')
  async dispatchExecuteAction(
    @Body()
    body?: {
      target_device_id?: string | null;
      imei?: string | null;
      session_id?: string | null;
      session_ref?: string | null;
      order_id?: string | null;
      ac?: string | null;
      action_code?: string | null;
      scope?: string | null;
      module_code?: string | null;
      module_instance_code?: string | null;
      channel_code?: string | null;
      payload?: Record<string, unknown> | null;
      start_token?: string | null;
      source?: string | null;
      dispatch_mode?: string | null;
    }
  ) {
    const request = {
      ...(body ?? {}),
      action_code: body?.ac ?? body?.action_code ?? null,
    };
    const result = await this.service.dispatchExecuteAction(request);
    const policy = resolveExecuteActionDispatchPolicy(request.action_code);
    const requestedMode = this.normalizeDispatchMode(body?.dispatch_mode, policy.defaultDispatchMode);
    const dispatchMode = policy.allowAsync ? requestedMode : 'sync';
    const delivery =
      dispatchMode === 'sync'
        ? await this.tcpServer.dispatchQueuedCommandNow(result.command.command_token)
        : {
            attempted: false,
            delivered: false,
            mode: 'queued',
            reason: 'async_dispatch_requested'
          };
    return ok({
      ...result,
      dispatch_mode: dispatchMode,
      dispatch_policy: policy,
      delivery
    });
  }

  @Post('sync-config')
  async dispatchSyncConfig(
    @Body()
    body?: {
      target_device_id?: string | null;
      imei?: string | null;
      session_id?: string | null;
      session_ref?: string | null;
      config_version?: number | null;
      firmware_family?: string | null;
      feature_modules?: string[] | null;
      control_config?: Record<string, unknown> | null;
      channel_bindings?: unknown[] | null;
      runtime_rules?: Record<string, unknown> | null;
      resource_inventory?: Record<string, unknown> | null;
      payload?: Record<string, unknown> | null;
      source?: string | null;
      dispatch_mode?: string | null;
    }
  ) {
    const result = await this.service.dispatchSyncConfig(body ?? {});
    const policy = resolveSyncConfigDispatchPolicy();
    const requestedMode = this.normalizeDispatchMode(body?.dispatch_mode, policy.defaultDispatchMode);
    const dispatchMode = policy.allowAsync ? requestedMode : 'sync';
    const delivery =
      dispatchMode === 'sync'
        ? await this.tcpServer.dispatchQueuedCommandNow(result.command.command_token)
        : {
            attempted: false,
            delivered: false,
            mode: 'queued',
            reason: 'async_dispatch_default'
          };
    return ok({
      ...result,
      dispatch_mode: dispatchMode,
      dispatch_policy: policy,
      delivery
    });
  }

  @Get('commands')
  async listCommands(
    @Query('imei') imei?: string,
    @Query('target_device_id') targetDeviceId?: string,
    @Query('session_ref') sessionRef?: string,
    @Query('command_status') commandStatus?: string,
    @Query('command_code') commandCode?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listCommands({
        imei,
        target_device_id: targetDeviceId,
        session_ref: sessionRef,
        command_status: commandStatus,
        command_code: commandCode,
        limit: limit ? Number(limit) : undefined,
      })
    );
  }

  @Get('commands/:id')
  async commandDetail(@Param('id') id: string) {
    return ok(await this.service.getCommand(id));
  }

  @Post('commands/:id/requeue')
  async requeueCommand(@Param('id') id: string) {
    return ok(await this.service.requeueCommand(id));
  }

  @Post('bridge/connect')
  async bridgeConnect(
    @Body()
    body?: {
      imei?: string;
      bridge_id?: string | null;
      protocol_version?: string | null;
      remote_addr?: string | null;
      remote_port?: number | null;
    }
  ) {
    return ok(await this.service.connectBridge(body ?? {}));
  }

  @Post('bridge/heartbeat')
  async bridgeHeartbeat(
    @Body()
    body?: {
      imei?: string;
      bridge_id?: string | null;
      session_ref?: string | null;
      msg_id?: string | null;
      seq_no?: number | null;
      device_ts?: string | null;
      remote_addr?: string | null;
      remote_port?: number | null;
      dispatch_pending_commands?: boolean | null;
      mark_sent?: boolean | null;
      include_sent?: boolean | null;
      limit?: number | null;
      payload?: Record<string, unknown>;
    }
  ) {
    return ok(await this.service.heartbeatBridge(body ?? {}));
  }

  @Post('bridge/disconnect')
  async bridgeDisconnect(
    @Body()
    body?: {
      bridge_id?: string | null;
      imei?: string | null;
      connection_id?: string | null;
    }
  ) {
    return ok(await this.service.disconnectBridge(body ?? {}));
  }

  @Post('commands')
  async queueCommand(
    @Body()
    body?: {
      target_device_id?: string;
      imei?: string;
      session_id?: string | null;
      session_ref?: string | null;
      order_id?: string | null;
      command_code?: string;
      request_payload?: Record<string, unknown>;
      start_token?: string | null;
      request_msg_id?: string | null;
      request_seq_no?: number | null;
      create_dispatch?: boolean;
      source?: string | null;
    }
  ) {
    return ok(await this.service.queueCommand(body ?? {}));
  }

  @Get('pending-commands')
  async pullPendingCommands(
    @Query('imei') imei?: string,
    @Query('session_ref') sessionRef?: string,
    @Query('limit') limit?: string,
    @Query('mark_sent') markSent?: string,
    @Query('include_sent') includeSent?: string
  ) {
    return ok(
      await this.service.pullPendingCommands({
        imei,
        session_ref: sessionRef,
        limit: limit ? Number(limit) : undefined,
        mark_sent: markSent ? markSent !== 'false' : undefined,
        include_sent: includeSent === 'true'
      })
    );
  }

  @Get('simulator/instances')
  async listSimulatorInstances() {
    return ok(this.simulatorService.listInstances());
  }

  @Post('simulator/instances')
  async addSimulatorInstances(
    @Body()
    body?: {
      imeis?: string[] | null;
      imei_text?: string | null;
      auto_start?: boolean | null;
    },
  ) {
    return ok(await this.simulatorService.addInstances(body ?? {}));
  }

  @Post('simulator/instances/start')
  async startAllSimulatorInstances() {
    return ok(await this.simulatorService.startAll());
  }

  @Post('simulator/instances/stop')
  async stopAllSimulatorInstances() {
    return ok(await this.simulatorService.stopAll());
  }

  @Post('simulator/instances/:imei/start')
  async startSimulatorInstance(@Param('imei') imei: string) {
    return ok(await this.simulatorService.startInstance(imei));
  }

  @Post('simulator/instances/:imei/stop')
  async stopSimulatorInstance(@Param('imei') imei: string) {
    return ok(await this.simulatorService.stopInstance(imei));
  }

  @Post('simulator/instances/:imei/tick')
  async tickSimulatorInstance(@Param('imei') imei: string) {
    return ok(await this.simulatorService.tickOnce(imei));
  }

  @Post('simulator/instances/:imei/remove')
  async removeSimulatorInstance(@Param('imei') imei: string) {
    return ok(await this.simulatorService.removeInstance(imei));
  }
}
