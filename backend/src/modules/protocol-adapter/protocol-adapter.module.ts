import { Module } from '@nestjs/common';
import { TcpJsonV1Adapter } from './tcp-json-v1.adapter';

@Module({
  providers: [TcpJsonV1Adapter],
  exports: [TcpJsonV1Adapter]
})
export class ProtocolAdapterModule {}
