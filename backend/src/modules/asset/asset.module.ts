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
  Param,
  Post,
  Put,
  Query
} from '@nestjs/common';
import { ArchiveService } from '../../common/archive/archive.service';
import { DatabaseService } from '../../common/db/database.service';
import {
  ASSET_EFFECTIVE_LATITUDE_SQL,
  ASSET_EFFECTIVE_LONGITUDE_SQL,
  ASSET_EFFECTIVE_SOURCE_SQL,
  buildSpatialLocationReadModelAsset
} from '../../common/location/effective-location';
import {
  assertNoForbiddenSpatialWriteKeys,
  SPATIAL_LOCATION_LAYERS_CONTRACT_V1
} from '../../common/location/spatial-location-semantics';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ASSET_CODE_PREFIX = 'AST-HJ-';
const ASSET_TYPES = ['well', 'pump_station', 'weather_point', 'pump', 'pipe', 'elbow', 'valve_group', 'control_zone', 'power_box', 'well_house'] as const;
const LIFECYCLE_STATUSES = ['draft', 'active', 'decommissioned'] as const;
const INSTALL_STATUSES = ['planned', 'installed', 'removed'] as const;
const LOCATION_SOURCE_STRATEGIES = [
  'manual_preferred',
  'reported_preferred',
  'manual_only',
  'reported_only',
  'auto'
] as const;

type AssetType = (typeof ASSET_TYPES)[number];
type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
type InstallStatus = (typeof INSTALL_STATUSES)[number];
type LocationSourceStrategy = (typeof LOCATION_SOURCE_STRATEGIES)[number];

interface AssetRecord {
  id: string;
  asset_code: string;
  asset_name: string;
  asset_type: AssetType;
  parent_asset_id: string | null;
  parent_asset_name: string | null;
  project_id: string;
  project_name: string;
  region_id: string;
  region_name: string;
  maintenance_team_id: string | null;
  maintenance_team_name: string | null;
  project_maintenance_team_id: string | null;
  project_maintenance_team_name: string | null;
  effective_maintenance_team_id: string | null;
  effective_maintenance_team_name: string | null;
  lifecycle_status: LifecycleStatus;
  install_status: InstallStatus;
  manual_region_id: string | null;
  manual_address_text: string | null;
  manual_latitude: number | null;
  manual_longitude: number | null;
  install_position_desc: string | null;
  location_source_strategy: LocationSourceStrategy | null;
  reported_latitude: number | null;
  reported_longitude: number | null;
  reported_at: string | null;
  reported_source: string | null;
  effective_latitude: number | null;
  effective_longitude: number | null;
  effective_location_source: string | null;
  location_read_model?: ReturnType<typeof buildSpatialLocationReadModelAsset>;
}

interface AssetOption {
  value: string;
  label: string;
  asset_code: string;
  asset_type: AssetType;
  project_id: string;
  project_name: string;
}

interface AssetTypeOption {
  value: AssetType;
  label: string;
}

interface AssetLocationSearchItem {
  manual_region_id: string;
  region_code: string;
  region_name: string;
  region_level: string;
  full_path_name: string;
  manual_address_text: string;
  manual_latitude: number | null;
  manual_longitude: number | null;
}

interface AssetLocationSearchResponse {
  items: AssetLocationSearchItem[];
  total: number;
  page: number;
  page_size: number;
  scope: {
    project_id: string;
    project_name: string;
    region_id: string;
    region_code: string;
    region_name: string;
  };
}

interface CreateAssetDto {
  asset_code?: string;
  asset_name?: string;
  asset_type?: AssetType;
  project_id?: string;
  maintenance_team_id?: string | null;
  parent_asset_id?: string | null;
  lifecycle_status?: LifecycleStatus;
  install_status?: InstallStatus;
  manual_region_id?: string | null;
  manual_address_text?: string | null;
  manual_latitude?: number | null;
  manual_longitude?: number | null;
  install_position_desc?: string | null;
  location_source_strategy?: LocationSourceStrategy;
}

