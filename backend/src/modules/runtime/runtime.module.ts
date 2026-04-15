import { Body, Controller, Get, Headers, HttpCode, Module, Param, Post, Query, forwardRef } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';
import { business, ok } from '../../common/http/api-response';
import { DeviceGatewayModule } from '../device-gateway/device-gateway.module';
import { FarmerFundModule } from '../farmer-fund/farmer-fund.module';
import { OrderModule } from '../order/order.module';
import { PaymentAccountModule } from '../payment-account/payment-account.module';
import { PolicyModule } from '../policy/policy.module';
import { RuntimeIngestModule } from '../runtime-ingest/runtime-ingest.module';
import { TopologyModule } from '../topology/topology.module';
import { CardSwipeDto, CompleteWechatPaymentDto, CreateRuntimeSessionDto, CreateWechatPaymentLinkDto, StartCheckDto } from './runtime.dto';
import { PaymentCallbackController } from './payment-callback.controller';
import { PaymentCallbackService } from './payment-callback.service';
import { RuntimeCheckoutService } from './runtime-checkout.service';
import { RuntimeProgressMaintainerService } from './runtime-progress-maintainer.service';
import { RuntimeRepository } from './runtime.repository';
import { SessionStatusLogRepository } from './session-status-log.repository';
import { RuntimeDecisionService, RuntimeService } from './runtime.service';

