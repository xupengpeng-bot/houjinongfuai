import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';

export const PHASE1_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** Raw row from list/detail SQL; effective_* filled in DeviceLedgerService.enrichLocation. */
export interface LedgerDeviceRow {
  id: string;
  device_code: string;
  device_name: string;
  device_type: string;
  asset_id: string | null;
  asset_name: string | null;
  project_name: string | null;
  region_name: string | null;
  status: 'online' | 'offline' | 'alarm';
  last_report: string | null;
  comm_identity_type: string | null;
  comm_identity_value: string | null;
  imei: string | null;
  chip_sn: string | null;
  iccid: string | null;
  module_model: string | null;
  firmware_version: string | null;
  manual_region_id: string | null;
  manual_address_text: string | null;
  manual_latitude: number | null;
  manual_longitude: number | null;
  install_position_desc: string | null;
  location_source_strategy: string | null;
  reported_latitude: number | null;
  reported_longitude: number | null;
  reported_at: string | null;
  reported_source: string | null;
  /** Resolved in service from manual/reported + strategy — not from ext_json alone. */
  effective_latitude: number | null;
  effective_longitude: number | null;
  effective_location_source: string | null;
}

@Injectable()
export class DeviceLedgerRepository {
  constructor(private readonly db: DatabaseService) {}

  private baseSelect(): string {
    return `
      select
        d.id,
        d.device_code,
        d.device_name,
        dt.type_name as device_type,
        a.id::text as asset_id,
        a.asset_name as asset_name,
        p.project_name as project_name,
        r.region_name as region_name,
        case
          when exists (
            select 1 from alarm_event ae
            where ae.device_id = d.id and ae.status in ('open', 'processing')
          ) then 'alarm'
          when d.lifecycle_state = 'active' and d.online_state = 'online' then 'online'
          else 'offline'
        end as status,
        to_char(coalesce(d.last_heartbeat_at, d.created_at) at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as last_report,
        coalesce(d.ext_json->>'comm_identity_type', null) as comm_identity_type,
        coalesce(d.ext_json->>'comm_identity_value', null) as comm_identity_value,
        d.imei as imei,
        coalesce(d.ext_json->>'chip_sn', null) as chip_sn,
        coalesce(d.ext_json->>'iccid', null) as iccid,
        coalesce(d.ext_json->>'module_model', null) as module_model,
        coalesce(d.ext_json->>'firmware_version', null) as firmware_version,
        coalesce(d.ext_json->>'manual_region_id', a.manual_region_id::text, null) as manual_region_id,
        coalesce(d.ext_json->>'manual_address_text', a.manual_address_text, null) as manual_address_text,
        coalesce((d.ext_json->>'manual_latitude')::numeric, a.manual_latitude, null) as manual_latitude,
        coalesce((d.ext_json->>'manual_longitude')::numeric, a.manual_longitude, null) as manual_longitude,
        coalesce(d.ext_json->>'install_position_desc', a.install_position_desc, null) as install_position_desc,
        coalesce(d.ext_json->>'location_source_strategy', a.location_source_strategy, null) as location_source_strategy,
        coalesce((d.ext_json->>'reported_latitude')::numeric, a.reported_latitude, null) as reported_latitude,
        coalesce((d.ext_json->>'reported_longitude')::numeric, a.reported_longitude, null) as reported_longitude,
        coalesce(d.ext_json->>'reported_at', a.reported_at::text, null) as reported_at,
        coalesce(d.ext_json->>'reported_source', a.reported_source, null) as reported_source,
        null::float8 as effective_latitude,
        null::float8 as effective_longitude,
        null::text as effective_location_source
      from device d
      join device_type dt on dt.id = d.device_type_id
      join region r on r.id = d.region_id
      left join asset a on a.id = d.asset_id
      left join project p on p.id = a.project_id
    `;
  }

  async findMany(params: {
    tenantId: string;
    page: number;
    pageSize: number;
    projectId?: string;
    assetId?: string;
    deviceTypeId?: string;
    q?: string;
  }): Promise<{ items: LedgerDeviceRow[]; total: number }> {
    const { tenantId, page, pageSize, projectId, assetId, deviceTypeId, q } = params;
    const offset = (page - 1) * pageSize;
    const conds: string[] = ['d.tenant_id = $1'];
    const args: unknown[] = [tenantId];
    let p = 2;

    if (projectId) {
      conds.push(`a.project_id = $${p}`);
      args.push(projectId);
      p++;
    }
    if (assetId) {
      conds.push(`d.asset_id = $${p}`);
      args.push(assetId);
      p++;
    }
    if (deviceTypeId) {
      conds.push(`d.device_type_id = $${p}`);
      args.push(deviceTypeId);
      p++;
    }
    if (q && q.trim()) {
      conds.push(
        `(d.device_name ilike $${p} or d.device_code ilike $${p} or coalesce(d.imei,'') ilike $${p} or coalesce(d.serial_no,'') ilike $${p})`
      );
      args.push(`%${q.trim()}%`);
      p++;
    }

    const where = conds.length ? `where ${conds.join(' and ')}` : '';

    const countSql = `
      select count(*)::int as c
      from device d
      left join asset a on a.id = d.asset_id
      ${where}
    `;
    const countRes = await this.db.query<{ c: number }>(countSql, args);
    const total = countRes.rows[0]?.c ?? 0;

    const listSql = `
      ${this.baseSelect()}
      ${where}
      order by d.created_at desc
      limit $${p} offset $${p + 1}
    `;
    args.push(pageSize, offset);
    const result = await this.db.query<LedgerDeviceRow>(listSql, args);
    return { items: result.rows, total };
  }

