import { Body, Controller, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import { NetworkModelModule } from '../network-model/network-model.module';
import { SolverService } from './solver.service';
import {
  SolverExplainRequestDto,
  SolverPlanRequestDto,
  SolverPreviewRequestDto,
  SolverSimulateRequestDto
} from './solver.dto';

@Controller('ops/solver')
class SolverController {
  constructor(private readonly solver: SolverService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: SolverPreviewRequestDto) {
    return this.solver.preview(dto);
  }

  @Post('plan')
  @HttpCode(HttpStatus.OK)
  plan(@Body() dto: SolverPlanRequestDto) {
    return this.solver.plan(dto);
  }

  @Post('explain')
  @HttpCode(HttpStatus.OK)
  explain(@Body() dto: SolverExplainRequestDto) {
    return this.solver.explain(dto);
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@Body() dto: SolverSimulateRequestDto) {
    return this.solver.simulate(dto);
  }
}

@Module({
  imports: [NetworkModelModule],
  controllers: [SolverController],
  providers: [SolverService],
  exports: [SolverService]
})
export class SolverModule {}
