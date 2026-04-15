import { Module, forwardRef } from '@nestjs/common';
import { FarmerFundModule } from '../farmer-fund/farmer-fund.module';
import { OrderModule } from '../order/order.module';
import { SessionStatusLogRepository } from '../runtime/session-status-log.repository';
import { RuntimeModule } from '../runtime/runtime.module';
import { ProtocolAdapterModule } from '../protocol-adapter/protocol-adapter.module';
import { RuntimeIngestModule } from '../runtime-ingest/runtime-ingest.module';
import { DeviceGatewayController } from './device-gateway.controller';
import { DeviceGatewayMaintainerService } from './device-gateway-maintainer.service';
import { DeviceGatewaySimulatorService } from './device-gateway-simulator.service';
import { DeviceGatewayService } from './device-gateway.service';
import { TcpJsonV1Server } from './tcp-json-v1.server';

@Module({
  imports: [ProtocolAdapterModule, OrderModule, FarmerFundModule, RuntimeIngestModule, forwardRef(() => RuntimeModule)],
  controllers: [DeviceGatewayController],
  providers: [DeviceGatewayService, DeviceGatewayMaintainerService, DeviceGatewaySimulatorService, TcpJsonV1Server, SessionStatusLogRepository],
  exports: [DeviceGatewayService, DeviceGatewayMaintainerService, DeviceGatewaySimulatorService, TcpJsonV1Server]
})
export class DeviceGatewayModule {}
