import { Module } from '@nestjs/common';
import { FarmerFundModule } from '../farmer-fund/farmer-fund.module';
import { OrderModule } from '../order/order.module';
import { SessionStatusLogRepository } from '../runtime/session-status-log.repository';
import { ProtocolAdapterModule } from '../protocol-adapter/protocol-adapter.module';
import { DeviceGatewayController } from './device-gateway.controller';
import { DeviceGatewayMaintainerService } from './device-gateway-maintainer.service';
import { DeviceGatewayService } from './device-gateway.service';
import { TcpJsonV1Server } from './tcp-json-v1.server';

@Module({
  imports: [ProtocolAdapterModule, OrderModule, FarmerFundModule],
  controllers: [DeviceGatewayController],
  providers: [DeviceGatewayService, DeviceGatewayMaintainerService, TcpJsonV1Server, SessionStatusLogRepository],
  exports: [DeviceGatewayService, DeviceGatewayMaintainerService, TcpJsonV1Server]
})
export class DeviceGatewayModule {}
