import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class FarmerFundRepository {
  constructor(private readonly db: DatabaseService) {}

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

  async insertFarmerUser(input: { tenantId: string; displayName: string; mobile: string }) {
    const id = randomUUID();
    await this.db.query(
      `
      insert into sys_user (id, tenant_id, user_type, display_name, mobile, status)
      values ($1, $2, 'farmer', $3, $4, 'active')
      `,
      [id, input.tenantId, input.displayName, input.mobile]
    );
    const role = await this.db.query<{ id: string }>(
      `select id from sys_role where tenant_id = $1 and role_type = 'farmer' order by created_at asc limit 1`,
      [input.tenantId]
    );
    const roleId = role.rows[0]?.id;
    if (roleId) {
      await this.db.query(
        `
        insert into sys_user_role (id, tenant_id, user_id, role_id)
        values ($1, $2, $3, $4)
        `,
        [randomUUID(), input.tenantId, id, roleId]
      );
    }
    await this.ensureWallet(input.tenantId, id);
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
    const existing = await client.query<{ id: string }>(
      `select id from farmer_wallet_ledger where tenant_id = $1 and idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey]
    );
    if (existing.rows[0]) {
      const bal = await this.getBalance(input.tenantId, input.userId, client);
      return { applied: false, balanceAfter: bal };
    }

    await this.ensureWallet(input.tenantId, input.userId, client);

    const lock = await client.query<{ balance: string }>(
      `select balance from farmer_wallet where tenant_id = $1 and user_id = $2 for update`,
      [input.tenantId, input.userId]
    );
    const current = Number(lock.rows[0]?.balance ?? 0);
    const next = current + input.amount;
    if (input.amount < 0 && next < 0) {
      throw new Error('WALLET_INSUFFICIENT_BALANCE');
    }

    await client.query(
      `update farmer_wallet set balance = $3, updated_at = now() where tenant_id = $1 and user_id = $2`,
      [input.tenantId, input.userId, next]
    );

    await client.query(
      `
      insert into farmer_wallet_ledger (
        id, tenant_id, user_id, entry_type, amount, balance_after, reference_type, reference_id, idempotency_key, remark
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        randomUUID(),
        input.tenantId,
        input.userId,
        input.entryType,
        input.amount,
        next,
        input.referenceType ?? null,
        input.referenceId ?? null,
        input.idempotencyKey,
        input.remark ?? null
      ]
    );

    return { applied: true, balanceAfter: next };
  }

  async listLedger(tenantId: string, userId: string, limit: number) {
    const result = await this.db.query<{
      id: string;
      entryType: string;
      amount: string;
      balanceAfter: string;
      remark: string | null;
      createdAt: Date;
    }>(
      `
      select id, entry_type as "entryType", amount::text, balance_after::text as "balanceAfter", remark, created_at as "createdAt"
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
      createdAt: r.createdAt.toISOString()
    }));
  }
}
