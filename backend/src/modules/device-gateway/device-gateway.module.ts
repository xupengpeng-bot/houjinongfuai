import { Module } from '@nestjs/common';
import { DeviceGatewayService } from './device-gateway.service';
import { TcpJsonV1Server } from './tcp-json-v1.server';

@Module({
  providers: [DeviceGatewayService, TcpJsonV1Server],
  exports: [DeviceGatewayService, TcpJsonV1Server]
})
export class DeviceGatewayModule {}
