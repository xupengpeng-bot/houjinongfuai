import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeviceLedgerRepository, PHASE1_TENANT_ID } from './device-ledger.repository';

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

@Injectable()
export class DeviceLedgerService {
  constructor(private readonly repo: DeviceLedgerRepository) {}

  private tenant(): string {
    return PHASE1_TENANT_ID;
  }

  async list(params: {
    page: number;
    pageSize: number;
    projectId?: string;
    assetId?: string;
    deviceTypeId?: string;
    q?: string;
  }) {
    return this.repo.findMany({
      tenantId: this.tenant(),
      ...params
    });
  }

  async getById(id: string) {
    const row = await this.repo.findById(this.tenant(), id);
    if (!row) throw new NotFoundException('device not found');
    return row;
  }

  async create(body: CreateLedgerDeviceBody) {
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
    const ok = await this.repo.softArchive(this.tenant(), id);
    if (!ok) throw new BadRequestException('device cannot be archived in current state');
    return { id };
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
      { value: 'reported_only', label: '仅使用上报位置' }
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
