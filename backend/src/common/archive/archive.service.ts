import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../db/database.service';

type ArchiveContext = {
  tenantId: string;
  archiveReason: string;
  reasonText?: string | null;
  triggerType: string;
  sourceModule: string;
  sourceAction: string;
  uiEntry?: string | null;
  requestId?: string | null;
  batchId?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
};

type ArchiveOperationTarget = {
  archiveTable: 'device_archive' | 'asset_archive';
  originTable: 'device' | 'asset';
  originId: string;
  originCode: string | null;
  entityName: string | null;
  archiveRecordId: string;
  snapshot: unknown;
};

type DeviceArchivePayload = ArchiveContext & {
  originId: string;
  originCode: string;
  entityName: string | null;
  releasedCode: string;
  snapshot: unknown;
};

type AssetArchivePayload = ArchiveContext & {
  originId: string;
  originCode: string;
  entityName: string | null;
  snapshot: unknown;
};

@Injectable()
export class ArchiveService {
  constructor(private readonly db: DatabaseService) {}

  query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = [], client?: PoolClient) {
    return this.db.query<T>(sql, params, client);
  }

  private async insertArchiveOperation(
    target: ArchiveOperationTarget,
    context: ArchiveContext,
    client?: PoolClient,
  ): Promise<void> {
    await this.db.query(
      `
      insert into archive_operation_log (
        tenant_id,
        archive_table,
        archive_record_id,
        origin_table,
        origin_id,
        origin_code,
        entity_name,
        operation_type,
        trigger_type,
        archive_reason,
        reason_text,
        source_module,
        source_action,
        ui_entry,
        request_id,
        batch_id,
        operator_id,
        operator_name,
        snapshot_json
      ) values (
        $1, $2, $3, $4, $5, $6, $7, 'archive', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb
      )
      `,
      [
        context.tenantId,
        target.archiveTable,
        target.archiveRecordId,
        target.originTable,
        target.originId,
        target.originCode,
        target.entityName,
        context.triggerType,
        context.archiveReason,
        context.reasonText ?? null,
        context.sourceModule,
        context.sourceAction,
        context.uiEntry ?? null,
        context.requestId ?? null,
        context.batchId ?? null,
        context.operatorId ?? null,
        context.operatorName ?? null,
        JSON.stringify(target.snapshot ?? {}),
      ],
      client,
    );
  }

  async archiveDevice(payload: DeviceArchivePayload, client?: PoolClient): Promise<{ archiveId: string }> {
    const archiveResult = await this.db.query<{ id: string }>(
      `
      insert into device_archive (
        tenant_id,
        origin_device_id,
        origin_device_code,
        entity_name,
        released_device_code,
        archive_reason,
        reason_text,
        trigger_type,
        source_module,
        source_action,
        ui_entry,
        request_id,
        batch_id,
        operator_id,
        operator_name,
        snapshot_json
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
      )
      returning id
      `,
      [
        payload.tenantId,
        payload.originId,
        payload.originCode,
        payload.entityName,
        payload.releasedCode,
        payload.archiveReason,
        payload.reasonText ?? null,
        payload.triggerType,
        payload.sourceModule,
        payload.sourceAction,
        payload.uiEntry ?? null,
        payload.requestId ?? null,
        payload.batchId ?? null,
        payload.operatorId ?? null,
        payload.operatorName ?? null,
        JSON.stringify(payload.snapshot ?? {}),
      ],
      client,
    );
    const archiveId = archiveResult.rows[0].id;
    await this.insertArchiveOperation(
      {
        archiveTable: 'device_archive',
        archiveRecordId: archiveId,
        originTable: 'device',
        originId: payload.originId,
        originCode: payload.originCode,
        entityName: payload.entityName,
        snapshot: payload.snapshot,
      },
      payload,
      client,
    );
    return { archiveId };
  }

  async archiveAsset(payload: AssetArchivePayload, client?: PoolClient): Promise<{ archiveId: string }> {
    const archiveResult = await this.db.query<{ id: string }>(
      `
      insert into asset_archive (
        tenant_id,
        origin_asset_id,
        origin_asset_code,
        entity_name,
        archive_reason,
        reason_text,
        trigger_type,
        source_module,
        source_action,
        ui_entry,
        request_id,
        batch_id,
        operator_id,
        operator_name,
        snapshot_json
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb
      )
      returning id
      `,
      [
        payload.tenantId,
        payload.originId,
        payload.originCode,
        payload.entityName,
        payload.archiveReason,
        payload.reasonText ?? null,
        payload.triggerType,
        payload.sourceModule,
        payload.sourceAction,
        payload.uiEntry ?? null,
        payload.requestId ?? null,
        payload.batchId ?? null,
        payload.operatorId ?? null,
        payload.operatorName ?? null,
        JSON.stringify(payload.snapshot ?? {}),
      ],
      client,
    );
    const archiveId = archiveResult.rows[0].id;
    await this.insertArchiveOperation(
      {
        archiveTable: 'asset_archive',
        archiveRecordId: archiveId,
        originTable: 'asset',
        originId: payload.originId,
        originCode: payload.originCode,
        entityName: payload.entityName,
        snapshot: payload.snapshot,
      },
      payload,
      client,
    );
    return { archiveId };
  }
}
