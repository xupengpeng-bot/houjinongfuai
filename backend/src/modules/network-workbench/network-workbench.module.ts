import { Module } from '@nestjs/common';
import { DeviceGatewayModule } from '../device-gateway/device-gateway.module';
import { SolverModule } from '../solver/solver.module';
import { NetworkWorkbenchController } from './network-workbench.controller';
import { NetworkWorkbenchService } from './network-workbench.service';

@Module({
  imports: [DeviceGatewayModule, SolverModule],
  controllers: [NetworkWorkbenchController],
  providers: [NetworkWorkbenchService],
  exports: [NetworkWorkbenchService]
})
export class NetworkWorkbenchModule {}
