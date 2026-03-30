import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { DeviceGatewayMaintainerService } from './device-gateway-maintainer.service';
import { DeviceGatewayService } from './device-gateway.service';

@Controller('ops/device-gateway')
export class DeviceGatewayController {
  constructor(
    private readonly service: DeviceGatewayService,
    private readonly maintainerService: DeviceGatewayMaintainerService
  ) {}

  @Post('runtime-events')
  async ingestRuntimeEvent(@Body() body: Record<string, unknown>) {
    return ok(await this.service.ingestRuntimeEvent(body ?? {}));
  }

  @Get('events')
  async listRecentEvents(
    @Query('imei') imei?: string,
    @Query('session_ref') sessionRef?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listRecentEvents({
        imei,
        session_ref: sessionRef,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Get('queue-health')
  async queueHealth() {
    return ok(await this.service.getQueueHealth());
  }

  @Get('connection-health')
  async connectionHealth() {
    return ok(await this.service.getConnectionHealth());
  }

  @Get('recovery-health')
  async recoveryHealth() {
    return ok(this.maintainerService.getRecoveryHealth());
  }

  @Get('recovery-recommendations')
  async recoveryRecommendations() {
    return ok(await this.service.getRecoveryRecommendations());
  }

  @Get('dead-letters')
  async deadLetters(
    @Query('imei') imei?: string,
    @Query('session_ref') sessionRef?: string,
    @Query('limit') limit?: string
  ) {
    return ok(
      await this.service.listDeadLetters({
        imei,
        session_ref: sessionRef,
        limit: limit ? Number(limit) : undefined
      })
    );
  }

  @Post('sweep-retries')
  async sweepRetries() {
    return ok(await this.service.sweepRetries());
  }

  @Post('sweep-connections')
  async sweepConnections() {
    return ok(await this.service.sweepConnections());
  }

  @Post('commands/:id/requeue')
  async requeueCommand(@Param('id') id: string) {
    return ok(await this.service.requeueCommand(id));
  }

  @Post('bridge/connect')
  async bridgeConnect(
    @Body()
    body?: {
      imei?: string;
      bridge_id?: string | null;
      protocol_version?: string | null;
      remote_addr?: string | null;
      remote_port?: number | null;
    }
  ) {
    return ok(await this.service.connectBridge(body ?? {}));
  }

  @Post('bridge/heartbeat')
  async bridgeHeartbeat(
    @Body()
    body?: {
      imei?: string;
      bridge_id?: string | null;
      session_ref?: string | null;
      msg_id?: string | null;
      seq_no?: number | null;
      device_ts?: string | null;
      remote_addr?: string | null;
      remote_port?: number | null;
      dispatch_pending_commands?: boolean | null;
      mark_sent?: boolean | null;
      include_sent?: boolean | null;
      limit?: number | null;
      payload?: Record<string, unknown>;
    }
  ) {
    return ok(await this.service.heartbeatBridge(body ?? {}));
  }

  @Post('bridge/disconnect')
  async bridgeDisconnect(
    @Body()
    body?: {
      bridge_id?: string | null;
      imei?: string | null;
      connection_id?: string | null;
    }
  ) {
    return ok(await this.service.disconnectBridge(body ?? {}));
  }

  @Post('commands')
  async queueCommand(
    @Body()
    body?: {
      target_device_id?: string;
      imei?: string;
      session_id?: string | null;
      session_ref?: string | null;
      order_id?: string | null;
      command_code?: string;
      request_payload?: Record<string, unknown>;
      start_token?: string | null;
      request_msg_id?: string | null;
      request_seq_no?: number | null;
      create_dispatch?: boolean;
      source?: string | null;
    }
  ) {
    return ok(await this.service.queueCommand(body ?? {}));
  }

  @Get('pending-commands')
  async pullPendingCommands(
    @Query('imei') imei?: string,
    @Query('session_ref') sessionRef?: string,
    @Query('limit') limit?: string,
    @Query('mark_sent') markSent?: string,
    @Query('include_sent') includeSent?: string
  ) {
    return ok(
      await this.service.pullPendingCommands({
        imei,
        session_ref: sessionRef,
        limit: limit ? Number(limit) : undefined,
        mark_sent: markSent ? markSent !== 'false' : undefined,
        include_sent: includeSent === 'true'
      })
    );
  }
}
