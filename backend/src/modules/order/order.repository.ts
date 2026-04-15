import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class OrderRepository {
  constructor(private readonly db: DatabaseService) {}

  /** 与 runtime 决策使用的用户一致（当前无 JWT 真源时的 Phase1 约定） */
  async findDefaultFarmerUserId(): Promise<string | null> {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from sys_user
      where user_type = 'farmer' and status = 'active'
      order by created_at asc
      limit 1
      `
    );
    return result.rows[0]?.id ?? null;
  }

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
      sessionStatus: string | null;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      unitType: string | null;
      amount: number;
      paymentMode: string | null;
      paymentStatus: string | null;
      prepaidAmount: number | null;
      lockedAmount: number | null;
      refundedAmount: number | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      endReasonCode: string | null;
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
        rs.status as "sessionStatus",
        io.status,
        io.settlement_status as "settlementStatus",
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        bp.unit_type as "unitType",
        io.amount,
        io.payment_mode as "paymentMode",
        io.payment_status as "paymentStatus",
        io.prepaid_amount as "prepaidAmount",
        io.locked_amount as "lockedAmount",
        io.refunded_amount as "refundedAmount",
        io.target_imei as "targetImei",
        io.target_device_role as "targetDeviceRole",
        rs.end_reason_code as "endReasonCode",
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

  async findPage(params?: { page?: number; pageSize?: number; targetImei?: string | null }) {
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const whereClauses: string[] = [];
    const values: Array<string | number> = [];

    if (params?.targetImei?.trim()) {
      values.push(params.targetImei.trim());
      whereClauses.push(`io.target_imei = $${values.length}`);
    }

    values.push(pageSize);
    const limitPlaceholder = `$${values.length}`;
    values.push(offset);
    const offsetPlaceholder = `$${values.length}`;
    const whereSql = whereClauses.length ? `where ${whereClauses.join(' and ')}` : '';

    const result = await this.db.query<{
      id: string;
      orderNo: string;
      sessionId: string;
      sessionRef: string | null;
      userId: string;
      userDisplayName: string | null;
      userMobile: string | null;
      billingPackageId: string;
      billingPackageName: string | null;
      wellCode: string | null;
      wellDisplayName: string | null;
      sessionStatus: string | null;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      unitType: string | null;
      amount: number;
      paymentMode: string | null;
      paymentStatus: string | null;
      prepaidAmount: number | null;
      lockedAmount: number | null;
      refundedAmount: number | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      endReasonCode: string | null;
      startedAt: string | null;
      endedAt: string | null;
      pricingSnapshot: Record<string, unknown>;
      pricingDetail: Record<string, unknown>;
      total: string;
    }>(
      `
      select
        io.id,
        io.order_no as "orderNo",
        io.session_id as "sessionId",
        rs.session_ref as "sessionRef",
        io.user_id as "userId",
        su.display_name as "userDisplayName",
        su.mobile as "userMobile",
        io.billing_package_id as "billingPackageId",
        bp.package_name as "billingPackageName",
        w.well_code as "wellCode",
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as "wellDisplayName",
        rs.status as "sessionStatus",
        io.status,
        io.settlement_status as "settlementStatus",
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        bp.unit_type as "unitType",
        io.amount,
        io.payment_mode as "paymentMode",
        io.payment_status as "paymentStatus",
        io.prepaid_amount as "prepaidAmount",
        io.locked_amount as "lockedAmount",
        io.refunded_amount as "refundedAmount",
        io.target_imei as "targetImei",
        io.target_device_role as "targetDeviceRole",
        rs.end_reason_code as "endReasonCode",
        rs.started_at as "startedAt",
        rs.ended_at as "endedAt",
        io.pricing_snapshot_json as "pricingSnapshot",
        io.pricing_detail_json as "pricingDetail",
        count(*) over() as total
      from irrigation_order io
      join sys_user su on su.id = io.user_id
      join runtime_session rs on rs.id = io.session_id
      join well w on w.id = rs.well_id
      join billing_package bp on bp.id = io.billing_package_id
      ${whereSql}
      order by io.created_at desc
      limit ${limitPlaceholder}
      offset ${offsetPlaceholder}
      `,
      values
    );

    return {
      rows: result.rows,
      total: Number(result.rows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }

  async findById(id: string, client?: PoolClient) {
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
      unitType: string | null;
      sessionRef: string | null;
      sessionStatus: string | null;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      amount: number;
      orderChannel: string | null;
      fundingMode: string | null;
      paymentMode: string | null;
      paymentStatus: string | null;
      prepaidAmount: number | null;
      lockedAmount: number | null;
      refundedAmount: number | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      sourcePaymentIntentId: string | null;
      endReasonCode: string | null;
      startedAt: string | null;
      endedAt: string | null;
      pricingSnapshot: Record<string, unknown>;
      pricingDetail: Record<string, unknown>;
      checkoutSnapshot: Record<string, unknown>;
    }>(
      `
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
        bp.unit_type as "unitType",
        rs.session_ref as "sessionRef",
        rs.status as "sessionStatus",
        io.status,
        io.settlement_status as "settlementStatus",
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        io.amount,
        io.order_channel as "orderChannel",
        io.funding_mode as "fundingMode",
        io.payment_mode as "paymentMode",
        io.payment_status as "paymentStatus",
        io.prepaid_amount as "prepaidAmount",
        io.locked_amount as "lockedAmount",
        io.refunded_amount as "refundedAmount",
        io.target_imei as "targetImei",
        io.target_device_role as "targetDeviceRole",
        io.source_payment_intent_id::text as "sourcePaymentIntentId",
        rs.end_reason_code as "endReasonCode",
        rs.started_at as "startedAt",
        rs.ended_at as "endedAt",
        io.pricing_snapshot_json as "pricingSnapshot",
        io.pricing_detail_json as "pricingDetail",
        io.checkout_snapshot_json as "checkoutSnapshot"
      from irrigation_order io
      join sys_user su on su.id = io.user_id
      join runtime_session rs on rs.id = io.session_id
      join well w on w.id = rs.well_id
      join billing_package bp on bp.id = io.billing_package_id
      where io.id = $1
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
      sessionStatus: string | null;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      amount: number;
      paymentMode: string | null;
      paymentStatus: string | null;
      prepaidAmount: number | null;
      lockedAmount: number | null;
      refundedAmount: number | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      endReasonCode: string | null;
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
        rs.status as "sessionStatus",
        io.status,
        io.settlement_status as "settlementStatus",
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        io.amount,
        io.payment_mode as "paymentMode",
        io.payment_status as "paymentStatus",
        io.prepaid_amount as "prepaidAmount",
        io.locked_amount as "lockedAmount",
        io.refunded_amount as "refundedAmount",
        io.target_imei as "targetImei",
        io.target_device_role as "targetDeviceRole",
        rs.end_reason_code as "endReasonCode",
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

  async findByUserIdPage(userId: string, page: number, pageSize: number) {
    const offset = (Math.max(1, page) - 1) * Math.max(1, pageSize);
    const limit = Math.min(100, Math.max(1, pageSize));
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
      sessionStatus: string | null;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      chargeVolume: number | null;
      amount: number;
      paymentMode: string | null;
      paymentStatus: string | null;
      prepaidAmount: number | null;
      lockedAmount: number | null;
      refundedAmount: number | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      endReasonCode: string | null;
      pricingDetail: Record<string, unknown>;
      total: string;
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
        rs.status as "sessionStatus",
        io.status,
        io.settlement_status as "settlementStatus",
        io.charge_duration_sec as "chargeDurationSec",
        io.charge_volume as "chargeVolume",
        io.amount,
        io.payment_mode as "paymentMode",
        io.payment_status as "paymentStatus",
        io.prepaid_amount as "prepaidAmount",
        io.locked_amount as "lockedAmount",
        io.refunded_amount as "refundedAmount",
        io.target_imei as "targetImei",
        io.target_device_role as "targetDeviceRole",
        rs.end_reason_code as "endReasonCode",
        io.pricing_detail_json as "pricingDetail",
        count(*) over()::text as total
      from irrigation_order io
      join runtime_session rs on rs.id = io.session_id
      join well w on w.id = rs.well_id
      join billing_package bp on bp.id = io.billing_package_id
      where io.user_id = $1
      order by io.created_at desc
      offset $2
      limit $3
      `,
      [userId, offset, limit]
    );
    const total = result.rows.length > 0 ? Number.parseInt(result.rows[0].total, 10) : 0;
    return { rows: result.rows.map(({ total: _t, ...row }) => row), total };
  }

  async findBySessionId(sessionId: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      orderNo: string;
      sessionId: string;
      userId: string;
      billingPackageId: string;
      status: string;
      settlementStatus: string;
      chargeDurationSec: number | null;
      amount: number;
      orderChannel: string | null;
      fundingMode: string | null;
      paymentMode: string | null;
      paymentStatus: string | null;
      prepaidAmount: number | null;
      lockedAmount: number | null;
      refundedAmount: number | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      sourcePaymentIntentId: string | null;
      pricingSnapshot: Record<string, unknown>;
      pricingDetail: Record<string, unknown>;
      checkoutSnapshot: Record<string, unknown>;
    }>(
      `
      select
        id,
        tenant_id as "tenantId",
        order_no as "orderNo",
        session_id as "sessionId",
        user_id as "userId",
        billing_package_id as "billingPackageId",
        status,
        settlement_status as "settlementStatus",
        charge_duration_sec as "chargeDurationSec",
        amount,
        order_channel as "orderChannel",
        funding_mode as "fundingMode",
        payment_mode as "paymentMode",
        payment_status as "paymentStatus",
        prepaid_amount as "prepaidAmount",
        locked_amount as "lockedAmount",
        refunded_amount as "refundedAmount",
        target_imei as "targetImei",
        target_device_role as "targetDeviceRole",
        source_payment_intent_id::text as "sourcePaymentIntentId",
        pricing_snapshot_json as "pricingSnapshot",
        pricing_detail_json as "pricingDetail",
        checkout_snapshot_json as "checkoutSnapshot"
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
    orderChannel?: string | null;
    fundingMode?: string | null;
  }, client: PoolClient) {
    const orderNo = `ord_${Date.now()}`;
    try {
      const result = await this.db.query<{ id: string; orderNo: string }>(
        `
        insert into irrigation_order (
          id, tenant_id, order_no, session_id, user_id, billing_package_id,
          status, settlement_status, amount, order_channel, funding_mode,
          pricing_snapshot_json, pricing_detail_json
        ) values (
          $1, $2, $3, $4, $5, $6,
          'created', 'unpaid', 0, $7, $8,
          $9::jsonb, $10::jsonb
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
          input.orderChannel ?? null,
          input.fundingMode ?? null,
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
