import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { RuntimeDecisionContract } from '../../common/contracts/runtime-decision';

@Injectable()
export class RuntimeRepository {
  constructor(private readonly db: DatabaseService) {}

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

  async countActiveSessionsForUser(userId: string, client?: PoolClient) {
    const result = await this.db.query<{ count: number }>(
      `
      select count(*)::int as count
      from runtime_session
      where user_id = $1 and status in ('pending_start', 'running', 'billing', 'stopping')
      `,
      [userId],
      client
    );
    return result.rows[0]?.count ?? 0;
  }

  async countActiveSessionsForWell(wellId: string, client?: PoolClient) {
    const result = await this.db.query<{ count: number }>(
      `
      select count(*)::int as count
      from runtime_session
      where well_id = $1 and status in ('pending_start', 'running', 'billing', 'stopping')
      `,
      [wellId],
      client
    );
    return result.rows[0]?.count ?? 0;
  }

  async countActiveSessionsForValve(valveId: string, client?: PoolClient) {
    const result = await this.db.query<{ count: number }>(
      `
      select count(*)::int as count
      from runtime_session
      where valve_id = $1 and status in ('pending_start', 'running', 'billing', 'stopping')
      `,
      [valveId],
      client
    );
    return result.rows[0]?.count ?? 0;
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
      targetType: 'valve' | 'well' | 'session';
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
    sourceDecisionId: string;
    telemetrySnapshot: Record<string, unknown>;
  }, client: PoolClient) {
    const sessionId = randomUUID();
    const sessionNo = `sess_${Date.now()}`;
    try {
      const result = await this.db.query<{
        id: string;
        sessionNo: string;
        status: string;
        startedAt: string;
      }>(
        `
        insert into runtime_session (
          id, tenant_id, session_no, source_decision_id, user_id,
          well_id, pump_id, valve_id, status, billing_started_at,
          started_at, telemetry_snapshot_json
        ) values (
          $1, $2, $3, $4, $5,
          $6, $7, $8, 'running', now(),
          now(), $9::jsonb
        )
        returning id, session_no as "sessionNo", status, started_at as "startedAt"
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
      billingPackageName: string | null;
      unitType: string | null;
      pricingDetail: Record<string, unknown> | null;
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
        io.amount,
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        io.status as "orderStatus",
        io.settlement_status as "settlementStatus",
        bp.package_name as "billingPackageName",
        bp.unit_type as "unitType",
        io.pricing_detail_json as "pricingDetail"
      from runtime_session rs
      join sys_user su on su.id = rs.user_id
      join well w on w.id = rs.well_id
      left join irrigation_order io on io.session_id = rs.id
      left join billing_package bp on bp.id = io.billing_package_id
      where rs.user_id = $1
        and rs.status in ('pending_start', 'running', 'billing', 'stopping')
      order by rs.created_at desc
      limit 1
      `,
      [userId],
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

  async findWellIdByIdentifier(identifier: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from well
      where id::text = $1 or well_code = $1
      limit 1
      `,
      [identifier],
      client
    );
    return result.rows[0]?.id ?? null;
  }

  async stopSession(sessionId: string, client: PoolClient) {
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
      set status = 'ended', ended_at = now(), end_reason_code = 'manual_stop', updated_at = now()
      where id = $1 and status in ('pending_start', 'running', 'billing', 'stopping')
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
      [sessionId],
      client
    );
    return result.rows[0] ?? null;
  }
}
