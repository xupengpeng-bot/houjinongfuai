import { AppException } from '../../src/common/errors/app-exception';
import { RuntimeDecisionService } from '../../src/modules/runtime/runtime.service';
import { ErrorCodes } from '../../src/common/errors/error-codes';

describe('RuntimeDecisionService metering readiness', () => {
  const topologyService = {
    validateStartTarget: jest.fn(),
    findPrimaryMeteringReadinessByWellId: jest.fn(),
  };
  const effectivePolicyResolver = {
    resolveForRuntime: jest.fn(),
  };
  const runtimeRepository = {
    countActiveSessionsForUser: jest.fn(),
    countActiveSessionsForWell: jest.fn(),
    countActiveSessionsForValve: jest.fn(),
    countActiveSessionsForPump: jest.fn(),
    listActiveBillingModesForPump: jest.fn(),
  };
  const farmerFundRepository = {
    getBalance: jest.fn(),
  };

  const service = new RuntimeDecisionService(
    topologyService as any,
    effectivePolicyResolver as any,
    runtimeRepository as any,
    farmerFundRepository as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    topologyService.validateStartTarget.mockResolvedValue({
      relation: {
        tenantId: 'tenant-1',
        relationId: 'rel-1',
        wellId: 'well-1',
        pumpId: 'pump-1',
        valveId: 'valve-1',
        relationRole: 'primary',
        billingInheritMode: 'well',
        relationConfigJson: {},
        wellFeatureModules: [],
        wellDeviceState: 'active',
        pumpDeviceState: 'active',
        valveDeviceState: 'active',
        wellOnlineState: 'online',
        pumpOnlineState: 'online',
        valveOnlineState: 'online',
      },
      blockingReasons: [],
    });
    effectivePolicyResolver.resolveForRuntime.mockResolvedValue({
      runtime: {
        wellId: 'well-1',
        pumpId: 'pump-1',
        valveId: 'valve-1',
        concurrencyLimit: 1,
      },
      billing: {
        billingMode: 'electric',
        unitPrice: 1,
        unitType: 'kwh',
        minChargeAmount: 0,
        billingPackageId: 'pkg-1',
      },
      interaction: {
        confirmMode: 'manual_confirm',
      },
    });
    runtimeRepository.countActiveSessionsForUser.mockResolvedValue(0);
    runtimeRepository.countActiveSessionsForWell.mockResolvedValue(0);
    runtimeRepository.countActiveSessionsForValve.mockResolvedValue(0);
    runtimeRepository.countActiveSessionsForPump.mockResolvedValue(0);
    runtimeRepository.listActiveBillingModesForPump.mockResolvedValue([]);
    farmerFundRepository.getBalance.mockResolvedValue(100);
  });

  it('blocks electric billing when the primary meter is offline', async () => {
    topologyService.findPrimaryMeteringReadinessByWellId.mockResolvedValue({
      blockId: 'block-1',
      blockName: '一区',
      meteringPointId: 'mp-1',
      meteringPointCode: 'MP-HJ-001',
      meteringPointStatus: 'active',
      primaryMeterDeviceId: 'device-meter-1',
      primaryMeterDeviceName: '国网表一号',
      primaryMeterLifecycleState: 'active',
      primaryMeterOnlineState: 'offline',
    });

    const result = await service.evaluateStartEligibility(
      { targetType: 'well', targetId: 'well-1', sceneCode: 'farmer_scan_start' },
      'user-1',
      'tenant-1',
    );

    expect(result.result).toBe('deny');
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ErrorCodes.DEVICE_OFFLINE,
          source: 'metering',
          message: expect.stringContaining('主电表未在线'),
        }),
      ]),
    );
    expect(topologyService.findPrimaryMeteringReadinessByWellId).toHaveBeenCalledWith('well-1');
  });

  it('does not require a meter for time billing', async () => {
    effectivePolicyResolver.resolveForRuntime.mockResolvedValue({
      runtime: {
        wellId: 'well-1',
        pumpId: 'pump-1',
        valveId: 'valve-1',
        concurrencyLimit: 1,
      },
      billing: {
        billingMode: 'time',
        unitPrice: 1,
        unitType: 'minute',
        minChargeAmount: 0,
        billingPackageId: 'pkg-1',
      },
      interaction: {
        confirmMode: 'manual_confirm',
      },
    });

    const result = await service.evaluateStartEligibility(
      { targetType: 'well', targetId: 'well-1', sceneCode: 'farmer_scan_start' },
      'user-1',
      'tenant-1',
    );

    expect(result.result).toBe('allow');
    expect(topologyService.findPrimaryMeteringReadinessByWellId).not.toHaveBeenCalled();
  });

  it('rejects blank target ids before creating a runtime decision', async () => {
    let caught: unknown;
    try {
      await service.createStartDecision({
        targetType: 'well',
        targetId: '   ',
        sceneCode: 'farmer_scan_start',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppException);
    expect((caught as AppException).getResponse()).toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      message: '启动目标缺失，无法创建运行决策',
      data: expect.objectContaining({
        targetType: 'well',
        sceneCode: 'farmer_scan_start',
      }),
    });
    expect(topologyService.validateStartTarget).not.toHaveBeenCalled();
  });

  it('treats mixed water-electric billing as requiring meter readiness', async () => {
    effectivePolicyResolver.resolveForRuntime.mockResolvedValue({
      runtime: {
        wellId: 'well-1',
        pumpId: 'pump-1',
        valveId: 'valve-1',
        concurrencyLimit: 1,
      },
      billing: {
        billingMode: 'water_electric',
        unitPrice: 1,
        unitType: 'mixed',
        minChargeAmount: 0,
        billingPackageId: 'pkg-1',
      },
      interaction: {
        confirmMode: 'manual_confirm',
      },
    });
    topologyService.findPrimaryMeteringReadinessByWellId.mockResolvedValue({
      blockId: 'block-1',
      blockName: '一区',
      meteringPointId: null,
      meteringPointCode: null,
      meteringPointStatus: null,
      primaryMeterDeviceId: null,
      primaryMeterDeviceName: null,
      primaryMeterLifecycleState: null,
      primaryMeterOnlineState: null,
    });

    const result = await service.evaluateStartEligibility(
      { targetType: 'well', targetId: 'well-1', sceneCode: 'farmer_scan_start' },
      'user-1',
      'tenant-1',
    );

    expect(result.result).toBe('deny');
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ErrorCodes.RELATION_NOT_CONFIGURED,
          source: 'metering',
          message: expect.stringContaining('区块未配置可用电力计量点'),
        }),
      ]),
    );
  });
});
