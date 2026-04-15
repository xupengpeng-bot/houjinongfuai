import { ArchiveService } from '../../src/common/archive/archive.service';
import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceLedgerRepository } from '../../src/modules/device-ledger/device-ledger.repository';
import { DeviceLedgerService } from '../../src/modules/device-ledger/device-ledger.service';
import { RuntimeIngestService } from '../../src/modules/runtime-ingest/runtime-ingest.service';

describe('DeviceLedgerService IMEI persistence', () => {
  const runtimeIngestService = {
    getRuntimeShadowByDeviceId: jest.fn(),
    listChannelLatest: jest.fn(),
  } as unknown as RuntimeIngestService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores imei and comm identity when creating a controller device', async () => {
    const repo = {
      resolveDeviceTypeId: jest.fn().mockResolvedValue('type-1'),
      resolveRegionIdForProject: jest.fn().mockResolvedValue('region-1'),
      insertDevice: jest.fn().mockResolvedValue({ id: 'device-1' }),
    } as unknown as DeviceLedgerRepository;

    const service = new DeviceLedgerService(
      repo,
      {} as DatabaseService,
      {} as ArchiveService,
      runtimeIngestService,
    );
    jest.spyOn(service, 'getById').mockResolvedValue({ id: 'device-1' } as never);

    await service.create({
      device_code: 'CTRL-H2-001',
      device_name: '1号水源控制器',
      imei: ' 860000000000001 ',
      device_type: 'TYPE-S08-H2-UNIFIED',
      project_id: '00000000-0000-0000-0000-000000000801',
    });

    expect((repo as any).insertDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        imei: '860000000000001',
        extPatch: expect.objectContaining({
          comm_identity_type: 'imei',
          comm_identity_value: '860000000000001',
        }),
      }),
    );
  });

  it('updates imei and comm identity when editing a controller device', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue({
        id: 'device-1',
        asset_id: null,
      }),
      resolveRegionIdForProject: jest.fn().mockResolvedValue('region-1'),
      updateDevice: jest.fn().mockResolvedValue(true),
    } as unknown as DeviceLedgerRepository;

    const service = new DeviceLedgerService(
      repo,
      {} as DatabaseService,
      {} as ArchiveService,
      runtimeIngestService,
    );
    jest
      .spyOn(service, 'getById')
      .mockResolvedValueOnce({ id: 'device-1', asset_id: null } as never)
      .mockResolvedValueOnce({ id: 'device-1' } as never);

    await service.update('device-1', {
      imei: '860000000000009',
      project_id: '00000000-0000-0000-0000-000000000801',
    });

    expect((repo as any).updateDevice).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      'device-1',
      expect.objectContaining({
        imei: '860000000000009',
        extMerge: expect.objectContaining({
          comm_identity_type: 'imei',
          comm_identity_value: '860000000000009',
        }),
      }),
    );
  });
});
