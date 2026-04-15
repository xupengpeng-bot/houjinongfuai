import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceGatewayMaintainerService } from '../../src/modules/device-gateway/device-gateway-maintainer.service';
import { DeviceGatewayService } from '../../src/modules/device-gateway/device-gateway.service';
import { NetworkWorkbenchService } from '../../src/modules/network-workbench/network-workbench.service';
import { SolverService } from '../../src/modules/solver/solver.service';
import { TcpJsonV1Server } from '../../src/modules/device-gateway/tcp-json-v1.server';

describe('NetworkWorkbenchService scoped pump-valve relation generation', () => {
  const db = {
    query: jest.fn(),
  } as unknown as DatabaseService;

  const service = new NetworkWorkbenchService(
    db,
    {} as DeviceGatewayService,
    {} as DeviceGatewayMaintainerService,
    {} as TcpJsonV1Server,
    {} as SolverService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates scoped relations even when the published draft pipe is stored in reverse direction', async () => {
    jest.spyOn(service as any, 'loadPublishedGraphDraftSnapshot').mockResolvedValue({
      nodes: [
        {
          node_code: 'SRC1',
          node_type: 'source_station',
          node_name: '1号机井',
          device_ids: ['11111111-1111-1111-1111-111111111111'],
          node_params: {
            source_kind: 'groundwater',
            design_flow_m3h: 36,
            pump_head_m: 42,
          },
          pump_units: [
            {
              unit_code: 'SRC1-P01',
              device_ids: ['22222222-2222-2222-2222-222222222222'],
              rated_power_kw: 18.5,
            },
          ],
        },
        {
          node_code: 'OUT1',
          node_type: 'outlet',
          node_name: '1号出水口',
          device_ids: ['33333333-3333-3333-3333-333333333333'],
          node_params: {
            valve_mode: 'solenoid',
          },
          pump_units: [],
        },
      ],
      pipes: [
        {
          pipe_code: 'P-REV-1',
          pipe_type: 'main',
          from_node_code: 'OUT1',
          to_node_code: 'SRC1',
        },
      ],
    });

    const insertedRelationCalls: unknown[][] = [];

    (db.query as jest.Mock).mockImplementation(async (sql: string, params: unknown[]) => {
      const text = String(sql);

      if (text.includes('from device d')) {
        return {
          rows: [
            {
              id: '11111111-1111-1111-1111-111111111111',
              device_code: 'DEV-SRC1',
              device_name: '机井控制器',
              asset_id: 'asset-src1',
              asset_name: '1号机井',
              asset_type: 'well',
              type_code: 'well_controller',
              type_name: 'Well Controller',
              lifecycle_state: 'active',
            },
            {
              id: '22222222-2222-2222-2222-222222222222',
              device_code: 'DEV-PUMP1',
              device_name: '1号泵',
              asset_id: 'asset-pump1',
              asset_name: '1号泵',
              asset_type: 'pump',
              type_code: 'pump_controller',
              type_name: 'Pump Controller',
              lifecycle_state: 'active',
            },
            {
              id: '33333333-3333-3333-3333-333333333333',
              device_code: 'DEV-OUT1',
              device_name: '1号出水口电磁阀',
              asset_id: 'asset-out1',
              asset_name: '1号出水口',
              asset_type: 'valve',
              type_code: 'solenoid_valve',
              type_name: 'Solenoid Valve',
              lifecycle_state: 'active',
            },
          ],
        };
      }

      if (text.includes('from well where tenant_id')) return { rows: [] };
      if (text.includes('from pump where tenant_id')) return { rows: [] };
      if (text.includes('from valve where tenant_id')) return { rows: [] };
      if (text.includes('from pump_valve_relation')) return { rows: [] };
      if (text.includes('insert into pump_valve_relation')) {
        insertedRelationCalls.push(params);
        return { rows: [] };
      }
      if (text.includes('insert into well')) return { rows: [{ id: 'well-1' }] };
      if (text.includes('insert into pump')) return { rows: [{ id: 'pump-1' }] };
      if (text.includes('insert into valve')) return { rows: [{ id: 'valve-1' }] };

      throw new Error(`Unexpected SQL in test: ${text}`);
    });

    await (service as any).ensureScopedPumpValveRelationsFromDraft(
      '00000000-0000-0000-0000-000000000801',
      '00000000-0000-0000-0000-000000000901',
      undefined,
    );

    expect(insertedRelationCalls).toHaveLength(1);
    expect(typeof insertedRelationCalls[0]?.[4]).toBe('string');
    expect(insertedRelationCalls[0]?.[4]).toContain('"source_station_node_code":"SRC1"');
    expect(insertedRelationCalls[0]?.[4]).toContain('"valve_node_code":"OUT1"');
    expect(insertedRelationCalls[0]?.[4]).toContain('"valve_endpoint_type":"outlet"');
  });

  it('recognizes Chinese workbench device names when auto-building scoped relations', async () => {
    jest.spyOn(service as any, 'loadPublishedGraphDraftSnapshot').mockResolvedValue({
      nodes: [
        {
          node_code: 'SRC_CN',
          node_type: 'source_station',
          node_name: '\u4e00\u53f7\u6cf5\u7ad9',
          device_ids: [
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            'cccccccc-cccc-cccc-cccc-cccccccccccc',
          ],
          node_params: {
            source_kind: 'surface_water',
            design_flow_m3h: 36,
            pump_head_m: 42,
          },
          pump_units: [
            {
              unit_code: 'SRC_CN-P01',
              device_ids: ['dddddddd-dddd-dddd-dddd-dddddddddddd'],
              rated_power_kw: 18.5,
            },
          ],
        },
        {
          node_code: 'OUT_CN',
          node_type: 'outlet',
          node_name: '\u4e00\u53f7\u51fa\u6c34\u53e3',
          device_ids: [
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            'ffffffff-ffff-ffff-ffff-ffffffffffff',
          ],
          node_params: {
            valve_mode: 'solenoid',
          },
          pump_units: [],
        },
      ],
      pipes: [
        {
          pipe_code: 'P-CN-1',
          pipe_type: 'main',
          from_node_code: 'SRC_CN',
          to_node_code: 'OUT_CN',
        },
      ],
    });

    const insertedWellCalls: unknown[][] = [];
    const insertedPumpCalls: unknown[][] = [];
    const insertedValveCalls: unknown[][] = [];
    const insertedRelationCalls: unknown[][] = [];

    (db.query as jest.Mock).mockImplementation(async (sql: string, params: unknown[]) => {
      const text = String(sql);

      if (text.includes('from device d')) {
        return {
          rows: [
            {
              id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              device_code: 'DEV-SRC-CN',
              device_name: '\u6cf5\u7ad9\u4e3b\u63a7',
              asset_id: null,
              asset_name: null,
              asset_type: null,
              type_code: 'type_s08_ctrl',
              type_name: '\u6cf5\u7ad9\u63a7\u5236\u5668',
              lifecycle_state: 'active',
            },
            {
              id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              device_code: 'DEV-PRESS-CN',
              device_name: '\u538b\u529b\u91c7\u96c6\u5668',
              asset_id: null,
              asset_name: null,
              asset_type: null,
              type_code: 'type_s08_sensor',
              type_name: '\u538b\u529b\u91c7\u96c6\u5668',
              lifecycle_state: 'active',
            },
            {
              id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
              device_code: 'DEV-WMTR-CN',
              device_name: '\u6c34\u8868\u91c7\u96c6\u5668',
              asset_id: null,
              asset_name: null,
              asset_type: null,
              type_code: 'type_s08_sensor',
              type_name: '\u6c34\u8868\u91c7\u96c6\u5668',
              lifecycle_state: 'active',
            },
            {
              id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
              device_code: 'DEV-PUMP-CN',
              device_name: '\u4e00\u53f7\u6cf5-\u6cf5\u63a7\u5668',
              asset_id: null,
              asset_name: null,
              asset_type: null,
              type_code: 'type_s08_ctrl',
              type_name: '\u6cf5\u7ad9\u63a7\u5236\u5668',
              lifecycle_state: 'active',
            },
            {
              id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
              device_code: 'DEV-VALVE-CN',
              device_name: '\u4e00\u53f7\u51fa\u6c34\u53e3-\u7535\u78c1\u9600\u63a7\u5236\u5668',
              asset_id: null,
              asset_name: null,
              asset_type: null,
              type_code: 'type_s08_ctrl',
              type_name: '\u9600\u95e8\u63a7\u5236\u5668',
              lifecycle_state: 'active',
            },
            {
              id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
              device_code: 'DEV-FLOW-CN',
              device_name: '\u6d41\u91cf\u91c7\u96c6\u5668',
              asset_id: null,
              asset_name: null,
              asset_type: null,
              type_code: 'type_s08_sensor',
              type_name: '\u6d41\u91cf\u91c7\u96c6\u5668',
              lifecycle_state: 'active',
            },
          ],
        };
      }

      if (text.includes('from well where tenant_id')) return { rows: [] };
      if (text.includes('from pump where tenant_id')) return { rows: [] };
      if (text.includes('from valve where tenant_id')) return { rows: [] };
      if (text.includes('from pump_valve_relation')) return { rows: [] };
      if (text.includes('insert into pump_valve_relation')) {
        insertedRelationCalls.push(params);
        return { rows: [] };
      }
      if (text.includes('insert into well')) {
        insertedWellCalls.push(params);
        return { rows: [{ id: 'well-cn-1' }] };
      }
      if (text.includes('insert into pump')) {
        insertedPumpCalls.push(params);
        return { rows: [{ id: 'pump-cn-1' }] };
      }
      if (text.includes('insert into valve')) {
        insertedValveCalls.push(params);
        return { rows: [{ id: 'valve-cn-1' }] };
      }

      throw new Error(`Unexpected SQL in test: ${text}`);
    });

    await (service as any).ensureScopedPumpValveRelationsFromDraft(
      '00000000-0000-0000-0000-000000000802',
      '00000000-0000-0000-0000-000000000902',
      undefined,
    );

    expect(insertedWellCalls).toHaveLength(1);
    expect(insertedWellCalls[0]?.[1]).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(insertedPumpCalls).toHaveLength(1);
    expect(insertedPumpCalls[0]?.[1]).toBe('dddddddd-dddd-dddd-dddd-dddddddddddd');
    expect(insertedValveCalls).toHaveLength(1);
    expect(insertedValveCalls[0]?.[1]).toBe('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
    expect(insertedRelationCalls).toHaveLength(1);
    expect(typeof insertedRelationCalls[0]?.[4]).toBe('string');
    expect(insertedRelationCalls[0]?.[4]).toContain('"source_station_node_code":"SRC_CN"');
    expect(insertedRelationCalls[0]?.[4]).toContain('"valve_node_code":"OUT_CN"');
  });

  it('does not truncate scoped pump-valve relations to the first 50 rows', async () => {
    let capturedSql = '';
    (db.query as jest.Mock).mockImplementation(async (sql: string) => {
      capturedSql = String(sql);
      return { rows: [] };
    });

    await service.loadPumpValveRelations(
      '00000000-0000-0000-0000-000000000803',
      '00000000-0000-0000-0000-000000000903',
    );

    expect(capturedSql.toLowerCase()).not.toContain('limit 50');
  });

  it('does not truncate scoped device relations to the first 50 rows', async () => {
    let capturedSql = '';
    (db.query as jest.Mock).mockImplementation(async (sql: string) => {
      capturedSql = String(sql);
      return { rows: [] };
    });

    await service.loadDeviceRelations(
      '00000000-0000-0000-0000-000000000804',
      '00000000-0000-0000-0000-000000000904',
    );

    expect(capturedSql.toLowerCase()).not.toContain('limit 50');
  });
});
