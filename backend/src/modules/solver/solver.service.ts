import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { NetworkModelService } from '../network-model/network-model.service';
import {
  buildPumpValveTopologyRelationReadModel,
  type PumpValveTopologyRelationReadModel
} from '../topology/pump-valve-topology-read-model';
import {
  SOLVER_CONTRACT_VERSION,
  SolverExplainRequestDto,
  SolverPlanRequestDto,
  SolverPreviewRequestDto,
  SolverSimulateRequestDto
} from './solver.dto';
import { buildSolverRuntimeSnapshot, type SolverRuntimeSnapshot } from './solver-runtime';

type SolverRuntimeIssue = {
  code: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
};

type SolverDeviceState = {
  role: 'well' | 'pump' | 'valve';
  deviceId: string | null;
  imei: string | null;
  deviceCode: string | null;
  deviceName: string | null;
  lifecycleState: string | null;
  onlineState: string | null;
  connectionState: string | null;
};

type SolverRuntimeContext = {
  dispatchable: boolean;
  relationScope: {
    relationId: string;
    wellId: string;
    pumpId: string;
    valveId: string;
    wellName: string;
    pumpName: string;
    valveName: string;
  };
  deviceStates: SolverDeviceState[];
  activeSessions: {
    total: number;
    items: Array<{
      id: string;
      sessionNo: string;
      sessionRef: string | null;
      status: string;
      startedAt: string | null;
    }>;
  };
  queuePressure: {
    counts: {
      created: number;
      sent: number;
      retryPending: number;
      readyRetryPending: number;
      blockedRetryPending: number;
      failed: number;
      deadLetter: number;
    };
    busyCommandCount: number;
    affectedDeviceCount: number;
  };
  blockers: SolverRuntimeIssue[];
  warnings: SolverRuntimeIssue[];
};

type SolverDeviceAvailabilityOverride = {
  byRole: Record<string, unknown> | null;
  devices: Record<string, unknown> | null;
  wells: Record<string, unknown> | null;
  pumps: Record<string, unknown> | null;
  valves: Record<string, unknown> | null;
  sensors: Record<string, unknown> | null;
};

type SolverReadModel = {
  networkModelVersion: {
    id: string;
    networkModelId: string;
    versionNo: number;
    isPublished: boolean;
    publishedAt: string | null;
    sourceFileRef: string | null;
    createdAt: string | null;
  };
  networkGraphSnapshot: {
    source: 'database';
    versionId: string;
    nodeCount: number;
    pipeCount: number;
  };
  pumpValveTopology: {
    id: string;
    wellId: string;
    pumpId: string;
    valveId: string;
    wellName: string;
    pumpName: string;
    valveName: string;
    wellDeviceId: string | null;
    wellImei: string | null;
    wellDeviceCode: string | null;
    wellDeviceName: string | null;
    wellLifecycleState: string | null;
    wellOnlineState: string | null;
    wellConnectionState: string | null;
    pumpDeviceId: string | null;
    pumpImei: string | null;
    pumpDeviceCode: string | null;
    pumpDeviceName: string | null;
    pumpLifecycleState: string | null;
    pumpOnlineState: string | null;
    pumpConnectionState: string | null;
    valveDeviceId: string | null;
    valveImei: string | null;
    valveDeviceCode: string | null;
    valveDeviceName: string | null;
    valveLifecycleState: string | null;
    valveOnlineState: string | null;
    valveConnectionState: string | null;
    relationRole: string;
    sequenceMode: string;
    valveDelaySeconds: number;
    pumpDelaySeconds: number;
    pumpValveTopologyReadModel: PumpValveTopologyRelationReadModel;
  } | null;
  runtimeContext: SolverRuntimeContext | null;
};

type SolverPlanBundle = {
  feasible: boolean;
  dispatchable: boolean;
  objective: ReturnType<SolverService['normalizeObjective']>;
  horizonMinutes: number | null;
  summary: {
    sequence_mode: string | null;
    topology_relation_type: string | null;
    total_steps: number;
    default_run_minutes: number | null;
    selected_objective: string | null;
    candidate_count: number;
    selected_score: number | null;
    selected_risk_level: string | null;
    selected_blocked: boolean;
    blocker_count: number;
    warning_count: number;
  };
  selected_plan_id: string | null;
  units: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
  plans: Array<Record<string, unknown>>;
  explanations: string[];
  runtimeSnapshot: SolverRuntimeSnapshot | null;
};

@Injectable()
export class SolverService {
  constructor(
    private readonly db: DatabaseService,
    private readonly networkModels: NetworkModelService
  ) {}

