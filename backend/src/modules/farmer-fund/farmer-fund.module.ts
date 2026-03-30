import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/db/database.module';
import { FarmerFundAdminController, FarmerFundPortalController } from './farmer-fund.controller';
import { FarmerFundRepository } from './farmer-fund.repository';
import { FarmerFundService } from './farmer-fund.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FarmerFundAdminController, FarmerFundPortalController],
  providers: [FarmerFundRepository, FarmerFundService],
  exports: [FarmerFundRepository, FarmerFundService]
})
export class FarmerFundModule {}
