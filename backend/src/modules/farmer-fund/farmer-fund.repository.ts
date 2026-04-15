import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class FarmerFundRepository {
  constructor(private readonly db: DatabaseService) {}

  async findFarmerUserByMobile(tenantId: string, mobile: string, client?: PoolClient) {
    const q = `
      select id, tenant_id as "tenantId", display_name as "displayName", mobile
      from sys_user
      where tenant_id = $1 and user_type = 'farmer' and mobile = $2
      limit 1
    `;
    const result = client
      ? await client.query<{ id: string; tenantId: string; displayName: string | null; mobile: string }>(q, [tenantId, mobile])
      : await this.db.query<{ id: string; tenantId: string; displayName: string | null; mobile: string }>(q, [tenantId, mobile]);
    return result.rows[0] ?? null;
  }

  async findDefaultFarmerUser(client?: PoolClient) {
    const q = `
      select id, tenant_id as "tenantId"
      from sys_user
      where user_type = 'farmer' and status = 'active'
      order by created_at asc
      limit 1
    `;
    const result = client ? await client.query<{ id: string; tenantId: string }>(q) : await this.db.query<{ id: string; tenantId: string }>(q);
    return result.rows[0] ?? null;
  }

  async findActiveCardUser(cardToken: string, client?: PoolClient) {
    const q = `
      select user_id as id, tenant_id as "tenantId"
      from farmer_card
      where card_token = $1 and status = 'active'
      limit 1
    `;
    const result = client ? await client.query<{ id: string; tenantId: string }>(q, [cardToken]) : await this.db.query<{ id: string; tenantId: string }>(q, [cardToken]);
    return result.rows[0] ?? null;
  }

  async ensureWallet(tenantId: string, userId: string, client?: PoolClient) {
    const sql = `
      insert into farmer_wallet (tenant_id, user_id, balance)
      values ($1, $2, 0)
      on conflict (tenant_id, user_id) do nothing
    `;
    if (client) {
      await client.query(sql, [tenantId, userId]);
    } else {
      await this.db.query(sql, [tenantId, userId]);
    }
  }

  async getBalance(tenantId: string, userId: string, client?: PoolClient): Promise<number> {
    await this.ensureWallet(tenantId, userId, client);
    const q = `
      select balance::float8 as balance
      from farmer_wallet
      where tenant_id = $1 and user_id = $2
    `;
    const result = client ? await client.query<{ balance: number }>(q, [tenantId, userId]) : await this.db.query<{ balance: number }>(q, [tenantId, userId]);
    return Number(result.rows[0]?.balance ?? 0);
  }

  async getWalletState(
    tenantId: string,
    userId: string,
    client?: PoolClient
  ): Promise<{ balance: number; lockedBalance: number }> {
    await this.ensureWallet(tenantId, userId, client);
    const q = `
      select
        balance::float8 as balance,
        coalesce(locked_balance, 0)::float8 as "lockedBalance"
      from farmer_wallet
      where tenant_id = $1 and user_id = $2
    `;
    const result = client
      ? await client.query<{ balance: number; lockedBalance: number }>(q, [tenantId, userId])
      : await this.db.query<{ balance: number; lockedBalance: number }>(q, [tenantId, userId]);
    return {
      balance: Number(result.rows[0]?.balance ?? 0),
      lockedBalance: Number(result.rows[0]?.lockedBalance ?? 0),
    };
  }

  async listFarmers(tenantId: string, offset: number, limit: number) {
    const result = await this.db.query<{
      id: string;
      displayName: string;
      mobile: string;
      status: string;
      balance: string;
      total: string;
    }>(
      `
      select
        u.id,
        u.display_name as "displayName",
        u.mobile,
        u.status,
        coalesce(fw.balance, 0)::text as balance,
        count(*) over()::text as total
      from sys_user u
      left join farmer_wallet fw on fw.tenant_id = u.tenant_id and fw.user_id = u.id
      where u.tenant_id = $1 and u.user_type = 'farmer'
      order by u.created_at asc
      offset $2
      limit $3
      `,
      [tenantId, offset, limit]
    );
    const total = result.rows.length > 0 ? Number.parseInt(result.rows[0].total, 10) : 0;
    return {
      items: result.rows.map(({ total: _t, ...row }) => ({
        ...row,
        balance: Number(row.balance)
      })),
      total
    };
  }

  async insertFarmerUser(input: { tenantId: string; displayName: string; mobile: string }, client?: PoolClient) {
    const id = randomUUID();
    if (client) {
      await client.query(
        `
        insert into sys_user (id, tenant_id, user_type, display_name, mobile, status)
        values ($1, $2, 'farmer', $3, $4, 'active')
        `,
        [id, input.tenantId, input.displayName, input.mobile]
      );
    } else {
      await this.db.query(
        `
        insert into sys_user (id, tenant_id, user_type, display_name, mobile, status)
        values ($1, $2, 'farmer', $3, $4, 'active')
        `,
        [id, input.tenantId, input.displayName, input.mobile]
      );
    }
    const role = client
      ? await client.query<{ id: string }>(
          `select id from sys_role where tenant_id = $1 and role_type = 'farmer' order by created_at asc limit 1`,
          [input.tenantId]
        )
      : await this.db.query<{ id: string }>(
          `select id from sys_role where tenant_id = $1 and role_type = 'farmer' order by created_at asc limit 1`,
          [input.tenantId]
        );
    const roleId = role.rows[0]?.id;
    if (roleId) {
      if (client) {
        await client.query(
          `
          insert into sys_user_role (id, tenant_id, user_id, role_id)
          values ($1, $2, $3, $4)
          `,
          [randomUUID(), input.tenantId, id, roleId]
        );
      } else {
        await this.db.query(
          `
          insert into sys_user_role (id, tenant_id, user_id, role_id)
          values ($1, $2, $3, $4)
          `,
          [randomUUID(), input.tenantId, id, roleId]
        );
      }
    }
    await this.ensureWallet(input.tenantId, id, client);
    return id;
  }

  async listCards(tenantId: string, userId: string) {
    const result = await this.db.query<{
      id: string;
      cardToken: string;
      status: string;
      label: string | null;
      createdAt: Date;
    }>(
      `
      select id, card_token as "cardToken", status, label, created_at as "createdAt"
      from farmer_card
      where tenant_id = $1 and user_id = $2
      order by created_at desc
      `,
      [tenantId, userId]
    );
    return result.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async getCardCatalogByToken(tenantId: string, cardToken: string, client?: PoolClient) {
    const q = `
      select
        c.id,
        c.tenant_id as "tenantId",
        c.card_token as "cardToken",
        c.user_id as "userId",
        c.status,
        c.label,
        c.batch_no as "batchNo",
        c.holder_name as "holderName",
        c.holder_mobile as "holderMobile",
        c.source_type as "sourceType",
        c.ext_json as "extJson",
        c.registered_at as "registeredAt",
        c.created_at as "createdAt",
        c.updated_at as "updatedAt",
        u.display_name as "userDisplayName",
        u.mobile as "userMobile"
      from farmer_card_catalog c
      left join sys_user u on u.id = c.user_id
      where c.tenant_id = $1 and c.card_token = $2
      limit 1
    `;
    const result = client
      ? await client.query<{
          id: string;
          tenantId: string;
          cardToken: string;
          userId: string | null;
          status: string;
          label: string | null;
          batchNo: string | null;
          holderName: string | null;
          holderMobile: string | null;
          sourceType: string;
          extJson: Record<string, unknown> | null;
          registeredAt: Date | null;
          createdAt: Date;
          updatedAt: Date;
          userDisplayName: string | null;
          userMobile: string | null;
        }>(q, [tenantId, cardToken])
      : await this.db.query<{
          id: string;
          tenantId: string;
          cardToken: string;
          userId: string | null;
          status: string;
          label: string | null;
          batchNo: string | null;
          holderName: string | null;
          holderMobile: string | null;
          sourceType: string;
          extJson: Record<string, unknown> | null;
          registeredAt: Date | null;
          createdAt: Date;
          updatedAt: Date;
          userDisplayName: string | null;
          userMobile: string | null;
        }>(q, [tenantId, cardToken]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      registeredAt: row.registeredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async upsertCardCatalog(input: {
    tenantId: string;
    cardToken: string;
    label?: string | null;
    batchNo?: string | null;
    sourceType?: string | null;
    userId?: string | null;
    holderName?: string | null;
    holderMobile?: string | null;
    status?: string | null;
    extJson?: Record<string, unknown> | null;
  }, client?: PoolClient) {
    const q = `
      insert into farmer_card_catalog (
        id, tenant_id, card_token, user_id, status, label, batch_no, holder_name, holder_mobile, source_type, ext_json, registered_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
        case when $4::uuid is not null then now() else null end
      )
      on conflict (tenant_id, card_token)
      do update set
        user_id = coalesce(excluded.user_id, farmer_card_catalog.user_id),
        status = excluded.status,
        label = coalesce(excluded.label, farmer_card_catalog.label),
        batch_no = coalesce(excluded.batch_no, farmer_card_catalog.batch_no),
        holder_name = coalesce(excluded.holder_name, farmer_card_catalog.holder_name),
        holder_mobile = coalesce(excluded.holder_mobile, farmer_card_catalog.holder_mobile),
        source_type = coalesce(excluded.source_type, farmer_card_catalog.source_type),
        ext_json = coalesce(farmer_card_catalog.ext_json, '{}'::jsonb) || coalesce(excluded.ext_json, '{}'::jsonb),
        registered_at = case
          when coalesce(excluded.user_id, farmer_card_catalog.user_id) is not null
            then coalesce(farmer_card_catalog.registered_at, now())
          else farmer_card_catalog.registered_at
        end,
        updated_at = now()
      returning id
    `;
    const params = [
      randomUUID(),
      input.tenantId,
      input.cardToken,
      input.userId ?? null,
      input.status ?? (input.userId ? 'active' : 'unregistered'),
      input.label ?? null,
      input.batchNo ?? null,
      input.holderName ?? null,
      input.holderMobile ?? null,
      input.sourceType ?? 'import',
      JSON.stringify(input.extJson ?? {}),
    ];
    const result = client ? await client.query<{ id: string }>(q, params) : await this.db.query<{ id: string }>(q, params);
    return result.rows[0]?.id ?? null;
  }

  async bindCardCatalogToUser(
    input: { tenantId: string; cardToken: string; userId: string; holderName: string; holderMobile: string },
    client?: PoolClient
  ) {
    const q = `
      update farmer_card_catalog
      set
        user_id = $3::uuid,
        status = 'active',
        holder_name = $4,
        holder_mobile = $5,
        registered_at = coalesce(registered_at, now()),
        updated_at = now()
      where tenant_id = $1 and card_token = $2
      returning id
    `;
    const result = client
      ? await client.query<{ id: string }>(q, [input.tenantId, input.cardToken, input.userId, input.holderName, input.holderMobile])
      : await this.db.query<{ id: string }>(q, [input.tenantId, input.cardToken, input.userId, input.holderName, input.holderMobile]);
    return result.rows[0]?.id ?? null;
  }

  async ensureFarmerCardBinding(input: {
    tenantId: string;
    userId: string;
    cardToken: string;
    label?: string | null;
  }, client?: PoolClient) {
    const q = `
      insert into farmer_card (id, tenant_id, user_id, card_token, status, label)
      values ($1, $2, $3, $4, 'active', $5)
      on conflict (tenant_id, card_token)
      do update set
        user_id = excluded.user_id,
        status = 'active',
        label = coalesce(excluded.label, farmer_card.label),
        updated_at = now()
      returning id
    `;
    const result = client
      ? await client.query<{ id: string }>(q, [randomUUID(), input.tenantId, input.userId, input.cardToken, input.label ?? null])
      : await this.db.query<{ id: string }>(q, [randomUUID(), input.tenantId, input.userId, input.cardToken, input.label ?? null]);
    return result.rows[0]?.id ?? null;
  }

  async updateFarmerDisplayName(tenantId: string, userId: string, displayName: string, client?: PoolClient) {
    const q = `
      update sys_user
      set display_name = $3
      where tenant_id = $1 and id = $2::uuid and user_type = 'farmer'
    `;
    if (client) {
      await client.query(q, [tenantId, userId, displayName]);
    } else {
      await this.db.query(q, [tenantId, userId, displayName]);
    }
  }

  async listCardCatalog(input: {
    tenantId: string;
    offset: number;
    limit: number;
    q?: string | null;
    status?: string | null;
  }) {
    const result = await this.db.query<{
      id: string;
      cardToken: string;
      status: string;
      label: string | null;
      batchNo: string | null;
      holderName: string | null;
      holderMobile: string | null;
      userId: string | null;
      balance: string;
      lockedBalance: string;
      createdAt: Date;
      updatedAt: Date;
      total: string;
    }>(
      `
      select
        c.id,
        c.card_token as "cardToken",
        c.status,
        c.label,
        c.batch_no as "batchNo",
        coalesce(c.holder_name, u.display_name) as "holderName",
        coalesce(c.holder_mobile, u.mobile) as "holderMobile",
        c.user_id as "userId",
        coalesce(fw.balance, 0)::text as balance,
        coalesce(fw.locked_balance, 0)::text as "lockedBalance",
        c.created_at as "createdAt",
        c.updated_at as "updatedAt",
        count(*) over()::text as total
      from farmer_card_catalog c
      left join sys_user u on u.id = c.user_id
      left join farmer_wallet fw on fw.tenant_id = c.tenant_id and fw.user_id = c.user_id
      where c.tenant_id = $1
        and ($2::text is null or c.status = $2)
        and (
          $3::text is null
          or c.card_token ilike '%' || $3 || '%'
          or coalesce(c.holder_name, u.display_name, '') ilike '%' || $3 || '%'
          or coalesce(c.holder_mobile, u.mobile, '') ilike '%' || $3 || '%'
        )
      order by c.created_at desc
      offset $4
      limit $5
      `,
      [input.tenantId, input.status?.trim() || null, input.q?.trim() || null, input.offset, input.limit]
    );
    const total = result.rows[0] ? Number.parseInt(result.rows[0].total, 10) : 0;
    return {
      items: result.rows.map(({ total: _total, createdAt, updatedAt, ...row }) => ({
        ...row,
        balance: Number(row.balance ?? 0),
        lockedBalance: Number(row.lockedBalance ?? 0),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      })),
      total,
    };
  }

  async listCardRechargeOrders(input: {
    tenantId: string;
    offset: number;
    limit: number;
    q?: string | null;
    status?: string | null;
    paymentChannel?: string | null;
    rechargeMode?: string | null;
    userId?: string | null;
    refundState?: 'eligible' | 'blocked' | null;
  }) {
    const result = await this.db.query<{
      id: string;
      paymentIntentId: string;
      cardToken: string;
      cardLabel: string | null;
      holderName: string | null;
      holderMobile: string | null;
      payerMobile: string | null;
      amount: string;
      status: string;
      rechargeMode: string;
      paymentChannel: string;
      outTradeNo: string | null;
      paymentIntentStatus: string | null;
      userId: string;
      createdAt: Date;
      paidAt: Date | null;
      currentBalance: string;
      isLatestPaidRecharge: boolean;
      total: string;
    }>(
      `
      select
        r.id,
        r.payment_intent_id as "paymentIntentId",
        c.card_token as "cardToken",
        c.label as "cardLabel",
        coalesce(c.holder_name, u.display_name) as "holderName",
        coalesce(r.holder_mobile, c.holder_mobile, u.mobile) as "holderMobile",
        r.payer_mobile as "payerMobile",
        r.amount::text as amount,
        r.status,
        r.recharge_mode as "rechargeMode",
        r.payment_channel as "paymentChannel",
        pi.out_trade_no as "outTradeNo",
        pi.status as "paymentIntentStatus",
        r.user_id as "userId",
        r.created_at as "createdAt",
        r.paid_at as "paidAt",
        coalesce(fw.balance, 0)::text as "currentBalance",
        coalesce(latest_paid.latest_id = r.id, false) as "isLatestPaidRecharge",
        count(*) over()::text as total
      from farmer_card_recharge r
      join farmer_card_catalog c on c.id = r.card_catalog_id
      join sys_user u on u.id = r.user_id
      left join payment_intent pi on pi.id = r.payment_intent_id
      left join farmer_wallet fw on fw.tenant_id = r.tenant_id and fw.user_id = r.user_id
      left join lateral (
        select r2.id as latest_id
        from farmer_card_recharge r2
        where r2.tenant_id = r.tenant_id
          and r2.user_id = r.user_id
          and r2.card_catalog_id = r.card_catalog_id
          and r2.status = 'paid'
        order by coalesce(r2.paid_at, r2.created_at) desc, r2.created_at desc, r2.id desc
        limit 1
      ) latest_paid on true
      where r.tenant_id = $1
        and ($2::text is null or r.status = $2)
        and ($3::text is null or r.payment_channel = $3)
        and ($4::text is null or r.recharge_mode = $4)
        and ($5::uuid is null or r.user_id = $5::uuid)
        and (
          $6::text is null
          or c.card_token ilike '%' || $6 || '%'
          or coalesce(c.holder_name, u.display_name, '') ilike '%' || $6 || '%'
          or coalesce(r.holder_mobile, c.holder_mobile, u.mobile, '') ilike '%' || $6 || '%'
          or coalesce(r.payer_mobile, '') ilike '%' || $6 || '%'
          or coalesce(pi.out_trade_no, '') ilike '%' || $6 || '%'
        )
        and (
          $7::text is null
          or (
            case
              when coalesce(pi.status, r.status) = 'paid'
                and coalesce(latest_paid.latest_id = r.id, false)
                and coalesce(fw.balance, 0) + 0.000001 >= r.amount
              then 'eligible'
              else 'blocked'
            end
          ) = $7
        )
      order by r.created_at desc
      offset $8
      limit $9
      `,
      [
        input.tenantId,
        input.status ?? null,
        input.paymentChannel ?? null,
        input.rechargeMode ?? null,
        input.userId ?? null,
        input.q ?? null,
        input.refundState ?? null,
        input.offset,
        input.limit,
      ]
    );
    const total = result.rows.length > 0 ? Number.parseInt(result.rows[0].total, 10) : 0;
    return {
      items: result.rows.map(({ total: _total, amount, createdAt, paidAt, ...row }) => ({
        ...row,
        amount: Number(amount),
        currentBalance: Number(row.currentBalance),
        createdAt: createdAt.toISOString(),
        paidAt: paidAt?.toISOString() ?? null,
      })),
      total,
    };
  }

  async getCardRechargeOrderById(
    input: { tenantId: string; id: string; forUpdate?: boolean },
    client?: PoolClient
  ) {
    type CardRechargeOrderDetailRow = {
      id: string;
      tenantId: string;
      cardCatalogId: string;
      userId: string;
      paymentIntentId: string;
      cardToken: string;
      cardLabel: string | null;
      holderName: string | null;
      holderMobile: string | null;
      payerMobile: string | null;
      amount: number;
      status: string;
      rechargeMode: string;
      paymentChannel: string;
      requestSnapshot: Record<string, unknown> | null;
      providerPayload: Record<string, unknown> | null;
      createdAt: Date;
      paidAt: Date | null;
      outTradeNo: string | null;
      paymentIntentStatus: string | null;
      refundedAmount: number;
      callbackToken: string | null;
      payLink: string | null;
      checkoutSnapshot: Record<string, unknown> | null;
      paymentProviderPayload: Record<string, unknown> | null;
      currentBalance: number;
      currentLockedBalance: number;
    };
    const q = `
      select
        r.id,
        r.tenant_id as "tenantId",
        r.card_catalog_id as "cardCatalogId",
        r.user_id as "userId",
        r.payment_intent_id as "paymentIntentId",
        c.card_token as "cardToken",
        c.label as "cardLabel",
        coalesce(c.holder_name, u.display_name) as "holderName",
        coalesce(r.holder_mobile, c.holder_mobile, u.mobile) as "holderMobile",
        r.payer_mobile as "payerMobile",
        r.amount::float8 as amount,
        r.status,
        r.recharge_mode as "rechargeMode",
        r.payment_channel as "paymentChannel",
        r.request_snapshot_json as "requestSnapshot",
        r.provider_payload_json as "providerPayload",
        r.created_at as "createdAt",
        r.paid_at as "paidAt",
        pi.out_trade_no as "outTradeNo",
        pi.status as "paymentIntentStatus",
        pi.refunded_amount::float8 as "refundedAmount",
        pi.callback_token as "callbackToken",
        pi.pay_link as "payLink",
        pi.checkout_snapshot_json as "checkoutSnapshot",
        pi.provider_payload_json as "paymentProviderPayload",
        coalesce(fw.balance, 0)::float8 as "currentBalance",
        coalesce(fw.locked_balance, 0)::float8 as "currentLockedBalance"
      from farmer_card_recharge r
      join farmer_card_catalog c on c.id = r.card_catalog_id
      join sys_user u on u.id = r.user_id
      left join payment_intent pi on pi.id = r.payment_intent_id
      left join farmer_wallet fw on fw.tenant_id = r.tenant_id and fw.user_id = r.user_id
      where r.tenant_id = $1 and r.id = $2::uuid
      ${input.forUpdate ? 'for update of r' : ''}
      limit 1
    `;
    const result = client
      ? await client.query<CardRechargeOrderDetailRow>(q, [input.tenantId, input.id])
      : await this.db.query<CardRechargeOrderDetailRow>(q, [input.tenantId, input.id]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      amount: Number(row.amount ?? 0),
      refundedAmount: Number(row.refundedAmount ?? 0),
      currentBalance: Number(row.currentBalance ?? 0),
      currentLockedBalance: Number(row.currentLockedBalance ?? 0),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      paidAt: row.paidAt instanceof Date ? row.paidAt.toISOString() : row.paidAt,
    };
  }

  async getCardUsageAfterRecharge(
    input: { tenantId: string; userId: string; cardToken: string; paidAt: string },
    client?: PoolClient
  ) {
    const q = `
      select
        io.id as "orderId",
        io.order_no as "orderNo",
        io.status,
        io.settlement_status as "settlementStatus",
        io.amount::float8 as amount,
        coalesce(io.locked_amount, 0)::float8 as "lockedAmount",
        coalesce(io.refunded_amount, 0)::float8 as "refundedAmount",
        io.created_at as "createdAt"
      from irrigation_order io
      where io.tenant_id = $1::uuid
        and io.user_id = $2::uuid
        and io.order_channel = 'CARD'
        and coalesce(io.checkout_snapshot_json->>'card_token', '') = $3
        and io.created_at >= $4::timestamptz
        and (
          io.status <> 'settled'
          or coalesce(io.amount, 0) > 0
          or coalesce(io.locked_amount, 0) > coalesce(io.refunded_amount, 0)
        )
      order by io.created_at desc
      limit 5
    `;
    const result = client
      ? await client.query<{
          orderId: string;
          orderNo: string | null;
          status: string;
          settlementStatus: string | null;
          amount: number;
          lockedAmount: number;
          refundedAmount: number;
          createdAt: Date;
        }>(q, [input.tenantId, input.userId, input.cardToken, input.paidAt])
      : await this.db.query<{
          orderId: string;
          orderNo: string | null;
          status: string;
          settlementStatus: string | null;
          amount: number;
          lockedAmount: number;
          refundedAmount: number;
          createdAt: Date;
        }>(q, [input.tenantId, input.userId, input.cardToken, input.paidAt]);
    return {
      count: result.rows.length,
      items: result.rows.map((row) => ({
        ...row,
        amount: Number(row.amount ?? 0),
        lockedAmount: Number(row.lockedAmount ?? 0),
        refundedAmount: Number(row.refundedAmount ?? 0),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async getLatestPaidRechargeForCard(
    input: { tenantId: string; userId: string; cardToken: string },
    client?: PoolClient
  ) {
    const q = `
      select
        r.id::text as "id",
        r.payment_intent_id::text as "paymentIntentId",
        r.status,
        r.paid_at as "paidAt",
        r.created_at as "createdAt"
      from farmer_card_recharge r
      join farmer_card_catalog c on c.id = r.card_catalog_id
      where r.tenant_id = $1::uuid
        and r.user_id = $2::uuid
        and c.card_token = $3
        and r.status = 'paid'
      order by coalesce(r.paid_at, r.created_at) desc, r.created_at desc, r.id desc
      limit 1
    `;
    const result = client
      ? await client.query<{ id: string; paymentIntentId: string | null; status: string; paidAt: Date | null; createdAt: Date }>(
          q,
          [input.tenantId, input.userId, input.cardToken]
        )
      : await this.db.query<{ id: string; paymentIntentId: string | null; status: string; paidAt: Date | null; createdAt: Date }>(
          q,
          [input.tenantId, input.userId, input.cardToken]
        );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async insertRechargePaymentIntent(input: {
    tenantId: string;
    userId: string;
    cardToken: string;
    paymentAccountId?: string | null;
    paymentAccountSnapshot?: Record<string, unknown> | null;
    paymentChannel: string;
    paymentMode: string;
    amount: number;
    outTradeNo: string;
    callbackToken: string;
    checkoutSnapshot: Record<string, unknown>;
    providerPayload?: Record<string, unknown>;
    expiredAt?: string | null;
  }, client?: PoolClient) {
    const q = `
      insert into payment_intent (
        id, tenant_id, user_id, payment_account_id, target_device_id, session_id, order_id, imei,
        payment_channel, payment_mode, status, out_trade_no, callback_token,
        amount, refunded_amount, pay_link, checkout_snapshot_json, payment_account_snapshot_json, provider_payload_json, expired_at
      ) values (
        $1, $2, $3, $4::uuid, null, null, null, $5,
        $6, $7, 'created', $8, $9,
        $10, 0, null, $11::jsonb, $12::jsonb, $13::jsonb, $14::timestamptz
      )
      returning id
    `;
    const id = randomUUID();
    const params = [
      id,
      input.tenantId,
      input.userId,
      input.paymentAccountId ?? null,
      `card:${input.cardToken}`,
      input.paymentChannel,
      input.paymentMode,
      input.outTradeNo,
      input.callbackToken,
      input.amount,
      JSON.stringify(input.checkoutSnapshot ?? {}),
      JSON.stringify(input.paymentAccountSnapshot ?? {}),
      JSON.stringify(input.providerPayload ?? {}),
      input.expiredAt ?? null,
    ];
    const result = client ? await client.query<{ id: string }>(q, params) : await this.db.query<{ id: string }>(q, params);
    return result.rows[0]?.id ?? id;
  }

  async getPaymentIntentById(id: string, client?: PoolClient) {
    const q = `
      select
        id,
        tenant_id as "tenantId",
        user_id as "userId",
        payment_account_id as "paymentAccountId",
        payment_channel as "paymentChannel",
        payment_mode as "paymentMode",
        status,
        out_trade_no as "outTradeNo",
        callback_token as "callbackToken",
        amount::float8 as amount,
        refunded_amount::float8 as "refundedAmount",
        pay_link as "payLink",
        checkout_snapshot_json as "checkoutSnapshot",
        payment_account_snapshot_json as "paymentAccountSnapshot",
        provider_payload_json as "providerPayload",
        paid_at as "paidAt",
        expired_at as "expiredAt",
        created_at as "createdAt"
      from payment_intent
      where id = $1::uuid
      limit 1
    `;
    const result = client
      ? await client.query<Record<string, unknown>>(q, [id])
      : await this.db.query<Record<string, unknown>>(q, [id]);
    return result.rows[0] ?? null;
  }

  async getPaymentIntentByOutTradeNo(outTradeNo: string, client?: PoolClient) {
    const q = `
      select
        id,
        tenant_id as "tenantId",
        user_id as "userId",
        payment_account_id as "paymentAccountId",
        payment_channel as "paymentChannel",
        payment_mode as "paymentMode",
        status,
        out_trade_no as "outTradeNo",
        callback_token as "callbackToken",
        amount::float8 as amount,
        refunded_amount::float8 as "refundedAmount",
        pay_link as "payLink",
        checkout_snapshot_json as "checkoutSnapshot",
        payment_account_snapshot_json as "paymentAccountSnapshot",
        provider_payload_json as "providerPayload",
        paid_at as "paidAt",
        expired_at as "expiredAt",
        created_at as "createdAt"
      from payment_intent
      where out_trade_no = $1
      limit 1
    `;
    const result = client
      ? await client.query<Record<string, unknown>>(q, [outTradeNo])
      : await this.db.query<Record<string, unknown>>(q, [outTradeNo]);
    return result.rows[0] ?? null;
  }

  async markPaymentIntentPaid(
    client: PoolClient,
    input: { id: string; providerPayload?: Record<string, unknown>; payLink?: string | null }
  ) {
    await client.query(
      `
      update payment_intent
      set
        status = 'paid',
        paid_at = coalesce(paid_at, now()),
        provider_payload_json = coalesce(provider_payload_json, '{}'::jsonb) || $2::jsonb,
        pay_link = coalesce($3, pay_link)
      where id = $1::uuid
      `,
      [input.id, JSON.stringify(input.providerPayload ?? {}), input.payLink ?? null]
    );
  }

  async updatePaymentIntentPayLink(id: string, payLink: string, client?: PoolClient) {
    const q = `update payment_intent set pay_link = $2, updated_at = now() where id = $1::uuid`;
    if (client) {
      await client.query(q, [id, payLink]);
    } else {
      await this.db.query(q, [id, payLink]);
    }
  }

  async createRechargeRecord(
    client: PoolClient,
    input: {
      tenantId: string;
      cardCatalogId: string;
      userId: string;
      paymentIntentId: string;
      paymentChannel: string;
      rechargeMode: string;
      amount: number;
      holderMobile?: string | null;
      payerMobile?: string | null;
      requestSnapshot?: Record<string, unknown>;
      providerPayload?: Record<string, unknown>;
      status?: string;
      paidAt?: string | null;
    }
  ) {
    await client.query(
      `
      insert into farmer_card_recharge (
        tenant_id, card_catalog_id, user_id, payment_intent_id, payment_channel, recharge_mode,
        amount, status, holder_mobile, payer_mobile, request_snapshot_json, provider_payload_json, paid_at
      )
      values (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
        $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::timestamptz
      )
      on conflict (payment_intent_id)
      do update set
        status = excluded.status,
        provider_payload_json = coalesce(farmer_card_recharge.provider_payload_json, '{}'::jsonb) || excluded.provider_payload_json,
        paid_at = coalesce(farmer_card_recharge.paid_at, excluded.paid_at),
        updated_at = now()
      `,
      [
        input.tenantId,
        input.cardCatalogId,
        input.userId,
        input.paymentIntentId,
        input.paymentChannel,
        input.rechargeMode,
        input.amount,
        input.status ?? 'created',
        input.holderMobile ?? null,
        input.payerMobile ?? null,
        JSON.stringify(input.requestSnapshot ?? {}),
        JSON.stringify(input.providerPayload ?? {}),
        input.paidAt ?? null,
      ]
    );
  }

  async markPaymentIntentRefunded(
    client: PoolClient,
    input: { id: string; refundedAmount: number; providerPayload?: Record<string, unknown> }
  ) {
    await client.query(
      `
      update payment_intent
      set
        status = 'refunded',
        refunded_amount = $2,
        provider_payload_json = coalesce(provider_payload_json, '{}'::jsonb) || $3::jsonb,
        updated_at = now()
      where id = $1::uuid
      `,
      [input.id, input.refundedAmount, JSON.stringify(input.providerPayload ?? {})]
    );
  }

  async markRechargeRecordRefunded(
    client: PoolClient,
    input: { id: string; providerPayload?: Record<string, unknown> }
  ) {
    await client.query(
      `
      update farmer_card_recharge
      set
        status = 'refunded',
        provider_payload_json = coalesce(provider_payload_json, '{}'::jsonb) || $2::jsonb,
        updated_at = now()
      where id = $1::uuid
      `,
      [input.id, JSON.stringify(input.providerPayload ?? {})]
    );
  }

  async getRechargeRecordByPaymentIntent(paymentIntentId: string, client?: PoolClient) {
    const q = `
      select
        id,
        tenant_id as "tenantId",
        card_catalog_id as "cardCatalogId",
        user_id as "userId",
        payment_intent_id as "paymentIntentId",
        payment_channel as "paymentChannel",
        recharge_mode as "rechargeMode",
        amount::float8 as amount,
        status,
        holder_mobile as "holderMobile",
        payer_mobile as "payerMobile",
        request_snapshot_json as "requestSnapshot",
        provider_payload_json as "providerPayload",
        paid_at as "paidAt",
        created_at as "createdAt"
      from farmer_card_recharge
      where payment_intent_id = $1::uuid
      limit 1
    `;
    const result = client
      ? await client.query<Record<string, unknown>>(q, [paymentIntentId])
      : await this.db.query<Record<string, unknown>>(q, [paymentIntentId]);
    return result.rows[0] ?? null;
  }

  async insertCard(input: { tenantId: string; userId: string; cardToken: string; label?: string | null }) {
    const id = randomUUID();
    await this.db.query(
      `
      insert into farmer_card (id, tenant_id, user_id, card_token, status, label)
      values ($1, $2, $3, $4, 'active', $5)
      `,
      [id, input.tenantId, input.userId, input.cardToken, input.label ?? null]
    );
    return id;
  }

  async insertLedgerAndApplyWalletState(
    client: PoolClient,
    input: {
      tenantId: string;
      userId: string;
      entryType: string;
      amount: number;
      availableDelta: number;
      lockedDelta?: number;
      referenceType?: string | null;
      referenceId?: string | null;
      idempotencyKey: string;
      remark?: string | null;
    }
  ): Promise<{ applied: boolean; balanceAfter: number; lockedBalanceAfter: number }> {
    const existing = await client.query<{ id: string }>(
      `select id from farmer_wallet_ledger where tenant_id = $1 and idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey]
    );
    if (existing.rows[0]) {
      const wallet = await this.getWalletState(input.tenantId, input.userId, client);
      return { applied: false, balanceAfter: wallet.balance, lockedBalanceAfter: wallet.lockedBalance };
    }

    await this.ensureWallet(input.tenantId, input.userId, client);

    const lock = await client.query<{ balance: string; lockedBalance: string }>(
      `select balance, coalesce(locked_balance, 0)::text as "lockedBalance" from farmer_wallet where tenant_id = $1 and user_id = $2 for update`,
      [input.tenantId, input.userId]
    );
    const current = Number(lock.rows[0]?.balance ?? 0);
    const currentLocked = Number(lock.rows[0]?.lockedBalance ?? 0);
    const next = current + input.availableDelta;
    const nextLocked = currentLocked + Number(input.lockedDelta ?? 0);
    if (next < 0 || nextLocked < 0) {
      throw new Error('WALLET_INSUFFICIENT_BALANCE');
    }

    await client.query(
      `update farmer_wallet set balance = $3, locked_balance = $4, updated_at = now() where tenant_id = $1 and user_id = $2`,
      [input.tenantId, input.userId, next, nextLocked]
    );

    await client.query(
      `
      insert into farmer_wallet_ledger (
        id, tenant_id, user_id, entry_type, amount, balance_after, locked_balance_after, reference_type, reference_id, idempotency_key, remark
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        randomUUID(),
        input.tenantId,
        input.userId,
        input.entryType,
        input.amount,
        next,
        nextLocked,
        input.referenceType ?? null,
        input.referenceId ?? null,
        input.idempotencyKey,
        input.remark ?? null
      ]
    );

    return { applied: true, balanceAfter: next, lockedBalanceAfter: nextLocked };
  }

  async insertLedgerAndApplyBalance(
    client: PoolClient,
    input: {
      tenantId: string;
      userId: string;
      entryType: string;
      amount: number;
      referenceType?: string | null;
      referenceId?: string | null;
      idempotencyKey: string;
      remark?: string | null;
    }
  ): Promise<{ applied: boolean; balanceAfter: number }> {
    const result = await this.insertLedgerAndApplyWalletState(client, {
      ...input,
      availableDelta: input.amount,
      lockedDelta: 0,
    });
    return {
      applied: result.applied,
      balanceAfter: result.balanceAfter,
    };
  }

  async listLedger(tenantId: string, userId: string, limit: number) {
    const result = await this.db.query<{
      id: string;
      entryType: string;
      amount: string;
      balanceAfter: string;
      lockedBalanceAfter: string;
      remark: string | null;
      createdAt: Date;
    }>(
      `
      select
        id,
        entry_type as "entryType",
        amount::text,
        balance_after::text as "balanceAfter",
        coalesce(locked_balance_after, 0)::text as "lockedBalanceAfter",
        remark,
        created_at as "createdAt"
      from farmer_wallet_ledger
      where tenant_id = $1 and user_id = $2
      order by created_at desc
      limit $3
      `,
      [tenantId, userId, limit]
    );
    return result.rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      balanceAfter: Number(r.balanceAfter),
      lockedBalanceAfter: Number(r.lockedBalanceAfter),
      createdAt: r.createdAt.toISOString()
    }));
  }

  async upsertPortalUser(input: {
    tenantId: string;
    provider: string;
    providerUserKey: string;
    mobile?: string | null;
    displayName?: string | null;
    authIdentity?: Record<string, unknown> | null;
  }) {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      provider: string;
      providerUserKey: string;
      mobile: string | null;
      displayName: string | null;
      authIdentity: Record<string, unknown> | null;
    }>(
      `
      insert into farmer_card_portal_user (
        tenant_id, provider, provider_user_key, mobile, display_name, auth_identity_json, last_login_at
      )
      values ($1::uuid, $2, $3, $4, $5, $6::jsonb, now())
      on conflict (tenant_id, provider, provider_user_key)
      do update set
        mobile = coalesce(excluded.mobile, farmer_card_portal_user.mobile),
        display_name = coalesce(excluded.display_name, farmer_card_portal_user.display_name),
        auth_identity_json = coalesce(farmer_card_portal_user.auth_identity_json, '{}'::jsonb) || coalesce(excluded.auth_identity_json, '{}'::jsonb),
        last_login_at = now(),
        updated_at = now()
      returning
        id,
        tenant_id as "tenantId",
        provider,
        provider_user_key as "providerUserKey",
        mobile,
        display_name as "displayName",
        auth_identity_json as "authIdentity"
      `,
      [
        input.tenantId,
        input.provider,
        input.providerUserKey,
        input.mobile ?? null,
        input.displayName ?? null,
        JSON.stringify(input.authIdentity ?? {}),
      ]
    );
    return result.rows[0] ?? null;
  }

  async createPortalSession(input: {
    tenantId: string;
    portalUserId: string;
    sessionToken: string;
    expiresAt: string;
  }) {
    await this.db.query(
      `
      insert into farmer_card_portal_session (
        tenant_id, portal_user_id, session_token, expires_at
      )
      values ($1::uuid, $2::uuid, $3, $4::timestamptz)
      `,
      [input.tenantId, input.portalUserId, input.sessionToken, input.expiresAt]
    );
  }

  async getPortalSession(sessionToken: string) {
    const result = await this.db.query<{
      sessionId: string;
      tenantId: string;
      expiresAt: Date;
      provider: string;
      providerUserKey: string;
      mobile: string | null;
      displayName: string | null;
      portalUserId: string;
      authIdentity: Record<string, unknown> | null;
    }>(
      `
      select
        s.id as "sessionId",
        s.tenant_id as "tenantId",
        s.expires_at as "expiresAt",
        u.provider,
        u.provider_user_key as "providerUserKey",
        u.mobile,
        u.display_name as "displayName",
        u.id as "portalUserId",
        u.auth_identity_json as "authIdentity"
      from farmer_card_portal_session s
      join farmer_card_portal_user u on u.id = s.portal_user_id
      where s.session_token = $1
      limit 1
      `,
      [sessionToken]
    );
    return result.rows[0] ?? null;
  }

  async touchPortalSession(sessionId: string) {
    await this.db.query(
      `
        update farmer_card_portal_session
        set last_seen_at = now(), updated_at = now()
        where id = $1::uuid
        `,
        [sessionId]
      );
  }

  async updatePortalUserMobile(input: {
    portalUserId: string;
    mobile: string;
    authIdentity?: Record<string, unknown> | null;
  }) {
    const result = await this.db.query<{
      id: string;
      mobile: string | null;
      displayName: string | null;
      authIdentity: Record<string, unknown> | null;
    }>(
      `
      update farmer_card_portal_user
      set
        mobile = $2,
        auth_identity_json = coalesce(auth_identity_json, '{}'::jsonb) || coalesce($3::jsonb, '{}'::jsonb),
        updated_at = now()
      where id = $1::uuid
      returning
        id,
        mobile,
        display_name as "displayName",
        auth_identity_json as "authIdentity"
      `,
      [input.portalUserId, input.mobile, JSON.stringify(input.authIdentity ?? {})]
    );
    return result.rows[0] ?? null;
  }
}
