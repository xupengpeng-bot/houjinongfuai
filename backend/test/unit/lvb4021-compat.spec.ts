import {
  meteringTypeToPointType,
  resolveAreaSizeForWrite,
  resolveMeteringTypeForUpdate,
  resolveMeteringTypeForWrite,
  toMeteringPointCompat,
  toProjectBlockCompat,
  type MeteringPointRow,
  type ProjectBlockRow
} from '../../src/common/contracts/lvb4021-compat';

describe('lvb4021-compat (COD-2026-03-26-018)', () => {
  it('mirrors area_size as area_hectare on project blocks', () => {
    const row: ProjectBlockRow = {
      id: '1',
      block_code: 'BLK-HJ-001',
      project_id: 'p',
      project_name: 'P',
      block_name: 'B',
      center_latitude: null,
      center_longitude: null,
      area_size: '125',
      priority: 0,
      status: 'active',
      remarks: ''
    };
    const out = toProjectBlockCompat(row);
    expect(out.area_size).toBe('125');
    expect(out.area_hectare).toBe(125);
  });

  it('accepts area_hectare in write DTO as alias for area_size', () => {
    expect(resolveAreaSizeForWrite({ area_hectare: 10 })).toBe(10);
    expect(resolveAreaSizeForWrite({ area_size: 5 })).toBe(5);
  });

  it('maps stored metering_type to UI point_type and exposes point_code alias', () => {
    const row: MeteringPointRow = {
      id: 'm1',
      metering_point_code: 'MP-HJ-001',
      project_id: 'p',
      project_name: 'P',
      block_id: 'b',
      block_name: 'B',
      asset_id: null,
      primary_meter_device_id: null,
      point_name: 'Demo',
      metering_type: 'GRID_METER',
      rated_capacity_kva: '200',
      status: 'active',
      remarks: '',
      tariff_plan_id: null
    };
    expect(meteringTypeToPointType('GRID_METER')).toBe('main_meter');
    const json = toMeteringPointCompat(row);
    expect(json.metering_point_code).toBe('MP-HJ-001');
    expect(json.point_code).toBe('MP-HJ-001');
    expect(json.point_type).toBe('main_meter');
    expect(json.rated_capacity_kva).toBe(200);
  });

  it('maps UI point_type to stored metering_type on create', () => {
    expect(resolveMeteringTypeForWrite({ point_type: 'sub_meter' })).toBe('SUB_METER');
    expect(resolveMeteringTypeForWrite({ metering_type: 'CUSTOM' })).toBe('CUSTOM');
  });

  it('resolves metering type on update from point_type when metering_type omitted', () => {
    const existing: MeteringPointRow = {
      id: 'm1',
      metering_point_code: 'X',
      project_id: 'p',
      project_name: 'P',
      block_id: 'b',
      block_name: 'B',
      asset_id: null,
      primary_meter_device_id: null,
      point_name: 'Demo',
      metering_type: 'GRID_METER',
      rated_capacity_kva: null,
      status: 'active',
      remarks: '',
      tariff_plan_id: null
    };
    expect(resolveMeteringTypeForUpdate({ point_type: 'transformer' }, existing)).toBe('TRANSFORMER');
  });
});