  private toNumber(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private buildRuntimeIssue(
    code: string,
    severity: SolverRuntimeIssue['severity'],
    message: string
  ): SolverRuntimeIssue {
    return { code, severity, message };
  }

  private async buildRuntimeContext(
    pumpValveTopology: NonNullable<SolverReadModel['pumpValveTopology']>,
    constraints?: Record<string, unknown>
  ): Promise<SolverRuntimeContext> {
    const deviceStates: SolverDeviceState[] = [
      {
        role: 'well',
        deviceId: pumpValveTopology.wellDeviceId,
        imei: pumpValveTopology.wellImei,
        deviceCode: pumpValveTopology.wellDeviceCode,
        deviceName: pumpValveTopology.wellDeviceName,
        lifecycleState: pumpValveTopology.wellLifecycleState,
        onlineState: pumpValveTopology.wellOnlineState,
        connectionState: pumpValveTopology.wellConnectionState
      },
      {
        role: 'pump',
        deviceId: pumpValveTopology.pumpDeviceId,
        imei: pumpValveTopology.pumpImei,
        deviceCode: pumpValveTopology.pumpDeviceCode,
        deviceName: pumpValveTopology.pumpDeviceName,
        lifecycleState: pumpValveTopology.pumpLifecycleState,
        onlineState: pumpValveTopology.pumpOnlineState,
        connectionState: pumpValveTopology.pumpConnectionState
      },
      {
        role: 'valve',
        deviceId: pumpValveTopology.valveDeviceId,
        imei: pumpValveTopology.valveImei,
        deviceCode: pumpValveTopology.valveDeviceCode,
        deviceName: pumpValveTopology.valveDeviceName,
        lifecycleState: pumpValveTopology.valveLifecycleState,
        onlineState: pumpValveTopology.valveOnlineState,
        connectionState: pumpValveTopology.valveConnectionState
      }
    ];
    const availabilityOverride = this.extractDeviceAvailabilityOverride(constraints);

    const [activeSessionsResult, queuePressureResult] = await Promise.all([
      this.db.query<{
        id: string;
        sessionNo: string;
        sessionRef: string | null;
        status: string;
        startedAt: string | null;
      }>(
        `
        select
          rs.id,
          rs.session_no as "sessionNo",
          rs.session_ref as "sessionRef",
          rs.status,
          rs.started_at as "startedAt"
        from runtime_session rs
        where rs.well_id = $1
          and rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
        order by rs.created_at desc
        limit 5
        `,
        [pumpValveTopology.wellId]
      ),
      this.db.query<{
        createdCount: number;
        sentCount: number;
        retryPendingCount: number;
        readyRetryPendingCount: number;
        blockedRetryPendingCount: number;
        failedCount: number;
        deadLetterCount: number;
        affectedDeviceCount: number;
      }>(
        `
        select
          count(*) filter (where dc.command_status = 'created')::int as "createdCount",
          count(*) filter (where dc.command_status = 'sent')::int as "sentCount",
          count(*) filter (where dc.command_status = 'retry_pending')::int as "retryPendingCount",
          count(*) filter (
            where dc.command_status = 'retry_pending'
              and coalesce(nullif(dc.response_payload_json->'transport'->>'next_retry_at', '')::timestamptz, now()) <= now()
          )::int as "readyRetryPendingCount",
          count(*) filter (
            where dc.command_status = 'retry_pending'
              and coalesce(nullif(dc.response_payload_json->'transport'->>'next_retry_at', '')::timestamptz, now()) > now()
          )::int as "blockedRetryPendingCount",
          count(*) filter (where dc.command_status = 'failed')::int as "failedCount",
          count(*) filter (where dc.command_status = 'dead_letter')::int as "deadLetterCount",
          count(distinct coalesce(nullif(dc.imei, ''), dc.target_device_id::text)) filter (
            where dc.command_status in ('created', 'sent', 'retry_pending', 'failed', 'dead_letter')
          )::int as "affectedDeviceCount"
        from device_command dc
        where dc.tenant_id = '00000000-0000-0000-0000-000000000001'
          and (
            ($1::text is not null and dc.imei = $1)
            or ($2::text is not null and dc.imei = $2)
            or ($3::text is not null and dc.imei = $3)
            or ($4::uuid is not null and dc.target_device_id = $4::uuid)
            or ($5::uuid is not null and dc.target_device_id = $5::uuid)
            or ($6::uuid is not null and dc.target_device_id = $6::uuid)
          )
        `,
        [
          pumpValveTopology.wellImei,
          pumpValveTopology.pumpImei,
          pumpValveTopology.valveImei,
          pumpValveTopology.wellDeviceId,
          pumpValveTopology.pumpDeviceId,
          pumpValveTopology.valveDeviceId
        ]
      )
    ]);

    const activeSessions = {
      total: activeSessionsResult.rows.length,
      items: activeSessionsResult.rows
    };
    const queuePressureRow = queuePressureResult.rows[0] ?? {
      createdCount: 0,
      sentCount: 0,
      retryPendingCount: 0,
      readyRetryPendingCount: 0,
      blockedRetryPendingCount: 0,
      failedCount: 0,
      deadLetterCount: 0,
      affectedDeviceCount: 0
    };
    const queuePressure = {
      counts: {
        created: queuePressureRow.createdCount,
        sent: queuePressureRow.sentCount,
        retryPending: queuePressureRow.retryPendingCount,
        readyRetryPending: queuePressureRow.readyRetryPendingCount,
        blockedRetryPending: queuePressureRow.blockedRetryPendingCount,
        failed: queuePressureRow.failedCount,
        deadLetter: queuePressureRow.deadLetterCount
      },
      busyCommandCount: queuePressureRow.sentCount + queuePressureRow.retryPendingCount,
      affectedDeviceCount: queuePressureRow.affectedDeviceCount
    };

    const blockers: SolverRuntimeIssue[] = [];
    const warnings: SolverRuntimeIssue[] = [];

    if (activeSessions.total > 0) {
      blockers.push(
        this.buildRuntimeIssue(
          'active_session_exists',
          'critical',
          `The selected well already has ${activeSessions.total} active runtime session(s).`
        )
      );
    }

    deviceStates.forEach((device) => {
      const deviceLabel = device.deviceName || device.deviceCode || device.role;
      const simulatedAvailability = this.resolveDeviceAvailabilityOverride(
        device,
        pumpValveTopology,
        availabilityOverride
      );
      if (simulatedAvailability === false) {
        blockers.push(
          this.buildRuntimeIssue(
            `device_unavailable_${device.role}`,
            'critical',
            `${deviceLabel} is marked unavailable in the current simulation context.`
          )
        );
        return;
      }
      if (simulatedAvailability === true) {
        const actualStateIssues: string[] = [];
        if (device.lifecycleState && device.lifecycleState !== 'active') {
          actualStateIssues.push(`lifecycle=${device.lifecycleState}`);
        }
        if (device.onlineState && device.onlineState !== 'online') {
          actualStateIssues.push(`online=${device.onlineState}`);
        }
        if (device.connectionState && device.connectionState !== 'connected') {
          actualStateIssues.push(`connection=${device.connectionState}`);
        }
        if (actualStateIssues.length > 0) {
          warnings.push(
            this.buildRuntimeIssue(
              `device_availability_override_${device.role}`,
              'warning',
              `${deviceLabel} is forced available by simulation override despite current ledger state (${actualStateIssues.join(
                ', '
              )}).`
            )
          );
        }
        return;
      }
      if (device.lifecycleState && device.lifecycleState !== 'active') {
        blockers.push(
          this.buildRuntimeIssue(
            `device_inactive_${device.role}`,
            'critical',
            `${deviceLabel} is not in active lifecycle state.`
          )
        );
        return;
      }
      if (device.onlineState && device.onlineState !== 'online') {
        blockers.push(
          this.buildRuntimeIssue(
            `device_offline_${device.role}`,
            'critical',
            `${deviceLabel} is offline and cannot join a new dispatch.`
          )
        );
        return;
      }
      if (device.connectionState && device.connectionState !== 'connected') {
        blockers.push(
          this.buildRuntimeIssue(
            `device_disconnected_${device.role}`,
            'critical',
            `${deviceLabel} is not currently connected to the gateway transport.`
          )
        );
      }
    });

    if (queuePressure.counts.deadLetter > 0) {
      blockers.push(
        this.buildRuntimeIssue(
          'dead_letter_pending',
          'critical',
          `There are ${queuePressure.counts.deadLetter} dead-letter command(s) on the same device lane.`
        )
      );
    }

    if (queuePressure.busyCommandCount > 0) {
      blockers.push(
        this.buildRuntimeIssue(
          'device_queue_busy',
          'critical',
          `There are ${queuePressure.busyCommandCount} in-flight or retry-pending command(s) on the same device lane.`
        )
      );
    }

    if (queuePressure.counts.created > 0) {
      warnings.push(
        this.buildRuntimeIssue(
          'created_commands_waiting',
          'warning',
          `There are ${queuePressure.counts.created} created command(s) still waiting to be sent.`
        )
      );
    }

    if (queuePressure.counts.failed > 0) {
      warnings.push(
        this.buildRuntimeIssue(
          'recent_failed_commands',
          'warning',
          `There are ${queuePressure.counts.failed} recently failed command(s) on the same device lane.`
        )
      );
    }

    if (queuePressure.counts.readyRetryPending > 0) {
      warnings.push(
        this.buildRuntimeIssue(
          'retry_window_open',
          'warning',
          `There are ${queuePressure.counts.readyRetryPending} retry-pending command(s) already due for recovery.`
        )
      );
    }

    if (queuePressure.counts.blockedRetryPending > 0) {
      warnings.push(
        this.buildRuntimeIssue(
          'retry_window_waiting',
          'info',
          `There are ${queuePressure.counts.blockedRetryPending} retry-pending command(s) still inside backoff.`
        )
      );
    }

    return {
      dispatchable: blockers.length === 0,
      relationScope: {
        relationId: pumpValveTopology.id,
        wellId: pumpValveTopology.wellId,
        pumpId: pumpValveTopology.pumpId,
        valveId: pumpValveTopology.valveId,
        wellName: pumpValveTopology.wellName,
        pumpName: pumpValveTopology.pumpName,
        valveName: pumpValveTopology.valveName
      },
      deviceStates,
      activeSessions,
      queuePressure,
      blockers,
      warnings
    };
  }

  private async buildReadModel(dto: SolverPreviewRequestDto): Promise<SolverReadModel> {
    const ver = await this.networkModels.getPublishedVersionById(dto.network_model_version_id);
    if (!ver) {
      throw new BadRequestException(
        'solver requires network_model_version_id to reference a published network_model_version row'
      );
    }

    const counts = await this.networkModels.countGraphElements(ver.id);

    const networkModelVersion: SolverReadModel['networkModelVersion'] = {
      id: ver.id,
      networkModelId: ver.network_model_id,
      versionNo: ver.version_no,
      isPublished: ver.is_published,
      publishedAt: ver.published_at ? ver.published_at.toISOString() : null,
      sourceFileRef: ver.source_file_ref,
      createdAt: ver.created_at.toISOString()
    };

    const networkGraphSnapshot = {
      source: 'database' as const,
      versionId: ver.id,
      nodeCount: counts.nodeCount,
      pipeCount: counts.pipeCount
    };

    let pumpValveTopology: SolverReadModel['pumpValveTopology'] = null;
    let runtimeContext: SolverRuntimeContext | null = null;
    if (dto.pump_valve_relation_id) {
      const r = await this.db.query<{
        id: string;
        well_id: string;
        pump_id: string;
        valve_id: string;
        relation_role: string;
        relation_config_json: Record<string, unknown>;
        topology_relation_type_state: Record<string, unknown>;
        well_name: string;
        pump_name: string;
        valve_name: string;
        well_device_id: string | null;
        well_imei: string | null;
        well_device_code: string | null;
        well_device_name: string | null;
        well_lifecycle_state: string | null;
        well_online_state: string | null;
        well_connection_state: string | null;
        pump_device_id: string | null;
        pump_imei: string | null;
        pump_device_code: string | null;
        pump_device_name: string | null;
        pump_lifecycle_state: string | null;
        pump_online_state: string | null;
        pump_connection_state: string | null;
        valve_device_id: string | null;
        valve_imei: string | null;
        valve_device_code: string | null;
        valve_device_name: string | null;
        valve_lifecycle_state: string | null;
        valve_online_state: string | null;
        valve_connection_state: string | null;
      }>(
        `
        select
          pvr.id,
          pvr.well_id,
          pvr.pump_id,
          pvr.valve_id,
          pvr.relation_role,
          coalesce(pvr.relation_config_json, '{}'::jsonb) as relation_config_json,
          coalesce(pvr.topology_relation_type_state, '{}'::jsonb) as topology_relation_type_state,
          coalesce(w.safety_profile_json->>'displayName', wd.device_name, w.well_code) as well_name,
          coalesce(pd.device_name, p.pump_code) as pump_name,
          coalesce(vd.device_name, v.valve_code) as valve_name,
          wd.id::text as well_device_id,
          wd.imei as well_imei,
          wd.device_code as well_device_code,
          wd.device_name as well_device_name,
          wd.lifecycle_state as well_lifecycle_state,
          wd.online_state as well_online_state,
          wd.connection_state as well_connection_state,
          pd.id::text as pump_device_id,
          pd.imei as pump_imei,
          pd.device_code as pump_device_code,
          pd.device_name as pump_device_name,
          pd.lifecycle_state as pump_lifecycle_state,
          pd.online_state as pump_online_state,
          pd.connection_state as pump_connection_state,
          vd.id::text as valve_device_id,
          vd.imei as valve_imei,
          vd.device_code as valve_device_code,
          vd.device_name as valve_device_name,
          vd.lifecycle_state as valve_lifecycle_state,
          vd.online_state as valve_online_state,
          vd.connection_state as valve_connection_state
        from pump_valve_relation pvr
        join well w on w.id = pvr.well_id
        join pump p on p.id = pvr.pump_id
        join valve v on v.id = pvr.valve_id
        left join device wd on wd.id = w.device_id
        left join device pd on pd.id = p.device_id
        left join device vd on vd.id = v.device_id
        where pvr.id = $1
        `,
        [dto.pump_valve_relation_id]
      );
      const row = r.rows[0];
      if (row) {
        const readModel = buildPumpValveTopologyRelationReadModel(row.topology_relation_type_state);
        const relationConfig = row.relation_config_json ?? {};
        const topology: NonNullable<SolverReadModel['pumpValveTopology']> = {
          id: row.id,
          wellId: row.well_id,
          pumpId: row.pump_id,
          valveId: row.valve_id,
          wellName: row.well_name,
          pumpName: row.pump_name,
          valveName: row.valve_name,
          wellDeviceId: row.well_device_id,
          wellImei: row.well_imei,
          wellDeviceCode: row.well_device_code,
          wellDeviceName: row.well_device_name,
          wellLifecycleState: row.well_lifecycle_state,
          wellOnlineState: row.well_online_state,
          wellConnectionState: row.well_connection_state,
          pumpDeviceId: row.pump_device_id,
          pumpImei: row.pump_imei,
          pumpDeviceCode: row.pump_device_code,
          pumpDeviceName: row.pump_device_name,
          pumpLifecycleState: row.pump_lifecycle_state,
          pumpOnlineState: row.pump_online_state,
          pumpConnectionState: row.pump_connection_state,
          valveDeviceId: row.valve_device_id,
          valveImei: row.valve_imei,
          valveDeviceCode: row.valve_device_code,
          valveDeviceName: row.valve_device_name,
          valveLifecycleState: row.valve_lifecycle_state,
          valveOnlineState: row.valve_online_state,
          valveConnectionState: row.valve_connection_state,
          relationRole: row.relation_role,
          sequenceMode: String(relationConfig.sequence ?? 'valve_first'),
          valveDelaySeconds: this.toNumber(relationConfig.valveDelaySeconds, 0),
          pumpDelaySeconds: this.toNumber(relationConfig.pumpDelaySeconds, 0),
          pumpValveTopologyReadModel: readModel
        };
        pumpValveTopology = topology;
        runtimeContext = await this.buildRuntimeContext(topology, dto.constraints);
      }
    }

    return { networkModelVersion, networkGraphSnapshot, pumpValveTopology, runtimeContext };
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  }

  private toOptionalBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'online', 'available', 'enabled'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'offline', 'unavailable', 'disabled'].includes(normalized)) {
      return false;
    }
    return null;
  }

  private extractDeviceAvailabilityOverride(
    constraints?: Record<string, unknown>
  ): SolverDeviceAvailabilityOverride | null {
    const root = this.asObject(constraints?.device_availability);
    if (!root) return null;
    return {
      byRole: this.asObject(root.by_role),
      devices: this.asObject(root.devices),
      wells: this.asObject(root.wells),
      pumps: this.asObject(root.pumps),
      valves: this.asObject(root.valves),
      sensors: this.asObject(root.sensors)
    };
  }

  private resolveAvailabilityFromBucket(
    bucket: Record<string, unknown> | null,
    keys: Array<string | null | undefined>
  ): boolean | null {
    if (!bucket) return null;
    for (const rawKey of keys) {
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!key) continue;
      const resolved = this.toOptionalBoolean(bucket[key]);
      if (resolved !== null) {
        return resolved;
      }
    }
    return null;
  }

  private resolveDeviceAvailabilityOverride(
    device: SolverDeviceState,
    pumpValveTopology: NonNullable<SolverReadModel['pumpValveTopology']>,
    availabilityOverride: SolverDeviceAvailabilityOverride | null
  ): boolean | null {
    if (!availabilityOverride) return null;

    const directByRole =
      this.toOptionalBoolean(availabilityOverride.byRole?.[device.role]) ??
      this.toOptionalBoolean((availabilityOverride as Record<string, unknown>)[device.role]);
    if (directByRole !== null) {
      return directByRole;
    }

    const entityId =
      device.role === 'well'
        ? pumpValveTopology.wellId
        : device.role === 'pump'
          ? pumpValveTopology.pumpId
          : pumpValveTopology.valveId;
    const entityName =
      device.role === 'well'
        ? pumpValveTopology.wellName
        : device.role === 'pump'
          ? pumpValveTopology.pumpName
          : pumpValveTopology.valveName;
    const roleBucket =
      device.role === 'well'
        ? availabilityOverride.wells
        : device.role === 'pump'
          ? availabilityOverride.pumps
          : availabilityOverride.valves;
    const candidateKeys = [entityId, entityName, device.deviceId, device.imei, device.deviceCode, device.deviceName];
    return (
      this.resolveAvailabilityFromBucket(roleBucket, candidateKeys) ??
      this.resolveAvailabilityFromBucket(availabilityOverride.devices, [device.role, ...candidateKeys])
    );
  }

  private extractActiveOutletIds(constraints?: Record<string, unknown>) {
    const value = constraints?.active_outlet_ids;
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item): item is string => Boolean(item));
  }

  private async loadGraphDraftSnapshotByVersion(versionId: string) {
    const snapshotResult = await this.db.query<{ graph_draft_snapshot: unknown }>(
      `
      select source_meta_json->'graph_draft_snapshot' as graph_draft_snapshot
      from network_model_version
      where id = $1::uuid and is_published = true
      `,
      [versionId]
    );
    const snapshot = this.asObject(snapshotResult.rows[0]?.graph_draft_snapshot);
    if (snapshot) {
      return snapshot;
    }

    const [nodesResult, pipesResult] = await Promise.all([
      this.db.query<{
        node_code: string;
        node_type: string;
        altitude: string | number | null;
      }>(
        `
        select node_code, node_type, altitude
        from network_node
        where version_id = $1::uuid
        order by node_code asc
        `,
        [versionId]
      ),
      this.db.query<{
        pipe_code: string;
        pipe_type: string;
        from_node_code: string;
        to_node_code: string;
        length_m: string | number | null;
        diameter_mm: string | number | null;
      }>(
        `
        select
          np.pipe_code,
          np.pipe_type,
          nfrom.node_code as from_node_code,
          nto.node_code as to_node_code,
          np.length_m,
          np.diameter_mm
        from network_pipe np
        join network_node nfrom on nfrom.id = np.from_node_id
        join network_node nto on nto.id = np.to_node_id
        where np.version_id = $1::uuid
        order by np.pipe_code asc
        `,
        [versionId]
      ),
    ]);

    if (nodesResult.rows.length === 0 && pipesResult.rows.length === 0) {
      return null;
    }

    return {
      import_mode: 'published_network_tables',
      overwrite_existing: true,
      nodes: nodesResult.rows.map((row) => ({
        node_code: row.node_code,
        node_type: row.node_type,
        altitude: row.altitude,
      })),
      pipes: pipesResult.rows.map((row) => ({
        pipe_code: row.pipe_code,
        pipe_type: row.pipe_type,
        from_node_code: row.from_node_code,
        to_node_code: row.to_node_code,
        length_m: row.length_m,
        diameter_mm: row.diameter_mm,
      })),
    };
  }

  private normalizeObjective(value: unknown) {
    const normalized = String(value ?? 'balanced').trim().toLowerCase();
    if (normalized === 'stability_first') return 'stability_first' as const;
    if (normalized === 'throughput_first') return 'throughput_first' as const;
    if (normalized === 'equipment_safety') return 'equipment_safety' as const;
    return 'balanced' as const;
  }

  private buildObjectiveWeights(objective: ReturnType<SolverService['normalizeObjective']>) {
    switch (objective) {
      case 'stability_first':
        return { safety: 0.3, reliability: 0.4, throughput: 0.15, simplicity: 0.15 };
      case 'throughput_first':
        return { safety: 0.15, reliability: 0.2, throughput: 0.5, simplicity: 0.15 };
      case 'equipment_safety':
        return { safety: 0.45, reliability: 0.25, throughput: 0.1, simplicity: 0.2 };
      default:
        return { safety: 0.25, reliability: 0.3, throughput: 0.25, simplicity: 0.2 };
    }
  }

  private listCandidateModes(configuredSequenceMode: string) {
    const ordered = [configuredSequenceMode, 'valve_first', 'simultaneous', 'pump_first']
      .map((item) => String(item || 'valve_first'))
      .filter(Boolean);
    return [...new Set(ordered)];
  }

  private buildPlanSteps(
    readModel: SolverReadModel,
    sequenceMode: string,
    topologyRelationType: string,
    runMinutes: number
  ) {
    if (!readModel.pumpValveTopology) return [];

    const pumpDelaySeconds = this.toNumber(readModel.pumpValveTopology.pumpDelaySeconds, 0);
    const valveDelaySeconds = this.toNumber(readModel.pumpValveTopology.valveDelaySeconds, 0);
    const common = {
      network_model_version_id: readModel.networkModelVersion.id,
      pump_valve_relation_id: readModel.pumpValveTopology.id,
      topology_relation_type: topologyRelationType
    };

    const startSteps =
      sequenceMode === 'simultaneous'
        ? [
            {
              step_no: 1,
              phase: 'start',
              command_code: 'START_SESSION',
              device_role: 'well',
              target_id: readModel.pumpValveTopology.wellId,
              target_name: readModel.pumpValveTopology.wellName,
              delay_seconds: 0,
              rationale: 'Open the runtime session before issuing equipment actions.'
            },
            {
              step_no: 2,
              phase: 'start',
              command_code: 'START_PUMP',
              device_role: 'pump',
              target_id: readModel.pumpValveTopology.pumpId,
              target_name: readModel.pumpValveTopology.pumpName,
              delay_seconds: pumpDelaySeconds,
              rationale: 'Start the pump in the same dispatch window to maximize throughput.'
            },
            {
              step_no: 3,
              phase: 'start',
              command_code: 'OPEN_VALVE',
              device_role: 'valve',
              target_id: readModel.pumpValveTopology.valveId,
              target_name: readModel.pumpValveTopology.valveName,
              delay_seconds: valveDelaySeconds,
              rationale: 'Open the valve in parallel so the path is available as early as possible.'
            }
          ]
        : sequenceMode === 'pump_first'
          ? [
              {
                step_no: 1,
                phase: 'start',
                command_code: 'START_SESSION',
                device_role: 'well',
                target_id: readModel.pumpValveTopology.wellId,
                target_name: readModel.pumpValveTopology.wellName,
                delay_seconds: 0,
                rationale: 'Open the runtime session before equipment actions.'
              },
              {
                step_no: 2,
                phase: 'start',
                command_code: 'START_PUMP',
                device_role: 'pump',
                target_id: readModel.pumpValveTopology.pumpId,
                target_name: readModel.pumpValveTopology.pumpName,
                delay_seconds: pumpDelaySeconds,
                rationale: 'Pump-first mode prioritizes pressure build-up before opening the downstream path.'
              },
              {
                step_no: 3,
                phase: 'start',
                command_code: 'OPEN_VALVE',
                device_role: 'valve',
                target_id: readModel.pumpValveTopology.valveId,
                target_name: readModel.pumpValveTopology.valveName,
                delay_seconds: Math.max(pumpDelaySeconds, valveDelaySeconds),
                rationale: 'Open the valve after the pump startup window has stabilized.'
              }
            ]
          : [
              {
                step_no: 1,
                phase: 'start',
                command_code: 'START_SESSION',
                device_role: 'well',
                target_id: readModel.pumpValveTopology.wellId,
                target_name: readModel.pumpValveTopology.wellName,
                delay_seconds: 0,
                rationale: 'Open the runtime session before equipment actions.'
              },
              {
                step_no: 2,
                phase: 'start',
                command_code: 'OPEN_VALVE',
                device_role: 'valve',
                target_id: readModel.pumpValveTopology.valveId,
                target_name: readModel.pumpValveTopology.valveName,
                delay_seconds: valveDelaySeconds,
                rationale: 'Valve-first mode lowers pressure shock before starting the pump.'
              },
              {
                step_no: 3,
                phase: 'start',
                command_code: 'START_PUMP',
                device_role: 'pump',
                target_id: readModel.pumpValveTopology.pumpId,
                target_name: readModel.pumpValveTopology.pumpName,
                delay_seconds: Math.max(pumpDelaySeconds, valveDelaySeconds),
                rationale: 'Start the pump after the valve path is confirmed available.'
              }
            ];

    const stopBase = runMinutes * 60;
    const stopSteps = [
      {
        step_no: 4,
        phase: 'stop',
        command_code: 'CLOSE_VALVE',
        device_role: 'valve',
        target_id: readModel.pumpValveTopology.valveId,
        target_name: readModel.pumpValveTopology.valveName,
        delay_seconds: stopBase,
        rationale: 'Close the downstream path at the end of the scheduled run window.'
      },
      {
        step_no: 5,
        phase: 'stop',
        command_code: 'STOP_PUMP',
        device_role: 'pump',
        target_id: readModel.pumpValveTopology.pumpId,
        target_name: readModel.pumpValveTopology.pumpName,
        delay_seconds: stopBase + 3,
        rationale: 'Stop the pump after the flow path is isolated.'
      },
      {
        step_no: 6,
        phase: 'stop',
        command_code: 'STOP_SESSION',
        device_role: 'well',
        target_id: readModel.pumpValveTopology.wellId,
        target_name: readModel.pumpValveTopology.wellName,
        delay_seconds: stopBase + 6,
        rationale: 'Close the runtime session after device shutdown is complete.'
      }
    ];

    return [...startSteps, ...stopSteps].map((item) => ({
      ...item,
      ...common
    }));
  }

  private scoreCandidatePlan(input: {
    sequenceMode: string;
    configuredSequenceMode: string;
    topologyRelationType: string;
    objective: ReturnType<SolverService['normalizeObjective']>;
    runMinutes: number;
    steps: Array<Record<string, unknown>>;
  }) {
    const baseScores: Record<string, { safety: number; reliability: number; throughput: number; simplicity: number; risk: string }> = {
      valve_first: { safety: 94, reliability: 90, throughput: 76, simplicity: 88, risk: 'low' },
      pump_first: { safety: 72, reliability: 79, throughput: 89, simplicity: 80, risk: 'medium' },
      simultaneous: { safety: 78, reliability: 74, throughput: 95, simplicity: 74, risk: 'medium' }
    };

    const scores = { ...(baseScores[input.sequenceMode] ?? baseScores.valve_first) };
    if (input.topologyRelationType === 'sequence_delayed' && input.sequenceMode === 'valve_first') {
      scores.reliability += 4;
      scores.safety += 2;
    }
    if (input.topologyRelationType === 'sequence_delayed' && input.sequenceMode === 'simultaneous') {
      scores.reliability -= 5;
      scores.safety -= 3;
    }
    if (input.configuredSequenceMode === input.sequenceMode) {
      scores.simplicity += 6;
      scores.reliability += 4;
    }
    if (input.runMinutes >= 30 && input.sequenceMode === 'valve_first') {
      scores.safety += 2;
      scores.reliability += 2;
    }
    if (input.runMinutes <= 12 && input.sequenceMode === 'simultaneous') {
      scores.throughput += 3;
    }

    const weights = this.buildObjectiveWeights(input.objective);
    const totalScore =
      scores.safety * weights.safety +
      scores.reliability * weights.reliability +
      scores.throughput * weights.throughput +
      scores.simplicity * weights.simplicity;

    return {
      metrics: {
        safety_score: Math.min(scores.safety, 100),
        reliability_score: Math.min(scores.reliability, 100),
        throughput_score: Math.min(scores.throughput, 100),
        operator_simplicity_score: Math.min(scores.simplicity, 100)
      },
      total_score: Math.round(totalScore * 10) / 10,
      risk_level: scores.risk,
      projected_cycle_seconds: input.runMinutes * 60 + 6,
      operator_summary:
        input.sequenceMode === 'valve_first'
          ? 'Open valve before pump for safer pressure behavior and easier field debugging.'
          : input.sequenceMode === 'pump_first'
            ? 'Start pump before valve to favor faster pressure build-up when the lane is stable.'
            : 'Start pump and valve in parallel for maximum throughput when transport and ACK are reliable.',
      reasons:
        input.sequenceMode === 'valve_first'
          ? [
              'The discharge path is prepared before pump startup.',
              'This path best matches the current relation defaults and field operation habits.',
              'It is the safest default while transport is still being hardened.'
            ]
          : input.sequenceMode === 'pump_first'
            ? [
                'Pressure builds up earlier and can shorten the start window.',
                'This path needs more reliable ACK confirmation from the device lane.',
                'It is better suited to stable networks and experienced operators.'
              ]
            : [
                'Parallel startup yields the shortest overall dispatch window.',
                'This path depends on reliable ACK timing across all devices.',
                'It is best suited to stable device lanes and throughput-oriented goals.'
              ],
      concurrent_start_commands: input.sequenceMode === 'simultaneous' ? 2 : 1,
      total_steps: input.steps.length
    };
  }

  private async buildPlanBundle(
    readModel: SolverReadModel,
    constraints?: Record<string, unknown>,
    requestedObjective?: unknown
  ): Promise<SolverPlanBundle> {
    const hasGraph =
      readModel.networkGraphSnapshot.nodeCount > 0 &&
      readModel.networkGraphSnapshot.pipeCount > 0;
    const runMinutes = this.toNumber(constraints?.run_minutes, 20);
    const objective = this.normalizeObjective(requestedObjective ?? constraints?.objective);
    const activeOutletIds = this.extractActiveOutletIds(constraints);
    const graphDraftSnapshot = hasGraph
      ? await this.loadGraphDraftSnapshotByVersion(readModel.networkModelVersion.id)
      : null;
    const runtimeSnapshot =
      graphDraftSnapshot && activeOutletIds.length > 0
        ? buildSolverRuntimeSnapshot({
            graphDraft: graphDraftSnapshot,
            activeOutletIds,
          })
        : null;

    if (!hasGraph) {
      return {
        feasible: false,
        dispatchable: false,
        objective,
        horizonMinutes: null,
        summary: {
          sequence_mode: null,
          topology_relation_type: null,
          total_steps: 0,
          default_run_minutes: null,
          selected_objective: objective,
          candidate_count: 0,
          selected_score: null,
          selected_risk_level: null,
          selected_blocked: true,
          blocker_count: 1,
          warning_count: 0
        },
        selected_plan_id: null,
        units: [],
        steps: [],
        plans: [],
        explanations: ['No published graph is available, so the solver cannot generate a dispatch plan.'],
        runtimeSnapshot: null,
      };
    }

    if (!readModel.pumpValveTopology) {
      return {
        feasible: true,
        dispatchable: false,
        objective,
        horizonMinutes: runMinutes,
        summary: {
          sequence_mode: null,
          topology_relation_type: null,
          total_steps: 0,
          default_run_minutes: runMinutes,
          selected_objective: objective,
          candidate_count: 0,
          selected_score: null,
          selected_risk_level: null,
          selected_blocked: true,
          blocker_count: 1,
          warning_count: 0
        },
        selected_plan_id: null,
        units: [],
        steps: [],
        plans: [],
        explanations: ['A published graph exists, but no active pump-valve relation was provided for dispatch.'],
        runtimeSnapshot,
      };
    }

    const configuredSequenceMode = String(readModel.pumpValveTopology.sequenceMode ?? 'valve_first');
    const topologyReadModel =
      (readModel.pumpValveTopology.pumpValveTopologyReadModel as { effectiveResolved?: string } | undefined) ?? undefined;
    const topologyRelationType = String(topologyReadModel?.effectiveResolved ?? 'sequence_delayed');
    const runtimeBlockers = readModel.runtimeContext?.blockers ?? [];
    const runtimeWarnings = readModel.runtimeContext?.warnings ?? [];
    const dispatchable = runtimeBlockers.length === 0;

    const candidatePlans = this.listCandidateModes(configuredSequenceMode)
      .map((sequenceMode) => {
        const steps = this.buildPlanSteps(readModel, sequenceMode, topologyRelationType, runMinutes);
        const score = this.scoreCandidatePlan({
          sequenceMode,
          configuredSequenceMode,
          topologyRelationType,
          objective,
          runMinutes,
          steps
        });

        return {
          plan_id: `plan-${readModel.networkModelVersion.id}-${readModel.pumpValveTopology?.id ?? 'none'}-${sequenceMode}`,
          objective,
          sequence_mode: sequenceMode,
          topology_relation_type: topologyRelationType,
          projected_cycle_seconds: score.projected_cycle_seconds,
          concurrent_start_commands: score.concurrent_start_commands,
          risk_level: score.risk_level,
          operator_summary: score.operator_summary,
          reasons: score.reasons,
          metrics: score.metrics,
          total_score: score.total_score,
          blocked: !dispatchable,
          blockers: runtimeBlockers,
          warnings: runtimeWarnings,
          units: steps
        };
      })
      .sort((a, b) => b.total_score - a.total_score)
      .map((item, index) => ({
        ...item,
        rank: index + 1
      }));

    const selectedPlan = candidatePlans[0];

    return {
      feasible: true,
      dispatchable,
      objective,
      horizonMinutes: runMinutes,
      summary: {
        sequence_mode: selectedPlan.sequence_mode,
        topology_relation_type: topologyRelationType,
        total_steps: selectedPlan.units.length,
        default_run_minutes: runMinutes,
        selected_objective: objective,
        candidate_count: candidatePlans.length,
        selected_score: selectedPlan.total_score,
        selected_risk_level: selectedPlan.risk_level,
        selected_blocked: !dispatchable,
        blocker_count: runtimeBlockers.length,
        warning_count: runtimeWarnings.length
      },
      selected_plan_id: selectedPlan.plan_id,
      units: selectedPlan.units,
      steps: selectedPlan.units,
      plans: candidatePlans,
      explanations: [
        ...runtimeBlockers.map((item) => `Runtime blocker: ${item.message}`),
        ...runtimeWarnings.map((item) => `Runtime warning: ${item.message}`),
        `Current objective = ${objective}.`,
        `The solver scored ${candidatePlans.length} candidate sequence(s).`,
        `Selected sequence = ${selectedPlan.sequence_mode}; risk = ${selectedPlan.risk_level}; score = ${selectedPlan.total_score}.`
      ],
      runtimeSnapshot,
    };
  }

  async preview(dto: SolverPreviewRequestDto) {
    const readModel = await this.buildReadModel(dto);
    const planBundle = await this.buildPlanBundle(readModel, dto.constraints);
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only — graph bound to published network_model_version',
      readModel,
      result: {
        feasible: planBundle.feasible,
        dispatchable: planBundle.dispatchable,
        horizonMinutes: planBundle.horizonMinutes,
        summary: planBundle.summary,
        selected_plan_id: planBundle.selected_plan_id,
        units: planBundle.units,
        plans: planBundle.plans,
        explanations: planBundle.explanations,
        runtime_snapshot: planBundle.runtimeSnapshot,
      }
    };
  }

  async plan(dto: SolverPlanRequestDto) {
    const readModel = await this.buildReadModel(dto);
    const planBundle = await this.buildPlanBundle(readModel, dto.constraints, dto.objective);
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only — graph bound to published network_model_version',
      readModel,
      result: {
        feasible: planBundle.feasible,
        dispatchable: planBundle.dispatchable,
        objective: planBundle.objective,
        horizonMinutes: planBundle.horizonMinutes,
        summary: planBundle.summary,
        selected_plan_id: planBundle.selected_plan_id,
        steps: planBundle.steps,
        units: planBundle.units,
        plans: planBundle.plans,
        explanations: planBundle.explanations,
        runtime_snapshot: planBundle.runtimeSnapshot,
      }
    };
  }

  explain(_dto: SolverExplainRequestDto) {
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only',
      result: {
        explanations: [] as unknown[]
      }
    };
  }

  simulate(_dto: SolverSimulateRequestDto) {
    return {
      contractVersion: SOLVER_CONTRACT_VERSION,
      status: 'accepted',
      notes: 'solver kernel not implemented; envelope only',
      result: {
        timeline: [] as unknown[]
      }
    };
  }
}
