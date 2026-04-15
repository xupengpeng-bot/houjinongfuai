import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { buildPumpValveTopologyRelationReadModel } from './pump-valve-topology-read-model';
import { PrimaryMeteringReadiness } from './topology.dto';
import { resolveEffectiveTopologyRelationTypeV1 } from './topology-relation-type-v1';

@Injectable()
export class TopologyRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<
    Array<{
      id: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      relationRole: string;
      well: string;
      pump: string;
      valve: string;
      sequence: string;
      valve_delay: number;
      pump_delay: number;
      status: string;
      topologyRelationTypeState: Record<string, unknown>;
      topologyRelationTypeEffective: string;
    }>
  > {
    const result = await this.db.query<{
      id: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      relationRole: string;
      well: string;
      pump: string;
      valve: string;
      sequence: string;
      valve_delay: number;
      pump_delay: number;
      status: string;
      topologyRelationTypeState: Record<string, unknown>;
    }>(`
      select
        r.id,
        r.well_id as "wellId",
        r.pump_id as "pumpId",
        r.valve_id as "valveId",
        r.relation_role as "relationRole",
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as "well",
        coalesce(pd.device_name, p.pump_code) as "pump",
        coalesce(vd.device_name, v.valve_code) as "valve",
        coalesce(r.relation_config_json->>'sequence', 'valve_first') as "sequence",
        coalesce((r.relation_config_json->>'valveDelaySeconds')::int, 0) as "valve_delay",
        coalesce((r.relation_config_json->>'pumpDelaySeconds')::int, 0) as "pump_delay",
        r.status,
        coalesce(r.topology_relation_type_state, '{}'::jsonb) as "topologyRelationTypeState"
      from pump_valve_relation r
      join well w on w.id = r.well_id
      join pump p on p.id = r.pump_id
      join valve v on v.id = r.valve_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      order by r.created_at desc
    `);
    return result.rows.map((row) => ({
      ...row,
      topologyRelationTypeEffective: resolveEffectiveTopologyRelationTypeV1(row.topologyRelationTypeState),
      pumpValveTopologyReadModel: buildPumpValveTopologyRelationReadModel(row.topologyRelationTypeState)
    }));
  }

  async create(input: {
    wellId: string;
    pumpId: string;
    valveId: string;
    relationRole: string;
    topologyRelationTypeState?: Record<string, unknown>;
  }) {
    const state = input.topologyRelationTypeState ?? {};
    const result = await this.db.query<{ id: string }>(
      `
      insert into pump_valve_relation (
        tenant_id, well_id, pump_id, valve_id, relation_role, status, topology_relation_type_state
      )
      select w.tenant_id, $1, $2, $3, $4, 'active', $5::jsonb
      from well w
      where w.id = $1
      returning id
      `,
      [input.wellId, input.pumpId, input.valveId, input.relationRole, JSON.stringify(state)]
    );
    return result.rows[0];
  }

  async update(
    id: string,
    input: { relationRole?: string; topologyRelationTypeStatePatch?: Record<string, unknown> }
  ) {
    if (input.topologyRelationTypeStatePatch && Object.keys(input.topologyRelationTypeStatePatch).length > 0) {
      await this.db.query(
        `
        update pump_valve_relation
        set topology_relation_type_state =
              coalesce(topology_relation_type_state, '{}'::jsonb) || $1::jsonb,
            updated_at = now()
        where id = $2
        `,
        [JSON.stringify(input.topologyRelationTypeStatePatch), id]
      );
    }

    if (input.relationRole) {
      const result = await this.db.query<{ id: string }>(
        `
        update pump_valve_relation
        set relation_role = $1, updated_at = now()
        where id = $2
        returning id
        `,
        [input.relationRole, id]
      );
      return result.rows[0];
    }

    const result = await this.db.query<{ id: string }>(`select id from pump_valve_relation where id = $1`, [id]);
    return result.rows[0];
  }

  async findRelationById(relationId: string) {
    const result = await this.db.query<{
      tenantId: string;
      relationId: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      relationRole: string;
      billingInheritMode: string;
      relationConfigJson: Record<string, unknown>;
      wellFeatureModules: string[] | null;
      wellDeviceState: string;
      pumpDeviceState: string;
      valveDeviceState: string;
      wellOnlineState: string;
      pumpOnlineState: string;
      valveOnlineState: string;
    }>(
      `
      select
        r.tenant_id as "tenantId",
        r.id as "relationId",
        r.well_id as "wellId",
        r.pump_id as "pumpId",
        r.valve_id as "valveId",
        r.relation_role as "relationRole",
        r.billing_inherit_mode as "billingInheritMode",
        r.relation_config_json as "relationConfigJson",
        coalesce(wd.ext_json->'feature_modules', '[]'::jsonb) as "wellFeatureModules",
        wd.lifecycle_state as "wellDeviceState",
        pd.lifecycle_state as "pumpDeviceState",
        vd.lifecycle_state as "valveDeviceState",
        case
          when wds.online_state = 'online'
           and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else wd.online_state
        end as "wellOnlineState",
        case
          when pds.online_state = 'online'
           and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else pd.online_state
        end as "pumpOnlineState",
        case
          when vds.online_state = 'online'
           and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else vd.online_state
        end as "valveOnlineState"
      from pump_valve_relation r
      join well w on w.id = r.well_id
      join pump p on p.id = r.pump_id
      join valve v on v.id = r.valve_id
      join device wd on wd.id = w.device_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      left join device_runtime_shadow wds on wds.tenant_id = r.tenant_id and wds.device_id = wd.id
      left join device_runtime_shadow pds on pds.tenant_id = r.tenant_id and pds.device_id = pd.id
      left join device_runtime_shadow vds on vds.tenant_id = r.tenant_id and vds.device_id = vd.id
      where r.id = $1 and r.status = 'active'
      limit 1
      `,
      [relationId]
    );
    return result.rows[0] ?? null;
  }

  async findRelationByValveId(valveId: string) {
    const result = await this.db.query<{
      tenantId: string;
      relationId: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      relationRole: string;
      billingInheritMode: string;
      relationConfigJson: Record<string, unknown>;
      wellFeatureModules: string[] | null;
      wellDeviceState: string;
      pumpDeviceState: string;
      valveDeviceState: string;
      wellOnlineState: string;
      pumpOnlineState: string;
      valveOnlineState: string;
    }>(
      `
      select
        r.tenant_id as "tenantId",
        r.id as "relationId",
        r.well_id as "wellId",
        r.pump_id as "pumpId",
        r.valve_id as "valveId",
        r.relation_role as "relationRole",
        r.billing_inherit_mode as "billingInheritMode",
        r.relation_config_json as "relationConfigJson",
        coalesce(wd.ext_json->'feature_modules', '[]'::jsonb) as "wellFeatureModules",
        wd.lifecycle_state as "wellDeviceState",
        pd.lifecycle_state as "pumpDeviceState",
        vd.lifecycle_state as "valveDeviceState",
        case
          when wds.online_state = 'online'
           and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else wd.online_state
        end as "wellOnlineState",
        case
          when pds.online_state = 'online'
           and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else pd.online_state
        end as "pumpOnlineState",
        case
          when vds.online_state = 'online'
           and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else vd.online_state
        end as "valveOnlineState"
      from pump_valve_relation r
      join well w on w.id = r.well_id
      join pump p on p.id = r.pump_id
      join valve v on v.id = r.valve_id
      join device wd on wd.id = w.device_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      left join device_runtime_shadow wds on wds.tenant_id = r.tenant_id and wds.device_id = wd.id
      left join device_runtime_shadow pds on pds.tenant_id = r.tenant_id and pds.device_id = pd.id
      left join device_runtime_shadow vds on vds.tenant_id = r.tenant_id and vds.device_id = vd.id
      where r.valve_id = $1 and r.status = 'active'
      order by
        case
          when wd.lifecycle_state = 'active'
           and pd.lifecycle_state = 'active'
           and vd.lifecycle_state = 'active'
           and (
             case
               when wds.online_state = 'online'
                and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else wd.online_state
             end
           ) = 'online'
           and (
             case
               when pds.online_state = 'online'
                and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else pd.online_state
             end
           ) = 'online'
           and (
             case
               when vds.online_state = 'online'
                and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else vd.online_state
             end
           ) = 'online'
          then 0
          else 1
        end,
        case when r.relation_role = 'primary' then 0 else 1 end,
        r.updated_at desc
      limit 1
      `,
      [valveId]
    );
    return result.rows[0] ?? null;
  }

  async findRelationByPumpId(pumpId: string) {
    const result = await this.db.query<{
      tenantId: string;
      relationId: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      relationRole: string;
      billingInheritMode: string;
      relationConfigJson: Record<string, unknown>;
      wellFeatureModules: string[] | null;
      wellDeviceState: string;
      pumpDeviceState: string;
      valveDeviceState: string;
      wellOnlineState: string;
      pumpOnlineState: string;
      valveOnlineState: string;
    }>(
      `
      select
        r.tenant_id as "tenantId",
        r.id as "relationId",
        r.well_id as "wellId",
        r.pump_id as "pumpId",
        r.valve_id as "valveId",
        r.relation_role as "relationRole",
        r.billing_inherit_mode as "billingInheritMode",
        r.relation_config_json as "relationConfigJson",
        coalesce(wd.ext_json->'feature_modules', '[]'::jsonb) as "wellFeatureModules",
        wd.lifecycle_state as "wellDeviceState",
        pd.lifecycle_state as "pumpDeviceState",
        vd.lifecycle_state as "valveDeviceState",
        case
          when wds.online_state = 'online'
           and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else wd.online_state
        end as "wellOnlineState",
        case
          when pds.online_state = 'online'
           and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else pd.online_state
        end as "pumpOnlineState",
        case
          when vds.online_state = 'online'
           and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else vd.online_state
        end as "valveOnlineState"
      from pump_valve_relation r
      join well w on w.id = r.well_id
      join pump p on p.id = r.pump_id
      join valve v on v.id = r.valve_id
      join device wd on wd.id = w.device_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      left join device_runtime_shadow wds on wds.tenant_id = r.tenant_id and wds.device_id = wd.id
      left join device_runtime_shadow pds on pds.tenant_id = r.tenant_id and pds.device_id = pd.id
      left join device_runtime_shadow vds on vds.tenant_id = r.tenant_id and vds.device_id = vd.id
      where r.pump_id = $1 and r.status = 'active'
      order by
        case
          when wd.lifecycle_state = 'active'
           and pd.lifecycle_state = 'active'
           and vd.lifecycle_state = 'active'
           and (
             case
               when wds.online_state = 'online'
                and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else wd.online_state
             end
           ) = 'online'
           and (
             case
               when pds.online_state = 'online'
                and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else pd.online_state
             end
           ) = 'online'
           and (
             case
               when vds.online_state = 'online'
                and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else vd.online_state
             end
           ) = 'online'
          then 0
          else 1
        end,
        case when r.relation_role = 'primary' then 0 else 1 end,
        r.updated_at desc
      limit 1
      `,
      [pumpId]
    );
    return result.rows[0] ?? null;
  }

  async findPrimaryRelationByWellId(wellId: string) {
    const result = await this.db.query<{
      tenantId: string;
      relationId: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      relationRole: string;
      billingInheritMode: string;
      relationConfigJson: Record<string, unknown>;
      wellFeatureModules: string[] | null;
      wellDeviceState: string;
      pumpDeviceState: string;
      valveDeviceState: string;
      wellOnlineState: string;
      pumpOnlineState: string;
      valveOnlineState: string;
    }>(
      `
      select
        r.tenant_id as "tenantId",
        r.id as "relationId",
        r.well_id as "wellId",
        r.pump_id as "pumpId",
        r.valve_id as "valveId",
        r.relation_role as "relationRole",
        r.billing_inherit_mode as "billingInheritMode",
        r.relation_config_json as "relationConfigJson",
        coalesce(wd.ext_json->'feature_modules', '[]'::jsonb) as "wellFeatureModules",
        wd.lifecycle_state as "wellDeviceState",
        pd.lifecycle_state as "pumpDeviceState",
        vd.lifecycle_state as "valveDeviceState",
        case
          when wds.online_state = 'online'
           and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else wd.online_state
        end as "wellOnlineState",
        case
          when pds.online_state = 'online'
           and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else pd.online_state
        end as "pumpOnlineState",
        case
          when vds.online_state = 'online'
           and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else vd.online_state
        end as "valveOnlineState"
      from pump_valve_relation r
      join well w on w.id = r.well_id
      join pump p on p.id = r.pump_id
      join valve v on v.id = r.valve_id
      join device wd on wd.id = w.device_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      left join device_runtime_shadow wds on wds.tenant_id = r.tenant_id and wds.device_id = wd.id
      left join device_runtime_shadow pds on pds.tenant_id = r.tenant_id and pds.device_id = pd.id
      left join device_runtime_shadow vds on vds.tenant_id = r.tenant_id and vds.device_id = vd.id
      where r.well_id = $1 and r.status = 'active'
      order by
        case
          when wd.lifecycle_state = 'active'
           and pd.lifecycle_state = 'active'
           and vd.lifecycle_state = 'active'
           and (
             case
               when wds.online_state = 'online'
                and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else wd.online_state
             end
           ) = 'online'
           and (
             case
               when pds.online_state = 'online'
                and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else pd.online_state
             end
           ) = 'online'
           and (
             case
               when vds.online_state = 'online'
                and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else vd.online_state
             end
           ) = 'online'
          then 0
          else 1
        end,
        case when r.relation_role = 'primary' then 0 else 1 end,
        r.updated_at desc
      limit 1
      `,
      [wellId]
    );
    return result.rows[0] ?? null;
  }

  async findPrimaryMeteringReadinessByWellId(wellId: string): Promise<PrimaryMeteringReadiness | null> {
    const result = await this.db.query<PrimaryMeteringReadiness>(
      `
      select
        w.block_id::text as "blockId",
        pb.block_name as "blockName",
        meter."meteringPointId",
        meter."meteringPointCode",
        meter."meteringPointStatus",
        meter."primaryMeterDeviceId",
        meter."primaryMeterDeviceName",
        meter."primaryMeterLifecycleState",
        meter."primaryMeterOnlineState"
      from well w
      left join project_block pb on pb.id = w.block_id
      left join lateral (
        select
          mp.id::text as "meteringPointId",
          mp.metering_point_code as "meteringPointCode",
          mp.status as "meteringPointStatus",
          mp.primary_meter_device_id::text as "primaryMeterDeviceId",
          coalesce(md.device_name, md.device_code) as "primaryMeterDeviceName",
          md.lifecycle_state as "primaryMeterLifecycleState",
          case
            when mds.online_state = 'online'
             and coalesce(mds.last_server_rx_ts, mds.last_heartbeat_at, mds.updated_at) >= now() - interval '15 minutes'
              then 'online'
            else md.online_state
          end as "primaryMeterOnlineState"
        from metering_point mp
        left join device md on md.id = mp.primary_meter_device_id
        left join device_runtime_shadow mds on mds.tenant_id = mp.tenant_id and mds.device_id = md.id
        where mp.tenant_id = w.tenant_id
          and mp.block_id = w.block_id
          and mp.status = 'active'
        order by
          case
            when mp.primary_meter_device_id is not null
             and md.lifecycle_state = 'active'
             and (
               case
                 when mds.online_state = 'online'
                  and coalesce(mds.last_server_rx_ts, mds.last_heartbeat_at, mds.updated_at) >= now() - interval '15 minutes'
                   then 'online'
                 else md.online_state
               end
             ) = 'online'
              then 0
            when mp.primary_meter_device_id is not null then 1
            else 2
          end,
          mp.created_at asc
        limit 1
      ) meter on true
      where w.id = $1::uuid
      limit 1
      `,
      [wellId]
    );
    return result.rows[0] ?? null;
  }
}
