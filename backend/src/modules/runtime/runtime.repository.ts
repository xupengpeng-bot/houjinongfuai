import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { RuntimeDecisionContract } from '../../common/contracts/runtime-decision';

@Injectable()
export class RuntimeRepository {
  constructor(private readonly db: DatabaseService) {}

  private readonly activeSessionStatuses = ['pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping'];

  private isUniqueViolation(error: unknown, constraintName: string) {
    const candidate = error as { code?: string; constraint?: string };
    return candidate?.code === '23505' && candidate?.constraint === constraintName;
  }

  withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
    return this.db.withTransaction(fn);
  }

  async findDefaultRuntimeUser() {
    const result = await this.db.query<{ id: string; tenantId: string }>(
      `
      select id, tenant_id as "tenantId"
      from sys_user
      where user_type = 'farmer' and status = 'active'
      order by created_at asc
      limit 1
      `
    );
    return result.rows[0] ?? null;
  }

  async listSessionsNeedingProgressSweep(limit = 200, client?: PoolClient) {
    const normalizedLimit = Math.min(1000, Math.max(1, Math.trunc(limit)));
    const result = await this.db.query<{
      sessionId: string;
      sessionStatus: string;
      pricingProgressAt: string | null;
      orderId: string;
      orderStatus: string;
    }>(
      `
      select
        rs.id::text as "sessionId",
        rs.status as "sessionStatus",
        io.pricing_progress_at as "pricingProgressAt",
        io.id as "orderId",
        io.status as "orderStatus"
      from runtime_session rs
      join irrigation_order io on io.session_id = rs.id
      where rs.status in ('running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
        and io.status <> 'settled'
      order by io.pricing_progress_at asc nulls first, rs.updated_at asc
      limit $1
      `,
      [normalizedLimit],
      client
    );
    return result.rows;
  }

  async countActiveSessionsForUser(userId: string, client?: PoolClient) {
    const result = await this.db.query<{ count: number }>(
      `
      select count(*)::int as count
      from runtime_session
      where user_id = $1 and status = any($2::text[])
      `,
      [userId, this.activeSessionStatuses],
      client
    );
    return result.rows[0]?.count ?? 0;
  }

  async countActiveSessionsForWell(wellId: string, client?: PoolClient) {
    const result = await this.db.query<{ count: number }>(
      `
      select count(*)::int as count
      from runtime_session
      where well_id = $1 and status = any($2::text[])
      `,
      [wellId, this.activeSessionStatuses],
      client
    );
    return result.rows[0]?.count ?? 0;
  }

  async countActiveSessionsForValve(valveId: string, client?: PoolClient) {
    const result = await this.db.query<{ count: number }>(
      `
      select count(*)::int as count
      from runtime_session
      where valve_id = $1 and status = any($2::text[])
      `,
      [valveId, this.activeSessionStatuses],
      client
    );
    return result.rows[0]?.count ?? 0;
  }

  async countActiveSessionsForPump(pumpId: string, client?: PoolClient) {
    const result = await this.db.query<{ count: number }>(
      `
      select count(*)::int as count
      from runtime_session
      where pump_id = $1 and status = any($2::text[])
      `,
      [pumpId, this.activeSessionStatuses],
      client
    );
    return result.rows[0]?.count ?? 0;
  }

  async listActiveBillingModesForPump(pumpId: string, client?: PoolClient) {
    const result = await this.db.query<{ billingMode: string | null }>(
      `
      select distinct nullif(io.pricing_snapshot_json->>'mode', '') as "billingMode"
      from runtime_session rs
      join irrigation_order io on io.session_id = rs.id
      where rs.pump_id = $1
        and rs.status = any($2::text[])
      `,
      [pumpId, this.activeSessionStatuses],
      client
    );
    return result.rows
      .map((row) => row.billingMode?.trim() ?? '')
      .filter((value) => value.length > 0);
  }

  async createDecision(input: {
    tenantId: string;
    userId: string;
    sceneCode: string;
    targetType: string;
    targetId: string;
    result: RuntimeDecisionContract['result'];
    blockingReasons: unknown[];
    availableActions: unknown[];
    effectiveRuleSnapshot: Record<string, unknown>;
    pricePreview: Record<string, unknown> | null;
  }) {
    const decisionId = randomUUID();
    await this.db.query(
      `
      insert into runtime_decision (
        id, tenant_id, user_id, scene_code, target_type, target_id,
        decision_result, blocking_reasons_json, available_actions_json,
        effective_rule_snapshot_json, price_preview_json, decision_expires_at
      ) values (
        $1, $2, $3, $4, $5, $6,
        $7, $8::jsonb, $9::jsonb,
        $10::jsonb, $11::jsonb, now() + interval '10 minute'
      )
      `,
      [
        decisionId,
        input.tenantId,
        input.userId,
        input.sceneCode,
        input.targetType,
        input.targetId,
        input.result,
        JSON.stringify(input.blockingReasons),
        JSON.stringify(input.availableActions),
        JSON.stringify(input.effectiveRuleSnapshot),
        JSON.stringify(input.pricePreview)
      ]
    );
    return decisionId;
  }

  async findDecisionById(decisionId: string, client?: PoolClient, forUpdate = false) {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      userId: string;
      sceneCode: string;
      targetType: 'valve' | 'well' | 'pump' | 'session';
      targetId: string;
      decisionResult: 'allow' | 'deny' | 'manual_review';
      effectiveRuleSnapshot: Record<string, unknown>;
      pricePreview: Record<string, unknown> | null;
      decisionExpiresAt: string;
    }>(
      `
      select
        id,
        tenant_id as "tenantId",
        user_id as "userId",
        scene_code as "sceneCode",
        target_type as "targetType",
        target_id::text as "targetId",
        decision_result as "decisionResult",
        effective_rule_snapshot_json as "effectiveRuleSnapshot",
        price_preview_json as "pricePreview",
        decision_expires_at as "decisionExpiresAt"
      from runtime_decision
      where id = $1
      ${forUpdate ? 'for update' : ''}
      `,
      [decisionId],
      client
    );
    return result.rows[0] ?? null;
  }

  async createRuntimeSession(input: {
    tenantId: string;
    userId: string;
    wellId: string;
    pumpId: string;
    valveId: string;
    sessionRef: string | null;
    sourceDecisionId: string;
    telemetrySnapshot: Record<string, unknown>;
  }, client: PoolClient) {
    const sessionId = randomUUID();
    const sessionNo = `sess_${Date.now()}`;
    try {
      const result = await this.db.query<{
        id: string;
        sessionNo: string;
        sessionRef: string | null;
        status: string;
        startedAt: string | null;
      }>(
        `
        insert into runtime_session (
          id, tenant_id, session_no, source_decision_id, user_id,
          well_id, pump_id, valve_id, session_ref, status, billing_started_at,
          started_at, telemetry_snapshot_json
        ) values (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, 'pending_start', null,
          null, $10::jsonb
        )
        returning id, session_no as "sessionNo", session_ref as "sessionRef", status, started_at as "startedAt"
        `,
        [
          sessionId,
          input.tenantId,
          sessionNo,
          input.sourceDecisionId,
          input.userId,
          input.wellId,
          input.pumpId,
          input.valveId,
          input.sessionRef,
          JSON.stringify(input.telemetrySnapshot)
        ],
        client
      );
      return {
        ...result.rows[0],
        created: true
      };
    } catch (error) {
      if (this.isUniqueViolation(error, 'ux_runtime_session_source_decision_not_null')) {
        const existing = await this.findSessionByDecisionId(input.sourceDecisionId, client);
        if (existing) {
          return {
            ...existing,
            sessionRef: null,
            startedAt: existing.startedAt ?? new Date().toISOString(),
            created: false
          };
        }
      }
      throw error;
    }
  }

  async findSessionByDecisionId(sourceDecisionId: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      sessionNo: string;
      status: string;
      startedAt: string | null;
      endedAt: string | null;
    }>(
      `
      select
        id,
        session_no as "sessionNo",
        status,
        started_at as "startedAt",
        ended_at as "endedAt"
      from runtime_session
      where source_decision_id = $1
      order by created_at asc
      limit 1
      `,
      [sourceDecisionId],
      client
    );
    return result.rows[0] ?? null;
  }

  async findSessionById(sessionId: string, client?: PoolClient, forUpdate = false) {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      userId: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      sessionRef: string | null;
      status: string;
      startedAt: string;
      endedAt: string | null;
    }>(
      `
      select
        id,
        tenant_id as "tenantId",
          user_id as "userId",
          well_id as "wellId",
          pump_id as "pumpId",
          valve_id as "valveId",
          session_ref as "sessionRef",
          status,
          started_at as "startedAt",
          ended_at as "endedAt"
      from runtime_session
      where id = $1
      ${forUpdate ? 'for update' : ''}
      `,
      [sessionId],
      client
    );
    return result.rows[0] ?? null;
  }

  async findCurrentSessionByUserId(userId: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      sessionNo: string;
      sessionRef: string | null;
      userId: string;
      userDisplayName: string | null;
      wellId: string;
      wellCode: string | null;
      wellDisplayName: string | null;
      status: string;
      startedAt: string | null;
      endedAt: string | null;
      amount: number | null;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      orderStatus: string | null;
      settlementStatus: string | null;
      paymentMode: string | null;
      paymentStatus: string | null;
      billingPackageName: string | null;
      unitType: string | null;
      pricingDetail: Record<string, unknown> | null;
      targetDeviceId: string | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      targetDeviceName: string | null;
    }>(
      `
      select
        rs.id,
        rs.session_no as "sessionNo",
        rs.session_ref as "sessionRef",
        rs.user_id as "userId",
        su.display_name as "userDisplayName",
        rs.well_id as "wellId",
        w.well_code as "wellCode",
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellDisplayName",
        rs.status,
        rs.started_at as "startedAt",
        rs.ended_at as "endedAt",
        io.amount,
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        io.status as "orderStatus",
        io.settlement_status as "settlementStatus",
        io.payment_mode as "paymentMode",
        io.payment_status as "paymentStatus",
        bp.package_name as "billingPackageName",
        bp.unit_type as "unitType",
        io.pricing_detail_json as "pricingDetail",
        io.target_device_id::text as "targetDeviceId",
        io.target_imei as "targetImei",
        io.target_device_role as "targetDeviceRole",
        td.device_name as "targetDeviceName"
      from runtime_session rs
      join sys_user su on su.id = rs.user_id
      join well w on w.id = rs.well_id
      left join irrigation_order io on io.session_id = rs.id
      left join billing_package bp on bp.id = io.billing_package_id
      left join device td on td.id = io.target_device_id
      where rs.user_id = $1
        and rs.status = any($2::text[])
      order by rs.created_at desc
      limit 1
      `,
      [userId, this.activeSessionStatuses],
      client
    );
    return result.rows[0] ?? null;
  }

  async findAllSessions(client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      sessionNo: string;
      userId: string;
      userDisplayName: string | null;
      wellId: string;
      wellCode: string | null;
      wellDisplayName: string | null;
      status: string;
      startedAt: string | null;
      endedAt: string | null;
      amount: number | null;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      orderId: string | null;
      orderStatus: string | null;
      settlementStatus: string | null;
    }>(
      `
      select
        rs.id,
        rs.session_no as "sessionNo",
        rs.user_id as "userId",
        su.display_name as "userDisplayName",
        rs.well_id as "wellId",
        w.well_code as "wellCode",
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellDisplayName",
        rs.status,
        rs.started_at as "startedAt",
        rs.ended_at as "endedAt",
        io.id as "orderId",
        io.amount,
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        io.status as "orderStatus",
        io.settlement_status as "settlementStatus"
      from runtime_session rs
      join sys_user su on su.id = rs.user_id
      join well w on w.id = rs.well_id
      left join irrigation_order io on io.session_id = rs.id
      order by rs.created_at desc
      `,
      [],
      client
    );
    return result.rows;
  }

  async findAllCommands(client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      time: string;
      session: string | null;
      target: string;
      action: string;
      source: string;
      result: string;
    }>(
      `
      select
        cd.id,
        to_char(cd.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as time,
        rs.session_no as session,
        coalesce(d.device_name, d.device_code) as target,
        cd.command_code as action,
        'runtime_engine' as source,
        case
          when cd.dispatch_status in ('success', 'acked') then 'success'
          when cd.dispatch_status in ('timeout') then 'timeout'
          else 'error'
        end as result
      from command_dispatch cd
      join device d on d.id = cd.target_device_id
      left join runtime_session rs on rs.id = cd.session_id
      order by cd.created_at desc
      `,
      [],
      client
    );
    return result.rows;
  }

  async findSessionControlTargets(input: { wellId: string; pumpId: string; valveId: string }, client?: PoolClient) {
    const result = await this.db.query<{
      wellDeviceId: string | null;
      wellImei: string | null;
      wellDeviceCode: string | null;
      wellDeviceName: string | null;
      wellFeatureModules: string[] | null;
      wellDeviceState: string | null;
      wellOnlineState: string | null;
      pumpDeviceId: string | null;
      pumpImei: string | null;
      pumpDeviceCode: string | null;
      pumpDeviceName: string | null;
      pumpDeviceState: string | null;
      pumpOnlineState: string | null;
      valveDeviceId: string | null;
      valveImei: string | null;
      valveDeviceCode: string | null;
      valveDeviceName: string | null;
      valveDeviceState: string | null;
      valveOnlineState: string | null;
    }>(
      `
      select
        wd.id as "wellDeviceId",
        wd.imei as "wellImei",
        wd.device_code as "wellDeviceCode",
        wd.device_name as "wellDeviceName",
        coalesce(wd.ext_json->'feature_modules', '[]'::jsonb) as "wellFeatureModules",
        wd.lifecycle_state as "wellDeviceState",
        case
          when wds.online_state = 'online'
           and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else wd.online_state
        end as "wellOnlineState",
        pd.id as "pumpDeviceId",
        pd.imei as "pumpImei",
        pd.device_code as "pumpDeviceCode",
        pd.device_name as "pumpDeviceName",
        pd.lifecycle_state as "pumpDeviceState",
        case
          when pds.online_state = 'online'
           and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else pd.online_state
        end as "pumpOnlineState",
        vd.id as "valveDeviceId",
        vd.imei as "valveImei",
        vd.device_code as "valveDeviceCode",
        vd.device_name as "valveDeviceName",
        vd.lifecycle_state as "valveDeviceState",
        case
          when vds.online_state = 'online'
           and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else vd.online_state
        end as "valveOnlineState"
      from well w
      join pump p on p.id = $2
      join valve v on v.id = $3
      join device wd on wd.id = w.device_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      left join device_runtime_shadow wds on wds.device_id = wd.id
      left join device_runtime_shadow pds on pds.device_id = pd.id
      left join device_runtime_shadow vds on vds.device_id = vd.id
      where w.id = $1
      limit 1
      `,
      [input.wellId, input.pumpId, input.valveId],
      client
    );
    return result.rows[0] ?? null;
  }

  async findCommandsBySessionId(sessionId: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      time: string;
      session: string | null;
      target: string;
      action: string;
      source: string;
      result: string;
      dispatchStatus: string;
      sentAt: string | null;
      ackedAt: string | null;
      requestPayload: Record<string, unknown>;
      responsePayload: Record<string, unknown>;
    }>(
      `
      select
        cd.id,
        to_char(cd.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as time,
        rs.session_no as session,
        coalesce(d.device_name, d.device_code) as target,
        cd.command_code as action,
        'runtime_engine' as source,
        case
          when cd.dispatch_status in ('success', 'acked') then 'success'
          when cd.dispatch_status in ('timeout') then 'timeout'
          else 'error'
        end as result,
        cd.dispatch_status as "dispatchStatus",
        cd.sent_at as "sentAt",
        cd.acked_at as "ackedAt",
        cd.request_payload_json as "requestPayload",
        cd.response_payload_json as "responsePayload"
      from command_dispatch cd
      join device d on d.id = cd.target_device_id
      left join runtime_session rs on rs.id = cd.session_id
      where cd.session_id = $1
      order by cd.created_at asc, cd.id asc
      `,
      [sessionId],
      client
    );
    return result.rows;
  }

  async findRuntimeContainers(client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      name: string;
      status: string;
      cpu: string;
      mem: string;
      uptime: string;
    }>(
      `
      select
        rc.id::text as id,
        coalesce(w.safety_profile_json->>'displayName', w.well_code, rc.id::text) as name,
        case
          when rc.status in ('running', 'ready') then 'running'
          else 'stopped'
        end as status,
        concat(coalesce(rc.shared_resource_snapshot_json->>'scenarioCode', 'runtime'), ' / ', rc.active_session_count, ' sessions') as cpu,
        concat(
          coalesce(nullif(rc.protection_state_json->>'lock', ''), 'normal'),
          ' / ',
          rc.active_session_count,
          ' active'
        ) as mem,
        trim(
          both ' '
          from concat(
            case when latest_session.started_at is not null then 'since ' || to_char(latest_session.started_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') end,
            case when latest_session.ended_at is not null then ' / last stop ' || to_char(latest_session.ended_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') end
          )
        ) as uptime
      from runtime_container rc
      join well w on w.id = rc.well_id
      left join lateral (
        select rs.started_at, rs.ended_at
        from runtime_session rs
        where rs.runtime_container_id = rc.id
        order by rs.created_at desc
        limit 1
      ) latest_session on true
      order by rc.updated_at desc, rc.created_at desc
      `,
      [],
      client
    );
    return result.rows.map((row) => ({
      ...row,
      uptime: row.uptime && row.uptime.length > 0 ? row.uptime : 'no runtime yet'
    }));
  }

  async findSessionObservabilityById(sessionId: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      sessionNo: string;
      status: string;
      userId: string;
      userDisplayName: string | null;
      wellId: string;
      wellCode: string | null;
      wellDisplayName: string | null;
      runtimeContainerId: string | null;
      startedAt: string | null;
      endedAt: string | null;
      telemetrySnapshot: Record<string, unknown> | null;
      orderId: string | null;
      orderNo: string | null;
      orderStatus: string | null;
      settlementStatus: string | null;
      amount: number | null;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      pricingDetail: Record<string, unknown> | null;
    }>(
      `
      select
        rs.id,
        rs.session_no as "sessionNo",
        rs.status,
        rs.user_id as "userId",
        su.display_name as "userDisplayName",
        rs.well_id as "wellId",
        w.well_code as "wellCode",
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellDisplayName",
        rs.runtime_container_id as "runtimeContainerId",
        rs.started_at as "startedAt",
        rs.ended_at as "endedAt",
        rs.telemetry_snapshot_json as "telemetrySnapshot",
        io.id as "orderId",
        io.order_no as "orderNo",
        io.status as "orderStatus",
        io.settlement_status as "settlementStatus",
        io.amount,
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        io.pricing_detail_json as "pricingDetail"
      from runtime_session rs
      join sys_user su on su.id = rs.user_id
      join well w on w.id = rs.well_id
      left join irrigation_order io on io.session_id = rs.id
      where rs.id = $1
      limit 1
      `,
      [sessionId],
      client
    );
    return result.rows[0] ?? null;
  }

  async findWellIdByIdentifier(identifier: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from well
      where id::text = $1
         or well_code = $1
         or lower(coalesce(safety_profile_json->>'displayName', '')) = lower($1)
      limit 1
      `,
      [identifier],
      client
    );
    return result.rows[0]?.id ?? null;
  }

  async findDeviceByIdentifier(identifier: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string; imei: string | null; deviceCode: string; deviceName: string }>(
      `
      select
        id,
        imei,
        device_code as "deviceCode",
        device_name as "deviceName"
      from device
      where id::text = $1 or device_code = $1
      limit 1
      `,
      [identifier],
      client
    );
    return result.rows[0] ?? null;
  }

  async stopSession(sessionId: string, client: PoolClient, endReasonCode = 'manual_stop_requested') {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      userId: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      status: string;
      startedAt: string;
      endedAt: string;
    }>(
      `
      update runtime_session
      set status = 'stopping', end_reason_code = $2, updated_at = now()
      where id = $1 and status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming')
      returning
        id,
        tenant_id as "tenantId",
        user_id as "userId",
        well_id as "wellId",
        pump_id as "pumpId",
        valve_id as "valveId",
        status,
        started_at as "startedAt",
        ended_at as "endedAt"
      `,
      [sessionId, endReasonCode],
      client
    );
    return result.rows[0] ?? null;
  }
}
