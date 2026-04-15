import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ArchiveModule } from './common/archive/archive.module';
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
import { CockpitModule } from './modules/cockpit/cockpit.module';
import { MaintenanceTeamModule } from './modules/maintenance-team/maintenance-team.module';
import { ProjectBlockModule } from './modules/project-block/project-block.module';
import { MeteringPointModule } from './modules/metering-point/metering-point.module';
import { PaymentAccountModule } from './modules/payment-account/payment-account.module';
import { DeviceRelationsModule } from './modules/device-relations/device-relations.module';
import { DispatchMysqlModule } from './modules/dispatch-mysql/dispatch-mysql.module';
import { SolverModule } from './modules/solver/solver.module';
import { NetworkWorkbenchModule } from './modules/network-workbench/network-workbench.module';
import { FarmerFundModule } from './modules/farmer-fund/farmer-fund.module';
import { FirmwareModule } from './modules/firmware/firmware.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env'
    }),
    ArchiveModule,
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
    CockpitModule,
    MaintenanceTeamModule,
    ProjectBlockModule,
    MeteringPointModule,
    PaymentAccountModule,
    DeviceRelationsModule,
    DispatchMysqlModule,
    SolverModule,
    NetworkWorkbenchModule,
    FarmerFundModule,
    FirmwareModule,
    AlarmModule,
    WorkOrderModule,
    UatModule,
    AiConversationModule
  ]
})
export class AppModule {}
