import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createServer, Server, Socket } from 'net';
import { DeviceGatewayService } from './device-gateway.service';

@Injectable()
export class TcpJsonV1Server implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TcpJsonV1Server.name);
  private server: Server | null = null;
  private readonly host: string;
  private readonly port: number;
  private started = false;
  private lastError: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly gatewayService: DeviceGatewayService
  ) {
    this.host = this.configService.get<string>('DEVICE_GATEWAY_TCP_HOST') || '127.0.0.1';
    this.port = Number(this.configService.get<string>('DEVICE_GATEWAY_TCP_PORT') || 19001);
  }

  async onModuleInit() {
    await this.start();
  }

  async onModuleDestroy() {
    await this.stop();
  }

  getMode() {
    return this.started ? 'tcp_json_socket_ready' : 'http_ingest_ready';
  }

  getSocketInfo() {
    return {
      enabled: this.started,
      host: this.host,
      port: this.port,
      protocol: 'tcp-json-v1',
      last_error: this.lastError
    };
  }

  private async start() {
    if (this.server) return;

    this.server = createServer((socket) => {
      this.handleSocket(socket).catch((error: unknown) => {
        this.logger.error(`socket handler failed: ${this.stringifyError(error)}`);
      });
    });

    this.server.on('error', (error) => {
      this.lastError = this.stringifyError(error);
      this.started = false;
      this.logger.error(`tcp-json-v1 server failed: ${this.lastError}`);
    });

    await new Promise<void>((resolve) => {
      const onError = (error: Error) => {
        this.lastError = this.stringifyError(error);
        this.started = false;
        this.logger.error(`tcp-json-v1 listen failed: ${this.lastError}`);
        this.server?.off('listening', onListening);
        resolve();
      };
      const onListening = () => {
        this.started = true;
        this.lastError = null;
        this.logger.log(`tcp-json-v1 server listening on ${this.host}:${this.port}`);
        this.server?.off('error', onError);
        resolve();
      };

      this.server!.once('error', onError);
      this.server!.once('listening', onListening);
      this.server!.listen(this.port, this.host);
    });
  }

  private async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.started = false;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handleSocket(socket: Socket) {
    socket.setEncoding('utf8');
    let buffer = '';
    const context = {
      connectionId: randomUUID(),
      imei: null as string | null
    };

    const remoteAddr = socket.remoteAddress ?? null;
    const remotePort = socket.remotePort ?? null;

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      void this.flushBuffer(socket, () => {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) return null;
        const frame = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        return frame;
      }, {
        connectionId: context.connectionId,
        remoteAddr,
        remotePort,
        setImei: (imei) => {
          context.imei = imei;
        }
      });
    });

    socket.on('error', (error) => {
      void this.gatewayService.closeConnectionSession(context.connectionId);
      this.logger.warn(`tcp-json-v1 socket error: ${this.stringifyError(error)}`);
    });

    socket.on('close', () => {
      void this.gatewayService.closeConnectionSession(context.connectionId);
    });

    socket.on('end', () => {
      void this.gatewayService.closeConnectionSession(context.connectionId);
    });

  }

  private async flushBuffer(
    socket: Socket,
    nextFrame: () => string | null,
    context: {
      connectionId: string;
      remoteAddr: string | null;
      remotePort: number | null;
      setImei: (imei: string) => void;
    }
  ) {
    while (true) {
      const frame = nextFrame();
      if (frame === null) return;
      if (!frame) continue;
      const response = await this.handleFrameWithConnection(frame, context);
      socket.write(`${JSON.stringify(response)}\n`);
    }
  }

  private async handleFrameWithConnection(
    frame: string,
    context: {
      connectionId: string;
      remoteAddr: string | null;
      remotePort: number | null;
      setImei: (imei: string) => void;
    }
  ) {
    try {
      const payload = JSON.parse(frame) as Record<string, unknown>;
      const imei = typeof payload.imei === 'string' ? payload.imei.trim() : '';
      if (imei) {
        context.setImei(imei);
        await this.gatewayService.bindConnectionSession({
          imei,
          connectionId: context.connectionId,
          transportType: 'tcp',
          protocolVersion:
            typeof payload.protocolVersion === 'string' ? payload.protocolVersion : 'tcp-json-v1',
          remoteAddr: context.remoteAddr,
          remotePort: context.remotePort
        });
      }
    } catch {
      // Ignore binding failures for malformed frames; handleFrame returns the actual protocol error.
    }

    return this.handleFrame(frame);
  }

  private async handleFrame(frame: string) {
    try {
      const payload = JSON.parse(frame) as Record<string, unknown>;
      const msgType = typeof payload.msgType === 'string' ? payload.msgType.trim().toUpperCase() : '';

      if (msgType === 'PULL_PENDING_COMMANDS') {
        const payloadBody =
          payload.payload && typeof payload.payload === 'object' && !Array.isArray(payload.payload)
            ? (payload.payload as Record<string, unknown>)
            : {};

        const result = await this.gatewayService.pullPendingCommands({
          imei: typeof payload.imei === 'string' ? payload.imei : undefined,
          session_ref:
            typeof payload.sessionRef === 'string'
              ? payload.sessionRef
              : typeof payloadBody.session_ref === 'string'
                ? payloadBody.session_ref
                : undefined,
          limit: typeof payloadBody.limit === 'number' ? payloadBody.limit : undefined,
          mark_sent: payloadBody.mark_sent === false ? false : true,
          include_sent: payloadBody.include_sent === true
        });

        return {
          ok: true,
          type: 'PENDING_COMMANDS',
          request: {
            msgId: payload.msgId ?? null,
            imei: payload.imei ?? null
          },
          data: result
        };
      }

      const result = await this.gatewayService.ingestRuntimeEvent(payload);
      return {
        ok: true,
        type: 'RUNTIME_EVENT_ACCEPTED',
        request: {
          msgId: payload.msgId ?? null,
          msgType: payload.msgType ?? null,
          imei: payload.imei ?? null
        },
        data: result
      };
    } catch (error) {
      return {
        ok: false,
        error: this.stringifyError(error)
      };
    }
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : JSON.stringify(error);
  }
}
