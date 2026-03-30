import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { FarmerFundRepository } from './farmer-fund.repository';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';

@Injectable()
export class FarmerFundService {
  constructor(
    private readonly repo: FarmerFundRepository,
    private readonly db: DatabaseService
  ) {}

  async resolvePortalUser(cardToken?: string | null) {
    const t = cardToken?.trim();
    if (t) {
      const row = await this.repo.findActiveCardUser(t);
      if (!row) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'Card not found or inactive', 404, { cardToken: t });
      }
      return row;
    }
    const row = await this.repo.findDefaultFarmerUser();
    if (!row) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'No active farmer user found', 404);
    }
    return row;
  }

  async getWalletSummary(userId: string, tenantId: string = DEFAULT_TENANT) {
    const balance = await this.repo.getBalance(tenantId, userId);
    const ledger = await this.repo.listLedger(tenantId, userId, 30);
    return { balance, ledger };
  }

  async recharge(input: {
    tenantId?: string;
    userId: string;
    amount: number;
    idempotencyKey: string;
    remark?: string;
  }) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    if (input.amount <= 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'amount must be positive', 400);
    }
    return this.db.withTransaction(async (client) => {
      try {
        const { balanceAfter } = await this.repo.insertLedgerAndApplyBalance(client, {
          tenantId,
          userId: input.userId,
          entryType: 'recharge',
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          remark: input.remark ?? 'recharge'
        });
        return { balance: balanceAfter };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '';
        if (msg === 'WALLET_INSUFFICIENT_BALANCE') {
          throw new AppException(ErrorCodes.WALLET_INSUFFICIENT_BALANCE, 'Invalid wallet operation', 400);
        }
        throw e;
      }
    });
  }

  async issueCard(input: { tenantId?: string; userId: string; cardToken: string; label?: string }) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    try {
      const id = await this.repo.insertCard({
        tenantId,
        userId: input.userId,
        cardToken: input.cardToken.trim(),
        label: input.label
      });
      return { id };
    } catch (e: unknown) {
      if (this.isUniqueViolation(e, 'farmer_card_tenant_id_card_token_key')) {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Card token already exists', 400);
      }
      throw e;
    }
  }

  async listFarmers(page = 1, pageSize = 20, tenantId: string = DEFAULT_TENANT) {
    const ps = Math.min(100, Math.max(1, pageSize));
    const pg = Math.max(1, page);
    const offset = (pg - 1) * ps;
    const { items, total } = await this.repo.listFarmers(tenantId, offset, ps);
    return { items, total, page: pg, page_size: ps };
  }

  private isUniqueViolation(error: unknown, constraint: string) {
    const c = error as { code?: string; constraint?: string };
    return c?.code === '23505' && c?.constraint === constraint;
  }

  async createFarmer(input: { displayName: string; mobile: string; tenantId?: string }) {
    const tenantId = input.tenantId ?? DEFAULT_TENANT;
    try {
      const id = await this.repo.insertFarmerUser({
        tenantId,
        displayName: input.displayName.trim(),
        mobile: input.mobile.trim()
      });
      return { id };
    } catch (e: unknown) {
      if (this.isUniqueViolation(e, 'sys_user_tenant_id_mobile_key')) {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, 'Mobile number already registered for this tenant', 400);
      }
      throw e;
    }
  }

  async listCardsForFarmer(userId: string, tenantId: string = DEFAULT_TENANT) {
    return this.repo.listCards(tenantId, userId);
  }

  /** 订单结算后从预付钱包扣款（幂等） */
  async debitForSettledOrder(
    client: PoolClient,
    input: { tenantId: string; userId: string; orderId: string; amount: number; fundingMode: string | null }
  ) {
    if (input.fundingMode !== 'card_wallet' || input.amount <= 0) {
      return { debited: false, balanceAfter: await this.repo.getBalance(input.tenantId, input.userId, client) };
    }
    const idempotencyKey = `order_settle_debit:${input.orderId}`;
    try {
      const r = await this.repo.insertLedgerAndApplyBalance(client, {
        tenantId: input.tenantId,
        userId: input.userId,
        entryType: 'consume',
        amount: -input.amount,
        referenceType: 'irrigation_order',
        referenceId: input.orderId,
        idempotencyKey,
        remark: 'settlement debit'
      });
      return { debited: r.applied, balanceAfter: r.balanceAfter };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'WALLET_INSUFFICIENT_BALANCE') {
        throw new AppException(
          ErrorCodes.WALLET_INSUFFICIENT_BALANCE,
          'Wallet balance insufficient at settlement',
          400,
          { orderId: input.orderId, amount: input.amount }
        );
      }
      throw e;
    }
  }
}
