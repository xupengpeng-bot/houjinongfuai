import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createServer, Server, Socket } from 'net';
import { AppException } from '../../common/errors/app-exception';
import { DeviceGatewayService } from './device-gateway.service';

const MAX_FRAME_BYTES = 2048;

@Injectable()
export class TcpJsonV1Server implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TcpJsonV1Server.name);
  private server: Server | null = null;
  private readonly host: string;
  private readonly port: number;
  private started = false;
  private lastError: string | null = null;
  private readonly activeConnections = new Map<
    string,
    {
      socket: Socket;
      connectionId: string;
      imei: string | null;
      remoteAddr: string | null;
      remotePort: number | null;
    }
  >();
  private readonly activeConnectionByImei = new Map<string, string>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => DeviceGatewayService))
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
    return this.started ? 'device_socket_ready' : 'http_ingest_ready';
  }

  getSocketInfo() {
    return {
      enabled: this.started,
      host: this.host,
      port: this.port,
      protocol: this.gatewayService.getProtocolName(),
      last_error: this.lastError,
      active_connection_count: this.activeConnections.size
    };
  }

  private serializeOutboundFrame(payload: Record<string, unknown>) {
    const bodyText = JSON.stringify(payload);
    if (!bodyText || bodyText[0] !== '{') {
      throw new Error('outbound wire payload must serialize to a JSON object');
    }
    JSON.parse(bodyText);
    const bodyBuffer = Buffer.from(bodyText, 'utf8');
    if (bodyBuffer.length === 0 || bodyBuffer.length > MAX_FRAME_BYTES) {
      throw new Error(`outbound wire payload exceeds device frame budget body_bytes=${bodyBuffer.length} max=${MAX_FRAME_BYTES}`);
    }
    const head = Buffer.alloc(4);
    head.writeUInt32BE(bodyBuffer.length, 0);
    const frameBuffer = Buffer.concat([head, bodyBuffer]);
    return {
      bodyText,
      bodyBuffer,
      frameBuffer,
      bodyByteLength: bodyBuffer.length,
      frameByteLength: frameBuffer.length,
      framePrefixHex: head.toString('hex'),
      bodyHexPreview: bodyBuffer.toString('hex').slice(0, 512)
    };
  }

  async dispatchQueuedCommandNow(commandToken: string) {
    const candidate = await this.gatewayService.getRealtimeDispatchCandidate(commandToken);
    if (!candidate) {
      return {
        attempted: false,
        delivered: false,
        mode: 'queued',
        reason: 'command_not_dispatchable'
      } as const;
    }

    const active = this.getActiveConnectionByImei(candidate.imei);
    if (!active) {
      return {
        attempted: true,
        delivered: false,
        mode: 'queued',
        reason: 'device_not_connected'
      } as const;
    }

    const hold = await this.gatewayService.getRealtimeDispatchHold(commandToken, active.connectionId);
    if (hold) {
      return {
        attempted: true,
        delivered: false,
        mode: 'queued',
        ...hold,
      } as const;
    }

    try {
      const serializedFrame = this.serializeOutboundFrame(candidate.wireMessage);
      await this.recordOutboundAudit(candidate.wireMessage, {
        connectionId: active.connectionId,
        remoteAddr: active.remoteAddr,
        remotePort: active.remotePort,
        getImei: () => candidate.imei
      }, serializedFrame);
      await new Promise<void>((resolve, reject) => {
        active.socket.write(serializedFrame.frameBuffer, (error?: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      const sent = await this.gatewayService.markCommandSentRealtime(candidate.commandToken);
      await this.gatewayService.recordRealtimeCommandSent({
        commandId: candidate.id,
        targetDeviceId: candidate.targetDeviceId,
        connectionId: active.connectionId,
        imei: candidate.imei,
        sessionRef: candidate.sessionRef,
        requestMsgId: candidate.requestMsgId,
        requestSeqNo: candidate.requestSeqNo,
        commandToken: candidate.commandToken,
        commandCode: candidate.commandCode,
        wireMessage: candidate.wireMessage
      });
      return {
        attempted: true,
        delivered: true,
        mode: 'realtime_socket',
        reason: 'delivered_now',
        connection_id: active.connectionId,
        command_status: sent.command_status
      } as const;
    } catch (error) {
      this.logger.warn(`realtime dispatch failed: ${this.stringifyError(error)}`);
      return {
        attempted: true,
        delivered: false,
        mode: 'queued',
        reason: 'socket_write_failed',
        error: this.stringifyError(error)
      } as const;
    }
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
      this.logger.error(`device socket server failed: ${this.lastError}`);
    });

    await new Promise<void>((resolve) => {
      const onError = (error: Error) => {
        this.lastError = this.stringifyError(error);
        this.started = false;
        this.logger.error(`device socket listen failed: ${this.lastError}`);
        this.server?.off('listening', onListening);
        resolve();
      };
      const onListening = () => {
        this.started = true;
        this.lastError = null;
        this.logger.log(`hj-device-v2 socket server listening on ${this.host}:${this.port}`);
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
    this.activeConnectionByImei.clear();
    this.activeConnections.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private bindActiveSocket(
    socket: Socket,
    connectionId: string,
    imei: string,
    remoteAddr: string | null,
    remotePort: number | null
  ) {
    const previousConnectionId = this.activeConnectionByImei.get(imei);
    const existing = this.activeConnections.get(connectionId);
    if (existing?.imei && existing.imei !== imei && this.activeConnectionByImei.get(existing.imei) === connectionId) {
      this.activeConnectionByImei.delete(existing.imei);
    }

    this.activeConnections.set(connectionId, {
      socket,
      connectionId,
      imei,
      remoteAddr,
      remotePort
    });
    this.activeConnectionByImei.set(imei, connectionId);

    if (previousConnectionId && previousConnectionId !== connectionId) {
      this.retireSupersededSocket(previousConnectionId, connectionId, imei);
    }
  }

  private unbindActiveSocket(connectionId: string) {
    const existing = this.activeConnections.get(connectionId);
    if (!existing) return;
    if (existing.imei && this.activeConnectionByImei.get(existing.imei) === connectionId) {
      this.activeConnectionByImei.delete(existing.imei);
    }
    this.activeConnections.delete(connectionId);
  }

  private retireSupersededSocket(previousConnectionId: string, nextConnectionId: string, imei: string) {
    const previous = this.activeConnections.get(previousConnectionId);
    this.unbindActiveSocket(previousConnectionId);
    void this.gatewayService.closeConnectionSession(previousConnectionId);
    if (previous?.socket && !previous.socket.destroyed) {
      previous.socket.destroy();
    }
    this.logger.warn(
      `superseded device connection detached imei=${imei} old_connection_id=${previousConnectionId} new_connection_id=${nextConnectionId}`
    );
  }

  private getActiveConnectionByImei(imei: string) {
    const connectionId = this.activeConnectionByImei.get(imei);
    if (!connectionId) return null;
    const existing = this.activeConnections.get(connectionId) ?? null;
    if (!existing) {
      this.activeConnectionByImei.delete(imei);
      return null;
    }
    if (existing.socket.destroyed) {
      this.unbindActiveSocket(connectionId);
      return null;
    }
    return existing;
  }

  private async writeSerializedFrame(socket: Socket, frameBuffer: Buffer) {
    await new Promise<void>((resolve, reject) => {
      socket.write(frameBuffer, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleSocket(socket: Socket) {
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let residualAuditFlushed = false;
    const context = {
      connectionId: randomUUID(),
      imei: null as string | null
    };

    const remoteAddr = socket.remoteAddress ?? null;
    const remotePort = socket.remotePort ?? null;
    socket.setNoDelay(true);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      void this.flushBuffer(socket, {
        getBuffer: () => buffer,
        setBuffer: (next) => {
          buffer = next;
        },
        connectionId: context.connectionId,
        remoteAddr,
        remotePort,
        setImei: (imei) => {
          context.imei = imei;
          this.bindActiveSocket(socket, context.connectionId, imei, remoteAddr, remotePort);
        },
        getImei: () => context.imei
      });
    });

    socket.on('error', (error) => {
      void this.flushResidualBufferAudit({
        getBuffer: () => buffer,
        setBuffer: (next) => {
          buffer = next;
        },
        connectionId: context.connectionId,
        remoteAddr,
        remotePort,
        getImei: () => context.imei,
        reason: 'socket_error',
        errorMessage: this.stringifyError(error),
        alreadyFlushed: () => residualAuditFlushed,
        markFlushed: () => {
          residualAuditFlushed = true;
        }
      });
      this.unbindActiveSocket(context.connectionId);
      void this.gatewayService.closeConnectionSession(context.connectionId);
      this.logger.warn(`device socket error: ${this.stringifyError(error)}`);
    });

    socket.on('close', () => {
      void this.flushResidualBufferAudit({
        getBuffer: () => buffer,
        setBuffer: (next) => {
          buffer = next;
        },
        connectionId: context.connectionId,
        remoteAddr,
        remotePort,
        getImei: () => context.imei,
        reason: 'socket_close',
        alreadyFlushed: () => residualAuditFlushed,
        markFlushed: () => {
          residualAuditFlushed = true;
        }
      });
      this.unbindActiveSocket(context.connectionId);
      void this.gatewayService.closeConnectionSession(context.connectionId);
    });

    socket.on('end', () => {
      void this.flushResidualBufferAudit({
        getBuffer: () => buffer,
        setBuffer: (next) => {
          buffer = next;
        },
        connectionId: context.connectionId,
        remoteAddr,
        remotePort,
        getImei: () => context.imei,
        reason: 'socket_end',
        alreadyFlushed: () => residualAuditFlushed,
        markFlushed: () => {
          residualAuditFlushed = true;
        }
      });
      this.unbindActiveSocket(context.connectionId);
      void this.gatewayService.closeConnectionSession(context.connectionId);
    });

  }

  private async flushResidualBufferAudit(context: {
    getBuffer: () => Buffer;
    setBuffer: (buffer: Buffer) => void;
    connectionId: string;
    remoteAddr: string | null;
    remotePort: number | null;
    getImei: () => string | null;
    reason: string;
    errorMessage?: string | null;
    alreadyFlushed: () => boolean;
    markFlushed: () => void;
  }) {
    if (context.alreadyFlushed()) return;
    const currentBuffer = context.getBuffer();
    if (!currentBuffer.length) {
      context.markFlushed();
      return;
    }

    let declaredFrameLength: number | null = null;
    if (currentBuffer.length >= 4) {
      declaredFrameLength = currentBuffer.readUInt32BE(0);
    }

    await this.safeCreateTcpAuditLog({
      connection_id: context.connectionId,
      transport_type: 'tcp',
      direction: 'inbound',
      remote_addr: context.remoteAddr,
      remote_port: context.remotePort,
      imei: context.getImei(),
      frame_size_bytes: currentBuffer.length,
      raw_frame_text: currentBuffer.toString('utf8'),
      parse_status: currentBuffer.length < 4 ? 'partial_prefix' : 'partial_frame',
      ingest_status: 'failed',
      ingest_error: context.errorMessage
        ? `${context.reason}: ${context.errorMessage}`
        : context.reason,
      request_snapshot: {
        declared_frame_length: declaredFrameLength,
        available_buffer_bytes: currentBuffer.length,
        connection_ended_with_residual_buffer: true
      }
    });

    context.setBuffer(Buffer.alloc(0));
    context.markFlushed();
    this.logger.warn(
      `device socket residual buffer saved reason=${context.reason} bytes=${currentBuffer.length} declared_frame_length=${declaredFrameLength ?? 'n/a'}`
    );
  }

  private async flushBuffer(
    socket: Socket,
    context: {
      getBuffer: () => Buffer;
      setBuffer: (buffer: Buffer) => void;
      connectionId: string;
      remoteAddr: string | null;
      remotePort: number | null;
      setImei: (imei: string) => void;
      getImei: () => string | null;
    }
  ) {
    while (true) {
      const currentBuffer = context.getBuffer();
      if (currentBuffer.length < 4) return;
      const frameLength = currentBuffer.readUInt32BE(0);
      if (frameLength === 0 || frameLength > MAX_FRAME_BYTES) {
        await this.safeCreateTcpAuditLog({
          connection_id: context.connectionId,
          transport_type: 'tcp',
          direction: 'inbound',
          remote_addr: context.remoteAddr,
          remote_port: context.remotePort,
          imei: context.getImei(),
          frame_size_bytes: currentBuffer.length,
          raw_frame_text: currentBuffer.toString('utf8'),
          parse_status: 'invalid_frame_length',
          ingest_status: 'failed',
          ingest_error: `invalid frame length=${frameLength}`,
          request_snapshot: {
            declared_frame_length: frameLength,
            available_buffer_bytes: currentBuffer.length
          }
        });
        this.logger.warn(`drop invalid frame length=${frameLength}`);
        context.setBuffer(Buffer.alloc(0));
        return;
      }
      if (currentBuffer.length < frameLength + 4) return;
      const frame = currentBuffer.subarray(4, 4 + frameLength).toString('utf8').trim();
      context.setBuffer(currentBuffer.subarray(4 + frameLength));
      if (!frame) {
        await this.safeCreateTcpAuditLog({
          connection_id: context.connectionId,
          transport_type: 'tcp',
          direction: 'inbound',
          remote_addr: context.remoteAddr,
          remote_port: context.remotePort,
          imei: context.getImei(),
          frame_size_bytes: frameLength,
          raw_frame_text: '',
          parse_status: 'empty_frame',
          ingest_status: 'ignored',
          request_snapshot: {
            declared_frame_length: frameLength
          }
        });
        continue;
      }
      const outboundMessages = await this.handleFrameWithConnection(frame, context);
      for (const outbound of outboundMessages) {
        const serializedFrame = this.serializeOutboundFrame(outbound);
        await this.recordOutboundAudit(outbound, context, serializedFrame);
        await this.writeSerializedFrame(socket, serializedFrame.frameBuffer);
      }
    }
  }

  private encodeFrame(payload: Record<string, unknown>) {
    return this.serializeOutboundFrame(payload).frameBuffer;
  }

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeMsgType(value: unknown) {
    const normalized = this.asString(value).toUpperCase();
    if (!normalized) return '';
    if (normalized === 'RG') return 'REGISTER';
    if (normalized === 'RA') return 'REGISTER_ACK';
    if (normalized === 'RN') return 'REGISTER_NACK';
    if (normalized === 'HB') return 'HEARTBEAT';
    if (normalized === 'SS') return 'STATE_SNAPSHOT';
    if (normalized === 'ER') return 'EVENT_REPORT';
    if (normalized === 'QR') return 'QUERY';
    if (normalized === 'QS') return 'QUERY_RESULT';
    if (normalized === 'EX') return 'EXECUTE_ACTION';
    if (normalized === 'SC') return 'SYNC_CONFIG';
    if (normalized === 'AK') return 'COMMAND_ACK';
    if (normalized === 'NK') return 'COMMAND_NACK';
    return normalized;
  }

  private nextServerSeq() {
    return Number(String(Date.now()).slice(-9));
  }

  private buildRegisterReplyEnvelope(payload: Record<string, unknown>, type: 'REGISTER_ACK' | 'REGISTER_NACK', error?: unknown) {
    const imei = this.asString(payload.i);
    const correlationId = this.asString(payload.c) || this.asString(payload.m) || null;
    const sessionRef = this.asString(payload.r) || null;
    const reply: Record<string, unknown> = {
      v: 1,
      t: type === 'REGISTER_ACK' ? 'RA' : 'RN',
      i: imei,
      m: `${type.toLowerCase()}-${randomUUID()}`,
      s: this.nextServerSeq(),
      ts: new Date().toISOString(),
      p:
        type === 'REGISTER_ACK'
          ? { result: 'accepted' }
          : {
              result: 'rejected',
              message: this.stringifyAuditError(error),
            },
    };

    if (correlationId) {
      reply.c = correlationId;
    }
    if (sessionRef) {
      reply.r = sessionRef;
    }

    return reply;
  }

  private async handleFrameWithConnection(
    frame: string,
    context: {
      connectionId: string;
      remoteAddr: string | null;
      remotePort: number | null;
      setImei: (imei: string) => void;
      getImei: () => string | null;
    }
  ) {
    let payload: Record<string, unknown>;
    let auditLogId: string | null = null;
    let imei = '';
    let protocolVersion = this.gatewayService.getProtocolName();
    let msgType: string | null = null;
    try {
      payload = JSON.parse(frame) as Record<string, unknown>;
    } catch (error) {
      await this.safeCreateTcpAuditLog({
        connection_id: context.connectionId,
        transport_type: 'tcp',
        direction: 'inbound',
        remote_addr: context.remoteAddr,
        remote_port: context.remotePort,
        imei: context.getImei(),
        frame_size_bytes: Buffer.byteLength(frame, 'utf8'),
        raw_frame_text: frame,
        parse_status: 'malformed_json',
        ingest_status: 'failed',
        ingest_error: this.stringifyAuditError(error),
        request_snapshot: {
          parser: 'JSON.parse'
        }
      });
      this.logger.warn(`drop malformed device frame: ${this.stringifyError(error)}`);
      return [];
    }

    imei = this.asString(payload.i);
    protocolVersion = this.resolveProtocolVersion(payload);
    msgType = this.resolveMsgType(payload) || null;
    auditLogId = await this.safeCreateTcpAuditLog({
      connection_id: context.connectionId,
      transport_type: 'tcp',
      direction: 'inbound',
      remote_addr: context.remoteAddr,
      remote_port: context.remotePort,
      imei: imei || context.getImei(),
      msg_type: msgType,
      protocol_version: protocolVersion,
      frame_size_bytes: Buffer.byteLength(frame, 'utf8'),
      raw_frame_text: frame,
      parse_status: 'parsed',
      ingest_status: 'pending',
      request_snapshot: payload
    });

    if (imei) {
      context.setImei(imei);
      try {
        await this.gatewayService.bindConnectionSession({
          imei,
          connectionId: context.connectionId,
          transportType: 'tcp',
          protocolVersion,
          msgType,
          remoteAddr: context.remoteAddr,
          remotePort: context.remotePort
        });
      } catch (error) {
        await this.safeFinalizeTcpAuditLog(auditLogId, {
          imei,
          msg_type: msgType,
          protocol_version: protocolVersion,
          ingest_status: 'failed',
          ingest_error: this.stringifyAuditError(error)
        });
        this.logger.warn(`device connection bind failed: ${this.stringifyError(error)}`);
        return [];
      }
    }

    return this.handleFrame(payload, context.getImei(), auditLogId);
  }

  private async handleFrame(payload: Record<string, unknown>, boundImei: string | null, auditLogId: string | null) {
    const payloadBody = this.asObject(payload.p);
    const msgType = this.resolveMsgType(payload);
    const imei = this.asString(payload.i) || boundImei || undefined;
    const protocolVersion = this.resolveProtocolVersion(payload);
    const sessionRef = this.asString(payload.r) || undefined;

    try {
      if (msgType === 'PULL_PENDING_COMMANDS') {
        const result = await this.gatewayService.pullPendingCommands({
          imei,
          session_ref: sessionRef,
          limit: typeof payloadBody.limit === 'number' ? payloadBody.limit : 1,
          mark_sent: payloadBody.mark_sent === false ? false : true,
          include_sent: payloadBody.include_sent === true
        });
        await this.safeFinalizeTcpAuditLog(auditLogId, {
          imei: imei ?? null,
          msg_type: msgType || null,
          protocol_version: protocolVersion,
          ingest_status: 'pull_only',
          ingest_error: null,
          request_snapshot: {
            session_ref: sessionRef ?? null,
            pending_command_count: result.items.length
          }
        });
        return result.items
          .map((item) =>
            item && typeof item === 'object' && !Array.isArray(item)
              ? ((item as Record<string, unknown>).wire_message as Record<string, unknown> | null)
              : null
          )
          .filter((item): item is Record<string, unknown> => Boolean(item));
      }

      await this.gatewayService.ingestRuntimeEvent({
        ...payload,
        _tcp_audit_log_id: auditLogId ?? undefined
      });
      if (!imei) {
        await this.safeFinalizeTcpAuditLog(auditLogId, {
          msg_type: msgType || null,
          protocol_version: protocolVersion,
          ingest_status: 'ingested',
          ingest_error: null
        });
        return [];
      }

      const pending = await this.gatewayService.pullPendingCommands({
        imei,
        session_ref: sessionRef,
        limit: 1,
        mark_sent: true,
        include_sent: false
      });
      await this.safeFinalizeTcpAuditLog(auditLogId, {
        imei,
        msg_type: msgType || null,
        protocol_version: protocolVersion,
        ingest_status: 'ingested',
        ingest_error: null,
        request_snapshot: {
          session_ref: sessionRef ?? null,
          pending_command_count: pending.items.length
        }
      });

      const outboundMessages =
        msgType === 'REGISTER'
          ? [this.buildRegisterReplyEnvelope(payload, 'REGISTER_ACK')]
          : [];

      return outboundMessages.concat(
        pending.items
        .map((item) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? ((item as Record<string, unknown>).wire_message as Record<string, unknown> | null)
            : null
        )
          .filter((item): item is Record<string, unknown> => Boolean(item))
      );
    } catch (error) {
      await this.safeFinalizeTcpAuditLog(auditLogId, {
        imei: imei ?? null,
        msg_type: msgType || null,
        protocol_version: protocolVersion,
        ingest_status: this.resolveAuditIngestStatus(error),
        ingest_error: this.stringifyAuditError(error),
        request_snapshot: {
          session_ref: sessionRef ?? null
        }
      });
      this.logger.warn(`device frame handling failed: ${this.stringifyError(error)}`);
      if (msgType === 'REGISTER' && imei) {
        return [this.buildRegisterReplyEnvelope(payload, 'REGISTER_NACK', error)];
      }
      return [];
    }
  }

  private resolveProtocolVersion(payload: Record<string, unknown>) {
    const version = this.asNumber(payload.v);
    return version === null ? this.gatewayService.getProtocolName() : `${this.gatewayService.getProtocolName()}/v${Math.trunc(version)}`;
  }

  private resolveMsgType(payload: Record<string, unknown>) {
    return this.normalizeMsgType(payload.t);
  }

  private resolveAuditIngestStatus(error: unknown) {
    if (error instanceof AppException) {
      const status = error.getStatus();
      if (status >= 400 && status < 500) {
        return 'rejected';
      }
    }
    return 'failed';
  }

  private stringifyAuditError(error: unknown) {
    if (error instanceof AppException) {
      const payload = error.getResponse() as {
        code?: string;
        message?: string;
      };
      const code = this.asString(payload?.code);
      const message = this.asString(payload?.message) || error.message;
      return code ? `${code}: ${message}` : message;
    }
    return this.stringifyError(error);
  }

  private async safeCreateTcpAuditLog(input: Parameters<DeviceGatewayService['createTcpAuditLog']>[0]) {
    try {
      const record = await this.gatewayService.createTcpAuditLog(input);
      return record?.id ?? null;
    } catch (error) {
      this.logger.warn(`tcp audit create failed: ${this.stringifyError(error)}`);
      return null;
    }
  }

  private async safeFinalizeTcpAuditLog(
    auditLogId: string | null,
    input: Parameters<DeviceGatewayService['finalizeTcpAuditLog']>[1]
  ) {
    if (!auditLogId) return;
    try {
      await this.gatewayService.finalizeTcpAuditLog(auditLogId, input);
    } catch (error) {
      this.logger.warn(`tcp audit finalize failed: ${this.stringifyError(error)}`);
    }
  }

  private async recordOutboundAudit(
    payload: Record<string, unknown>,
    context: {
      connectionId: string;
      remoteAddr: string | null;
      remotePort: number | null;
      getImei: () => string | null;
    },
    serializedFrame = this.serializeOutboundFrame(payload)
  ) {
    await this.safeCreateTcpAuditLog({
      connection_id: context.connectionId,
      transport_type: 'tcp',
      direction: 'outbound',
      remote_addr: context.remoteAddr,
      remote_port: context.remotePort,
      imei: this.asString(payload.i) || context.getImei(),
      msg_type: this.resolveMsgType(payload) || null,
      protocol_version: this.resolveProtocolVersion(payload),
      frame_size_bytes: serializedFrame.frameByteLength,
      raw_frame_text: serializedFrame.bodyText,
      parse_status: 'generated',
      ingest_status: 'sent',
      request_snapshot: {
        ...payload,
        _wire_frame_bytes: serializedFrame.frameByteLength,
        _wire_body_bytes: serializedFrame.bodyByteLength,
        _wire_prefix_hex: serializedFrame.framePrefixHex,
        _wire_body_hex_preview: serializedFrame.bodyHexPreview
      }
    });
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : JSON.stringify(error);
  }
}
