import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ArchiveService } from '../../common/archive/archive.service';
import { DatabaseService } from '../../common/db/database.service';
import {
  buildSpatialLocationReadModelDevice,
  resolveEffectiveLocation,
  type SpatialLocationReadModelV1
} from '../../common/location/effective-location';
import { assertNoForbiddenSpatialWriteKeys } from '../../common/location/spatial-location-semantics';
import { DeviceLedgerRepository, type LedgerDeviceRow, PHASE1_TENANT_ID } from './device-ledger.repository';

export type LedgerDeviceWithLocation = LedgerDeviceRow & {
  map_display_latitude: number | null;
  map_display_longitude: number | null;
  location_read_model: SpatialLocationReadModelV1;
  sn: string;
  name: string;
  type: string;
  area: string | null;
  well: string | null;
};

export interface CreateLedgerDeviceBody {
  device_code: string;
  device_name: string;
  device_type: string;
  asset_id: string;
  manual_region_id?: string | null;
  manual_address_text?: string | null;
  manual_latitude?: number | null;
  manual_longitude?: number | null;
  install_position_desc?: string | null;
  location_source_strategy?: string | null;
}

export interface UpdateLedgerDeviceBody {
  device_name?: string;
  device_type?: string;
  asset_id?: string;
  manual_region_id?: string | null;
  manual_address_text?: string | null;
  manual_latitude?: number | null;
  manual_longitude?: number | null;
  install_position_desc?: string | null;
  location_source_strategy?: string | null;
}

export interface ArchiveLedgerDeviceBody {
  archive_reason?: string;
  reason_text?: string | null;
  trigger_type?: string;
  source_module?: string;
  source_action?: string;
  ui_entry?: string | null;
  request_id?: string | null;
  batch_id?: string | null;
  operator_id?: string | null;
  operator_name?: string | null;
}

