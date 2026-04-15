import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';

export const PHASE1_TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** Raw row from list/detail SQL; effective_* filled in DeviceLedgerService.enrichLocation. */
export interface LedgerDeviceRow {
  id: string;
  device_code: string;
  device_name: string;
  device_type_code: string | null;
  device_type: string;
  device_family: string | null;
  asset_id: string | null;
  asset_name: string | null;
  project_id: string | null;
  project_name: string | null;
  block_id: string | null;
  source_module: string | null;
  source_node_code: string | null;
  source_unit_code: string | null;
  region_name: string | null;
  status: 'online' | 'offline' | 'alarm';
  last_report: string | null;
  protocol_type: string | null;
  protocol_version: string | null;
  online_state: string | null;
  connection_state: string | null;
  lifecycle_state: string | null;
  runtime_state: string | null;
  comm_identity_type: string | null;
  comm_identity_value: string | null;
  imei: string | null;
  chip_sn: string | null;
  iccid: string | null;
  module_model: string | null;
  software_family: string | null;
  software_version: string | null;
  firmware_version: string | null;
  hardware_sku: string | null;
  hardware_rev: string | null;
  firmware_family: string | null;
  meter_protocol: string | null;
  control_protocol: string | null;
  controller_role: string | null;
  deployment_mode: string | null;
  config_version: number | null;
  capability_version: number | null;
  capability_hash: string | null;
  config_bitmap: string | null;
  actions_bitmap: string | null;
  queries_bitmap: string | null;
  capability_limits: Record<string, unknown> | null;
  feature_modules: unknown[] | null;
  resource_inventory: Record<string, unknown> | null;
  control_config: Record<string, unknown> | null;
  channel_bindings: unknown[] | null;
  runtime_rules: Record<string, unknown> | null;
  last_register_payload: Record<string, unknown> | null;
  auto_identified: boolean | null;
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
  type_capability_json: Record<string, unknown> | null;
  type_default_config_json: Record<string, unknown> | null;
  type_form_schema_json: Record<string, unknown> | null;
}

@Injectable()
export class DeviceLedgerRepository {
  constructor(private readonly db: DatabaseService) {}

  private displayStatusSql(): string {
    return `
      case
        when exists (
          select 1 from alarm_event ae
          where ae.device_id = d.id and ae.status in ('open', 'processing')
        ) then 'alarm'
        when d.lifecycle_state = 'active' and d.online_state = 'online' then 'online'
        else 'offline'
      end
    `;
  }

