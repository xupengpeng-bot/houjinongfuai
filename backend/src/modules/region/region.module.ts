import { Body, Controller, Delete, Get, HttpException, HttpStatus, Module, Param, Patch, Post, Put } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';
import { RegionCompatService } from '../../common/region/region-compat.service';

type RegionLevel = 'province' | 'city' | 'county' | 'town' | 'village';

interface FlatRegionNode {
  id: string;
  parent_id: string | null;
  value: string;
  label: string;
  code: string;
  name: string;
  level: RegionLevel;
  full_path_name: string;
  full_path_code: string;
  enabled: boolean;
}

interface CascadeRegionNode extends FlatRegionNode {
  children: CascadeRegionNode[];
}

interface CreateRegionDto {
  parent_id?: string | null;
  parentId?: string | null;
  level?: RegionLevel;
  regionType?: string;
  code?: string;
  regionCode?: string;
  name?: string;
  regionName?: string;
  enabled?: boolean;
}

interface UpdateRegionDto {
  parent_id?: string | null;
  parentId?: string | null;
  level?: RegionLevel;
  regionType?: string;
  code?: string;
  regionCode?: string;
  name?: string;
  regionName?: string;
  enabled?: boolean;
}

function coalesceRegionLevel(input?: string | null): RegionLevel {
  switch (input) {
    case 'province':
    case 'city':
    case 'county':
    case 'town':
    case 'village':
      return input;
    case 'project':
      return 'county';
    case 'service_area':
      return 'town';
    case 'plot_group':
    case 'plot':
      return 'village';
    default:
      return 'county';
  }
}

function normalizeCreatePayload(dto: CreateRegionDto) {
  return {
    parentId: dto.parent_id ?? dto.parentId ?? null,
    level: dto.level ?? dto.regionType ? coalesceRegionLevel(dto.level ?? dto.regionType ?? null) : undefined,
    code: dto.code ?? dto.regionCode ?? '',
    name: dto.name ?? dto.regionName ?? '',
    enabled: dto.enabled ?? true
  };
}

function normalizeUpdatePayload(dto: UpdateRegionDto) {
  return {
    parentId: dto.parent_id ?? dto.parentId,
    level: dto.level ?? dto.regionType ? coalesceRegionLevel(dto.level ?? dto.regionType ?? null) : undefined,
    code: dto.code ?? dto.regionCode,
    name: dto.name ?? dto.regionName,
    enabled: dto.enabled
  };
}