function buildReleasedArchivedDeviceCode(deviceCode: string, id: string): string {
  const suffix = `-ARC-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const base = (deviceCode || 'DEVICE').slice(0, Math.max(1, 64 - suffix.length));
  return `${base}${suffix}`;
}

@Injectable()
export class DeviceLedgerService {
  constructor(
    private readonly repo: DeviceLedgerRepository,
    private readonly db: DatabaseService,
    private readonly archiveService: ArchiveService,
  ) {}

  private tenant(): string {
    return PHASE1_TENANT_ID;
  }

  private enrichLocation(row: LedgerDeviceRow): LedgerDeviceWithLocation {
    const eff = resolveEffectiveLocation({
      strategy: row.location_source_strategy,
      manual: { lat: row.manual_latitude, lng: row.manual_longitude },
      reported: { lat: row.reported_latitude, lng: row.reported_longitude }
    });
    const effective_latitude = eff.lat;
    const effective_longitude = eff.lng;
    const effective_location_source = eff.source === 'none' ? null : eff.source;
    return {
      ...row,
      effective_latitude,
      effective_longitude,
      effective_location_source,
      sn: row.device_code,
      name: row.device_name,
      type: row.device_type,
      area: row.region_name,
      well: row.asset_name ?? row.project_name ?? null,
      map_display_latitude: effective_latitude,
      map_display_longitude: effective_longitude,
      location_read_model: buildSpatialLocationReadModelDevice({
        ...row,
        effective_latitude,
        effective_longitude,
        effective_location_source
      })
    };
  }

  async list(params: {
    page: number;
    pageSize: number;
    projectId?: string;
    assetId?: string;
    deviceTypeId?: string;
    q?: string;
  }) {
    const { items, total } = await this.repo.findMany({
      tenantId: this.tenant(),
      ...params
    });
    return { items: items.map((r) => this.enrichLocation(r)), total };
  }

  async getById(id: string) {
    const row = await this.repo.findById(this.tenant(), id);
    if (!row) throw new NotFoundException('device not found');
    return this.enrichLocation(row);
  }

  async create(body: CreateLedgerDeviceBody) {
    assertNoForbiddenSpatialWriteKeys(body as unknown as Record<string, unknown>);
    const tid = this.tenant();
    const typeId = await this.repo.resolveDeviceTypeId(tid, body.device_type);
    if (!typeId) throw new BadRequestException('device_type not found');

    const regionId = await this.repo.resolveRegionIdForAsset(tid, body.asset_id);
    if (!regionId) throw new BadRequestException('asset not found or region not resolvable');

    const ext: Record<string, unknown> = {};
    if (body.manual_region_id !== undefined) ext.manual_region_id = body.manual_region_id;
    if (body.manual_address_text !== undefined) ext.manual_address_text = body.manual_address_text;
    if (body.manual_latitude !== undefined) ext.manual_latitude = body.manual_latitude;
    if (body.manual_longitude !== undefined) ext.manual_longitude = body.manual_longitude;
    if (body.install_position_desc !== undefined) ext.install_position_desc = body.install_position_desc;
    if (body.location_source_strategy !== undefined) ext.location_source_strategy = body.location_source_strategy;

    const created = await this.repo.insertDevice({
      tenantId: tid,
      deviceTypeId: typeId,
      regionId,
      deviceCode: body.device_code,
      deviceName: body.device_name,
      assetId: body.asset_id,
      extPatch: ext
    });
    return this.getById(created.id);
  }

  async update(id: string, body: UpdateLedgerDeviceBody) {
    assertNoForbiddenSpatialWriteKeys(body as unknown as Record<string, unknown>);
    const tid = this.tenant();
    const existing = await this.repo.findById(tid, id);
    if (!existing) throw new NotFoundException('device not found');

    let deviceTypeId: string | undefined;
    if (body.device_type !== undefined) {
      const resolved = await this.repo.resolveDeviceTypeId(tid, body.device_type);
      if (!resolved) throw new BadRequestException('device_type not found');
      deviceTypeId = resolved;
    }

    let regionId: string | undefined;
    let assetId: string | undefined;
    if (body.asset_id !== undefined) {
      assetId = body.asset_id;
      if (body.asset_id !== existing.asset_id) {
        const r = await this.repo.resolveRegionIdForAsset(tid, body.asset_id);
        if (!r) throw new BadRequestException('asset not found or region not resolvable');
        regionId = r;
      }
    }

    const extMerge: Record<string, unknown> = {};
    if (body.manual_region_id !== undefined) extMerge.manual_region_id = body.manual_region_id;
    if (body.manual_address_text !== undefined) extMerge.manual_address_text = body.manual_address_text;
    if (body.manual_latitude !== undefined) extMerge.manual_latitude = body.manual_latitude;
    if (body.manual_longitude !== undefined) extMerge.manual_longitude = body.manual_longitude;
    if (body.install_position_desc !== undefined) extMerge.install_position_desc = body.install_position_desc;
    if (body.location_source_strategy !== undefined) extMerge.location_source_strategy = body.location_source_strategy;

    await this.repo.updateDevice(tid, id, {
      deviceName: body.device_name,
      deviceTypeId,
      assetId,
      regionId,
      extMerge
    });
    return this.getById(id);
  }

  async remove(id: string) {
    return this.archive(id, {
      archive_reason: 'manual_remove',
      reason_text: 'Archived from device ledger delete flow',
      trigger_type: 'manual_delete',
      source_module: 'device-ledger',
      source_action: 'DELETE /devices/:id',
      ui_entry: 'device_ledger.detail',
    });
  }

  async archive(id: string, body: ArchiveLedgerDeviceBody = {}) {
    const tenantId = this.tenant();
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) throw new NotFoundException('device not found');

    const releasedCode = buildReleasedArchivedDeviceCode(existing.device_code, existing.id);

    const archiveMeta = await this.db.withTransaction(async (client) => {
      const fresh = await this.repo.findById(tenantId, id, client);
      if (!fresh) {
        throw new NotFoundException('device not found');
      }

      const archiveResult = await this.archiveService.archiveDevice(
        {
          tenantId,
          originId: fresh.id,
          originCode: fresh.device_code,
          entityName: fresh.device_name,
          releasedCode,
          archiveReason: body.archive_reason?.trim() || 'manual_remove',
          reasonText: body.reason_text?.trim() || 'Archived from device ledger delete flow',
          triggerType: body.trigger_type?.trim() || 'manual_delete',
          sourceModule: body.source_module?.trim() || 'device-ledger',
          sourceAction: body.source_action?.trim() || 'DELETE /devices/:id',
          uiEntry: body.ui_entry?.trim() || 'device_ledger.detail',
          requestId: body.request_id?.trim() || null,
          batchId: body.batch_id?.trim() || null,
          operatorId: body.operator_id?.trim() || null,
          operatorName: body.operator_name?.trim() || null,
          snapshot: this.enrichLocation(fresh),
        },
        client,
      );

      const ok = await this.repo.archiveAndRelease(tenantId, id, releasedCode, client);
      if (!ok) throw new BadRequestException('device cannot be archived in current state');

      return archiveResult;
    });

    return { id, archive_id: archiveMeta.archiveId };
  }

  /**
   * Read-only display status aligned with `device-ledger.repository` list CASE
   * (`online` | `offline` | `alarm`). Not a persisted column.
   */
  displayStatusOptions() {
    return [
      { value: 'online', label: '在线' },
      { value: 'offline', label: '离线' },
      { value: 'alarm', label: '告警' }
    ];
  }

  /** Canonical keys for `ext_json.location_source_strategy` and asset defaults. */
  locationSourceStrategyOptions() {
    return [
      { value: 'manual_preferred', label: '优先使用人工位置' },
      { value: 'reported_preferred', label: '优先使用上报位置' },
      { value: 'manual_only', label: '仅使用人工位置' },
      { value: 'reported_only', label: '仅使用上报位置' },
      { value: 'auto', label: '自动（上报优先）' }
    ];
  }

  /** Canonical keys for `ext_json.comm_identity_type`. */
  commIdentityTypeOptions() {
    return [
      { value: 'imei', label: 'IMEI' },
      { value: 'iccid', label: 'ICCID' },
      { value: 'mac', label: 'MAC 地址' },
      { value: 'serial', label: '序列号' },
      { value: 'custom', label: '自定义' }
    ];
  }
}