@Controller()
class RuntimeController {
  constructor(
    private readonly decisionService: RuntimeDecisionService,
    private readonly runtimeService: RuntimeService,
    private readonly checkoutService: RuntimeCheckoutService,
    private readonly progressMaintainer: RuntimeProgressMaintainerService
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

  @Post('farmer/wells/:id/start-check')
  @HttpCode(200)
  async startCheckByWell(@Param('id') id: string, @Headers('x-farmer-card-token') card?: string) {
    return this.execute(() => this.runtimeService.createStartDecisionForWellIdentifier(id, card?.trim() || null));
  }

  @Post('u/runtime/sessions')
  @HttpCode(200)
  async createRuntimeSession(@Body() dto: CreateRuntimeSessionDto) {
    return this.execute(() => this.runtimeService.createSessionSynchronously(dto.decisionId));
  }

  @Post('farmer/wells/:id/sessions')
  @HttpCode(200)
  async createRuntimeSessionByWell(@Param('id') id: string, @Headers('x-farmer-card-token') card?: string) {
    return this.execute(() =>
      this.runtimeService.createSessionFromWellIdentifierSynchronously(id, card?.trim() || null)
    );
  }

  @Get('farmer/checkout/imei/:imei')
  @HttpCode(200)
  async inspectCheckoutByImei(@Param('imei') imei: string, @Headers('x-farmer-card-token') card?: string) {
    return this.execute(() => this.checkoutService.inspectByImei(imei, card?.trim() || null));
  }

  @Post('farmer/checkout/imei/:imei/wechat-link')
  @HttpCode(200)
  async createWechatLink(@Param('imei') imei: string, @Body() dto: CreateWechatPaymentLinkDto) {
    return this.execute(() => this.checkoutService.createWechatPaymentLink(imei, dto.amount));
  }

  @Get('farmer/checkout/payments/:id')
  @HttpCode(200)
  async getWechatPaymentStatus(@Param('id') id: string, @Headers('x-farmer-card-token') card?: string) {
    return this.execute(() => this.checkoutService.getWechatPaymentStatus(id, card?.trim() || null));
  }

  @Post('farmer/checkout/payments/:id/complete')
  @HttpCode(200)
  async completeWechatPayment(@Param('id') id: string, @Body() dto: CompleteWechatPaymentDto) {
    return this.execute(() => this.checkoutService.completeWechatPayment(id, dto.callback_token));
  }

  @Post('farmer/checkout/imei/:imei/card-swipe')
  @HttpCode(200)
  async handleCardSwipe(
    @Param('imei') imei: string,
    @Headers('x-farmer-card-token') headerCard?: string,
    @Body() dto?: CardSwipeDto
  ) {
    return this.execute(() =>
      this.checkoutService.handleCardSwipe(
        imei,
        dto?.card_token ?? headerCard?.trim() ?? null,
        dto?.swipe_action ?? null,
        dto?.swipe_event_id ?? null,
        dto?.swipe_at ?? null
      )
    );
  }

  @Get('farmer/session/active')
  @HttpCode(200)
  async currentSession(@Headers('x-farmer-card-token') card?: string) {
    return this.execute(() => this.runtimeService.getCurrentSession(card?.trim() || null));
  }

  @Get('runtime/progress-health')
  @HttpCode(200)
  async runtimeProgressHealth() {
    return this.execute(() => Promise.resolve(this.progressMaintainer.getHealth()));
  }

  @Get('ops/payment-flows')
  @HttpCode(200)
  async paymentFlows(
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('q') q?: string,
    @Query('flow_type') flowType?: string,
    @Query('result_bucket') resultBucket?: string,
    @Query('ops_status') opsStatus?: string,
    @Query('sla_level') slaLevel?: string,
    @Query('imei') imei?: string,
    @Query('card_token') cardToken?: string
  ) {
    return this.execute(() =>
      this.checkoutService.listPaymentFlows({
        page,
        page_size: pageSize,
        q,
        flow_type: flowType,
        result_bucket: resultBucket,
        ops_status: opsStatus,
        sla_level: slaLevel,
        imei,
        card_token: cardToken
      })
    );
  }

  @Post('ops/payment-flows/:flowType/:id/actions/:action')
  @HttpCode(200)
  async handlePaymentFlowAction(
    @Param('flowType') flowType: string,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() dto?: { note?: string; work_order_id?: string }
  ) {
    return this.execute(() =>
      this.checkoutService.applyPaymentFlowAction(flowType, id, {
        action,
        note: dto?.note,
        work_order_id: dto?.work_order_id
      })
    );
  }

  @Post('ops/payment-flows/batch-actions/:action')
  @HttpCode(200)
  async handlePaymentFlowBatchAction(
    @Param('action') action: string,
    @Body() dto?: {
      note?: string;
      items?: Array<{ flow_type?: string; id?: string }>;
    }
  ) {
    return this.execute(() =>
      this.checkoutService.applyPaymentFlowBatchAction(action, {
        note: dto?.note,
        items: dto?.items
      })
    );
  }

  @Get('run-sessions')
  @HttpCode(200)
  async listSessions() {
    return this.execute(async () => ({
      items: (await this.runtimeService.listSessions()).map((item) => {
        const durationSeconds =
          item.chargeDurationSec ??
          (item.startedAt && item.endedAt
            ? Math.max(1, Math.ceil((new Date(item.endedAt).getTime() - new Date(item.startedAt).getTime()) / 1000))
            : null);

        return {
          ...item,
          well: item.wellCode ?? item.wellId,
          user: item.userDisplayName ?? item.userId,
          start_time: item.startedAt,
          flow: 0,
          duration:
            durationSeconds === null
              ? '--'
              : `${Math.max(1, Math.ceil(durationSeconds / 60))} min`
        };
      })
    }));
  }

  @Get('commands')
  @HttpCode(200)
  async listCommands() {
    return this.execute(async () => ({
      items: await this.runtimeService.listCommands()
    }));
  }

  @Get('runtime/containers')
  @HttpCode(200)
  async listRuntimeContainers() {
    return this.execute(() => this.runtimeService.listRuntimeContainers());
  }

  @Get('run-sessions/:id/observability')
  @HttpCode(200)
  async sessionObservability(@Param('id') id: string) {
    return this.execute(() => this.runtimeService.getSessionObservability(id));
  }

  @Post('runtime/test-command')
  @HttpCode(200)
  async sendTestCommand(@Body() dto: { device_id: string; action: string }) {
    return this.execute(() => this.runtimeService.sendTestCommand(dto.device_id, dto.action));
  }

  @Post('u/runtime/sessions/:id/stop')
  @HttpCode(200)
  async stop(@Param('id') id: string) {
    return this.execute(() => this.runtimeService.stopSession(id));
  }

  @Post('u/runtime/sessions/:id/pause')
  @HttpCode(200)
  async pause(@Param('id') id: string) {
    return this.execute(() => this.runtimeService.pauseSession(id));
  }

  @Post('u/runtime/sessions/:id/resume')
  @HttpCode(200)
  async resume(@Param('id') id: string) {
    return this.execute(() => this.runtimeService.resumeSession(id));
  }

  @Post('farmer/sessions/:id/stop')
  @HttpCode(200)
  async stopFromFarmer(@Param('id') id: string, @Headers('x-farmer-card-token') card?: string) {
    return this.execute(() => this.runtimeService.stopSession(id, card?.trim() || null));
  }

  @Post('farmer/sessions/:id/pause')
  @HttpCode(200)
  async pauseFromFarmer(@Param('id') id: string, @Headers('x-farmer-card-token') card?: string) {
    return this.execute(() => this.runtimeService.pauseSession(id, card?.trim() || null));
  }

  @Post('farmer/sessions/:id/resume')
  @HttpCode(200)
  async resumeFromFarmer(@Param('id') id: string, @Headers('x-farmer-card-token') card?: string) {
    return this.execute(() => this.runtimeService.resumeSession(id, card?.trim() || null));
  }
}

@Module({
  imports: [
    PolicyModule,
    TopologyModule,
    OrderModule,
    forwardRef(() => DeviceGatewayModule),
    FarmerFundModule,
    RuntimeIngestModule,
    PaymentAccountModule
  ],
  controllers: [RuntimeController, PaymentCallbackController],
  providers: [
    RuntimeRepository,
    SessionStatusLogRepository,
    RuntimeDecisionService,
    RuntimeService,
    RuntimeCheckoutService,
    PaymentCallbackService,
    RuntimeProgressMaintainerService
  ],
  exports: [RuntimeDecisionService, RuntimeCheckoutService]
})
export class RuntimeModule {}
