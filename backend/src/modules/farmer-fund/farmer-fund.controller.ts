import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
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
}

@Controller()
export class FarmerFundPortalController {
  constructor(private readonly farmerFund: FarmerFundService) {}

  @Get('farmer/wallet')
  async myWallet(@Headers('x-farmer-card-token') card?: string) {
    const user = await this.farmerFund.resolvePortalUser(card?.trim() || null);
    return ok(await this.farmerFund.getWalletSummary(user.id, user.tenantId));
  }
}
