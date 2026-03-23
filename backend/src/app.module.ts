import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './common/db/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { IamModule } from './modules/iam/iam.module';
import { RegionModule } from './modules/region/region.module';
import { RegionLibraryModule } from './modules/region-library/region-library.module';
import { ProjectModule } from './modules/project/project.module';
import { DeviceTypeModule } from './modules/device-type/device-type.module';
import { DeviceLedgerModule } from './modules/device-ledger/device-ledger.module';
import { AssetModule } from './modules/asset/asset.module';
import { IrrigationAssetsModule } from './modules/irrigation-assets/irrigation-assets.module';
import { BillingModule } from './modules/billing/billing.module';
import { PolicyModule } from './modules/policy/policy.module';
import { TopologyModule } from './modules/topology/topology.module';
import { RuntimeModule } from './modules/runtime/runtime.module';
import { OrderModule } from './modules/order/order.module';
import { AlarmModule } from './modules/alarm/alarm.module';
import { WorkOrderModule } from './modules/work-order/work-order.module';
import { UatModule } from './modules/uat/uat.module';
import { AiConversationModule } from './modules/ai-conversation/ai-conversation.module';
import { HealthModule } from './modules/health/health.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MaintenanceTeamModule } from './modules/maintenance-team/maintenance-team.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env'
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    IamModule,
    RegionModule,
    RegionLibraryModule,
    ProjectModule,
    DeviceTypeModule,
    DeviceLedgerModule,
    AssetModule,
    IrrigationAssetsModule,
    BillingModule,
    PolicyModule,
    TopologyModule,
    RuntimeModule,
    OrderModule,
    DashboardModule,
    MaintenanceTeamModule,
    AlarmModule,
    WorkOrderModule,
    UatModule,
    AiConversationModule
  ]
})
export class AppModule {}
