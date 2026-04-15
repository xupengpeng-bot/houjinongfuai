import { ErrorCodes } from '../../src/common/errors/error-codes';
import { RuntimeCheckoutService } from '../../src/modules/runtime/runtime-checkout.service';

describe('RuntimeCheckoutService checkout target resolution', () => {
  it('returns a configuration error when the IMEI resolves to no runnable target', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            tenantId: 'tenant-1',
            deviceId: 'device-1',
            deviceCode: 'CTRL-001',
            deviceName: '扫码控制器',
            imei: 'imei-1',
            deviceRole: 'device',
            targetType: 'well',
            targetId: null,
            wellId: null,
            valveId: null,
            relationId: null,
            wellName: null,
            blockId: null,
            blockName: null,
            projectId: null,
            projectName: null,
            wellDeviceId: null,
            pumpDeviceId: null,
            valveDeviceId: null,
            relationRole: null,
            relationConfigJson: {},
            wellDeviceState: null,
            pumpDeviceState: null,
            valveDeviceState: null,
            wellOnlineState: null,
            pumpOnlineState: null,
            valveOnlineState: null,
            deviceFeatureModulesJson: ['payment_qr_control'],
            wellFeatureModulesJson: [],
          },
        ],
      }),
    };

    const service = new RuntimeCheckoutService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const resolution = await (service as any).resolveCheckoutTargetContext('imei-1');

    expect(db.query).toHaveBeenCalled();
    expect(resolution).toMatchObject({
      target: null,
      blockingReason: {
        code: ErrorCodes.RELATION_NOT_CONFIGURED,
        message: '当前控制器未绑定可启动的井/泵/阀目标，请先完成设备关系配置',
        details: expect.objectContaining({
          imei: 'imei-1',
          device_id: 'device-1',
          device_role: 'device',
        }),
      },
    });
  });
});
