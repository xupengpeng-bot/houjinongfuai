import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { ok } from '../../common/http/api-response';
import { FarmerFundService } from './farmer-fund.service';

class CreateFarmerDto {
  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsString()
  @MinLength(5)
  mobile!: string;
}

class IssueCardDto {
  @IsString()
  @MinLength(4)
  cardToken!: string;

  @IsOptional()
  @IsString()
  label?: string;
}

class RechargeDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  idempotency_key?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

class RefundCardRechargeOrderDto {
  @IsOptional()
  @IsString()
  remark?: string;
}

class ImportCardItemDto {
  @IsString()
  @MinLength(4)
  cardToken!: string;

  @IsOptional()
  @IsString()
  label?: string;
}

class ImportCardCatalogDto {
  @IsOptional()
  @IsString()
  batch_no?: string;

  @IsArray()
  cards!: ImportCardItemDto[];
}

class RegisterCardDto {
  @IsString()
  @MinLength(1)
  holder_name!: string;

  @IsString()
  @MinLength(5)
  holder_mobile!: string;
}

class CreateCardRechargeIntentDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  @IsIn(['wechat', 'alipay'])
  payment_provider!: 'wechat' | 'alipay';

  @IsOptional()
  @IsString()
  @IsIn(['self', 'other'])
  recharge_mode?: 'self' | 'other';

  @IsOptional()
  @IsString()
  holder_mobile?: string;

  @IsOptional()
  @IsString()
  payer_mobile?: string;

  @IsOptional()
  @IsString()
  return_url?: string;
}

class CardPortalLoginDto {
  @IsString()
  @IsIn(['wechat', 'alipay'])
  provider!: 'wechat' | 'alipay';

  @IsString()
  @MinLength(5)
  mobile!: string;

  @IsString()
  @MinLength(1)
  sms_code!: string;

  @IsOptional()
  @IsString()
  provider_user_key?: string;

  @IsOptional()
  @IsString()
  display_name?: string;
}

class BindPortalMobileDto {
  @IsString()
  @MinLength(5)
  mobile!: string;

  @IsString()
  @MinLength(1)
  sms_code!: string;
}

@Controller('system')
export class FarmerFundAdminController {
  constructor(private readonly farmerFund: FarmerFundService) {}

  @Get('farmers')
  async listFarmers(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    const pg = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const ps = Math.min(100, Math.max(1, Number.parseInt(pageSize ?? '20', 10) || 20));
    return ok(await this.farmerFund.listFarmers(pg, ps));
  }

  @Post('farmers')
  async createFarmer(@Body() dto: CreateFarmerDto) {
    return ok(await this.farmerFund.createFarmer(dto));
  }

  @Get('farmers/:userId/cards')
  async listCards(@Param('userId') userId: string) {
    return ok({ items: await this.farmerFund.listCardsForFarmer(userId) });
  }

  @Post('farmers/:userId/cards')
  async issueCard(@Param('userId') userId: string, @Body() dto: IssueCardDto) {
    return ok(await this.farmerFund.issueCard({ userId, cardToken: dto.cardToken, label: dto.label }));
  }

  @Get('farmers/:userId/wallet')
  async farmerWallet(@Param('userId') userId: string) {
    return ok(await this.farmerFund.getWalletSummary(userId));
  }

  @Post('farmers/:userId/wallet/recharge')
  async recharge(@Param('userId') userId: string, @Body() dto: RechargeDto) {
    const idempotencyKey = dto.idempotency_key?.trim() || `recharge-${userId}-${Date.now()}`;
    return ok(
      await this.farmerFund.recharge({
        userId,
        amount: dto.amount,
        idempotencyKey,
        remark: dto.remark
      })
    );
  }

  @Get('card-catalog')
  async listCardCatalog(
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('q') q?: string,
    @Query('status') status?: string
  ) {
    const pg = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const ps = Math.min(100, Math.max(1, Number.parseInt(pageSize ?? '20', 10) || 20));
    return ok(await this.farmerFund.listCardCatalog(pg, ps, { q: q ?? null, status: status ?? null }));
  }

  @Get('card-recharge-orders')
  async listCardRechargeOrders(
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('payment_channel') paymentChannel?: string,
    @Query('recharge_mode') rechargeMode?: string,
    @Query('user_id') userId?: string,
    @Query('refund_state') refundState?: string,
  ) {
    const pg = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const ps = Math.min(100, Math.max(1, Number.parseInt(pageSize ?? '20', 10) || 20));
    return ok(
      await this.farmerFund.listCardRechargeOrders(pg, ps, {
        q: q ?? null,
        status: status ?? null,
        paymentChannel: paymentChannel ?? null,
        rechargeMode: rechargeMode ?? null,
        userId: userId ?? null,
        refundState: refundState === 'eligible' || refundState === 'blocked' ? refundState : null,
      })
    );
  }

