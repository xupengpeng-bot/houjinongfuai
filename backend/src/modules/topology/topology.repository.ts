import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class TopologyRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<Array<{
    id: string;
    wellId: string;
    pumpId: string;
    valveId: string;
    relationRole: string;
    status: string;
  }>> {
    const result = await this.db.query<{
      id: string;
      wellId: string;
      pumpId: string;
      valveId: string;
      relationRole: string;
      status: string;
    }>(`
      select
        id,
        well_id as "wellId",
        pump_id as "pumpId",
        valve_id as "valveId",
        relation_role as "relationRole",
        status
      from pump_valve_relation
      order by created_at desc
    `);
    return result.rows;
  }

  async create(input: { wellId: string; pumpId: string; valveId: string; relationRole: string }) {
    const result = await this.db.query<{ id: string }>(
      `
      insert into pump_valve_relation (
        tenant_id, well_id, pump_id, valve_id, relation_role, status
      )
      select w.tenant_id, $1, $2, $3, $4, 'active'
      from well w
      where w.id = $1
      returning id
      `,
      [input.wellId, input.pumpId, input.valveId, input.relationRole]
    );
    return result.rows[0];
  }

  async update(id: string, input: { relationRole?: string }) {
    if (!input.relationRole) {
      const result = await this.db.query<{ id: string }>(`select id from pump_valve_relation where id = $1`, [id]);
      return result.rows[0];
    }

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
        wd.lifecycle_state as "wellDeviceState",
        pd.lifecycle_state as "pumpDeviceState",
        vd.lifecycle_state as "valveDeviceState",
        wd.online_state as "wellOnlineState",
        pd.online_state as "pumpOnlineState",
        vd.online_state as "valveOnlineState"
      from pump_valve_relation r
      join well w on w.id = r.well_id
      join pump p on p.id = r.pump_id
      join valve v on v.id = r.valve_id
      join device wd on wd.id = w.device_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      where r.valve_id = $1 and r.status = 'active'
      order by case when r.relation_role = 'primary' then 0 else 1 end, r.updated_at desc
      limit 1
      `,
      [valveId]
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
        wd.lifecycle_state as "wellDeviceState",
        pd.lifecycle_state as "pumpDeviceState",
        vd.lifecycle_state as "valveDeviceState",
        wd.online_state as "wellOnlineState",
        pd.online_state as "pumpOnlineState",
        vd.online_state as "valveOnlineState"
      from pump_valve_relation r
      join well w on w.id = r.well_id
      join pump p on p.id = r.pump_id
      join valve v on v.id = r.valve_id
      join device wd on wd.id = w.device_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      where r.well_id = $1 and r.status = 'active'
      order by case when r.relation_role = 'primary' then 0 else 1 end, r.updated_at desc
      limit 1
      `,
      [wellId]
    );
    return result.rows[0] ?? null;
  }
}