function buildCascadeTree(items: FlatRegionNode[]): CascadeRegionNode[] {
  const map = new Map<string, CascadeRegionNode>();
  const roots: CascadeRegionNode[] = [];

  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function nextRegionLevel(parentLevel: RegionLevel): RegionLevel {
  switch (parentLevel) {
    case 'province':
      return 'city';
    case 'city':
      return 'county';
    case 'county':
      return 'town';
    case 'town':
      return 'village';
    case 'village':
      return 'village';
  }
}

@Controller('regions')
class RegionController {
  constructor(
    private readonly db: DatabaseService,
    private readonly regionCompat: RegionCompatService
  ) {}

  private async listCanonicalRegions() {
    const result = await this.db.query<FlatRegionNode>(`
      with recursive region_tree as (
        select
          r.id,
          r.parent_id,
          r.region_code,
          r.region_name,
          r.region_type,
          r.status,
          r.region_name::text as full_path_name,
          r.region_code::text as full_path_code
        from region r
        where r.parent_id is null

        union all

        select
          r.id,
          r.parent_id,
          r.region_code,
          r.region_name,
          r.region_type,
          r.status,
          rt.full_path_name || ' / ' || r.region_name as full_path_name,
          rt.full_path_code || '/' || r.region_code as full_path_code
        from region r
        join region_tree rt on rt.id = r.parent_id
      )
      select
        rt.id,
        rt.parent_id,
        rt.id as value,
        rt.region_name as label,
        rt.region_code as code,
        rt.region_name as name,
        case
          when rt.region_type = 'province' then 'province'
          when rt.region_type = 'city' then 'city'
          when rt.region_type = 'county' then 'county'
          when rt.region_type = 'town' then 'town'
          when rt.region_type = 'village' then 'village'
          when rt.region_type = 'project' then 'county'
          when rt.region_type = 'service_area' then 'town'
          when rt.region_type = 'plot_group' then 'village'
          when rt.region_type = 'plot' then 'village'
          else 'county'
        end as level,
        rt.full_path_name,
        rt.full_path_code,
        (rt.status = 'active') as enabled
      from region_tree rt
      order by rt.full_path_code asc
    `);

    return result.rows;
  }

  private async getCanonicalRegionById(id: string, client?: PoolClient) {
    const result = await this.db.query<FlatRegionNode>(
      `
        with recursive region_tree as (
          select
            r.id,
            r.parent_id,
            r.region_code,
            r.region_name,
            r.region_type,
            r.status,
            r.region_name::text as full_path_name,
            r.region_code::text as full_path_code
          from region r
          where r.parent_id is null

          union all

          select
            r.id,
            r.parent_id,
            r.region_code,
            r.region_name,
            r.region_type,
            r.status,
            rt.full_path_name || ' / ' || r.region_name as full_path_name,
            rt.full_path_code || '/' || r.region_code as full_path_code
          from region r
          join region_tree rt on rt.id = r.parent_id
        )
        select
          rt.id,
          rt.parent_id,
          rt.id as value,
          rt.region_name as label,
          rt.region_code as code,
          rt.region_name as name,
          case
            when rt.region_type = 'province' then 'province'
            when rt.region_type = 'city' then 'city'
            when rt.region_type = 'county' then 'county'
            when rt.region_type = 'town' then 'town'
            when rt.region_type = 'village' then 'village'
            when rt.region_type = 'project' then 'county'
            when rt.region_type = 'service_area' then 'town'
            when rt.region_type = 'plot_group' then 'village'
            when rt.region_type = 'plot' then 'village'
            else 'county'
          end as level,
          rt.full_path_name,
          rt.full_path_code,
          (rt.status = 'active') as enabled
        from region_tree rt
        where rt.id = $1
      `,
      [id],
      client
    );

    return result.rows[0] ?? null;
  }

  @Get('options')
  async options() {
    const items = await this.listCanonicalRegions();
    return ok({ items });
  }

  @Get('cascade-options')
  async cascadeOptions() {
    const items = await this.listCanonicalRegions();
    return ok({ items: buildCascadeTree(items) });
  }

  @Get('tree')
  async tree() {
    const items = await this.listCanonicalRegions();
    return ok({ items });
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const row = await this.getCanonicalRegionById(id);
    if (!row) {
      throw new HttpException(
        { code: 'NOT_FOUND', message: 'Region not found', data: null },
        HttpStatus.NOT_FOUND
      );
    }
    return row;
  }

  @Get()
  async list() {
    const result = await this.db.query(`
      with recursive region_tree as (
        select
          r.id,
          r.parent_id,
          r.region_code,
          r.region_name,
          case
            when r.region_type = 'province' then 'province'
            when r.region_type = 'city' then 'city'
            when r.region_type = 'county' then 'county'
            when r.region_type = 'town' then 'town'
            when r.region_type = 'village' then 'village'
            when r.region_type = 'project' then 'county'
            when r.region_type = 'service_area' then 'town'
            when r.region_type = 'plot_group' then 'village'
            when r.region_type = 'plot' then 'village'
            else 'county'
          end as region_level,
          r.status,
          r.region_name::text as full_path_name,
          r.region_code::text as full_path_code
        from region r
        where r.parent_id is null

        union all

        select
          r.id,
          r.parent_id,
          r.region_code,
          r.region_name,
          case
            when r.region_type = 'province' then 'province'
            when r.region_type = 'city' then 'city'
            when r.region_type = 'county' then 'county'
            when r.region_type = 'town' then 'town'
            when r.region_type = 'village' then 'village'
            when r.region_type = 'project' then 'county'
            when r.region_type = 'service_area' then 'town'
            when r.region_type = 'plot_group' then 'village'
            when r.region_type = 'plot' then 'village'
            else 'county'
          end as region_level,
          r.status,
          rt.full_path_name || ' / ' || r.region_name as full_path_name,
          rt.full_path_code || '/' || r.region_code as full_path_code
        from region r
        join region_tree rt on rt.id = r.parent_id
      )
      select
        rt.id,
        rt.region_name as name,
        rt.region_level as level,
        rt.region_code as code,
        rt.full_path_name,
        rt.full_path_code,
        (
          select count(*)::int
          from project p
          where p.region_id = rt.id
        ) as projects,
        (
          select count(*)::int
          from asset a
          where a.manual_region_id = rt.id
        ) as assets,
        (rt.status = 'active') as enabled
      from region_tree rt
      order by rt.full_path_code asc
    `);

    return ok({ items: result.rows });
  }

  @Post()
  async create(@Body() dto: CreateRegionDto) {
    const payload = normalizeCreatePayload(dto);

    if (!payload.code) {
      throw new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          data: {
            fieldErrors: {
              ...(payload.code ? {} : { code: 'code is required' })
            }
          }
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const created = await this.db.withTransaction(async (client) => {
      const materialized = await this.regionCompat.ensureBusinessRegionByReferenceCode(payload.code, client);
      await this.db.query(
        `
        update region
        set
          status = $2,
          updated_at = now()
        where id = $1
        `,
        [materialized.id, payload.enabled ? 'active' : 'inactive'],
        client
      );
      return await this.getCanonicalRegionById(materialized.id, client);
    });

    return ok({ created });
  }

  @Put(':id')
  async replace(@Param('id') id: string, @Body() dto: UpdateRegionDto) {
    return this.updateInternal(id, dto);
  }

  @Patch(':id')
  async patch(@Param('id') id: string, @Body() dto: UpdateRegionDto) {
    return this.updateInternal(id, dto);
  }

  private async updateInternal(id: string, dto: UpdateRegionDto) {
    const payload = normalizeUpdatePayload(dto);
    const current = await this.db.query<{ id: string; region_code: string; region_name: string; region_type: string; status: string }>(
      `select id, region_code, region_name, region_type, status from region where id = $1`,
      [id]
    );
    if (!current.rows[0]) {
      throw new HttpException(
        { code: 'NOT_FOUND', message: 'Region not found', data: null },
        HttpStatus.NOT_FOUND
      );
    }

    await this.db.query(
      `
        update region
        set
          region_name = $2,
          status = $3,
          updated_at = now()
        where id = $1
      `,
      [
        id,
        payload.name ?? current.rows[0].region_name,
        payload.enabled == null ? current.rows[0].status : payload.enabled ? 'active' : 'inactive'
      ]
    );

    const updated = await this.getCanonicalRegionById(id);
    return ok({ updated });
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const blockers = await this.db.query<{ type: string; count: number }>(
      `
        with blocker_rows as (
          select 'child_region'::text as type, count(*)::int as count from region where parent_id = $1
          union all
          select 'project'::text as type, count(*)::int as count from project where region_id = $1
          union all
          select 'asset_manual_location'::text as type, count(*)::int as count from asset where manual_region_id = $1
          union all
          select 'device_region'::text as type, count(*)::int as count from device where region_id = $1
          union all
          select 'valve_farmland_region'::text as type, count(*)::int as count from valve where farmland_region_id = $1
          union all
          select 'data_scope'::text as type, count(*)::int as count from sys_data_scope where scope_type = 'region' and scope_ref_id = $1
        )
        select type, count
        from blocker_rows
        where count > 0
      `,
      [id]
    );

    if (blockers.rows.length > 0) {
      throw new HttpException(
        {
          code: 'DELETE_BLOCKED',
          message: 'Region cannot be deleted while related data still exists',
          data: { blocked_by: blockers.rows }
        },
        HttpStatus.CONFLICT
      );
    }

    await this.db.query(`delete from region where id = $1`, [id]);
    return ok({ deleted: true, id });
  }
}

@Module({
  controllers: [RegionController],
  providers: [RegionCompatService]
})
export class RegionModule {}
