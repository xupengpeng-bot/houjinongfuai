/**
 * LVB-4021 API compatibility: canonical DB field names plus frontend aliases.
 * Does not change schema; mapping is response/DTO boundary only.
 */

export interface ProjectBlockRow {
  id: string;
  block_code: string;
  project_id: string;
  project_name: string;
  block_name: string;
  center_latitude: string | null;
  center_longitude: string | null;
  area_size: string | null;
  priority: number;
  status: string;
  remarks: string;
}

export interface MeteringPointRow {
  id: string;
  metering_point_code: string;
  project_id: string;
  project_name: string;
  block_id: string;
  block_name: string;
  asset_id: string | null;
  primary_meter_device_id: string | null;
  point_name: string;
  metering_type: string;
  rated_capacity_kva: string | null;
  status: string;
  remarks: string;
  tariff_plan_id: string | null;
}

export interface CreateProjectBlockAreaInput {
  area_size?: number | null;
  area_hectare?: number | null;
}

export function resolveAreaSizeForWrite(dto: CreateProjectBlockAreaInput): number | null | undefined {
  if (dto.area_size !== undefined) return dto.area_size;
  if (dto.area_hectare !== undefined) return dto.area_hectare;
  return undefined;
}

export function toProjectBlockCompat(row: ProjectBlockRow): ProjectBlockRow & { area_hectare: number | null } {
  const raw = row.area_size;
  const areaNum = raw != null && raw !== '' ? Number(raw) : null;
  return {
    ...row,
    area_hectare: areaNum !== null && Number.isFinite(areaNum) ? areaNum : null
  };
}

const METERING_TYPE_TO_POINT_TYPE: Record<string, string> = {
  GRID_METER: 'main_meter',
  MAIN_METER: 'main_meter',
  SUB_METER: 'sub_meter',
  TRANSFORMER: 'transformer',
  TRANSFORMER_ZONE: 'transformer'
};

const POINT_TYPE_TO_METERING_TYPE: Record<string, string> = {
  main_meter: 'GRID_METER',
  sub_meter: 'SUB_METER',
  transformer: 'TRANSFORMER'
};

export function meteringTypeToPointType(stored: string): string {
  return METERING_TYPE_TO_POINT_TYPE[stored] ?? stored;
}

export function resolveMeteringTypeForWrite(dto: { metering_type?: string; point_type?: string }): string | undefined {
  const mt = dto.metering_type?.trim();
  if (mt) return mt;
  const pt = dto.point_type?.trim();
  if (!pt) return undefined;
  return POINT_TYPE_TO_METERING_TYPE[pt] ?? pt;
}

export interface MeteringPointWritePatch {
  metering_type?: string;
  point_type?: string;
}

export function resolveMeteringTypeForUpdate(dto: MeteringPointWritePatch, existing: MeteringPointRow): string {
  if (dto.metering_type !== undefined) {
    const t = dto.metering_type.trim();
    return t || existing.metering_type;
  }
  if (dto.point_type !== undefined) {
    return resolveMeteringTypeForWrite({ point_type: dto.point_type }) ?? existing.metering_type;
  }
  return existing.metering_type;
}

function parseRatedKva(raw: string | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function toMeteringPointCompat(row: MeteringPointRow): Record<string, unknown> {
  const { rated_capacity_kva: rkv, ...rest } = row;
  return {
    ...rest,
    rated_capacity_kva: parseRatedKva(rkv),
    point_code: row.metering_point_code,
    point_type: meteringTypeToPointType(row.metering_type)
  };
}

export const FORM_OPTION_POINT_TYPES: { value: string; label: string }[] = [
  { value: 'main_meter', label: '总表' },
  { value: 'sub_meter', label: '分表' },
  { value: 'transformer', label: '变压器台区表' }
];

export const FORM_OPTION_STATUSES: { value: string; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '在线' },
  { value: 'inactive', label: '停用' },
  { value: 'fault', label: '故障' }
];
