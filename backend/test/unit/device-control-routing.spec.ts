import {
  collectControlRouteDeviceIds,
  isRoleControllable,
  resolveRoleControlRoute,
  supportsIntegratedPumpValveControl,
} from '../../src/common/device-control-routing';

describe('device control routing', () => {
  it('treats integrated control as requiring both pump and valve capability on the well controller', () => {
    expect(supportsIntegratedPumpValveControl(['breaker_control'])).toBe(false);
    expect(supportsIntegratedPumpValveControl(['breaker_control', 'dual_valve_control'])).toBe(true);
  });

  it('allows mixed topology when the well can control pump and the dedicated valve controller is online', () => {
    expect(
      isRoleControllable({
        role: 'pump',
        wellFeatureModules: ['breaker_control'],
        wellDeviceState: 'active',
        wellOnlineState: 'online',
        dedicatedDeviceState: 'archived',
        dedicatedOnlineState: 'offline',
      }),
    ).toBe(true);

    expect(
      isRoleControllable({
        role: 'valve',
        wellFeatureModules: ['breaker_control'],
        wellDeviceState: 'active',
        wellOnlineState: 'online',
        dedicatedDeviceState: 'active',
        dedicatedOnlineState: 'online',
      }),
    ).toBe(true);
  });

  it('routes pump to the well controller and valve to the dedicated valve controller in mixed topology', () => {
    const pumpRoute = resolveRoleControlRoute({
      role: 'pump',
      wellFeatureModules: ['breaker_control'],
      wellDeviceState: 'active',
      wellOnlineState: 'online',
      wellDeviceId: 'well-device',
      wellImei: 'well-imei',
      dedicatedDeviceState: 'archived',
      dedicatedOnlineState: 'offline',
      dedicatedDeviceId: 'pump-device',
      dedicatedImei: 'pump-imei',
    });
    const valveRoute = resolveRoleControlRoute({
      role: 'valve',
      wellFeatureModules: ['breaker_control'],
      wellDeviceState: 'active',
      wellOnlineState: 'online',
      wellDeviceId: 'well-device',
      wellImei: 'well-imei',
      dedicatedDeviceState: 'active',
      dedicatedOnlineState: 'online',
      dedicatedDeviceId: 'valve-device',
      dedicatedImei: 'valve-imei',
    });

    expect(pumpRoute).toEqual({
      route: 'well',
      deviceId: 'well-device',
      imei: 'well-imei',
    });
    expect(valveRoute).toEqual({
      route: 'dedicated',
      deviceId: 'valve-device',
      imei: 'valve-imei',
    });
  });

  it('scopes fault checks to the actual control path instead of archived fallback hardware', () => {
    expect(
      collectControlRouteDeviceIds({
        integratedControl: false,
        deviceId: 'valve-device',
        wellFeatureModules: ['breaker_control'],
        wellDeviceState: 'active',
        wellOnlineState: 'online',
        wellDeviceId: 'well-device',
        pumpDeviceState: 'archived',
        pumpOnlineState: 'offline',
        pumpDeviceId: 'pump-device',
        valveDeviceState: 'active',
        valveOnlineState: 'online',
        valveDeviceId: 'valve-device',
      }),
    ).toEqual(['well-device', 'valve-device']);
  });
});
