import { Controller, Get, HttpException, HttpStatus, Injectable, Module, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

type RegionReferenceLevel = 'province' | 'city' | 'county' | 'town' | 'village';

interface RegionReferenceRow {
  id: string;
  code: string;
  name: string;
  level: RegionReferenceLevel;
  parent_code: string | null;
  full_path_name: string;
  full_path_code: string;
  enabled: boolean;
  source_type: string;
  source_version: string;
  effective_date: string;
}

function parsePage(value?: string, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value?: string, fallback = 20) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnabled(value?: string) {
  if (value == null || value === '') {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new HttpException(
    {
      requestId: 'local-dev',
      code: 'VALIDATION_ERROR',
      message: 'enabled must be true or false',
      data: { field: 'enabled' }
    },
    HttpStatus.BAD_REQUEST
  );
}

@Injectable()
class RegionLibraryService {
  constructor(private readonly db: DatabaseService) {}

  async search(params: {
    q?: string;
    level?: string;
    parentCode?: string;
    enabled?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const values: unknown[] = [];
    const where: string[] = [];

    if (params.q?.trim()) {
      values.push(`%${params.q.trim()}%`);
      where.push(`(rr.code ilike $${values.length} or rr.name ilike $${values.length} or rr.full_path_name ilike $${values.length})`);
    }

    if (params.level?.trim()) {
      values.push(params.level.trim());
      where.push(`rr.level = $${values.length}`);
    }

    if (params.parentCode?.trim()) {
      values.push(params.parentCode.trim());
      where.push(`rr.parent_code = $${values.length}`);
    }

    if (params.enabled != null) {
      values.push(params.enabled);
      where.push(`rr.enabled = $${values.length}`);
    }

    values.push(pageSize, offset);
    const whereClause = where.length > 0 ? `where ${where.join(' and ')}` : '';

    const result = await this.db.query<RegionReferenceRow & { total_count: string }>(
      `
      select
        rr.id,
        rr.code,
        rr.name,
        rr.level,
        rr.parent_code,
        rr.full_path_name,
        rr.full_path_code,
        rr.enabled,
        rr.source_type,
        rr.source_version,
        to_char(rr.effective_date, 'YYYY-MM-DD') as effective_date,
        count(*) over()::text as total_count
      from region_reference rr
      ${whereClause}
      order by rr.full_path_code asc
      limit $${values.length - 1} offset $${values.length}
      `,
      values
    );

    const items = result.rows.map(({ total_count, ...row }) => ({
      ...row,
      value: row.code,
      label: row.name
    }));
    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

    return ok({
      items,
      page,
      page_size: pageSize,
      total
    });
  }

  async children(parentCode?: string) {
    const values: unknown[] = [];
    let whereClause = 'where rr.parent_code is null';
    if (parentCode?.trim()) {
      values.push(parentCode.trim());
      whereClause = `where rr.parent_code = $1`;
    }

    const result = await this.db.query<RegionReferenceRow>(
      `
      select
        rr.id,
        rr.code,
        rr.name,
        rr.level,
        rr.parent_code,
        rr.full_path_name,
        rr.full_path_code,
        rr.enabled,
        rr.source_type,
        rr.source_version,
        to_char(rr.effective_date, 'YYYY-MM-DD') as effective_date
      from region_reference rr
      ${whereClause}
      order by rr.full_path_code asc
      `,
      values
    );

    return ok({
      items: result.rows.map((row) => ({
        ...row,
        value: row.code,
        label: row.name
      }))
    });
  }

  async path(code?: string) {
    if (!code?.trim()) {
      throw new HttpException(
        {
          requestId: 'local-dev',
          code: 'VALIDATION_ERROR',
          message: 'code is required',
          data: { field: 'code' }
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await this.db.query<RegionReferenceRow>(
      `
      with recursive upward as (
        select
          rr.id,
          rr.code,
          rr.name,
          rr.level,
          rr.parent_code,
          rr.full_path_name,
          rr.full_path_code,
          rr.enabled,
          rr.source_type,
          rr.source_version,
          rr.effective_date,
          0::int as depth
        from region_reference rr
        where rr.code = $1

        union all

        select
          parent.id,
          parent.code,
          parent.name,
          parent.level,
          parent.parent_code,
          parent.full_path_name,
          parent.full_path_code,
          parent.enabled,
          parent.source_type,
          parent.source_version,
          parent.effective_date,
          upward.depth + 1
        from region_reference parent
        join upward on upward.parent_code = parent.code
      )
      select
        id,
        code,
        name,
        level,
        parent_code,
        full_path_name,
        full_path_code,
        enabled,
        source_type,
        source_version,
        to_char(effective_date, 'YYYY-MM-DD') as effective_date
      from upward
      order by depth desc
      `,
      [code.trim()]
    );

    if (result.rows.length === 0) {
      throw new HttpException(
        {
          requestId: 'local-dev',
          code: 'NOT_FOUND',
          message: 'Region reference not found',
          data: { code: code.trim() }
        },
        HttpStatus.NOT_FOUND
      );
    }

    const path = result.rows.map((row) => ({
      ...row,
      value: row.code,
      label: row.name
    }));

    return ok({
      selected: path[path.length - 1],
      ancestors: path.slice(0, -1),
      path
    });
  }
}

@Controller('region-library')
class RegionLibraryController {
  constructor(private readonly service: RegionLibraryService) {}

  @Get('search')
  search(
    @Query('q') q?: string,
    @Query('level') level?: string,
    @Query('parent_code') parentCode?: string,
    @Query('enabled') enabled?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string
  ) {
    return this.service.search({
      q,
      level,
      parentCode,
      enabled: parseEnabled(enabled),
      page: parsePage(page),
      pageSize: parsePageSize(pageSize)
    });
  }

  @Get('children')
  children(@Query('parent_code') parentCode?: string) {
    return this.service.children(parentCode);
  }

  @Get('path')
  path(@Query('code') code?: string) {
    return this.service.path(code);
  }
}

@Module({
  controllers: [RegionLibraryController],
  providers: [RegionLibraryService]
})
export class RegionLibraryModule {}
