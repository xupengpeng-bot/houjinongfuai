import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';
import { PumpValveRelationDto, UpdatePumpValveRelationDto } from './topology.dto';
import { TopologyRepository } from './topology.repository';
import { TopologyService } from './topology.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

type FrontendSequence = 'valve_first' | 'simultaneous';
type FrontendStatus = 'active' | 'inactive';

type TopologyPayload = Partial<PumpValveRelationDto & UpdatePumpValveRelationDto> & {
  well?: string;
  pump?: string;
  valve?: string;
  sequence?: FrontendSequence;
  valve_delay?: number;
  pump_delay?: number;
  status?: FrontendStatus;
};

function appException(status: HttpStatus, code: string, message: string, data: Record<string, unknown> = {}) {
  return new HttpException({ requestId: 'local-dev', code, message, data }, status);
}

function normalizeSequence(value?: string): FrontendSequence {
  return value === 'simultaneous' ? 'simultaneous' : 'valve_first';
}

function normalizeStatus(value?: string): FrontendStatus {
  return value === 'inactive' ? 'inactive' : 'active';
}

function validateNonNegativeNumber(value: unknown) {
  return value === undefined || value === null || (Number.isFinite(Number(value)) && Number(value) >= 0);
}

@Injectable()
class TopologyUiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly topologyRepository: TopologyRepository
  ) {}

  private validatePayload(dto: TopologyPayload, isCreate: boolean) {
    const fieldErrors: Record<string, string[]> = {};
    if (isCreate && !(dto.wellId || dto.well)) fieldErrors.well = ['well is required'];
    if (isCreate && !(dto.pumpId || dto.pump)) fieldErrors.pump = ['pump is required'];
    if (isCreate && !(dto.valveId || dto.valve)) fieldErrors.valve = ['valve is required'];
    if (dto.sequence && !['valve_first', 'simultaneous'].includes(dto.sequence)) {
      fieldErrors.sequence = ['sequence is invalid'];
    }
    if (dto.status && !['active', 'inactive'].includes(dto.status)) {
      fieldErrors.status = ['status is invalid'];
    }
    if (!validateNonNegativeNumber(dto.valve_delay)) fieldErrors.valve_delay = ['valve_delay must be >= 0'];
    if (!validateNonNegativeNumber(dto.pump_delay)) fieldErrors.pump_delay = ['pump_delay must be >= 0'];
    if (Object.keys(fieldErrors).length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors });
    }
  }

  private mapRow(row: Record<string, any>) {
    return {
      id: row.id,
      well: row.well,
      pump: row.pump,
      valve: row.valve,
      sequence: normalizeSequence(row.sequence),
      valve_delay: Number(row.valve_delay ?? 0),
      pump_delay: Number(row.pump_delay ?? 0),
      status: normalizeStatus(row.status),
      wellId: row.wellId,
      pumpId: row.pumpId,
      valveId: row.valveId,
      relationRole: row.relationRole
    };
  }

  async list() {
    const rows = await this.topologyRepository.findAll();
    return rows.map((row) => this.mapRow(row));
  }

  private async getRow(id: string, client?: PoolClient) {
    const result = await this.db.query<Record<string, any>>(
      `
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
        r.status
      from pump_valve_relation r
      join well w on w.id = r.well_id
      join pump p on p.id = r.pump_id
      join valve v on v.id = r.valve_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      where r.tenant_id = $1 and r.id = $2
      limit 1
      `,
      [TENANT_ID, id],
      client
    );
    return result.rows[0] ?? null;
  }

  private async resolveWellRef(ref: string, client?: PoolClient) {
    const value = ref.trim();
    const result = await this.db.query<Record<string, any>>(
      `
      select
        w.id,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as label
      from well w
      join device d on d.id = w.device_id
      where w.tenant_id = $1
        and (
          w.id::text = $2
          or lower(w.well_code) = lower($2)
          or lower(coalesce(w.safety_profile_json->>'displayName', '')) = lower($2)
          or lower(d.device_name) = lower($2)
        )
      order by
        case
          when w.id::text = $2 then 0
          when lower(w.well_code) = lower($2) then 1
          when lower(coalesce(w.safety_profile_json->>'displayName', '')) = lower($2) then 2
          else 3
        end,
        w.created_at asc
      limit 1
      `,
      [TENANT_ID, value],
      client
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { well: ['well is invalid'] }
      });
    }
    return result.rows[0];
  }

  private async resolvePumpRef(ref: string, wellId?: string, client?: PoolClient) {
    const value = ref.trim();
    const params: unknown[] = [TENANT_ID, value];
    let wellClause = '';
    if (wellId) {
      params.push(wellId);
      wellClause = `and p.well_id = $${params.length}`;
    }
    const result = await this.db.query<Record<string, any>>(
      `
      select
        p.id,
        p.well_id,
        coalesce(d.device_name, p.pump_code) as label
      from pump p
      join device d on d.id = p.device_id
      where p.tenant_id = $1
        ${wellClause}
        and (
          p.id::text = $2
          or lower(p.pump_code) = lower($2)
          or lower(d.device_name) = lower($2)
        )
      order by
        case
          when p.id::text = $2 then 0
          when lower(p.pump_code) = lower($2) then 1
          else 2
        end,
        p.created_at asc
      limit 1
      `,
      params,
      client
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { pump: ['pump is invalid'] }
      });
    }
    return result.rows[0];
  }

  private async resolveValveRef(ref: string, wellId?: string, client?: PoolClient) {
    const value = ref.trim();
    const params: unknown[] = [TENANT_ID, value];
    let wellClause = '';
    if (wellId) {
      params.push(wellId);
      wellClause = `and v.well_id = $${params.length}`;
    }
    const result = await this.db.query<Record<string, any>>(
      `
      select
        v.id,
        v.well_id,
        coalesce(d.device_name, v.valve_code) as label
      from valve v
      join device d on d.id = v.device_id
      where v.tenant_id = $1
        ${wellClause}
        and (
          v.id::text = $2
          or lower(v.valve_code) = lower($2)
          or lower(d.device_name) = lower($2)
        )
      order by
        case
          when v.id::text = $2 then 0
          when lower(v.valve_code) = lower($2) then 1
          else 2
        end,
        v.created_at asc
      limit 1
      `,
      params,
      client
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { valve: ['valve is invalid'] }
      });
    }
    return result.rows[0];
  }

  private buildRelationConfig(dto: TopologyPayload, fallback?: Record<string, unknown>) {
    return {
      ...(fallback ?? {}),
      sequence: normalizeSequence(dto.sequence ?? String(fallback?.sequence ?? 'valve_first')),
      valveDelaySeconds: Number(dto.valve_delay ?? fallback?.valveDelaySeconds ?? 0),
      pumpDelaySeconds: Number(dto.pump_delay ?? fallback?.pumpDelaySeconds ?? 0)
    };
  }

  private async ensureUniqueCombination(wellId: string, pumpId: string, valveId: string, ignoreId?: string, client?: PoolClient) {
    const params: unknown[] = [TENANT_ID, wellId, pumpId, valveId];
    let ignoreClause = '';
    if (ignoreId) {
      params.push(ignoreId);
      ignoreClause = `and id <> $${params.length}`;
    }
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from pump_valve_relation
      where tenant_id = $1
        and well_id = $2
        and pump_id = $3
        and valve_id = $4
        ${ignoreClause}
      limit 1
      `,
      params,
      client
    );
    if (result.rows[0]) {
      throw appException(HttpStatus.CONFLICT, 'DUPLICATE_RELATION', 'Pump-valve relation already exists');
    }
  }

  async detail(id: string) {
    const row = await this.getRow(id);
    if (!row) throw new NotFoundException('pump_valve_relation not found');
    return this.mapRow(row);
  }

  async create(dto: TopologyPayload) {
    this.validatePayload(dto, true);
    const createdId = await this.db.withTransaction(async (client) => {
      const well = dto.wellId ? { id: dto.wellId } : await this.resolveWellRef(dto.well!, client);
      const pump = dto.pumpId ? { id: dto.pumpId, well_id: well.id } : await this.resolvePumpRef(dto.pump!, well.id, client);
      const valve = dto.valveId ? { id: dto.valveId, well_id: well.id } : await this.resolveValveRef(dto.valve!, well.id, client);

      if ((pump as any).well_id && (pump as any).well_id !== well.id) {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
          fieldErrors: { pump: ['pump does not belong to well'] }
        });
      }
      if ((valve as any).well_id && (valve as any).well_id !== well.id) {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
          fieldErrors: { valve: ['valve does not belong to well'] }
        });
      }

      await this.ensureUniqueCombination(well.id, pump.id, valve.id, undefined, client);
      const inserted = await this.db.query<{ id: string }>(
        `
        insert into pump_valve_relation (
          tenant_id,
          well_id,
          pump_id,
          valve_id,
          relation_role,
          billing_inherit_mode,
          relation_config_json,
          status,
          topology_relation_type_state
        ) values ($1, $2, $3, $4, $5, 'well_policy', $6::jsonb, $7, $8::jsonb)
        returning id
        `,
        [
          TENANT_ID,
          well.id,
          pump.id,
          valve.id,
          dto.relationRole ?? 'primary',
          JSON.stringify(this.buildRelationConfig(dto)),
          normalizeStatus(dto.status),
          JSON.stringify(dto.topology_relation_types ?? {})
        ],
        client
      );
      return inserted.rows[0].id;
    });
    return this.detail(createdId);
  }

  async update(id: string, dto: TopologyPayload) {
    this.validatePayload(dto, false);
    const existing = await this.db.query<Record<string, any>>(
      `
      select id, well_id, pump_id, valve_id, relation_role, relation_config_json, status, topology_relation_type_state
      from pump_valve_relation
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, id]
    );
    const row = existing.rows[0];
    if (!row) throw new NotFoundException('pump_valve_relation not found');

    await this.db.withTransaction(async (client) => {
      const well = dto.wellId || dto.well
        ? dto.wellId ? { id: dto.wellId } : await this.resolveWellRef(dto.well!, client)
        : { id: row.well_id };
      const pump = dto.pumpId || dto.pump
        ? dto.pumpId ? { id: dto.pumpId, well_id: well.id } : await this.resolvePumpRef(dto.pump!, well.id, client)
        : { id: row.pump_id, well_id: row.well_id };
      const valve = dto.valveId || dto.valve
        ? dto.valveId ? { id: dto.valveId, well_id: well.id } : await this.resolveValveRef(dto.valve!, well.id, client)
        : { id: row.valve_id, well_id: row.well_id };

      if ((pump as any).well_id && (pump as any).well_id !== well.id) {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
          fieldErrors: { pump: ['pump does not belong to well'] }
        });
      }
      if ((valve as any).well_id && (valve as any).well_id !== well.id) {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
          fieldErrors: { valve: ['valve does not belong to well'] }
        });
      }

      await this.ensureUniqueCombination(well.id, pump.id, valve.id, id, client);
      await this.db.query(
        `
        update pump_valve_relation
        set well_id = $3,
            pump_id = $4,
            valve_id = $5,
            relation_role = $6,
            relation_config_json = $7::jsonb,
            status = $8,
            topology_relation_type_state = $9::jsonb,
            updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          id,
          well.id,
          pump.id,
          valve.id,
          dto.relationRole ?? row.relation_role,
          JSON.stringify(this.buildRelationConfig(dto, row.relation_config_json ?? {})),
          normalizeStatus(dto.status ?? row.status),
          JSON.stringify({
            ...(row.topology_relation_type_state ?? {}),
            ...(dto.topology_relation_types ?? {})
          })
        ],
        client
      );
    });
    return this.detail(id);
  }

  async remove(id: string) {
    const result = await this.db.query<{ id: string }>(
      `
      delete from pump_valve_relation
      where tenant_id = $1 and id = $2
      returning id
      `,
      [TENANT_ID, id]
    );
    if (!result.rows[0]) throw new NotFoundException('pump_valve_relation not found');
  }
}

@Controller('pump-valve-relations')
class TopologyController {
  constructor(private readonly topologyUiService: TopologyUiService) {}

  @Get()
  async list() {
    return ok({ items: await this.topologyUiService.list() });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.topologyUiService.detail(id));
  }

  @Post()
  async create(@Body() dto: TopologyPayload) {
    return ok(await this.topologyUiService.create(dto));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: TopologyPayload) {
    return ok(await this.topologyUiService.update(id, dto));
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() dto: TopologyPayload) {
    return ok(await this.topologyUiService.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.topologyUiService.remove(id);
  }
}

@Module({
  controllers: [TopologyController],
  providers: [TopologyRepository, TopologyService, TopologyUiService],
  exports: [TopologyRepository, TopologyService]
})
export class TopologyModule {}