  @Get('card-recharge-orders/:id')
  async getCardRechargeOrderDetail(@Param('id') id: string) {
    return ok(await this.farmerFund.getCardRechargeOrderDetail(id));
  }

  @Post('card-recharge-orders/:id/refund')
  async refundCardRechargeOrder(@Param('id') id: string, @Body() dto: RefundCardRechargeOrderDto) {
    return ok(await this.farmerFund.refundCardRechargeOrder({ id, remark: dto.remark }));
  }

  @Post('card-catalog/import')
  async importCardCatalog(@Body() dto: ImportCardCatalogDto) {
    return ok(
      await this.farmerFund.importCardCatalog({
        batchNo: dto.batch_no,
        cards: (dto.cards ?? []).map((item) => ({
          cardToken: item.cardToken,
          label: item.label,
        }))
      })
    );
  }
}

@Controller()
export class FarmerFundPortalController {
  constructor(private readonly farmerFund: FarmerFundService) {}

  @Get('farmer/wallet')
  async myWallet(@Headers('x-farmer-card-token') card?: string) {
    const user = await this.farmerFund.resolvePortalUser(card?.trim() || null);
    return ok(await this.farmerFund.getWalletSummary(user.id, user.tenantId));
  }

  @Get('card-recharge/cards/resolve')
  async resolveCard(@Query('card_no') cardNo?: string, @Query('card_token') cardToken?: string) {
    const normalized = cardNo?.trim() || cardToken?.trim() || '';
    return ok(await this.farmerFund.getCardCatalogDetail(normalized));
  }

  @Post('card-recharge/cards/:cardToken/register')
  async registerCard(
    @Param('cardToken') cardToken: string,
    @Body() dto: RegisterCardDto,
    @Headers('x-card-portal-token') portalToken?: string,
  ) {
    return ok(
      await this.farmerFund.registerImportedCard({
        cardToken,
        holderName: dto.holder_name,
        holderMobile: dto.holder_mobile,
        portalSessionToken: portalToken,
      })
    );
  }

  @Post('card-recharge/cards/:cardToken/payment-intents')
  async createCardRechargeIntent(
    @Param('cardToken') cardToken: string,
    @Body() dto: CreateCardRechargeIntentDto,
    @Headers('x-card-portal-token') portalToken?: string,
  ) {
    return ok(
      await this.farmerFund.createCardRechargePayment({
        cardToken,
        amount: dto.amount,
        paymentProvider: dto.payment_provider,
        rechargeMode: dto.recharge_mode,
        holderMobile: dto.holder_mobile,
        payerMobile: dto.payer_mobile,
        returnUrl: dto.return_url,
        portalSessionToken: portalToken,
      })
    );
  }

  @Get('card-recharge/payments/:id')
  async getCardRechargePayment(@Param('id') id: string) {
    return ok(await this.farmerFund.getCardRechargePaymentStatus(id));
  }

  @Post('card-recharge/portal/login')
  async portalLogin(@Body() dto: CardPortalLoginDto) {
    return ok(
      await this.farmerFund.portalLogin({
        provider: dto.provider,
        mobile: dto.mobile,
        smsCode: dto.sms_code,
        providerUserKey: dto.provider_user_key,
        displayName: dto.display_name,
      })
    );
  }

  @Get('card-recharge/portal/me')
  async portalMe(@Headers('x-card-portal-token') portalToken?: string) {
    return ok(await this.farmerFund.resolvePortalSession(portalToken ?? null));
  }

  @Post('card-recharge/portal/bind-mobile')
  async bindPortalMobile(@Body() dto: BindPortalMobileDto, @Headers('x-card-portal-token') portalToken?: string) {
    return ok(
      await this.farmerFund.bindPortalMobile({
        portalSessionToken: portalToken ?? null,
        mobile: dto.mobile,
        smsCode: dto.sms_code,
      })
    );
  }

  @Get('card-recharge/portal/wechat/authorize')
  async getWechatAuthorizeUrl(@Query('return_to') returnTo?: string) {
    return ok(await this.farmerFund.getWechatOauthAuthorizeUrl({ returnTo }));
  }

  @Get('card-recharge/portal/wechat/callback')
  async handleWechatCallback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Res() response?: Response,
  ) {
    const result = await this.farmerFund.handleWechatOauthCallback({ code, state });
    return response?.redirect(result.redirect_url);
  }
}
