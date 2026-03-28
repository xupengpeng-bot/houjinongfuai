import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class OrderRepository {
  constructor(private readonly db: DatabaseService) {}

  private isUniqueViolation(error: unknown, constraintName: string) {
    const candidate = error as { code?: string; constraint?: string };
    return candidate?.code === '23505' && candidate?.constraint === constraintName;
  }

  async findAll(): Promise<Array<{
    id: string;
    orderNo: string;
    sessionId: string;
    userId: string;
    userDisplayName: string | null;
    userMobile: string | null;
    billingPackageId: string;
    billingPackageName: string | null;
    wellCode: string | null;
    wellDisplayName: string | null;
    status: string;
    settlementStatus: string;
    chargeDurationSec: number | null;
    chargeVolume: number | null;
    unitType: string | null;
    amount: number;
    startedAt: string | null;
    endedAt: string | null;
    pricingSnapshot: Record<string, unknown>;
    pricingDetail: Record<string, unknown>;
  }>> {
    const result = await this.db.query<{
      id: string;
      orderNo: string;
      sessionId: string;
      userId: string;
      userDisplayName: string | null;
      userMobile: string | null;
      billingPackageId: string;
      billingPackageName: string | null;
      wellCode: string | null;
      wellDisplayName: string | null;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      unitType: string | null;
      amount: number;
      startedAt: string | null;
      endedAt: string | null;
      pricingSnapshot: Record<string, unknown>;
      pricingDetail: Record<string, unknown>;
    }>(`
      select
        io.id,
        io.order_no as "orderNo",
        io.session_id as "sessionId",
        io.user_id as "userId",
        su.display_name as "userDisplayName",
        su.mobile as "userMobile",
        io.billing_package_id as "billingPackageId",
        bp.package_name as "billingPackageName",
        w.well_code as "wellCode",
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellDisplayName",
        io.status,
        io.settlement_status as "settlementStatus",
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        bp.unit_type as "unitType",
        io.amount,
        rs.started_at as "startedAt",
        rs.ended_at as "endedAt",
        io.pricing_snapshot_json as "pricingSnapshot",
        io.pricing_detail_json as "pricingDetail"
      from irrigation_order io
      join sys_user su on su.id = io.user_id
      join runtime_session rs on rs.id = io.session_id
      join well w on w.id = rs.well_id
      join billing_package bp on bp.id = io.billing_package_id
      order by io.created_at desc
    `);
    return result.rows;
  }

  async findById(id: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      orderNo: string;
      sessionId: string;
      userId: string;
      billingPackageId: string;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      amount: number;
      pricingSnapshot: Record<string, unknown>;
      pricingDetail: Record<string, unknown>;
    }>(
      `
      select
        id,
        order_no as "orderNo",
        session_id as "sessionId",
        user_id as "userId",
        billing_package_id as "billingPackageId",
        status,
        settlement_status as "settlementStatus",
        charge_duration_sec as "chargeDurationSec",
        amount,
        pricing_snapshot_json as "pricingSnapshot",
        pricing_detail_json as "pricingDetail"
      from irrigation_order
      where id = $1
      `,
      [id],
      client
    );
    return result.rows[0] ?? null;
  }

  async findByUserId(userId: string) {
    const result = await this.db.query<{
      id: string;
      orderNo: string;
      sessionId: string;
      wellCode: string | null;
      wellDisplayName: string | null;
      billingPackageName: string | null;
      unitType: string | null;
      startedAt: string | null;
      endedAt: string | null;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      amount: number;
      pricingDetail: Record<string, unknown>;
    }>(
      `
      select
        io.id,
        io.order_no as "orderNo",
        io.session_id as "sessionId",
        w.well_code as "wellCode",
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellDisplayName",
        bp.package_name as "billingPackageName",
        bp.unit_type as "unitType",
        rs.started_at as "startedAt",
        rs.ended_at as "endedAt",
        io.status,
        io.settlement_status as "settlementStatus",
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        io.amount,
        io.pricing_detail_json as "pricingDetail"
      from irrigation_order io
      join runtime_session rs on rs.id = io.session_id
      join well w on w.id = rs.well_id
      join billing_package bp on bp.id = io.billing_package_id
      where io.user_id = $1
      order by io.created_at desc
      `,
      [userId]
    );
    return result.rows;
  }

  async findBySessionId(sessionId: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      orderNo: string;
      sessionId: string;
      userId: string;
      billingPackageId: string;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      amount: number;
      pricingSnapshot: Record<string, unknown>;
      pricingDetail: Record<string, unknown>;
    }>(
      `
      select
        id,
        order_no as "orderNo",
        session_id as "sessionId",
        user_id as "userId",
        billing_package_id as "billingPackageId",
        status,
        settlement_status as "settlementStatus",
        charge_duration_sec as "chargeDurationSec",
        amount,
        pricing_snapshot_json as "pricingSnapshot",
        pricing_detail_json as "pricingDetail"
      from irrigation_order
      where session_id = $1
      limit 1
      `,
      [sessionId],
      client
    );
    return result.rows[0] ?? null;
  }

  async createDraft(input: {
    tenantId: string;
    sessionId: string;
    userId: string;
    billingPackageId: string;
    pricingSnapshot: Record<string, unknown>;
    pricingDetail: Record<string, unknown>;
  }, client: PoolClient) {
    const orderNo = `ord_${Date.now()}`;
    try {
      const result = await this.db.query<{ id: string; orderNo: string }>(
        `
        insert into irrigation_order (
          id, tenant_id, order_no, session_id, user_id, billing_package_id,
          status, settlement_status, amount, pricing_snapshot_json, pricing_detail_json
        ) values (
          $1, $2, $3, $4, $5, $6,
          'created', 'unpaid', 0, $7::jsonb, $8::jsonb
        )
        returning id, order_no as "orderNo"
        `,
        [
          randomUUID(),
          input.tenantId,
          orderNo,
          input.sessionId,
          input.userId,
          input.billingPackageId,
          JSON.stringify(input.pricingSnapshot),
          JSON.stringify(input.pricingDetail)
        ],
        client
      );
      return {
        ...result.rows[0],
        created: true
      };
    } catch (error) {
      if (this.isUniqueViolation(error, 'ux_irrigation_order_session_id')) {
        const existing = await this.findBySessionId(input.sessionId, client);
        if (existing) {
          return {
            ...existing,
            created: false
          };
        }
      }
      throw error;
    }
  }

  async finalize(input: {
    orderId: string;
    chargeDurationSec: number;
    amount: number;
    pricingSnapshot: Record<string, unknown>;
    pricingDetail: Record<string, unknown>;
  }, client: PoolClient) {
    const result = await this.db.query<{
      id: string;
      orderNo: string;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number;
      amount: number;
    }>(
      `
      update irrigation_order
      set
        status = 'settled',
        settlement_status = 'paid',
        charge_duration_sec = $1,
        amount = $2,
        pricing_snapshot_json = $3::jsonb,
        pricing_detail_json = $4::jsonb,
        updated_at = now()
      where id = $5 and status <> 'settled'
      returning
        id,
        order_no as "orderNo",
        status,
        settlement_status as "settlementStatus",
        charge_duration_sec as "chargeDurationSec",
        amount
      `,
      [
        input.chargeDurationSec,
        input.amount,
        JSON.stringify(input.pricingSnapshot),
        JSON.stringify(input.pricingDetail),
        input.orderId
      ],
      client
    );
    return result.rows[0] ?? this.findById(input.orderId, client);
  }
}
