import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Response } from 'express';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';
import { DeviceGatewayModule } from '../device-gateway/device-gateway.module';
import { DeviceGatewayService } from '../device-gateway/device-gateway.service';
import { SCAN_CONTROLLER_TRIAL_BASELINE } from '../device-gateway/scan-controller-trial.contract';
import { TcpJsonV1Server } from '../device-gateway/tcp-json-v1.server';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_CREATED_BY = '运维管理员';
const UPLOAD_ROOT = path.resolve(process.cwd(), 'var', 'uploads', 'device-release-artifacts');
const DEFAULT_ACTOR_NAME_CN = '运维管理员';
const DEFAULT_ACTOR_NAME = '运维管理员';

type JsonObject = Record<string, unknown>;

type ReleaseKind = 'software' | 'hardware';
type ArtifactKind = 'binary' | 'source' | 'document';
type UpgradeJobScope = 'single' | 'batch';
type UpgradeJobStatus = 'pending' | 'running' | 'partial_success' | 'success' | 'failed' | 'paused';
type UpgradeItemStatus =
  | 'pending'
  | 'command_sent'
  | 'command_acked'
  | 'downloading'
  | 'installing'
  | 'rebooting'
  | 'rollback_running'
  | 'rollback_succeeded'
  | 'rollback_failed'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

type UpgradeCommandStatus = 'created' | 'sent' | 'acked' | 'retry_pending' | 'failed' | 'dead_letter' | '';

type UploadFile = {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
};

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = asString(value).toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parsePage(value?: string, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value?: string, fallback = 20) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeToken(value: unknown, fallback = '') {
  const normalized = asString(value)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  return normalized || fallback;
}

function normalizeSemver(value: unknown) {
  const normalized = asString(value).replace(/^v/i, '');
  return normalized || '';
}

function sanitizeFileName(value: string) {
  const base = path.basename(value || 'artifact.bin');
  const normalized = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return normalized || 'artifact.bin';
}

function extractReleaseRevisionTag(value: unknown) {
  const normalized = asString(value).toLowerCase();
  const matched = normalized.match(/(?:^|[-_])(r\d+)$/i);
  return matched?.[1] ?? '';
}

function sanitizePercent(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Number(parsed.toFixed(2))));
}

function releaseKindLabel(kind: ReleaseKind) {
  if (kind === 'software') return '软件版本';
  return '硬件版本';
}

function appException(status: HttpStatus, code: string, message: string, data: Record<string, unknown> = {}) {
  return new HttpException({ requestId: 'local-dev', code, message, data }, status);
}

function ensureReleaseKind(value: unknown): ReleaseKind {
  const normalized = asString(value).toLowerCase();
  if (normalized === 'software' || normalized === 'hardware') {
    return normalized;
  }
  throw new BadRequestException('release_kind 必须是 software 或 hardware');
}

function firstCatalogFamily(versioning: JsonObject, key: 'software_catalog') {
  return asArray(versioning[key])
    .map((item) => asString(asObject(item).family))
    .find(Boolean) ?? '';
}

function firstHardwareModel(versioning: JsonObject) {
  const model = asArray(versioning.hardware_catalog).find((item) => asObject(item).sku);
  return asObject(model);
}

function generateReleaseCode(input: {
  releaseKind: ReleaseKind;
  family?: string;
  versionSemver?: string;
  hardwareSku?: string;
  hardwareRev?: string;
  bundleCodeSeed?: string;
}) {
  if (input.releaseKind === 'software') {
    return `SW-${normalizeToken(input.family || input.bundleCodeSeed, 'SOFTWARE')}-v${normalizeSemver(input.versionSemver)}`;
  }
  return `HW-${normalizeToken(input.hardwareSku, 'UNSPEC')}-${normalizeToken(input.hardwareRev, 'A00')}`;
}

