import { Body, Controller, HttpCode, Module, Param, Post } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';
import { business, ok } from '../../common/http/api-response';
import { OrderModule } from '../order/order.module';
import { PolicyModule } from '../policy/policy.module';
import { TopologyModule } from '../topology/topology.module';
import { CreateRuntimeSessionDto, StartCheckDto } from './runtime.dto';
import { RuntimeRepository } from './runtime.repository';
import { SessionStatusLogRepository } from './session-status-log.repository';
import { RuntimeDecisionService, RuntimeService } from './runtime.service';

@Controller()
class RuntimeController {
  constructor(
    private readonly decisionService: RuntimeDecisionService,
    private readonly runtimeService: RuntimeService
  ) {}

  private async execute<T>(handler: () => Promise<T>) {
    try {
      return ok(await handler());
    } catch (error) {
      if (error instanceof AppException) {
        const payload = error.getResponse() as {
          requestId?: string;
          code: string;
          message: string;
          data?: Record<string, unknown>;
        };
        return business(payload.code as any, payload.message, payload.data ?? {}, payload.requestId ?? 'local-dev');
      }
      throw error;
    }
  }

  @Post('u/runtime/start-check')
  @HttpCode(200)
  async startCheck(@Body() dto: StartCheckDto) {
    return this.execute(() => this.decisionService.createStartDecision(dto));
  }

  @Post('u/runtime/sessions')
  @HttpCode(200)
  async createRuntimeSession(@Body() dto: CreateRuntimeSessionDto) {
    return this.execute(() => this.runtimeService.createSession(dto.decisionId));
  }

  @Post('u/runtime/sessions/:id/stop')
  @HttpCode(200)
  async stop(@Param('id') id: string) {
    return this.execute(() => this.runtimeService.stopSession(id));
  }
}

@Module({
  imports: [PolicyModule, TopologyModule, OrderModule],
  controllers: [RuntimeController],
  providers: [RuntimeRepository, SessionStatusLogRepository, RuntimeDecisionService, RuntimeService],
  exports: [RuntimeDecisionService]
})
export class RuntimeModule {}