interface UpdateAssetDto {
  asset_name?: string;
  asset_type?: AssetType;
  project_id?: string;
  maintenance_team_id?: string | null;
  parent_asset_id?: string | null;
  lifecycle_status?: LifecycleStatus;
  install_status?: InstallStatus;
  manual_region_id?: string | null;
  manual_address_text?: string | null;
  manual_latitude?: number | null;
  manual_longitude?: number | null;
  install_position_desc?: string | null;
  location_source_strategy?: LocationSourceStrategy;
}

interface ArchiveAssetDto {
  archive_reason?: string;
  reason_text?: string | null;
  trigger_type?: string;
  source_module?: string;
  source_action?: string;
  ui_entry?: string | null;
  request_id?: string | null;
  batch_id?: string | null;
  operator_id?: string | null;
  operator_name?: string | null;
}

interface AssetTreeNode {
  id: string;
  asset_code: string;
  asset_name: string;
  asset_type: AssetType;
  parent_asset_id?: string | null;
  project_id?: string;
  project_name?: string;
  region_name?: string;
  lifecycle_status?: LifecycleStatus;
  install_status?: InstallStatus;
  children: AssetTreeNode[];
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

function parsePage(value?: string, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value?: string, fallback = 20) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

function assetTypeLabel(value: AssetType): string {
  const labels: Record<AssetType, string> = {
    well: 'Well',
    pump_station: 'Pump Station',
    weather_point: 'Weather Point',
    pump: 'Pump',
    pipe: 'Pipe',
    elbow: 'Elbow',
    valve_group: 'Valve Group',
    control_zone: 'Control Zone',
    power_box: 'Power Box',
    well_house: 'Well House'
  };
  return labels[value];
}

@Injectable()
class AssetService {
  constructor(
    private readonly db: DatabaseService,
    private readonly archiveService: ArchiveService,
  ) {}

  private async nextAssetCode(client?: Parameters<DatabaseService['query']>[2]) {
    const result = await this.db.query<{ value: string }>(
      `select nextval('asset_code_seq')::text as value`,
      [],
      client
    );
    const serial = Number(result.rows[0]?.value ?? '0');
    return `${ASSET_CODE_PREFIX}${serial.toString().padStart(3, '0')}`;
  }

