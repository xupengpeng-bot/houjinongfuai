import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../db/database.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

type RegionLevel = 'province' | 'city' | 'county' | 'town' | 'village';

interface RegionReferenceRow {
  code: string;
  name: string;
  level: RegionLevel;
  parent_code: string | null;
  full_path_name: string;
  full_path_code: string;
  enabled: boolean;
}

interface BusinessRegionRow {
  id: string;
  region_code: string;
  region_name: string;
  region_type: RegionLevel;
  parent_id: string | null;
}

function appException(status: HttpStatus, code: string, message: string, data: Record<string, unknown> = {}) {
  return new HttpException(
    {
      requestId: 'local-dev',
      code,
      message,
      data
    },
    status
  );
}

@Injectable()
export class RegionCompatService {
  constructor(private readonly db: DatabaseService) {}

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private async findBusinessRegionByCode(code: string, client?: PoolClient) {
    const result = await this.db.query<BusinessRegionRow>(
      `
      select id, region_code, region_name, region_type, parent_id
      from region
      where tenant_id = $1 and region_code = $2
      `,
      [TENANT_ID, code],
      client
    );
    return result.rows[0] ?? null;
  }

  private async findBusinessRegionById(id: string, client?: PoolClient) {
    const result = await this.db.query<BusinessRegionRow>(
      `
      select id, region_code, region_name, region_type, parent_id
      from region
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, id],
      client
    );
    return result.rows[0] ?? null;
  }

  async ensureBusinessRegionByReferenceCode(code: string, client?: PoolClient): Promise<BusinessRegionRow> {
    const existing = await this.findBusinessRegionByCode(code, client);
    if (existing) return existing;

    const targetResult = await this.db.query<RegionReferenceRow>(
      `
      select code, name, level, parent_code, full_path_name, full_path_code, enabled
      from region_reference
      where code = $1 and enabled = true
      `,
      [code],
      client
    );

    const target = targetResult.rows[0];
    if (!target) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          region_code: 'region library code is invalid'
        }
      });
    }

    const pathCodes = target.full_path_code.split('/').filter(Boolean);
    const pathResult = await this.db.query<RegionReferenceRow>(
      `
      select code, name, level, parent_code, full_path_name, full_path_code, enabled
      from region_reference
      where code = any($1::text[])
      order by array_position($1::text[], code)
      `,
      [pathCodes],
      client
    );

    let parentId: string | null = null;
    let current: BusinessRegionRow | null = null;

    for (const ref of pathResult.rows) {
      const found = await this.findBusinessRegionByCode(ref.code, client);
      if (found) {
        parentId = found.id;
        current = found;
        continue;
      }

      const insertedResult: { rows: BusinessRegionRow[] } = await this.db.query<BusinessRegionRow>(
        `
        insert into region (
          tenant_id,
          parent_id,
          region_code,
          region_name,
          region_type,
          full_path,
          status
        ) values ($1, $2, $3, $4, $5, $6, 'active')
        returning id, region_code, region_name, region_type, parent_id
        `,
        [TENANT_ID, parentId, ref.code, ref.name, ref.level, `/${ref.full_path_code}`],
        client
      );
      const inserted = insertedResult.rows[0];
      current = inserted;
      parentId = inserted.id;
    }

    if (!current) {
      throw appException(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', 'Failed to materialize region from reference library');
    }

    return current;
  }

  async resolveBusinessRegionId(input: string, fieldName: string, client?: PoolClient): Promise<string> {
    const value = input.trim();
    if (!value) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { [fieldName]: `${fieldName} is required` }
      });
    }

    if (this.isUuid(value)) {
      const business = await this.findBusinessRegionById(value, client);
      if (!business) {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
          fieldErrors: { [fieldName]: `${fieldName} is invalid` }
        });
      }
      return business.id;
    }

    const materialized = await this.ensureBusinessRegionByReferenceCode(value, client);
    return materialized.id;
  }

  async resolveRegionCodeForApi(input: string | null, client?: PoolClient): Promise<string | null> {
    if (!input) return null;
    const value = input.trim();
    if (!value) return null;

    if (this.isUuid(value)) {
      const business = await this.findBusinessRegionById(value, client);
      return business?.region_code ?? value;
    }

    return value;
  }
}