  private baseSelect(): string {
    return `
      select
        d.id,
        d.device_code,
        d.device_name,
        dt.type_code as device_type_code,
        dt.type_name as device_type,
        dt.family as device_family,
        a.id::text as asset_id,
        a.asset_name as asset_name,
        coalesce(a.project_id::text, nullif(d.ext_json->>'project_id', '')) as project_id,
        coalesce(p.project_name, pj.project_name) as project_name,
        nullif(d.ext_json->>'block_id', '') as block_id,
        nullif(d.ext_json->>'source_module', '') as source_module,
        nullif(d.ext_json->>'source_node_code', '') as source_node_code,
        nullif(d.ext_json->>'source_unit_code', '') as source_unit_code,
        r.region_name as region_name,
        ${this.displayStatusSql()} as status,
        to_char(coalesce(d.last_heartbeat_at, d.created_at) at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as last_report,
        d.protocol_type as protocol_type,
        d.protocol_version as protocol_version,
        d.online_state as online_state,
        d.connection_state as connection_state,
        d.lifecycle_state as lifecycle_state,
        d.runtime_state as runtime_state,
        coalesce(d.ext_json->>'comm_identity_type', null) as comm_identity_type,
        coalesce(d.ext_json->>'comm_identity_value', null) as comm_identity_value,
        d.imei as imei,
        coalesce(d.ext_json->>'chip_sn', null) as chip_sn,
        coalesce(d.ext_json->>'iccid', null) as iccid,
        coalesce(d.ext_json->>'module_model', null) as module_model,
        coalesce(d.ext_json->>'software_family', null) as software_family,
        coalesce(d.ext_json->>'software_version', null) as software_version,
        coalesce(d.ext_json->>'firmware_version', null) as firmware_version,
        coalesce(d.ext_json->>'hardware_sku', null) as hardware_sku,
        coalesce(d.ext_json->>'hardware_rev', null) as hardware_rev,
        coalesce(d.ext_json->>'firmware_family', null) as firmware_family,
        coalesce(d.ext_json->>'meter_protocol', null) as meter_protocol,
        coalesce(d.ext_json->>'control_protocol', null) as control_protocol,
        coalesce(d.ext_json->>'controller_role', null) as controller_role,
        coalesce(d.ext_json->>'deployment_mode', null) as deployment_mode,
        coalesce((d.ext_json->>'config_version')::int, null) as config_version,
        coalesce((d.ext_json->>'capability_version')::int, null) as capability_version,
        coalesce(d.ext_json->>'capability_hash', null) as capability_hash,
        coalesce(d.ext_json->>'config_bitmap', null) as config_bitmap,
        coalesce(d.ext_json->>'actions_bitmap', null) as actions_bitmap,
        coalesce(d.ext_json->>'queries_bitmap', null) as queries_bitmap,
        coalesce(d.ext_json->'capability_limits', '{}'::jsonb) as capability_limits,
        coalesce(d.ext_json->'feature_modules', '[]'::jsonb) as feature_modules,
        coalesce(d.ext_json->'resource_inventory', '{}'::jsonb) as resource_inventory,
        coalesce(d.ext_json->'control_config', '{}'::jsonb) as control_config,
        coalesce(d.ext_json->'channel_bindings', '[]'::jsonb) as channel_bindings,
        coalesce(d.ext_json->'runtime_rules', '{}'::jsonb) as runtime_rules,
        coalesce(d.ext_json->'last_register_payload', '{}'::jsonb) as last_register_payload,
        coalesce((d.ext_json->>'auto_identified')::boolean, false) as auto_identified,
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
        null::text as effective_location_source,
        coalesce(dt.capability_json, '{}'::jsonb) as type_capability_json,
        coalesce(dt.default_config_json, '{}'::jsonb) as type_default_config_json,
        coalesce(dt.form_schema_json, '{}'::jsonb) as type_form_schema_json
      from device d
      join device_type dt on dt.id = d.device_type_id
      join region r on r.id = d.region_id
      left join asset a on a.id = d.asset_id
      left join project p on p.id = a.project_id
      left join project pj on pj.id::text = nullif(d.ext_json->>'project_id', '')
    `;
  }