  private async ensureManualRegionCodeExists(regionCode: string, client?: Parameters<DatabaseService['query']>[2]) {
    const result = await this.db.query<{ code: string }>(
      `
      select code
      from region_reference
      where code = $1 and enabled = true
      `,
      [regionCode],
      client
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          manual_region_id: 'manual_region_id is invalid'
        }
      });
    }
  }

  private async fetchById(id: string, client?: Parameters<DatabaseService['query']>[2]) {
    const result = await this.db.query<AssetRecord>(
      `
      select
        a.id,
        a.asset_code,
        a.asset_name,
        a.asset_type,
        a.parent_asset_id,
        pa.asset_name as parent_asset_name,
        a.project_id,
        p.project_name,
        p.region_id,
        r.region_name,
        a.maintenance_team_id,
        amt.team_name as maintenance_team_name,
        p.maintenance_team_id as project_maintenance_team_id,
        pmt.team_name as project_maintenance_team_name,
        coalesce(a.maintenance_team_id, p.maintenance_team_id) as effective_maintenance_team_id,
        coalesce(amt.team_name, pmt.team_name) as effective_maintenance_team_name,
        a.lifecycle_status,
        a.install_status,
        a.manual_region_id,
        a.manual_address_text,
        a.manual_latitude::float8 as manual_latitude,
        a.manual_longitude::float8 as manual_longitude,
        a.install_position_desc,
        a.location_source_strategy,
        a.reported_latitude::float8 as reported_latitude,
        a.reported_longitude::float8 as reported_longitude,
        a.reported_at::text as reported_at,
        a.reported_source,
        ${ASSET_EFFECTIVE_LATITUDE_SQL} as effective_latitude,
        ${ASSET_EFFECTIVE_LONGITUDE_SQL} as effective_longitude,
        ${ASSET_EFFECTIVE_SOURCE_SQL} as effective_location_source
      from asset a
      join project p on p.id = a.project_id
      join region r on r.id = p.region_id
      left join maintenance_team amt on amt.id = a.maintenance_team_id
      left join maintenance_team pmt on pmt.id = p.maintenance_team_id
      left join asset pa on pa.id = a.parent_asset_id
      where a.tenant_id = $1 and a.id = $2
      `,
      [TENANT_ID, id],
      client
    );
    const row = result.rows[0] ?? null;
    if (!row) return null;
    return row;
  }

  private async ensureProjectExists(projectId: string, client?: Parameters<DatabaseService['query']>[2]) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from project
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, projectId],
      client
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          project_id: 'project_id is invalid'
        }
      });
    }
  }

  private async getProjectScope(projectId: string, client?: Parameters<DatabaseService['query']>[2]) {
    const result = await this.db.query<{
      project_id: string;
      project_name: string;
      region_id: string;
      region_code: string;
      region_name: string;
      full_path_code: string;
    }>(
      `
      select
        p.id as project_id,
        p.project_name,
        r.id as region_id,
        r.region_code,
        r.region_name,
        rr.full_path_code
      from project p
      join region r on r.id = p.region_id
      join region_reference rr on rr.code = r.region_code
      where p.tenant_id = $1 and p.id = $2
      `,
      [TENANT_ID, projectId],
      client
    );

    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          project_id: 'project_id is invalid'
        }
      });
    }

    return row;
  }

  private async ensureParentAssetExists(parentAssetId: string, client?: Parameters<DatabaseService['query']>[2]) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from asset
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, parentAssetId],
      client
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          parent_asset_id: 'parent_asset_id is invalid'
        }
      });
    }
  }

  private async ensureActiveMaintenanceTeamExists(maintenanceTeamId: string, client?: Parameters<DatabaseService['query']>[2]) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from maintenance_team
      where tenant_id = $1 and id = $2 and status = 'active'
      `,
      [TENANT_ID, maintenanceTeamId],
      client
    );
    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          maintenance_team_id: 'maintenance_team_id is invalid'
        }
      });
    }
  }

  async list(page = 1, pageSize = 20) {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<AssetRecord & { total_count: string }>(
      `
      select
        a.id,
        a.asset_code,
        a.asset_name,
        a.asset_type,
        a.parent_asset_id,
        pa.asset_name as parent_asset_name,
        a.project_id,
        p.project_name,
        p.region_id,
        r.region_name,
        a.maintenance_team_id,
        amt.team_name as maintenance_team_name,
        p.maintenance_team_id as project_maintenance_team_id,
        pmt.team_name as project_maintenance_team_name,
        coalesce(a.maintenance_team_id, p.maintenance_team_id) as effective_maintenance_team_id,
        coalesce(amt.team_name, pmt.team_name) as effective_maintenance_team_name,
        a.lifecycle_status,
        a.install_status,
        a.manual_region_id,
        a.manual_address_text,
        a.manual_latitude::float8 as manual_latitude,
        a.manual_longitude::float8 as manual_longitude,
        a.install_position_desc,
        a.location_source_strategy,
        a.reported_latitude::float8 as reported_latitude,
        a.reported_longitude::float8 as reported_longitude,
        a.reported_at::text as reported_at,
        a.reported_source,
        ${ASSET_EFFECTIVE_LATITUDE_SQL} as effective_latitude,
        ${ASSET_EFFECTIVE_LONGITUDE_SQL} as effective_longitude,
        ${ASSET_EFFECTIVE_SOURCE_SQL} as effective_location_source,
        count(*) over()::text as total_count
      from asset a
      join project p on p.id = a.project_id
      join region r on r.id = p.region_id
      left join maintenance_team amt on amt.id = a.maintenance_team_id
      left join maintenance_team pmt on pmt.id = p.maintenance_team_id
      left join asset pa on pa.id = a.parent_asset_id
      where a.tenant_id = $1
      order by a.created_at asc
      limit $2 offset $3
      `,
      [TENANT_ID, pageSize, offset]
    );

    // List view: omit per-row location_read_model (same contract as root `spatial_location_contract`).
    // Detail lives on GET /assets/:id — avoids huge payloads and duplicate contract × N.
    const items = result.rows.map(({ total_count, ...row }) => row);
    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
    return {
      items,
      total,
      page,
      page_size: pageSize,
      spatial_location_contract: SPATIAL_LOCATION_LAYERS_CONTRACT_V1
    };
  }

  async tree(): Promise<AssetTreeNode[]> {
    const result = await this.db.query<AssetRecord>(
      `
      select
        a.id,
        a.asset_code,
        a.asset_name,
        a.asset_type,
        a.parent_asset_id,
        pa.asset_name as parent_asset_name,
        a.project_id,
        p.project_name,
        p.region_id,
        r.region_name,
        a.maintenance_team_id,
        amt.team_name as maintenance_team_name,
        p.maintenance_team_id as project_maintenance_team_id,
        pmt.team_name as project_maintenance_team_name,
        coalesce(a.maintenance_team_id, p.maintenance_team_id) as effective_maintenance_team_id,
        coalesce(amt.team_name, pmt.team_name) as effective_maintenance_team_name,
        a.lifecycle_status,
        a.install_status,
        a.manual_region_id,
        a.manual_address_text,
        a.manual_latitude::float8 as manual_latitude,
        a.manual_longitude::float8 as manual_longitude,
        a.install_position_desc,
        a.location_source_strategy,
        a.reported_latitude::float8 as reported_latitude,
        a.reported_longitude::float8 as reported_longitude,
        a.reported_at::text as reported_at,
        a.reported_source,
        ${ASSET_EFFECTIVE_LATITUDE_SQL} as effective_latitude,
        ${ASSET_EFFECTIVE_LONGITUDE_SQL} as effective_longitude,
        ${ASSET_EFFECTIVE_SOURCE_SQL} as effective_location_source
      from asset a
      join project p on p.id = a.project_id
      join region r on r.id = p.region_id
      left join maintenance_team amt on amt.id = a.maintenance_team_id
      left join maintenance_team pmt on pmt.id = p.maintenance_team_id
      left join asset pa on pa.id = a.parent_asset_id
      where a.tenant_id = $1
      order by a.created_at asc
      `,
      [TENANT_ID]
    );

    const nodes = new Map<string, AssetTreeNode>();
    result.rows.forEach((row) => {
      nodes.set(row.id, {
        id: row.id,
        asset_code: row.asset_code,
        asset_name: row.asset_name,
        asset_type: row.asset_type,
        parent_asset_id: row.parent_asset_id,
        project_id: row.project_id,
        project_name: row.project_name,
        region_name: row.region_name,
        lifecycle_status: row.lifecycle_status,
        install_status: row.install_status,
        children: []
      });
    });

    const roots: AssetTreeNode[] = [];
    result.rows.forEach((row) => {
      const node = nodes.get(row.id)!;
      if (row.parent_asset_id && nodes.has(row.parent_asset_id)) {
        nodes.get(row.parent_asset_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }

  async options(): Promise<AssetOption[]> {
    const result = await this.db.query<AssetOption>(
      `
      select
        a.id as value,
        a.asset_name as label,
        a.asset_code,
        a.asset_type,
        a.project_id,
        p.project_name
      from asset a
      join project p on p.id = a.project_id
      where a.tenant_id = $1
      order by a.created_at asc
      `,
      [TENANT_ID]
    );
    return result.rows;
  }

  typeOptions(): AssetTypeOption[] {
    return ASSET_TYPES.map((value) => ({
      value,
      label: assetTypeLabel(value)
    }));
  }

  async getById(id: string) {
    const row = await this.fetchById(id);
    if (!row) {
      throw appException(HttpStatus.NOT_FOUND, 'TARGET_NOT_FOUND', 'Asset not found', { id });
    }
    return {
      ...row,
      location_read_model: buildSpatialLocationReadModelAsset(row)
    };
  }

  async searchLocations(projectId: string, q: string, page = 1, pageSize = 20): Promise<AssetLocationSearchResponse> {
    const normalizedProjectId = projectId.trim();
    const normalizedQuery = q.trim();
    if (!normalizedProjectId) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          project_id: 'project_id is required'
        }
      });
    }
    if (normalizedQuery.length < 2) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: {
          q: 'q must be at least 2 characters'
        }
      });
    }

    const scope = await this.getProjectScope(normalizedProjectId);
    const offset = (page - 1) * pageSize;
    const likeQuery = `%${escapeLikePattern(normalizedQuery)}%`;
    const scopedPrefix = `${scope.full_path_code}/%`;

    const result = await this.db.query<
      {
        code: string;
        name: string;
        level: string;
        full_path_name: string;
        total_count: string;
      }
    >(
      `
      select
        rr.code,
        rr.name,
        rr.level,
        rr.full_path_name,
        count(*) over()::text as total_count
      from region_reference rr
      where rr.enabled = true
        and (
          rr.full_path_code = $1
          or rr.full_path_code like $2 escape '\\'
        )
        and (
          rr.code ilike $3 escape '\\'
          or rr.name ilike $3 escape '\\'
          or rr.full_path_name ilike $3 escape '\\'
        )
      order by
        case when rr.code = $4 then 0 else 1 end,
        rr.full_path_code asc
      limit $5 offset $6
      `,
      [scope.full_path_code, scopedPrefix, likeQuery, scope.region_code, pageSize, offset]
    );

    return {
      items: result.rows.map(({ total_count, ...row }) => ({
        manual_region_id: row.code,
        region_code: row.code,
        region_name: row.name,
        region_level: row.level,
        full_path_name: row.full_path_name,
        manual_address_text: row.full_path_name,
        manual_latitude: null,
        manual_longitude: null
      })),
      total: result.rows.length > 0 ? Number(result.rows[0].total_count) : 0,
      page,
      page_size: pageSize,
      scope: {
        project_id: scope.project_id,
        project_name: scope.project_name,
        region_id: scope.region_id,
        region_code: scope.region_code,
        region_name: scope.region_name
      }
    };
  }

  async create(dto: CreateAssetDto) {
    assertNoForbiddenSpatialWriteKeys(dto as Record<string, unknown>);
    const fieldErrors: Record<string, string> = {};
    if (dto.asset_code?.trim()) fieldErrors.asset_code = 'asset_code must not be provided';
    if (!dto.asset_name?.trim()) fieldErrors.asset_name = 'asset_name is required';
    if (!dto.asset_type?.trim()) fieldErrors.asset_type = 'asset_type is required';
    if (!dto.project_id?.trim()) fieldErrors.project_id = 'project_id is required';
    if (dto.asset_type && !ASSET_TYPES.includes(dto.asset_type)) fieldErrors.asset_type = 'asset_type is invalid';
    if (dto.lifecycle_status && !LIFECYCLE_STATUSES.includes(dto.lifecycle_status)) fieldErrors.lifecycle_status = 'lifecycle_status is invalid';
    if (dto.install_status && !INSTALL_STATUSES.includes(dto.install_status)) fieldErrors.install_status = 'install_status is invalid';
    if (dto.location_source_strategy && !LOCATION_SOURCE_STRATEGIES.includes(dto.location_source_strategy)) {
      fieldErrors.location_source_strategy = 'location_source_strategy is invalid';
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors });
    }

    const createdId = await this.db.withTransaction(async (client) => {
      await this.ensureProjectExists(dto.project_id!.trim(), client);
      if (dto.maintenance_team_id?.trim()) {
        await this.ensureActiveMaintenanceTeamExists(dto.maintenance_team_id.trim(), client);
      }
      if (dto.parent_asset_id?.trim()) {
        await this.ensureParentAssetExists(dto.parent_asset_id.trim(), client);
      }

      const resolvedManualRegionId = dto.manual_region_id?.trim()
        ? dto.manual_region_id.trim()
        : null;
      if (resolvedManualRegionId) {
        await this.ensureManualRegionCodeExists(resolvedManualRegionId, client);
      }

      const generatedAssetCode = await this.nextAssetCode(client);

      const inserted = await this.db.query<{ id: string }>(
        `
        insert into asset (
          tenant_id,
          asset_code,
          asset_name,
          asset_type,
          parent_asset_id,
          project_id,
          maintenance_team_id,
          lifecycle_status,
          install_status,
          manual_region_id,
          manual_address_text,
          manual_latitude,
          manual_longitude,
          install_position_desc,
          location_source_strategy
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        returning id
        `,
        [
          TENANT_ID,
          generatedAssetCode,
          dto.asset_name!.trim(),
          dto.asset_type!,
          dto.parent_asset_id?.trim() || null,
          dto.project_id!.trim(),
          dto.maintenance_team_id?.trim() || null,
          dto.lifecycle_status ?? 'draft',
          dto.install_status ?? 'planned',
          resolvedManualRegionId,
          dto.manual_address_text?.trim() || null,
          dto.manual_latitude ?? null,
          dto.manual_longitude ?? null,
          dto.install_position_desc?.trim() || null,
          dto.location_source_strategy ?? 'manual_preferred'
        ],
        client
      );
      return inserted.rows[0].id;
    });

    return this.getById(createdId);
  }

  async update(id: string, dto: UpdateAssetDto) {
    assertNoForbiddenSpatialWriteKeys(dto as Record<string, unknown>);
    if (dto.asset_type && !ASSET_TYPES.includes(dto.asset_type)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { asset_type: 'asset_type is invalid' }
      });
    }
    if (dto.lifecycle_status && !LIFECYCLE_STATUSES.includes(dto.lifecycle_status)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { lifecycle_status: 'lifecycle_status is invalid' }
      });
    }
    if (dto.install_status && !INSTALL_STATUSES.includes(dto.install_status)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { install_status: 'install_status is invalid' }
      });
    }
    if (dto.location_source_strategy && !LOCATION_SOURCE_STRATEGIES.includes(dto.location_source_strategy)) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { location_source_strategy: 'location_source_strategy is invalid' }
      });
    }

    const existing = await this.getById(id);

    await this.db.withTransaction(async (client) => {
      if (dto.project_id?.trim()) {
        await this.ensureProjectExists(dto.project_id.trim(), client);
      }
      if (dto.maintenance_team_id?.trim()) {
        await this.ensureActiveMaintenanceTeamExists(dto.maintenance_team_id.trim(), client);
      }
      if (dto.parent_asset_id?.trim()) {
        if (dto.parent_asset_id === id) {
          throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
            fieldErrors: { parent_asset_id: 'parent_asset_id cannot equal current asset' }
          });
        }
        await this.ensureParentAssetExists(dto.parent_asset_id.trim(), client);
      }

      const resolvedManualRegionId = dto.manual_region_id === undefined
        ? existing.manual_region_id
        : dto.manual_region_id?.trim() || null;
      if (resolvedManualRegionId) {
        await this.ensureManualRegionCodeExists(resolvedManualRegionId, client);
      }

      await this.db.query(
        `
        update asset
        set
          asset_name = $3,
          asset_type = $4,
          parent_asset_id = $5,
          project_id = $6,
          maintenance_team_id = $7,
          lifecycle_status = $8,
          install_status = $9,
          manual_region_id = $10,
          manual_address_text = $11,
          manual_latitude = $12,
          manual_longitude = $13,
          install_position_desc = $14,
          location_source_strategy = $15,
          updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [
          TENANT_ID,
          id,
          dto.asset_name?.trim() ?? existing.asset_name,
          dto.asset_type ?? existing.asset_type,
          dto.parent_asset_id === undefined ? existing.parent_asset_id : dto.parent_asset_id?.trim() || null,
          dto.project_id?.trim() ?? existing.project_id,
          dto.maintenance_team_id === undefined ? existing.maintenance_team_id : dto.maintenance_team_id?.trim() || null,
          dto.lifecycle_status ?? existing.lifecycle_status,
          dto.install_status ?? existing.install_status,
          resolvedManualRegionId,
          dto.manual_address_text === undefined ? existing.manual_address_text : dto.manual_address_text?.trim() || null,
          dto.manual_latitude === undefined ? existing.manual_latitude : dto.manual_latitude,
          dto.manual_longitude === undefined ? existing.manual_longitude : dto.manual_longitude,
          dto.install_position_desc === undefined ? existing.install_position_desc : dto.install_position_desc?.trim() || null,
          dto.location_source_strategy ?? existing.location_source_strategy ?? 'manual_preferred'
        ],
        client
      );
    });

    return this.getById(id);
  }

  async delete(id: string) {
    return this.archive(id, {
      archive_reason: 'manual_remove',
      reason_text: 'Archived from asset delete flow',
      trigger_type: 'manual_delete',
      source_module: 'asset',
      source_action: 'DELETE /assets/:id',
      ui_entry: 'asset.detail'
    });
  }

  async archive(id: string, dto: ArchiveAssetDto = {}) {
    const archiveMeta = await this.db.withTransaction(async (client) => {
      const existing = await this.fetchById(id, client);
      if (!existing) {
        throw appException(HttpStatus.NOT_FOUND, 'TARGET_NOT_FOUND', 'Asset not found', { id });
      }

      const childCount = await this.db.query<{ count: string }>(
        `
        select count(*)::text as count
        from asset
        where tenant_id = $1 and parent_asset_id = $2
        `,
        [TENANT_ID, id],
        client
      );

      if (Number(childCount.rows[0]?.count ?? 0) > 0) {
        throw appException(HttpStatus.CONFLICT, 'DELETE_BLOCKED', 'Asset cannot be deleted while child assets still exist', {
          id,
          reason: 'HAS_CHILD_ASSETS'
        });
      }

      const linkedMeteringPoints = await this.db.query<{ count: string }>(
        `
        select count(*)::text as count
        from metering_point
        where tenant_id = $1 and asset_id = $2
        `,
        [TENANT_ID, id],
        client
      );

      if (Number(linkedMeteringPoints.rows[0]?.count ?? 0) > 0) {
        throw appException(HttpStatus.CONFLICT, 'DELETE_BLOCKED', 'Asset cannot be deleted while metering points still reference it', {
          id,
          reason: 'HAS_METERING_POINTS'
        });
      }

      const archiveResult = await this.archiveService.archiveAsset(
        {
          tenantId: TENANT_ID,
          originId: existing.id,
          originCode: existing.asset_code,
          entityName: existing.asset_name,
          archiveReason: dto.archive_reason?.trim() || 'manual_remove',
          reasonText: dto.reason_text?.trim() || 'Archived from asset delete flow',
          triggerType: dto.trigger_type?.trim() || 'manual_delete',
          sourceModule: dto.source_module?.trim() || 'asset',
          sourceAction: dto.source_action?.trim() || 'DELETE /assets/:id',
          uiEntry: dto.ui_entry?.trim() || 'asset.detail',
          requestId: dto.request_id?.trim() || null,
          batchId: dto.batch_id?.trim() || null,
          operatorId: dto.operator_id?.trim() || null,
          operatorName: dto.operator_name?.trim() || null,
          snapshot: {
            ...existing,
            location_read_model: buildSpatialLocationReadModelAsset(existing)
          }
        },
        client
      );

      await this.db.query(
        `
        delete from asset
        where tenant_id = $1 and id = $2
        `,
        [TENANT_ID, id],
        client
      );

      return archiveResult;
    });

    return { id, archive_id: archiveMeta.archiveId };
  }
}

@Controller('assets')
class AssetController {
  constructor(private readonly service: AssetService) {}

  @Get()
  list(@Query('page') page?: string, @Query('page_size') pageSize?: string) {
    return this.service.list(parsePage(page), parsePageSize(pageSize));
  }

  @Get('tree')
  tree() {
    return this.service.tree();
  }

  @Get('options')
  options() {
    return this.service.options();
  }

  @Get('type-options')
  typeOptions() {
    return this.service.typeOptions();
  }

  @Get('spatial-location-contract')
  spatialLocationContract() {
    return { spatial_location_contract: SPATIAL_LOCATION_LAYERS_CONTRACT_V1 };
  }

  @Get('location-search')
  searchLocations(
    @Query('project_id') projectId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string
  ) {
    return this.service.searchLocations(projectId ?? '', q ?? '', parsePage(page), parsePageSize(pageSize));
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post()
  create(@Body() dto: CreateAssetDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string, @Body() dto: ArchiveAssetDto) {
    return this.service.archive(id, dto);
  }
}

@Module({
  controllers: [AssetController],
  providers: [AssetService]
})
export class AssetModule {}
