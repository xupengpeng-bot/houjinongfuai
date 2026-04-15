import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/db/database.module';
import { PaymentAccountModule } from '../payment-account/payment-account.module';
import { FarmerFundAdminController, FarmerFundPortalController } from './farmer-fund.controller';
import { FarmerFundRepository } from './farmer-fund.repository';
import { FarmerFundService } from './farmer-fund.service';

@Module({
  imports: [DatabaseModule, PaymentAccountModule],
  controllers: [FarmerFundAdminController, FarmerFundPortalController],
  providers: [FarmerFundRepository, FarmerFundService],
  exports: [FarmerFundRepository, FarmerFundService]
})
export class FarmerFundModule {}
