import { NotFoundException } from '@nestjs/common';
import { ArchiveService } from '../../src/common/archive/archive.service';
import { DatabaseService } from '../../src/common/db/database.service';
import { DeviceLedgerRepository } from '../../src/modules/device-ledger/device-ledger.repository';
import { DeviceLedgerService } from '../../src/modules/device-ledger/device-ledger.service';
import { RuntimeIngestService } from '../../src/modules/runtime-ingest/runtime-ingest.service';

describe('DeviceLedgerService telemetry', () => {
  const repo = {
    findById: jest.fn(),
  } as unknown as DeviceLedgerRepository;

  const runtimeIngestService = {
    getRuntimeShadowByDeviceId: jest.fn(),
    getRuntimeHealthSnapshot: jest.fn(),
    listChannelLatest: jest.fn(),
  } as unknown as RuntimeIngestService;

  const service = new DeviceLedgerService(
    repo,
    {} as DatabaseService,
    {} as ArchiveService,
    runtimeIngestService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns runtime shadow and latest channels for a known device', async () => {
    (repo.findById as jest.Mock).mockResolvedValue({
      id: 'device-1',
      imei: '860000000000001',
    });
    (runtimeIngestService.getRuntimeShadowByDeviceId as jest.Mock).mockResolvedValue({
      deviceId: 'device-1',
      ready: true,
    });
    (runtimeIngestService.getRuntimeHealthSnapshot as jest.Mock).mockResolvedValue({
      runtimeStatus: { deviceId: 'device-1', onlineState: 'online', isOnline: true },
      latestOfflineEvent: null,
      today: { registerCount: 1, rebootCount: 0, offlineTotalSec: 0 },
      recentRebootEvents: [],
    });
    (runtimeIngestService.listChannelLatest as jest.Mock).mockResolvedValue([
      { channelCode: 'CH_AI_1', metricCode: 'pressure_mpa', valueNum: 0.32 },
    ]);

    await expect(service.getTelemetry('device-1')).resolves.toEqual({
      id: 'device-1',
      imei: '860000000000001',
      runtime_shadow: {
        deviceId: 'device-1',
        ready: true,
      },
      runtime_health: {
        runtimeStatus: { deviceId: 'device-1', onlineState: 'online', isOnline: true },
        latestOfflineEvent: null,
        today: { registerCount: 1, rebootCount: 0, offlineTotalSec: 0 },
        recentRebootEvents: [],
      },
      channel_latest: [{ channelCode: 'CH_AI_1', metricCode: 'pressure_mpa', valueNum: 0.32 }],
    });
  });

  it('throws when device does not exist', async () => {
    (repo.findById as jest.Mock).mockResolvedValue(null);

    await expect(service.getTelemetry('missing-device')).rejects.toThrow(NotFoundException);
  });
});
