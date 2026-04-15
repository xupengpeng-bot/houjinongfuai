import { ArchiveService } from '../../src/common/archive/archive.service';
import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceLedgerService } from '../../src/modules/device-ledger/device-ledger.service';
import { DeviceLedgerRepository } from '../../src/modules/device-ledger/device-ledger.repository';
import { RuntimeIngestService } from '../../src/modules/runtime-ingest/runtime-ingest.service';

describe('DeviceLedgerService option helpers', () => {
  const svc = new DeviceLedgerService(
    {} as DeviceLedgerRepository,
    {} as DatabaseService,
    {} as ArchiveService,
    {} as RuntimeIngestService,
  );

  it('displayStatusOptions matches ledger list semantics', () => {
    expect(svc.displayStatusOptions().map((o) => o.value)).toEqual(['online', 'offline', 'alarm']);
  });

  it('locationSourceStrategyOptions includes auto and four explicit strategies', () => {
    expect(svc.locationSourceStrategyOptions()).toHaveLength(5);
  });

  it('commIdentityTypeOptions has five kinds', () => {
    expect(svc.commIdentityTypeOptions()).toHaveLength(5);
  });
});

describe('DeviceLedgerService create', () => {
  it('allows creating a device without asset when project scope is provided', async () => {
    const repo = {
      resolveDeviceTypeId: jestLikeFn().mockResolvedValue('type-1'),
      resolveRegionIdForProject: jestLikeFn().mockResolvedValue('region-1'),
      insertDevice: jestLikeFn().mockResolvedValue({ id: 'device-1' }),
    } as unknown as DeviceLedgerRepository;
    const svc = new DeviceLedgerService(
      repo,
      {} as DatabaseService,
      {} as ArchiveService,
      {} as RuntimeIngestService,
    );
    const getByIdSpy = jest.spyOn(svc, 'getById').mockResolvedValue({ id: 'device-1' } as never);

    await svc.create({
      device_code: 'WB-TEST-DEV-01',
      device_name: '测试设备',
      device_type: 'TYPE-S08-VALVE',
      project_id: '00000000-0000-0000-0000-000000000801',
      block_id: '00000000-0000-0000-0000-000000000901',
      source_module: 'network_workbench',
      source_node_code: 'e10',
    });

    expect((repo as any).resolveRegionIdForProject).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000801',
    );
    expect((repo as any).insertDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: null,
        regionId: 'region-1',
        extPatch: expect.objectContaining({
          project_id: '00000000-0000-0000-0000-000000000801',
          block_id: '00000000-0000-0000-0000-000000000901',
          source_module: 'network_workbench',
          source_node_code: 'e10',
        }),
      }),
    );
    expect(getByIdSpy).toHaveBeenCalledWith('device-1');
  });
});

describe('DeviceLedgerService list', () => {
  it('passes display status filter through to the repository', async () => {
    const repo = {
      findMany: jestLikeFn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as DeviceLedgerRepository;
    const svc = new DeviceLedgerService(
      repo,
      {} as DatabaseService,
      {} as ArchiveService,
      {} as RuntimeIngestService,
    );

    await svc.list({
      page: 1,
      pageSize: 20,
      displayStatus: 'offline',
    });

    expect((repo as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '00000000-0000-0000-0000-000000000001',
        displayStatus: 'offline',
      }),
    );
  });
});

describe('DeviceLedgerService integration profile capability set', () => {
  it('surfaces capability-set metadata from ledger ext fields', async () => {
    const repo = {
      findById: jestLikeFn().mockResolvedValue({
        id: 'device-1',
        device_code: 'DEV-1',
        device_name: '测试设备',
        device_type_code: 'TYPE-CTRL',
        device_type: '控制器',
        device_family: 'controller',
        asset_id: null,
        asset_name: null,
        project_id: null,
        project_name: null,
        block_id: null,
        source_module: null,
        source_node_code: null,
        source_unit_code: null,
        region_name: null,
        status: 'online',
        last_report: '2026-04-12 10:00',
        protocol_type: 'hj-device-v2',
        protocol_version: '1.0.0',
        online_state: 'online',
        connection_state: 'connected',
        lifecycle_state: 'active',
        runtime_state: 'idle',
        comm_identity_type: 'imei',
        comm_identity_value: '860000000000001',
        imei: '860000000000001',
        chip_sn: null,
        iccid: null,
        module_model: null,
        software_family: 'scan_controller',
        software_version: '1.0.0',
        firmware_version: '1.0.0',
        hardware_sku: 'SCAN-IRR-CTRL-4G',
        hardware_rev: 'A01',
        firmware_family: 'scan_controller',
        meter_protocol: null,
        control_protocol: 'relay_direct',
        controller_role: 'scan_irrigation_controller',
        deployment_mode: 'standalone',
        config_version: 12,
        capability_version: 3,
        capability_hash: 'sha256:8d1a97f4c4d0f2b8',
        config_bitmap: '0x0000001f',
        actions_bitmap: '0x0000003f',
        queries_bitmap: '0x00000007',
        capability_limits: {
          max_inflight_control: 1,
          event_queue_depth: 8,
          ota_block_bytes: 512,
        },
        feature_modules: ['pump_direct_control', 'single_valve_control'],
        resource_inventory: {},
        channel_bindings: [],
        runtime_rules: {},
        last_register_payload: {},
        auto_identified: true,
        manual_region_id: null,
        manual_address_text: null,
        manual_latitude: null,
        manual_longitude: null,
        install_position_desc: null,
        location_source_strategy: null,
        reported_latitude: null,
        reported_longitude: null,
        reported_at: null,
        reported_source: null,
        effective_latitude: null,
        effective_longitude: null,
        effective_location_source: null,
        type_capability_json: {},
        type_default_config_json: {},
        type_form_schema_json: {},
      }),
    } as unknown as DeviceLedgerRepository;
    const svc = new DeviceLedgerService(
      repo,
      {} as DatabaseService,
      {} as ArchiveService,
      {} as RuntimeIngestService,
    );

    const profile = await svc.getIntegrationProfile('device-1');

    expect(profile.capability_model.capability_version).toBe(3);
    expect(profile.capability_model.capability_hash).toBe('sha256:8d1a97f4c4d0f2b8');
    expect(profile.capability_model.config_bitmap).toBe('0x0000001f');
    expect(profile.capability_model.actions_bitmap).toBe('0x0000003f');
    expect(profile.capability_model.queries_bitmap).toBe('0x00000007');
    expect(profile.capability_model.capability_limits).toEqual({
      max_inflight_control: 1,
      event_queue_depth: 8,
      ota_block_bytes: 512,
    });
    expect(profile.platform_contract.heartbeat_contract.capability_echo_fields).toEqual([
      'capability_version',
      'capability_hash',
      'config_bitmap',
      'actions_bitmap',
      'queries_bitmap',
    ]);
  });
});

function jestLikeFn() {
  return jest.fn();
}