  async findMany(params: {
    tenantId: string;
    page: number;
    pageSize: number;
    projectId?: string;
    blockId?: string;
    assetId?: string;
    deviceTypeId?: string;
    displayStatus?: 'online' | 'offline' | 'alarm';
    q?: string;
  }): Promise<{ items: LedgerDeviceRow[]; total: number }> {
    const { tenantId, page, pageSize, projectId, blockId, assetId, deviceTypeId, displayStatus, q } = params;
    const offset = (page - 1) * pageSize;
    const conds: string[] = ['d.tenant_id = $1', `d.lifecycle_state <> 'archived'`];
    const args: unknown[] = [tenantId];
    let p = 2;

    if (projectId) {
      conds.push(`coalesce(a.project_id::text, nullif(d.ext_json->>'project_id', '')) = $${p}`);
      args.push(projectId);
      p++;
    }
    if (blockId) {
      conds.push(`nullif(d.ext_json->>'block_id', '') = $${p}`);
      args.push(blockId);
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
    if (displayStatus) {
      conds.push(`(${this.displayStatusSql()}) = $${p}`);
      args.push(displayStatus);
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

  async findById(tenantId: string, id: string, client?: PoolClient): Promise<LedgerDeviceRow | null> {
    const result = await this.db.query<LedgerDeviceRow>(
      `${this.baseSelect()}
       where d.tenant_id = $1 and d.id = $2 and d.lifecycle_state <> 'archived'`,
      [tenantId, id],
      client,
    );
    return result.rows[0] ?? null;
  }

  async resolveDeviceTypeId(tenantId: string, deviceType: string): Promise<string | null> {
    const normalized = deviceType.trim();
    const isUuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized);
    if (isUuidLike) {
      const r = await this.db.query<{ id: string }>(
        `select id from device_type where tenant_id = $1 and id = $2`,
        [tenantId, normalized]
      );
      return r.rows[0]?.id ?? null;
    }
    const r = await this.db.query<{ id: string }>(
      `select id from device_type where tenant_id = $1 and (type_code = $2 or type_name = $2) limit 1`,
      [tenantId, normalized]
    );
    return r.rows[0]?.id ?? null;
  }

  async resolveRegionIdForAsset(tenantId: string, assetId: string): Promise<string | null> {
    const r = await this.db.query<{ region_id: string }>(
      `
      select coalesce(rr.id, p.region_id) as region_id
      from asset a
      join project p on p.id = a.project_id
      left join lateral (
        select r.id
        from region r
        where r.tenant_id = a.tenant_id
          and (
            r.region_code = nullif(a.manual_region_id, '')
            or r.id::text = nullif(a.manual_region_id, '')
          )
        limit 1
      ) rr on true
      where a.tenant_id = $1 and a.id = $2
      `,
      [tenantId, assetId]
    );
    return r.rows[0]?.region_id ?? null;
  }

  async resolveRegionIdForProject(tenantId: string, projectId: string): Promise<string | null> {
    const result = await this.db.query<{ region_id: string }>(
      `
      select region_id
      from project
      where tenant_id = $1 and id = $2
      `,
      [tenantId, projectId],
    );
    return result.rows[0]?.region_id ?? null;
  }

  async insertDevice(input: {
    tenantId: string;
    deviceTypeId: string;
    regionId: string;
    deviceCode: string;
    deviceName: string;
    imei?: string | null;
    assetId: string | null;
    extPatch: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const r = await this.db.query<{ id: string }>(
      `
      insert into device (
        tenant_id, device_type_id, region_id, device_code, device_name,
        serial_no, imei, protocol_type, online_state, lifecycle_state, runtime_state,
        asset_id, ext_json, created_at, updated_at
      )
      values (
        $1, $2, $3, $4, $5,
        $6, $7, $8, 'unknown', 'draft', 'idle',
        $9, $10::jsonb, now(), now()
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
        input.imei ?? null,
        input.imei ? 'hj-device-v2' : 'modbus',
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
      imei?: string | null;
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
    if (patch.imei !== undefined) {
      sets.push(`imei = $${i}`);
      args.push(patch.imei);
      i++;
      if (patch.imei) {
        sets.push(`protocol_type = $${i}`);
        args.push('hj-device-v2');
        i++;
      }
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

  /**
   * Archive device in-place while releasing online business constraints:
   * - lifecycle_state := archived
   * - device_code / serial_no rewritten to a tombstone code
   * - asset_id nulled so archived rows stop blocking asset cleanup
   */
  async archiveAndRelease(tenantId: string, id: string, releasedCode: string, client?: PoolClient): Promise<boolean> {
    const r = await this.db.query(
      `
      update device
      set
        lifecycle_state = 'archived',
        device_code = $3::varchar,
        serial_no = $4::varchar,
        asset_id = null,
        updated_at = now(),
        ext_json = coalesce(ext_json, '{}'::jsonb) || jsonb_build_object(
          'archive_origin_device_code', device_code,
          'archive_released_code', $5::text,
          'archived_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      where tenant_id = $1 and id = $2
        and lifecycle_state <> 'archived'
      `,
      [tenantId, id, releasedCode, releasedCode, releasedCode],
      client,
    );
    return (r.rowCount ?? 0) > 0;
  }
}