  async findById(tenantId: string, id: string): Promise<LedgerDeviceRow | null> {
    const result = await this.db.query<LedgerDeviceRow>(
      `${this.baseSelect()}
       where d.tenant_id = $1 and d.id = $2`,
      [tenantId, id]
    );
    return result.rows[0] ?? null;
  }

  async resolveDeviceTypeId(tenantId: string, deviceType: string): Promise<string | null> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceType);
    if (isUuid) {
      const r = await this.db.query<{ id: string }>(
        `select id from device_type where tenant_id = $1 and id = $2`,
        [tenantId, deviceType]
      );
      return r.rows[0]?.id ?? null;
    }
    const r = await this.db.query<{ id: string }>(
      `select id from device_type where tenant_id = $1 and (type_code = $2 or type_name = $2) limit 1`,
      [tenantId, deviceType]
    );
    return r.rows[0]?.id ?? null;
  }

  async resolveRegionIdForAsset(tenantId: string, assetId: string): Promise<string | null> {
    const r = await this.db.query<{ region_id: string }>(
      `
      select coalesce(a.manual_region_id, p.region_id) as region_id
      from asset a
      join project p on p.id = a.project_id
      where a.tenant_id = $1 and a.id = $2
      `,
      [tenantId, assetId]
    );
    return r.rows[0]?.region_id ?? null;
  }

  async insertDevice(input: {
    tenantId: string;
    deviceTypeId: string;
    regionId: string;
    deviceCode: string;
    deviceName: string;
    assetId: string | null;
    extPatch: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const r = await this.db.query<{ id: string }>(
      `
      insert into device (
        tenant_id, device_type_id, region_id, device_code, device_name,
        serial_no, protocol_type, online_state, lifecycle_state, runtime_state,
        asset_id, ext_json, created_at, updated_at
      )
      values (
        $1, $2, $3, $4, $5,
        $6, 'modbus', 'unknown', 'draft', 'idle',
        $7, $8::jsonb, now(), now()
      )
      returning id
      `,
      [
        input.tenantId,
        input.deviceTypeId,
        input.regionId,
        input.deviceCode,
        input.deviceName,
        input.deviceCode,
        input.assetId,
        JSON.stringify(input.extPatch)
      ]
    );
    return r.rows[0]!;
  }

  async updateDevice(
    tenantId: string,
    id: string,
    patch: {
      deviceName?: string;
      deviceTypeId?: string;
      assetId?: string | null;
      regionId?: string;
      extMerge: Record<string, unknown>;
    }
  ): Promise<boolean> {
    const sets: string[] = ['updated_at = now()'];
    const args: unknown[] = [];
    let i = 1;

    if (patch.deviceName !== undefined) {
      sets.push(`device_name = $${i}`);
      args.push(patch.deviceName);
      i++;
    }
    if (patch.deviceTypeId !== undefined) {
      sets.push(`device_type_id = $${i}`);
      args.push(patch.deviceTypeId);
      i++;
    }
    if (patch.assetId !== undefined) {
      sets.push(`asset_id = $${i}`);
      args.push(patch.assetId);
      i++;
    }
    if (patch.regionId !== undefined) {
      sets.push(`region_id = $${i}`);
      args.push(patch.regionId);
      i++;
    }
    if (Object.keys(patch.extMerge).length > 0) {
      sets.push(`ext_json = coalesce(ext_json, '{}'::jsonb) || $${i}::jsonb`);
      args.push(JSON.stringify(patch.extMerge));
      i++;
    }

    args.push(tenantId, id);
    const sql = `update device set ${sets.join(', ')} where tenant_id = $${i} and id = $${i + 1}`;
    const r = await this.db.query(sql, args);
    return r.rowCount !== null && r.rowCount > 0;
  }

  /** Only draft devices can be archived (conservative Phase 1 rule). */
  async softArchive(tenantId: string, id: string): Promise<boolean> {
    const r = await this.db.query(
      `
      update device
      set lifecycle_state = 'archived', updated_at = now()
      where tenant_id = $1 and id = $2
        and lifecycle_state = 'draft'
      `,
      [tenantId, id]
    );
    return (r.rowCount ?? 0) > 0;
  }
}
