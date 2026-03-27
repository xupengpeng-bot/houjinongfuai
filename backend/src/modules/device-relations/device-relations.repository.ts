import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';

export const PHASE1_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface DeviceRelationRow {
  id: string;
  source_device_id: string;
  source_device_name: string;
  source_device_type: string | null;
  target_device_id: string;
  target_device_name: string;
  target_device_type: string | null;
  relation_type: string;
  enabled: boolean;
  status: 'enabled' | 'disabled';
  priority: number | null;
  sequence_rule: string | null;
  delay_seconds: number | null;
  remarks: string | null;
}

@Injectable()
export class DeviceRelationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findMany(params: {
    tenantId: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: DeviceRelationRow[]; total: number }> {
    const { tenantId, page, pageSize } = params;
    const offset = (page - 1) * pageSize;

    const countRes = await this.db.query<{ c: number }>(
      `
      select count(*)::int as c
      from topology_relation tr
      where tr.tenant_id = $1
        and tr.source_type = 'device'
        and tr.target_type = 'device'
    `,
      [tenantId]
    );
    const total = countRes.rows[0]?.c ?? 0;

    const listRes = await this.db.query<DeviceRelationRow>(
      `
      select
        tr.id,
        tr.source_id as source_device_id,
        sd.device_name as source_device_name,
        dt_s.type_name as source_device_type,
        tr.target_id as target_device_id,
        td.device_name as target_device_name,
        dt_t.type_name as target_device_type,
        tr.relation_type,
        (tr.status = 'active') as enabled,
        case when tr.status = 'active' then 'enabled' else 'disabled' end as status,
        tr.priority,
        coalesce(tr.config_json->>'sequence_rule', null) as sequence_rule,
        coalesce((tr.config_json->>'delay_seconds')::int, null) as delay_seconds,
        coalesce(tr.config_json->>'remarks', null) as remarks
      from topology_relation tr
      join device sd on sd.id = tr.source_id
      join device td on td.id = tr.target_id
      join device_type dt_s on dt_s.id = sd.device_type_id
      join device_type dt_t on dt_t.id = td.device_type_id
      where tr.tenant_id = $1
        and tr.source_type = 'device'
        and tr.target_type = 'device'
      order by tr.priority desc, tr.created_at desc
      limit $2 offset $3
    `,
      [tenantId, pageSize, offset]
    );

    return { items: listRes.rows, total };
  }

  async findById(tenantId: string, id: string): Promise<DeviceRelationRow | null> {
    const result = await this.db.query<DeviceRelationRow>(
      `
      select
        tr.id,
        tr.source_id as source_device_id,
        sd.device_name as source_device_name,
        dt_s.type_name as source_device_type,
        tr.target_id as target_device_id,
        td.device_name as target_device_name,
        dt_t.type_name as target_device_type,
        tr.relation_type,
        (tr.status = 'active') as enabled,
        case when tr.status = 'active' then 'enabled' else 'disabled' end as status,
        tr.priority,
        coalesce(tr.config_json->>'sequence_rule', null) as sequence_rule,
        coalesce((tr.config_json->>'delay_seconds')::int, null) as delay_seconds,
        coalesce(tr.config_json->>'remarks', null) as remarks
      from topology_relation tr
      join device sd on sd.id = tr.source_id
      join device td on td.id = tr.target_id
      join device_type dt_s on dt_s.id = sd.device_type_id
      join device_type dt_t on dt_t.id = td.device_type_id
      where tr.tenant_id = $1 and tr.id = $2
        and tr.source_type = 'device'
        and tr.target_type = 'device'
    `,
      [tenantId, id]
    );
    return result.rows[0] ?? null;
  }

  async insert(input: {
    tenantId: string;
    sourceDeviceId: string;
    targetDeviceId: string;
    relationType: string;
    priority: number;
    status: string;
    config: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const r = await this.db.query<{ id: string }>(
      `
      insert into topology_relation (
        tenant_id, source_type, source_id, target_type, target_id,
        relation_type, priority, status, config_json
      )
      values ($1, 'device', $2, 'device', $3, $4, $5, $6, $7::jsonb)
      returning id
    `,
      [
        input.tenantId,
        input.sourceDeviceId,
        input.targetDeviceId,
        input.relationType,
        input.priority,
        input.status,
        JSON.stringify(input.config)
      ]
    );
    return r.rows[0]!;
  }

  async update(
    tenantId: string,
    id: string,
    patch: {
      sourceDeviceId?: string;
      targetDeviceId?: string;
      relationType?: string;
      priority?: number;
      status?: string;
      configMerge?: Record<string, unknown>;
    }
  ): Promise<boolean> {
    const mergeJson =
      patch.configMerge && Object.keys(patch.configMerge).length > 0
        ? JSON.stringify(patch.configMerge)
        : null;

    const r = await this.db.query(
      `
      update topology_relation
      set
        source_id = coalesce($3::uuid, source_id),
        target_id = coalesce($4::uuid, target_id),
        relation_type = coalesce($5, relation_type),
        priority = coalesce($6, priority),
        status = coalesce($7, status),
        config_json = case
          when $8::text is not null then coalesce(config_json, '{}'::jsonb) || $8::jsonb
          else config_json
        end,
        updated_at = now()
      where tenant_id = $1 and id = $2
        and source_type = 'device' and target_type = 'device'
    `,
      [
        tenantId,
        id,
        patch.sourceDeviceId ?? null,
        patch.targetDeviceId ?? null,
        patch.relationType ?? null,
        patch.priority ?? null,
        patch.status ?? null,
        mergeJson
      ]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const r = await this.db.query(`delete from topology_relation where tenant_id = $1 and id = $2`, [
      tenantId,
      id
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async listDeviceOptions(tenantId: string): Promise<
    Array<{
      value: string;
      label: string;
      device_type: string;
      device_type_code: string | null;
      asset_name: string;
    }>
  > {
    const result = await this.db.query(
      `
      select
        d.id as value,
        d.device_name as label,
        dt.type_name as device_type,
        dt.type_code as device_type_code,
        coalesce(a.asset_name, '') as asset_name
      from device d
      join device_type dt on dt.id = d.device_type_id
      left join asset a on a.id = d.asset_id
      where d.tenant_id = $1
        and d.lifecycle_state = 'active'
      order by d.device_name asc
    `,
      [tenantId]
    );
    return result.rows as Array<{
      value: string;
      label: string;
      device_type: string;
      device_type_code: string | null;
      asset_name: string;
    }>;
  }
}