@Injectable()
class FirmwareService {
  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
    private readonly deviceGatewayService: DeviceGatewayService,
    private readonly tcpServer: TcpJsonV1Server
  ) {}

  private mapReleaseRow(row: Record<string, any>) {
    return {
      id: row.id,
      device_type_id: row.device_type_id,
      type_code: row.type_code ?? null,
      type_name: row.type_name ?? '',
      release_kind: row.release_kind,
      release_kind_label: releaseKindLabel(row.release_kind),
      release_code: row.release_code,
      family: row.family ?? null,
      version_semver: row.version_semver ?? null,
      firmware_version: row.version_semver ?? null,
      hardware_sku: row.hardware_sku ?? null,
      hardware_rev: row.hardware_rev ?? null,
      protocol_version: row.protocol_version ?? null,
      package_name: row.package_name ?? null,
      package_size_kb: Number(row.package_size_kb ?? 0),
      checksum: row.checksum ?? null,
      release_notes: row.release_notes ?? '',
      status: row.status,
      source_repo_url: row.source_repo_url ?? null,
      source_repo_ref: row.source_repo_ref ?? null,
      source_commit_sha: row.source_commit_sha ?? null,
      artifact_count: Number(row.artifact_count ?? 0),
      artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
      created_at: row.created_at,
    };
  }

  private async getReleaseById(releaseId: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        r.id,
        r.device_type_id,
        dt.type_code,
        dt.type_name,
        r.release_kind,
        r.release_code,
        r.family,
        r.version_semver,
        r.hardware_sku,
        r.hardware_rev,
        r.protocol_version,
        r.package_name,
        r.package_size_kb,
        r.checksum,
        r.release_notes,
        r.status,
        r.source_repo_url,
        r.source_repo_ref,
        r.source_commit_sha,
        r.created_at,
        coalesce(art.artifact_count, 0)::int as artifact_count,
        coalesce(art.artifacts, '[]'::json) as artifacts
      from device_release_registry r
      left join device_type dt on dt.id = r.device_type_id
      left join lateral (
        select
          count(*)::int as artifact_count,
          coalesce(
            json_agg(
              json_build_object(
                'id', a.id,
                'artifact_kind', a.artifact_kind,
                'file_name', a.file_name,
                'content_type', a.content_type,
                'file_size_bytes', a.file_size_bytes,
                'created_at', a.created_at
              )
              order by a.created_at asc
            ),
            '[]'::json
          ) as artifacts
        from device_release_artifact a
        where a.tenant_id = r.tenant_id and a.release_id = r.id
      ) art on true
      where r.tenant_id = $1 and r.id = $2
      limit 1
      `,
      [TENANT_ID, releaseId],
      client
    );
    const row = result.rows[0];
    return row ? this.mapReleaseRow(row) : null;
  }

  private mapJobItemRow(row: Record<string, any>) {
    const detailJson = asObject(row.detail_json);
    const commandStatus = this.normalizeUpgradeCommandStatus(row.gateway_command_status);
    const commandResponsePayload = asObject(row.gateway_response_payload);
    const delivery = this.deriveUpgradeItemDelivery({
      status: row.status,
      stage: row.stage,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
      commandStatus,
      commandResponsePayload,
    });

    return {
      id: row.id,
      job_id: row.job_id,
      device_id: row.device_id,
      release_id: row.release_id,
      imei: row.imei,
      device_code: row.device_code ?? '',
      device_name: row.device_name ?? '',
      target_version: row.target_version ?? '',
      upgrade_token: row.upgrade_token,
      status: row.status,
      stage: row.stage,
      effective_status: delivery.effectiveStatus,
      effective_stage: delivery.effectiveStage,
      progress_percent: Number(row.progress_percent ?? 0),
      command_id: row.command_id ?? null,
      command_token: row.command_token ?? null,
      command_status: commandStatus || null,
      command_sent_at: row.gateway_sent_at ?? null,
      command_acked_at: row.gateway_acked_at ?? null,
      command_failed_at: row.gateway_failed_at ?? null,
      command_timeout_at: row.gateway_timeout_at ?? null,
      command_response_payload: commandResponsePayload,
      package_artifact_id: row.package_artifact_id ?? null,
      package_file_name: row.package_file_name ?? null,
      package_checksum: row.package_checksum ?? null,
      last_error_code: row.last_error_code ?? null,
      last_error_message: row.last_error_message ?? null,
      detail_json: detailJson,
      last_dispatch_at: asString(detailJson.last_dispatch_at) || null,
      awaiting_device_ack: delivery.awaitingDeviceAck,
      delivery_state: delivery.state,
      delivery_summary: delivery.summary,
      blocking_reason_code: delivery.blockingReasonCode,
      blocking_reason_text: delivery.blockingReasonText,
      last_reported_at: row.last_reported_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private resolveFirmwarePublicBaseUrl() {
    const explicitApiBase =
      this.configService.get<string>('FIRMWARE_PUBLIC_BASE_URL') ||
      this.configService.get<string>('PUBLIC_API_BASE_URL');
    if (explicitApiBase) {
      return explicitApiBase.replace(/\/+$/, '');
    }

    const publicWebBase =
      this.configService.get<string>('PUBLIC_WEB_BASE_URL') ||
      this.configService.get<string>('PORTAL_PUBLIC_BASE_URL') ||
      'http://xupengpeng.top';
    return `${publicWebBase.replace(/\/+$/, '')}/api/v1`;
  }

  private resolveFirmwarePublicBinaryBaseUrl() {
    return (
      this.configService.get<string>('FIRMWARE_PUBLIC_BINARY_BASE_URL') ||
      this.configService.get<string>('PUBLIC_WEB_BASE_URL') ||
      this.configService.get<string>('PORTAL_PUBLIC_BASE_URL') ||
      'http://xupengpeng.top'
    ).replace(/\/+$/, '');
  }

  private buildArtifactDownloadUrl(artifactId: string) {
    return `${this.resolveFirmwarePublicBaseUrl()}/firmware/artifacts/${artifactId}/download`;
  }

  private buildPublicBinaryFileName(release: Record<string, any>, binaryArtifact: Record<string, any>) {
    const originalName = sanitizeFileName(
      asString(binaryArtifact.file_name) || asString(release.package_name) || 'artifact.bin'
    );
    const extension = path.extname(originalName);
    const stem = path.basename(originalName, extension);
    const revisionTag =
      extractReleaseRevisionTag(release.version_semver) ||
      extractReleaseRevisionTag(release.release_code);

    if (!revisionTag) {
      return originalName;
    }
    return `${stem}-${revisionTag}${extension || '.bin'}`;
  }

  private buildPackageDownloadUrl(release: Record<string, any>, binaryArtifact: Record<string, any>) {
    const fileName = this.buildPublicBinaryFileName(release, binaryArtifact);
    if (fileName) {
      return `${this.resolveFirmwarePublicBinaryBaseUrl()}/${fileName}`;
    }
    return this.buildArtifactDownloadUrl(asString(binaryArtifact.id));
  }

  private normalizeUpgradeItemStage(value: unknown) {
    const normalized = asString(value).toLowerCase();
    if (
      [
        'pending',
        'command_sent',
        'command_acked',
        'downloading',
        'installing',
        'rebooting',
        'rollback_running',
        'rollback_succeeded',
        'rollback_failed',
        'succeeded',
        'failed',
        'cancelled',
      ].includes(normalized)
    ) {
      return normalized as UpgradeItemStatus;
    }
    return 'pending';
  }

  private deriveUpgradeItemStatus(input: {
    stage: UpgradeItemStatus;
    result?: string | null;
    commandAccepted?: boolean | null;
  }): UpgradeItemStatus {
    const result = asString(input.result).toLowerCase();
    if (result === 'failed') return 'failed';
    if (result === 'cancelled') return 'cancelled';
    if (input.stage === 'rollback_running') return 'rollback_running';
    if (input.stage === 'rollback_succeeded') return 'rollback_succeeded';
    if (input.stage === 'rollback_failed') return 'rollback_failed';
    if (result === 'succeeded' || input.stage === 'succeeded') return 'succeeded';
    if (input.commandAccepted && input.stage === 'pending') return 'command_acked';
    return input.stage;
  }

  private normalizeUpgradeCommandStatus(value: unknown): UpgradeCommandStatus {
    const normalized = asString(value).toLowerCase();
    if (
      ['created', 'sent', 'acked', 'retry_pending', 'failed', 'dead_letter'].includes(normalized)
    ) {
      return normalized as UpgradeCommandStatus;
    }
    return '';
  }

  private describeUpgradeBlockingReason(code: string) {
    switch (code) {
      case 'dispatch_failed':
        return '平台下发升级指令失败。';
      case 'ack_timeout_exceeded':
        return '平台已下发升级指令，但设备长期未返回 AK/NK。';
      case 'sync_start_ack_timeout':
      case 'sync_workflow_control_ack_timeout':
      case 'realtime_control_ack_timeout':
        return '设备未在时限内确认指令，平台已按实时命令超时处理。';
      default:
        return code ? `升级链路阻塞：${code}` : '升级链路已阻塞。';
    }
  }

  private deriveUpgradeItemDelivery(input: {
    status: unknown;
    stage: unknown;
    lastErrorCode: unknown;
    lastErrorMessage: unknown;
    commandStatus: UpgradeCommandStatus;
    commandResponsePayload: JsonObject;
  }) {
    const status = this.normalizeUpgradeItemStage(input.status);
    const stage = this.normalizeUpgradeItemStage(input.stage);
    const transport = asObject(input.commandResponsePayload.transport);
    const blockingReasonCode =
      asString(input.lastErrorCode) ||
      asString(transport.dead_letter_reason) ||
      asString(transport.last_transition) ||
      '';
    const blockingReasonText =
      asString(input.lastErrorMessage) ||
      this.describeUpgradeBlockingReason(blockingReasonCode);

    if (status === 'succeeded' || stage === 'succeeded') {
      return {
        effectiveStatus: 'succeeded' as UpgradeItemStatus,
        effectiveStage: 'succeeded' as UpgradeItemStatus,
        state: 'upgrade_succeeded',
        summary: '设备已回报升级成功。',
        awaitingDeviceAck: false,
        blockingReasonCode: null,
        blockingReasonText: null,
      };
    }

    if (status === 'cancelled' || stage === 'cancelled') {
      return {
        effectiveStatus: 'cancelled' as UpgradeItemStatus,
        effectiveStage: 'cancelled' as UpgradeItemStatus,
        state: 'upgrade_cancelled',
        summary: '升级任务已取消。',
        awaitingDeviceAck: false,
        blockingReasonCode: blockingReasonCode || null,
        blockingReasonText: blockingReasonText || null,
      };
    }

    if (
      status === 'failed' ||
      stage === 'failed' ||
      input.commandStatus === 'failed' ||
      input.commandStatus === 'dead_letter'
    ) {
      return {
        effectiveStatus: 'failed' as UpgradeItemStatus,
        effectiveStage: 'failed' as UpgradeItemStatus,
        state: 'command_blocked',
        summary: blockingReasonText || '升级命令未得到设备确认，任务已阻塞。',
        awaitingDeviceAck: false,
        blockingReasonCode: blockingReasonCode || null,
        blockingReasonText: blockingReasonText || null,
      };
    }

    if (
      ['downloading', 'installing', 'rebooting', 'rollback_running', 'rollback_succeeded', 'rollback_failed'].includes(
        stage
      )
    ) {
      return {
        effectiveStatus: status,
        effectiveStage: stage,
        state: 'upgrade_in_progress',
        summary: '设备已确认升级并开始回报升级阶段。',
        awaitingDeviceAck: false,
        blockingReasonCode: null,
        blockingReasonText: null,
      };
    }

    if (stage === 'command_acked' || status === 'command_acked' || input.commandStatus === 'acked') {
      return {
        effectiveStatus: 'command_acked' as UpgradeItemStatus,
        effectiveStage: 'command_acked' as UpgradeItemStatus,
        state: 'command_acknowledged',
        summary: '设备已确认升级指令，正在等待下载或安装进度。',
        awaitingDeviceAck: false,
        blockingReasonCode: null,
        blockingReasonText: null,
      };
    }

    if (input.commandStatus === 'retry_pending') {
      return {
        effectiveStatus: 'command_sent' as UpgradeItemStatus,
        effectiveStage: 'command_sent' as UpgradeItemStatus,
        state: 'command_retry_pending',
        summary: '设备尚未确认升级指令，平台已转入重试队列。',
        awaitingDeviceAck: true,
        blockingReasonCode: blockingReasonCode || null,
        blockingReasonText: blockingReasonText || null,
      };
    }

    if (status === 'command_sent' || stage === 'command_sent' || input.commandStatus === 'sent') {
      return {
        effectiveStatus: 'command_sent' as UpgradeItemStatus,
        effectiveStage: 'command_sent' as UpgradeItemStatus,
        state: 'command_sent_waiting_ack',
        summary: '平台已下发升级指令，但设备还没有返回 AK/NK，也还没有进度。',
        awaitingDeviceAck: true,
        blockingReasonCode: null,
        blockingReasonText: null,
      };
    }

    return {
      effectiveStatus: 'pending' as UpgradeItemStatus,
      effectiveStage: 'pending' as UpgradeItemStatus,
      state: 'pending_dispatch',
      summary: '升级任务已创建，尚未向设备下发命令。',
      awaitingDeviceAck: false,
      blockingReasonCode: null,
      blockingReasonText: null,
    };
  }

  private deriveJobStatusFromItemSummary(summary: {
    total: number;
    pending: number;
    active: number;
    success: number;
    failed: number;
    cancelled: number;
  }): UpgradeJobStatus {
    if (summary.total <= 0 || summary.pending === summary.total) return 'pending';
    if (summary.success === summary.total) return 'success';
    if (summary.failed + summary.cancelled === summary.total) return 'failed';
    if (summary.success > 0 && summary.failed + summary.cancelled > 0 && summary.active === 0 && summary.pending === 0) {
      return 'partial_success';
    }
    return 'running';
  }

  private shouldAutoDispatchUpgrade(requested: unknown) {
    if (requested !== undefined && requested !== null && asString(requested) !== '') {
      return asBoolean(requested);
    }
    return asBoolean(this.configService.get<string>('FIRMWARE_UPGRADE_AUTO_DISPATCH'));
  }

  private async getReleaseBinaryArtifact(releaseId: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        id,
        file_name,
        content_type,
        file_size_bytes,
        storage_path
      from device_release_artifact
      where tenant_id = $1 and release_id = $2 and artifact_kind = 'binary'
      order by created_at asc
      limit 1
      `,
      [TENANT_ID, releaseId],
      client
    );
    return result.rows[0] ?? null;
  }

  private async listTargetDevicesForUpgrade(input: {
    scope: UpgradeJobScope;
    deviceId?: string | null;
    deviceTypeId?: string | null;
  }, client: PoolClient) {
    if (input.scope === 'single') {
      const result = await this.db.query<Record<string, any>>(
        `
        select id, device_type_id, imei, device_code, device_name
        from device
        where tenant_id = $1 and id = $2
        limit 1
        `,
        [TENANT_ID, input.deviceId],
        client
      );
      return result.rows;
    }

    const result = await this.db.query<Record<string, any>>(
      `
      select id, device_type_id, imei, device_code, device_name
      from device
      where tenant_id = $1 and ($2::uuid is null or device_type_id = $2::uuid)
      order by created_at asc
      `,
      [TENANT_ID, input.deviceTypeId ?? null],
      client
    );
    return result.rows;
  }

  private mapJobRow(row: Record<string, any>) {
    return {
      id: row.id,
      scope: row.scope,
      release_id: row.release_id ?? null,
      release_code: row.release_code ?? row.target_version ?? '',
      type_code: row.type_code ?? '',
      type_name: row.type_name ?? '',
      target_version: row.target_version ?? '',
      status: row.status,
      total_devices: Number(row.total_devices ?? 0),
      success_count: Number(row.success_count ?? 0),
      failed_count: Number(row.failed_count ?? 0),
      pending_count: Number(row.pending_count ?? 0),
      active_count: Number(row.active_count ?? 0),
      awaiting_ack_count: Number(row.awaiting_ack_count ?? 0),
      acked_waiting_progress_count: Number(row.acked_waiting_progress_count ?? 0),
      blocked_count: Number(row.blocked_count ?? 0),
      created_at: row.created_at,
      created_by: row.created_by ?? DEFAULT_ACTOR_NAME_CN,
      project_name: row.project_name ?? null,
      block_name: row.block_name ?? null,
      batch_strategy: row.batch_strategy ?? null,
    };
  }

  private async getJobById(jobId: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        j.id,
        j.scope,
        j.release_id,
        dt.type_code,
        dt.type_name,
        r.release_code,
        r.release_code as target_version,
        j.status,
        j.total_devices,
        j.success_count,
        j.failed_count,
        coalesce(item.pending_count, 0)::int as pending_count,
        coalesce(item.active_count, 0)::int as active_count,
        coalesce(item.awaiting_ack_count, 0)::int as awaiting_ack_count,
        coalesce(item.acked_waiting_progress_count, 0)::int as acked_waiting_progress_count,
        coalesce(item.blocked_count, 0)::int as blocked_count,
        j.created_at,
        j.created_by,
        j.project_name,
        j.block_name,
        j.batch_strategy
      from device_upgrade_job j
      left join device_type dt on dt.id = j.device_type_id
      left join device_release_registry r on r.id = j.release_id
      left join lateral (
        select
          count(*) filter (
            where case
              when i.status = 'command_sent' and dc.command_status in ('failed', 'dead_letter') then 'failed'
              when i.status = 'command_sent' and dc.command_status = 'acked' then 'command_acked'
              else i.status
            end = 'pending'
          ) as pending_count,
          count(*) filter (
            where case
              when i.status = 'command_sent' and dc.command_status in ('failed', 'dead_letter') then 'failed'
              when i.status = 'command_sent' and dc.command_status = 'acked' then 'command_acked'
              else i.status
            end in ('command_sent', 'command_acked', 'downloading', 'installing', 'rebooting')
          ) as active_count
          ,
          count(*) filter (where i.status = 'command_sent' and dc.command_status = 'sent') as awaiting_ack_count,
          count(*) filter (
            where (i.status = 'command_sent' and dc.command_status = 'acked')
               or i.status = 'command_acked'
          ) as acked_waiting_progress_count,
          count(*) filter (
            where i.status = 'command_sent' and dc.command_status in ('failed', 'dead_letter')
          ) as blocked_count
        from device_upgrade_job_item i
        left join device_command dc on dc.tenant_id = i.tenant_id and dc.id = i.command_id
        where i.tenant_id = j.tenant_id and i.job_id = j.id
      ) item on true
      where j.tenant_id = $1 and j.id = $2
      limit 1
      `,
      [TENANT_ID, jobId],
      client
    );
    const row = result.rows[0];
    return row ? this.mapJobRow(row) : null;
  }

  private async listJobItemsByJobId(jobId: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        i.id,
        i.job_id,
        i.device_id,
        i.release_id,
        i.imei,
        i.device_code,
        i.device_name,
        i.target_version,
        i.upgrade_token,
        i.status,
        i.stage,
        i.progress_percent,
        i.command_id,
        i.command_token,
        i.package_artifact_id,
        i.package_file_name,
        i.package_checksum,
        i.last_error_code,
        i.last_error_message,
        i.detail_json,
        i.last_reported_at,
        dc.command_status as gateway_command_status,
        dc.sent_at as gateway_sent_at,
        dc.acked_at as gateway_acked_at,
        dc.failed_at as gateway_failed_at,
        dc.timeout_at as gateway_timeout_at,
        dc.response_payload_json as gateway_response_payload,
        i.created_at,
        i.updated_at
      from device_upgrade_job_item i
      left join device_command dc on dc.tenant_id = i.tenant_id and dc.id = i.command_id
      where i.tenant_id = $1 and i.job_id = $2
      order by i.created_at asc
      `,
      [TENANT_ID, jobId],
      client
    );
    return result.rows.map((row) => this.mapJobItemRow(row));
  }

  private async refreshJobAggregate(jobId: string, client: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        count(*)::int as total,
        count(*) filter (where effective_status = 'pending')::int as pending,
        count(*) filter (
          where effective_status in ('command_sent', 'command_acked', 'downloading', 'installing', 'rebooting')
        )::int as active,
        count(*) filter (where effective_status = 'succeeded')::int as success,
        count(*) filter (where effective_status = 'failed')::int as failed,
        count(*) filter (where effective_status = 'cancelled')::int as cancelled
      from (
        select
          case
            when i.status = 'command_sent' and dc.command_status in ('failed', 'dead_letter') then 'failed'
            when i.status = 'command_sent' and dc.command_status = 'acked' then 'command_acked'
            else i.status
          end as effective_status
        from device_upgrade_job_item i
        left join device_command dc on dc.tenant_id = i.tenant_id and dc.id = i.command_id
        where i.tenant_id = $1 and i.job_id = $2
      ) summary
      `,
      [TENANT_ID, jobId],
      client
    );
    const summary = result.rows[0] ?? {
      total: 0,
      pending: 0,
      active: 0,
      success: 0,
      failed: 0,
      cancelled: 0,
    };
    const nextStatus = this.deriveJobStatusFromItemSummary({
      total: Number(summary.total ?? 0),
      pending: Number(summary.pending ?? 0),
      active: Number(summary.active ?? 0),
      success: Number(summary.success ?? 0),
      failed: Number(summary.failed ?? 0),
      cancelled: Number(summary.cancelled ?? 0),
    });

    await this.db.query(
      `
      update device_upgrade_job
      set status = $3,
          total_devices = $4,
          success_count = $5,
          failed_count = $6,
          updated_at = now()
      where tenant_id = $1 and id = $2
      `,
      [
        TENANT_ID,
        jobId,
        nextStatus,
        Number(summary.total ?? 0),
        Number(summary.success ?? 0),
        Number(summary.failed ?? 0) + Number(summary.cancelled ?? 0),
      ],
      client
    );
  }

  private async getDeviceTypeRow(deviceTypeId: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        dt.id,
        dt.type_code,
        dt.type_name,
        dt.default_config_json
      from device_type dt
      where dt.tenant_id = $1 and dt.id = $2
      limit 1
      `,
      [TENANT_ID, deviceTypeId],
      client
    );
    return result.rows[0] ?? null;
  }

  private validateCreateBody(body: Record<string, unknown>) {
    const releaseKind = ensureReleaseKind(body.release_kind);
    if (releaseKind === 'hardware') {
      if (!asString(body.hardware_sku) || !asString(body.hardware_rev)) {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', '硬件版本必须填写 hardware_sku 和 hardware_rev');
      }
      return;
    }
    if (!normalizeSemver(body.version_semver)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', '软件版本必须填写 version_semver');
    }
  }

  private async ensureUniqueReleaseCode(releaseCode: string, client: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from device_release_registry
      where tenant_id = $1 and release_code = $2
      limit 1
      `,
      [TENANT_ID, releaseCode],
      client
    );
    if (result.rows[0]) {
      throw appException(HttpStatus.CONFLICT, 'DUPLICATE_RELEASE_CODE', '版本编码已存在', {
        release_code: releaseCode,
      });
    }
  }

  private async findReleaseByCode(releaseCode: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from device_release_registry
      where tenant_id = $1 and release_code = $2
      limit 1
      `,
      [TENANT_ID, releaseCode],
      client
    );
    const releaseId = result.rows[0]?.id ?? null;
    return releaseId ? this.getReleaseById(releaseId, client) : null;
  }

  private async createBaselineReleaseRecord(
    input: {
      releaseKind: ReleaseKind;
      releaseCode: string;
      family?: string | null;
      versionSemver?: string | null;
      hardwareSku?: string | null;
      hardwareRev?: string | null;
      protocolVersion?: string | null;
      releaseNotes: string;
    },
    client: PoolClient
  ) {
    const existing = await this.findReleaseByCode(input.releaseCode, client);
    if (existing) {
      return { release: existing, created: false };
    }

    const inserted = await this.db.query<{ id: string }>(
      `
      insert into device_release_registry (
        tenant_id,
        device_type_id,
        release_kind,
        release_code,
        family,
        version_semver,
        hardware_sku,
        hardware_rev,
        protocol_version,
        package_name,
        package_size_kb,
        checksum,
        release_notes,
        source_repo_url,
        source_repo_ref,
        source_commit_sha,
        status,
        created_by
      ) values (
        $1, null, $2, $3, $4, $5, $6, $7, $8, null, 0, null, $9, null, null, null, 'released', $10
      )
      returning id
      `,
      [
        TENANT_ID,
        input.releaseKind,
        input.releaseCode,
        input.family ?? null,
        input.versionSemver ?? null,
        input.hardwareSku ?? null,
        input.hardwareRev ?? null,
        input.protocolVersion ?? null,
        input.releaseNotes,
        DEFAULT_ACTOR_NAME_CN,
      ],
      client
    );

    const created = await this.getReleaseById(inserted.rows[0]?.id ?? '', client);
    if (!created) {
      throw new BadRequestException('基线版本创建后读取失败');
    }
    return { release: created, created: true };
  }

  private async persistArtifact(
    client: PoolClient,
    input: {
      releaseId: string;
      artifactKind: ArtifactKind;
      file: UploadFile;
    }
  ) {
    const fileName = sanitizeFileName(input.file.originalname || `${input.artifactKind}.bin`);
    const releaseDir = path.join(UPLOAD_ROOT, input.releaseId);
    await fs.promises.mkdir(releaseDir, { recursive: true });
    const hashSeed = crypto.randomBytes(4).toString('hex');
    const storedName = `${Date.now()}-${hashSeed}-${fileName}`;
    const absolutePath = path.join(releaseDir, storedName);
    await fs.promises.writeFile(absolutePath, input.file.buffer);

    const inserted = await this.db.query<{ id: string }>(
      `
      insert into device_release_artifact (
        tenant_id,
        release_id,
        artifact_kind,
        file_name,
        content_type,
        file_size_bytes,
        storage_path
      ) values ($1, $2, $3, $4, $5, $6, $7)
      returning id
      `,
      [
        TENANT_ID,
        input.releaseId,
        input.artifactKind,
        fileName,
        asString(input.file.mimetype) || 'application/octet-stream',
        Number(input.file.size ?? input.file.buffer.length ?? 0),
        absolutePath,
      ],
      client
    );
    return inserted.rows[0]?.id ?? null;
  }

  private async appendArtifacts(
    client: PoolClient,
    releaseId: string,
    files: {
      binary_file?: UploadFile[];
      source_file?: UploadFile[];
      document_files?: UploadFile[];
    }
  ) {
    const tasks: Array<{ artifactKind: ArtifactKind; file: UploadFile }> = [];
    for (const file of files.binary_file ?? []) {
      tasks.push({ artifactKind: 'binary', file });
    }
    for (const file of files.source_file ?? []) {
      tasks.push({ artifactKind: 'source', file });
    }
    for (const file of files.document_files ?? []) {
      tasks.push({ artifactKind: 'document', file });
    }
    for (const task of tasks) {
      await this.persistArtifact(client, { releaseId, artifactKind: task.artifactKind, file: task.file });
    }
  }

  async listReleases(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<Record<string, any>>(
      `
      select
        r.id,
        r.device_type_id,
        dt.type_code,
        dt.type_name,
        r.release_kind,
        r.release_code,
        r.family,
        r.version_semver,
        r.hardware_sku,
        r.hardware_rev,
        r.protocol_version,
        r.package_name,
        r.package_size_kb,
        r.checksum,
        r.release_notes,
        r.status,
        r.source_repo_url,
        r.source_repo_ref,
        r.source_commit_sha,
        r.created_at,
        coalesce(art.artifact_count, 0)::int as artifact_count,
        coalesce(art.artifacts, '[]'::json) as artifacts,
        count(*) over()::int as total_count
      from device_release_registry r
      left join device_type dt on dt.id = r.device_type_id
      left join lateral (
        select
          count(*)::int as artifact_count,
          coalesce(
            json_agg(
              json_build_object(
                'id', a.id,
                'artifact_kind', a.artifact_kind,
                'file_name', a.file_name,
                'content_type', a.content_type,
                'file_size_bytes', a.file_size_bytes,
                'created_at', a.created_at
              )
              order by a.created_at asc
            ),
            '[]'::json
          ) as artifacts
        from device_release_artifact a
        where a.tenant_id = r.tenant_id and a.release_id = r.id
      ) art on true
      where r.tenant_id = $1
      order by r.created_at desc
      limit $2 offset $3
      `,
      [TENANT_ID, pageSize, offset]
    );

    return {
      items: result.rows.map((row) => this.mapReleaseRow(row)),
      total: result.rows[0]?.total_count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  async createRelease(
    body: Record<string, unknown>,
    files: {
      binary_file?: UploadFile[];
      source_file?: UploadFile[];
      document_files?: UploadFile[];
    }
  ) {
    this.validateCreateBody(body);

    return this.db.withTransaction(async (client) => {
      const deviceTypeId = asString(body.device_type_id);
      const deviceType = deviceTypeId ? await this.getDeviceTypeRow(deviceTypeId, client) : null;
      if (deviceTypeId && !deviceType) {
        throw new NotFoundException('设备类型不存在');
      }

      const versioning = asObject(asObject(deviceType?.default_config_json).versioning);
      const releaseKind = ensureReleaseKind(body.release_kind);
      const firstHardware = firstHardwareModel(versioning);
      const family =
        asString(body.family) ||
        (releaseKind === 'software' ? firstCatalogFamily(versioning, 'software_catalog') : '');
      const hardwareSku = asString(body.hardware_sku) || asString(firstHardware.sku);
      const hardwareRev =
        asString(body.hardware_rev) ||
        (Array.isArray(firstHardware.revisions) ? asString(firstHardware.revisions[0]) : '');
      const versionSemver = normalizeSemver(body.version_semver);
      const releaseCode = generateReleaseCode({
        releaseKind,
        family,
        versionSemver,
        hardwareSku,
        hardwareRev,
        bundleCodeSeed: asString(versioning.bundle_code_seed) || 'IRR-GEN-GEN-HJV2',
      });
      await this.ensureUniqueReleaseCode(releaseCode, client);

      const binaryFile = files.binary_file?.[0];
      const sourceFile = files.source_file?.[0];
      const packageName = sanitizeFileName(binaryFile?.originalname || sourceFile?.originalname || '');
      const packageSizeKb = Math.ceil(Number(binaryFile?.size ?? sourceFile?.size ?? 0) / 1024);

      const inserted = await this.db.query<{ id: string }>(
        `
        insert into device_release_registry (
          tenant_id,
          device_type_id,
          release_kind,
          release_code,
          family,
          version_semver,
          hardware_sku,
          hardware_rev,
          protocol_version,
          package_name,
          package_size_kb,
          checksum,
          release_notes,
          source_repo_url,
          source_repo_ref,
          source_commit_sha,
          status,
          created_by
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
        returning id
        `,
        [
          TENANT_ID,
          deviceType?.id ?? null,
          releaseKind,
          releaseCode,
          family || null,
          versionSemver || null,
          releaseKind === 'hardware' ? hardwareSku : null,
          releaseKind === 'hardware' ? hardwareRev : null,
          asString(body.protocol_version) || null,
          packageName || null,
          packageSizeKb,
          asString(body.checksum) || null,
          asString(body.release_notes),
          asString(body.source_repo_url) || null,
          asString(body.source_repo_ref) || null,
          asString(body.source_commit_sha) || null,
          'released',
          DEFAULT_ACTOR_NAME_CN,
        ],
        client
      );

      const releaseId = inserted.rows[0]?.id;
      if (!releaseId) {
        throw new BadRequestException('创建版本档案失败');
      }

      await this.appendArtifacts(client, releaseId, files);
      const created = await this.getReleaseById(releaseId, client);
      if (!created) {
        throw new BadRequestException('读取新建版本档案失败');
      }
      return created;
    });
  }

  async bootstrapScanControllerBaseline() {
    return this.db.withTransaction(async (client) => {
      const hardware = await this.createBaselineReleaseRecord(
        {
          releaseKind: 'hardware',
          releaseCode: SCAN_CONTROLLER_TRIAL_BASELINE.first_hardware.release_code,
          hardwareSku: SCAN_CONTROLLER_TRIAL_BASELINE.first_hardware.sku,
          hardwareRev: SCAN_CONTROLLER_TRIAL_BASELINE.first_hardware.rev,
          protocolVersion: SCAN_CONTROLLER_TRIAL_BASELINE.protocol_version,
          releaseNotes: SCAN_CONTROLLER_TRIAL_BASELINE.first_hardware.release_notes,
        },
        client
      );
      const software = await this.createBaselineReleaseRecord(
        {
          releaseKind: 'software',
          releaseCode: SCAN_CONTROLLER_TRIAL_BASELINE.first_software.release_code,
          family: SCAN_CONTROLLER_TRIAL_BASELINE.first_software.family,
          versionSemver: SCAN_CONTROLLER_TRIAL_BASELINE.first_software.version_semver,
          protocolVersion: SCAN_CONTROLLER_TRIAL_BASELINE.protocol_version,
          releaseNotes: SCAN_CONTROLLER_TRIAL_BASELINE.first_software.release_notes,
        },
        client
      );

      return {
        controller_code: SCAN_CONTROLLER_TRIAL_BASELINE.controller_code,
        controller_name: SCAN_CONTROLLER_TRIAL_BASELINE.controller_name,
        created_count: Number(hardware.created) + Number(software.created),
        unchanged_count: Number(!hardware.created) + Number(!software.created),
        hardware_release: hardware.release,
        software_release: software.release,
      };
    });
  }

  async addArtifacts(
    releaseId: string,
    files: {
      binary_file?: UploadFile[];
      source_file?: UploadFile[];
      document_files?: UploadFile[];
    }
  ) {
    const release = await this.db.query<{ id: string }>(
      `
      select id
      from device_release_registry
      where tenant_id = $1 and id = $2
      limit 1
      `,
      [TENANT_ID, releaseId]
    );
    if (!release.rows[0]) {
      throw new NotFoundException('版本档案不存在');
    }

    await this.db.withTransaction(async (client) => {
      await this.appendArtifacts(client, releaseId, files);
    });

    const page = await this.listReleases(1, 200);
    return page.items.find((item) => item.id === releaseId) ?? null;
  }

  async downloadArtifact(artifactId: string) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        a.id,
        a.file_name,
        a.content_type,
        a.storage_path
      from device_release_artifact a
      where a.tenant_id = $1 and a.id = $2
      limit 1
      `,
      [TENANT_ID, artifactId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('附件不存在');
    }
    if (!fs.existsSync(row.storage_path)) {
      throw new NotFoundException('附件文件不存在');
    }
    return {
      file_name: row.file_name,
      content_type: row.content_type || 'application/octet-stream',
      absolute_path: row.storage_path,
    };
  }

  async listJobs(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<Record<string, any>>(
      `
      select
        j.id,
        j.scope,
        j.release_id,
        dt.type_code,
        dt.type_name,
        r.release_code,
        r.release_code as target_version,
        j.status,
        j.total_devices,
        j.success_count,
        j.failed_count,
        coalesce(item.pending_count, 0)::int as pending_count,
        coalesce(item.active_count, 0)::int as active_count,
        coalesce(item.awaiting_ack_count, 0)::int as awaiting_ack_count,
        coalesce(item.acked_waiting_progress_count, 0)::int as acked_waiting_progress_count,
        coalesce(item.blocked_count, 0)::int as blocked_count,
        j.created_at,
        j.created_by,
        j.project_name,
        j.block_name,
        j.batch_strategy,
        count(*) over()::int as total_count
      from device_upgrade_job j
      left join device_type dt on dt.id = j.device_type_id
      left join device_release_registry r on r.id = j.release_id
      left join lateral (
        select
          count(*) filter (
            where case
              when i.status = 'command_sent' and dc.command_status in ('failed', 'dead_letter') then 'failed'
              when i.status = 'command_sent' and dc.command_status = 'acked' then 'command_acked'
              else i.status
            end = 'pending'
          ) as pending_count,
          count(*) filter (
            where case
              when i.status = 'command_sent' and dc.command_status in ('failed', 'dead_letter') then 'failed'
              when i.status = 'command_sent' and dc.command_status = 'acked' then 'command_acked'
              else i.status
            end in ('command_sent', 'command_acked', 'downloading', 'installing', 'rebooting')
          ) as active_count
          ,
          count(*) filter (where i.status = 'command_sent' and dc.command_status = 'sent') as awaiting_ack_count,
          count(*) filter (
            where (i.status = 'command_sent' and dc.command_status = 'acked')
               or i.status = 'command_acked'
          ) as acked_waiting_progress_count,
          count(*) filter (
            where i.status = 'command_sent' and dc.command_status in ('failed', 'dead_letter')
          ) as blocked_count
        from device_upgrade_job_item i
        left join device_command dc on dc.tenant_id = i.tenant_id and dc.id = i.command_id
        where i.tenant_id = j.tenant_id and i.job_id = j.id
      ) item on true
      where j.tenant_id = $1
      order by j.created_at desc
      limit $2 offset $3
      `,
      [TENANT_ID, pageSize, offset]
    );
    return {
      items: result.rows.map((row) => this.mapJobRow(row)),
      total: result.rows[0]?.total_count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  private async loadReleaseForUpgrade(releaseId: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
      select
        r.id,
        r.release_kind,
        r.release_code,
        r.device_type_id,
        r.version_semver,
        r.package_name,
        r.checksum
      from device_release_registry r
      where r.tenant_id = $1 and r.id = $2
      limit 1
      `,
      [TENANT_ID, releaseId],
      client
    );
    return result.rows[0] ?? null;
  }

  private async createUpgradeJob(input: {
    scope: 'single' | 'batch';
    deviceId?: string | null;
    deviceTypeId?: string | null;
    releaseId: string;
    projectName?: string | null;
    blockName?: string | null;
    batchStrategy?: string | null;
  }) {
    return this.db.withTransaction(async (client) => {
      const release = await this.loadReleaseForUpgrade(input.releaseId, client);
      if (!release) {
        throw new NotFoundException('版本档案不存在');
      }
      if (release.release_kind === 'hardware') {
        throw appException(HttpStatus.CONFLICT, 'UNSUPPORTED_UPGRADE_KIND', '硬件版本不支持进入升级任务');
      }

      let totalDevices = 1;
      let deviceTypeId = input.deviceTypeId ?? release.device_type_id;
      if (input.scope === 'single') {
        const deviceResult = await this.db.query<{ id: string; device_type_id: string | null }>(
          `
          select id, device_type_id
          from device
          where tenant_id = $1 and id = $2
          limit 1
          `,
          [TENANT_ID, input.deviceId],
          client
        );
        const device = deviceResult.rows[0];
        if (!device) {
          throw new NotFoundException('设备不存在');
        }
        if (release.device_type_id && device.device_type_id && release.device_type_id !== device.device_type_id) {
          throw appException(HttpStatus.CONFLICT, 'TYPE_MISMATCH', '版本档案与设备类型不匹配');
        }
        deviceTypeId = device.device_type_id;
      } else {
        const deviceCount = await this.db.query<{ count: string }>(
          `
          select count(*)::text as count
          from device
          where tenant_id = $1 and ($2::uuid is null or device_type_id = $2::uuid)
          `,
          [TENANT_ID, deviceTypeId],
          client
        );
        totalDevices = Math.max(1, Number(deviceCount.rows[0]?.count ?? 0));
      }

      const inserted = await this.db.query<{ id: string }>(
        `
        insert into device_upgrade_job (
          tenant_id,
          scope,
          device_id,
          device_type_id,
          release_id,
          target_version,
          status,
          total_devices,
          success_count,
          failed_count,
          created_by,
          project_name,
          block_name,
          batch_strategy
        ) values (
          $1, $2, $3, $4, $5, $6, 'pending', $7, 0, 0, $8, $9, $10, $11
        )
        returning id
        `,
        [
          TENANT_ID,
          input.scope,
          input.deviceId ?? null,
          deviceTypeId ?? null,
          release.id,
          release.release_code,
          totalDevices,
          DEFAULT_ACTOR_NAME_CN,
          input.projectName ?? null,
          input.blockName ?? null,
          input.batchStrategy ?? null,
        ],
        client
      );
      const jobId = inserted.rows[0]?.id;
      const created = jobId ? await this.getJobById(jobId, client) : null;
      if (!created) {
        throw new BadRequestException('创建升级任务失败');
      }
      return created;
    });
  }

  private async createRemoteUpgradeJob(input: {
    scope: UpgradeJobScope;
    deviceId?: string | null;
    deviceTypeId?: string | null;
    releaseId: string;
    projectName?: string | null;
    blockName?: string | null;
    batchStrategy?: string | null;
  }) {
    return this.db.withTransaction(async (client) => {
      const release = await this.loadReleaseForUpgrade(input.releaseId, client);
      if (!release) {
        throw new NotFoundException('版本档案不存在');
      }
      if (release.release_kind === 'hardware') {
        throw appException(HttpStatus.CONFLICT, 'UNSUPPORTED_UPGRADE_KIND', '硬件版本不支持进入升级任务');
      }

      const binaryArtifact = await this.getReleaseBinaryArtifact(release.id, client);
      if (!binaryArtifact) {
        throw appException(HttpStatus.CONFLICT, 'MISSING_BINARY_ARTIFACT', '软件版本还没有程序包，不能创建远程升级任务');
      }

      let deviceTypeId = input.deviceTypeId ?? release.device_type_id;
      const targetDevices = await this.listTargetDevicesForUpgrade(
        {
          scope: input.scope,
          deviceId: input.deviceId,
          deviceTypeId,
        },
        client
      );
      if (targetDevices.length === 0) {
        throw appException(HttpStatus.BAD_REQUEST, 'NO_TARGET_DEVICES', '没有匹配到可升级设备');
      }

      if (release.device_type_id) {
        const mismatched = targetDevices.find(
          (device) => device.device_type_id && device.device_type_id !== release.device_type_id
        );
        if (mismatched) {
          throw appException(HttpStatus.CONFLICT, 'TYPE_MISMATCH', '版本档案与设备类型不匹配');
        }
      }

      deviceTypeId = targetDevices[0]?.device_type_id ?? deviceTypeId;

      const inserted = await this.db.query<{ id: string }>(
        `
        insert into device_upgrade_job (
          tenant_id,
          scope,
          device_id,
          device_type_id,
          release_id,
          target_version,
          status,
          total_devices,
          success_count,
          failed_count,
          created_by,
          project_name,
          block_name,
          batch_strategy
        ) values (
          $1, $2, $3, $4, $5, $6, 'pending', $7, 0, 0, $8, $9, $10, $11
        )
        returning id
        `,
        [
          TENANT_ID,
          input.scope,
          input.deviceId ?? null,
          deviceTypeId ?? null,
          release.id,
          release.release_code,
          targetDevices.length,
          DEFAULT_ACTOR_NAME_CN,
          input.projectName ?? null,
          input.blockName ?? null,
          input.batchStrategy ?? null,
        ],
        client
      );
      const jobId = inserted.rows[0]?.id;
      if (!jobId) {
        throw new BadRequestException('创建升级任务失败');
      }

      for (const device of targetDevices) {
        await this.db.query(
          `
          insert into device_upgrade_job_item (
            tenant_id,
            job_id,
            device_id,
            release_id,
            imei,
            device_code,
            device_name,
            target_version,
            upgrade_token,
            status,
            stage,
            progress_percent,
            package_artifact_id,
            package_file_name,
            package_checksum,
            detail_json
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'pending', 0, $10, $11, $12, $13::jsonb
          )
          `,
          [
            TENANT_ID,
            jobId,
            device.id,
            release.id,
            asString(device.imei),
            asString(device.device_code) || null,
            asString(device.device_name) || null,
            release.release_code,
            crypto.randomUUID(),
            binaryArtifact.id,
            asString(binaryArtifact.file_name) || null,
            asString(release.checksum) || null,
            JSON.stringify({
              release_code: release.release_code,
              release_id: release.id,
              package_download_url: this.buildPackageDownloadUrl(release, binaryArtifact),
              package_size_bytes: Number(binaryArtifact.file_size_bytes ?? 0),
            }),
          ],
          client
        );
      }

      await this.refreshJobAggregate(jobId, client);
      const created = await this.getJobById(jobId, client);
      if (!created) {
        throw new BadRequestException('创建升级任务失败');
      }
      return created;
    });
  }

  async upgradeSingle(body: { device_id?: string; release_id?: string; auto_dispatch?: boolean | string | number }) {
    if (!asString(body.device_id) || !asString(body.release_id)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'device_id 和 release_id 不能为空');
    }
    const created = await this.createRemoteUpgradeJob({
      scope: 'single',
      deviceId: asString(body.device_id),
      releaseId: asString(body.release_id),
    });
    return this.shouldAutoDispatchUpgrade(body.auto_dispatch) ? this.dispatchJob(created.id) : created;
  }

  async upgradeBatch(body: {
    device_type_id?: string;
    release_id?: string;
    project_name?: string | null;
    block_name?: string | null;
    batch_strategy?: string | null;
    auto_dispatch?: boolean | string | number;
  }) {
    if (!asString(body.device_type_id) || !asString(body.release_id)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'device_type_id 和 release_id 不能为空');
    }
    const created = await this.createRemoteUpgradeJob({
      scope: 'batch',
      deviceTypeId: asString(body.device_type_id),
      releaseId: asString(body.release_id),
      projectName: body.project_name ?? null,
      blockName: body.block_name ?? null,
      batchStrategy: body.batch_strategy ?? null,
    });
    return this.shouldAutoDispatchUpgrade(body.auto_dispatch) ? this.dispatchJob(created.id) : created;
  }

  async getJobDetail(jobId: string, client?: PoolClient) {
    const job = await this.getJobById(jobId, client);
    if (!job) {
      throw new NotFoundException('升级任务不存在');
    }
    const items = await this.listJobItemsByJobId(jobId, client);
    return {
      ...job,
      items,
    };
  }

  async dispatchJob(jobId: string) {
    const job = await this.getJobById(jobId);
    if (!job) {
      throw new NotFoundException('升级任务不存在');
    }

    const items = await this.listJobItemsByJobId(jobId);
    const dispatchable = items.filter((item) => item.status === 'pending' || item.status === 'failed');
    if (dispatchable.length === 0) {
      return {
        ...job,
        dispatched_count: 0,
        items,
      };
    }

    let dispatchedCount = 0;

    for (const item of dispatchable) {
      const detail = asObject(item.detail_json);
      try {
        const result = await this.deviceGatewayService.dispatchExecuteAction({
          target_device_id: item.device_id,
          imei: item.imei,
          action_code: 'upgrade_firmware',
          scope: 'common',
          payload: {
            params: {
              upgrade_token: item.upgrade_token,
              upgrade_job_id: item.job_id,
              upgrade_item_id: item.id,
              release_id: item.release_id,
              release_code: item.target_version,
              package_artifact_id: item.package_artifact_id,
              package_download_url: asString(detail.package_download_url),
              package_file_name: item.package_file_name,
              package_checksum: item.package_checksum,
              package_size_bytes: detail.package_size_bytes ?? null,
            },
          },
          source: 'firmware_remote_upgrade.dispatch',
        });
        await this.tcpServer.dispatchQueuedCommandNow(result.command.command_token);

        await this.db.query(
          `
          update device_upgrade_job_item
          set status = 'command_sent',
              stage = 'command_sent',
              progress_percent = greatest(progress_percent, 0),
              command_id = $3::uuid,
              command_token = $4::uuid,
              detail_json = jsonb_set(coalesce(detail_json, '{}'::jsonb), '{last_dispatch_at}', to_jsonb(now()::text), true),
              last_error_code = null,
              last_error_message = null,
              updated_at = now()
          where tenant_id = $1 and id = $2
          `,
          [TENANT_ID, item.id, result.command.id, result.command.command_token]
        );
        dispatchedCount += 1;
      } catch (error) {
        await this.db.query(
          `
          update device_upgrade_job_item
          set status = 'failed',
              stage = 'failed',
              last_error_code = 'dispatch_failed',
              last_error_message = $3,
              updated_at = now()
          where tenant_id = $1 and id = $2
          `,
          [
            TENANT_ID,
            item.id,
            error instanceof Error ? error.message : String(error),
          ]
        );
      }
    }

    await this.db.withTransaction(async (client) => {
      await this.refreshJobAggregate(jobId, client);
    });

    const refreshed = await this.getJobDetail(jobId);
    return {
      ...refreshed,
      dispatched_count: dispatchedCount,
    };
  }

  async reportDeviceUpgrade(body: {
    upgrade_token?: string;
    job_item_id?: string;
    imei?: string;
    stage?: string;
    result?: string;
    progress_percent?: number;
    reason_code?: string | null;
    message?: string | null;
    firmware_version?: string | null;
    checksum?: string | null;
    extra?: Record<string, unknown> | null;
  }) {
    const upgradeToken = asString(body.upgrade_token);
    const jobItemId = asString(body.job_item_id);
    if (!upgradeToken && !jobItemId) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'upgrade_token 或 job_item_id 不能为空');
    }

    return this.db.withTransaction(async (client) => {
      const result = await this.db.query<Record<string, any>>(
        `
        select *
        from device_upgrade_job_item
        where tenant_id = $1
          and (
            ($2 <> '' and upgrade_token = $2)
            or ($3 <> '' and id = $3::uuid)
          )
        limit 1
        `,
        [TENANT_ID, upgradeToken, jobItemId],
        client
      );
      const row = result.rows[0];
      if (!row) {
        throw new NotFoundException('升级明细不存在');
      }

      const item = this.mapJobItemRow(row);
      if (body.imei && asString(body.imei) && asString(body.imei) !== item.imei) {
        throw appException(HttpStatus.CONFLICT, 'IMEI_MISMATCH', '设备 IMEI 与升级明细不匹配');
      }

      const stage = this.normalizeUpgradeItemStage(body.stage);
      const nextStatus = this.deriveUpgradeItemStatus({
        stage,
        result: body.result,
        commandAccepted: stage === 'command_acked',
      });
      const detail = {
        ...asObject(item.detail_json),
        firmware_version: asString(body.firmware_version) || asObject(item.detail_json).firmware_version || null,
        checksum: asString(body.checksum) || asObject(item.detail_json).checksum || null,
        extra: asObject(body.extra),
      };

      await this.db.query(
        `
        update device_upgrade_job_item
        set status = $3,
            stage = $4,
            progress_percent = $5,
            last_error_code = $6,
            last_error_message = $7,
            detail_json = $8::jsonb,
            last_reported_at = now(),
            updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          item.id,
          nextStatus,
          stage,
          sanitizePercent(body.progress_percent ?? item.progress_percent),
          asString(body.reason_code) || null,
          asString(body.message) || null,
          JSON.stringify(detail),
        ],
        client
      );

      await this.refreshJobAggregate(item.job_id, client);
      const refreshed = await this.getJobDetail(item.job_id, client);
      return refreshed;
    });
  }

  async retryRemoteJob(jobId: string) {
    return this.db.withTransaction(async (client) => {
      const updated = await this.db.query<Record<string, any>>(
        `
        update device_upgrade_job
        set status = 'pending',
            updated_at = now()
        where tenant_id = $1 and id = $2
        returning id
        `,
        [TENANT_ID, jobId],
        client
      );
      if (!updated.rows[0]) {
        throw new NotFoundException('升级任务不存在');
      }

      await this.db.query(
        `
        update device_upgrade_job_item
        set status = 'pending',
            stage = 'pending',
            progress_percent = 0,
            command_id = null,
            command_token = null,
            last_error_code = null,
            last_error_message = null,
            updated_at = now()
        where tenant_id = $1 and job_id = $2 and status in ('failed', 'cancelled')
        `,
        [TENANT_ID, jobId],
        client
      );

      await this.refreshJobAggregate(jobId, client);
      return this.getJobDetail(jobId, client);
    });
  }

  async retryJob(jobId: string) {
    const updated = await this.db.query<Record<string, any>>(
      `
      update device_upgrade_job
      set status = 'pending',
          updated_at = now()
      where tenant_id = $1 and id = $2
      returning id
      `,
      [TENANT_ID, jobId]
    );
    if (!updated.rows[0]) {
      throw new NotFoundException('升级任务不存在');
    }
    const jobs = await this.listJobs(1, 200);
    return jobs.items.find((item) => item.id === jobId) ?? null;
  }
}

@Controller('firmware')
class FirmwareController {
  constructor(private readonly service: FirmwareService) {}

  @Get('releases')
  async listReleases(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return ok(await this.service.listReleases(parsePage(page), parsePageSize(pageSize)));
  }

  @Post('releases')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'binary_file', maxCount: 1 },
      { name: 'source_file', maxCount: 1 },
      { name: 'document_files', maxCount: 6 },
    ])
  )
  async createRelease(
    @UploadedFiles()
    files: {
      binary_file?: UploadFile[];
      source_file?: UploadFile[];
      document_files?: UploadFile[];
    },
    @Body() body?: Record<string, unknown>
  ) {
    return ok(await this.service.createRelease(body ?? {}, files));
  }

  @Post('releases/:id/artifacts')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'binary_file', maxCount: 1 },
      { name: 'source_file', maxCount: 1 },
      { name: 'document_files', maxCount: 6 },
    ])
  )
  async addArtifacts(
    @Param('id') id: string,
    @UploadedFiles()
    files: {
      binary_file?: UploadFile[];
      source_file?: UploadFile[];
      document_files?: UploadFile[];
    }
  ) {
    return ok(await this.service.addArtifacts(id, files));
  }

  @Post('releases/bootstrap-scan-controller-baseline')
  async bootstrapScanControllerBaseline() {
    return ok(await this.service.bootstrapScanControllerBaseline());
  }

  @Get('artifacts/:id/download')
  async downloadArtifact(@Param('id') id: string, @Res({ passthrough: true }) res?: Response) {
    const file = await this.service.downloadArtifact(id);
    res?.setHeader('Content-Type', file.content_type);
    res?.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    return new StreamableFile(fs.createReadStream(file.absolute_path));
  }

  @Get('upgrade-jobs')
  async listJobs(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return ok(await this.service.listJobs(parsePage(page), parsePageSize(pageSize)));
  }

  @Get('upgrade-jobs/:id')
  async jobDetail(@Param('id') id: string) {
    return ok(await this.service.getJobDetail(id));
  }

  @Get('upgrade-jobs/:id/items')
  async jobItems(@Param('id') id: string) {
    const detail = await this.service.getJobDetail(id);
    return ok(detail.items ?? []);
  }

  @Post('upgrade-jobs/single')
  async upgradeSingle(@Body() body?: { device_id?: string; release_id?: string; auto_dispatch?: boolean | string | number }) {
    return ok(await this.service.upgradeSingle(body ?? {}));
  }

  @Post('upgrade-jobs/batch')
  async upgradeBatch(
    @Body()
    body?: {
      device_type_id?: string;
      release_id?: string;
      project_name?: string | null;
      block_name?: string | null;
      batch_strategy?: string | null;
      auto_dispatch?: boolean | string | number;
    }
  ) {
    return ok(await this.service.upgradeBatch(body ?? {}));
  }

  @Post('upgrade-jobs/:id/dispatch')
  async dispatchJob(@Param('id') id: string) {
    return ok(await this.service.dispatchJob(id));
  }

  @Post('upgrade-jobs/:id/retry')
  async retryJob(@Param('id') id: string) {
    return ok(await this.service.retryRemoteJob(id));
  }

  @Post('device-upgrade-reports')
  async reportDeviceUpgrade(
    @Body()
    body?: {
      upgrade_token?: string;
      job_item_id?: string;
      imei?: string;
      stage?: string;
      result?: string;
      progress_percent?: number;
      reason_code?: string | null;
      message?: string | null;
      firmware_version?: string | null;
      checksum?: string | null;
      extra?: Record<string, unknown> | null;
    }
  ) {
    return ok(await this.service.reportDeviceUpgrade(body ?? {}));
  }
}

@Module({
  imports: [DeviceGatewayModule],
  controllers: [FirmwareController],
  providers: [FirmwareService],
})
export class FirmwareModule {}
