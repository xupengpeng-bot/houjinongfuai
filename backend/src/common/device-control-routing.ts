export type ControlRole = 'pump' | 'valve';

const PUMP_CONTROL_FEATURES = ['pump_vfd_control', 'pump_direct_control', 'breaker_control', 'bkr', 'pvc'];
const VALVE_CONTROL_FEATURES = ['single_valve_control', 'dual_valve_control', 'svl', 'dvl'];

function normalizeFeatureModules(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim().toLowerCase()).filter((item) => item.length > 0)
    : [];
}

function supportsAnyFeature(featureModules: unknown, candidates: readonly string[]) {
  const featureSet = new Set(normalizeFeatureModules(featureModules));
  return candidates.some((item) => featureSet.has(item.toLowerCase()));
}

export function supportsPumpControl(featureModules: unknown) {
  return supportsAnyFeature(featureModules, PUMP_CONTROL_FEATURES);
}

export function supportsValveControl(featureModules: unknown) {
  return supportsAnyFeature(featureModules, VALVE_CONTROL_FEATURES);
}

export function supportsIntegratedPumpValveControl(featureModules: unknown) {
  return supportsPumpControl(featureModules) && supportsValveControl(featureModules);
}

export function isDeviceActiveAndOnline(lifecycleState?: string | null, onlineState?: string | null) {
  return String(lifecycleState ?? '').trim().toLowerCase() === 'active' && String(onlineState ?? '').trim().toLowerCase() === 'online';
}

export function isRoleControllable(input: {
  role: ControlRole;
  wellFeatureModules?: unknown;
  wellDeviceState?: string | null;
  wellOnlineState?: string | null;
  dedicatedDeviceState?: string | null;
  dedicatedOnlineState?: string | null;
}) {
  const wellReady = isDeviceActiveAndOnline(input.wellDeviceState, input.wellOnlineState);
  const dedicatedReady = isDeviceActiveAndOnline(input.dedicatedDeviceState, input.dedicatedOnlineState);
  const wellSupportsRole = input.role === 'pump'
    ? supportsPumpControl(input.wellFeatureModules)
    : supportsValveControl(input.wellFeatureModules);
  return dedicatedReady || (wellSupportsRole && wellReady);
}

export function resolveRoleControlRoute(input: {
  role: ControlRole;
  wellFeatureModules?: unknown;
  wellDeviceState?: string | null;
  wellOnlineState?: string | null;
  wellDeviceId?: string | null;
  wellImei?: string | null;
  dedicatedDeviceState?: string | null;
  dedicatedOnlineState?: string | null;
  dedicatedDeviceId?: string | null;
  dedicatedImei?: string | null;
}) {
  const wellReady = isDeviceActiveAndOnline(input.wellDeviceState, input.wellOnlineState);
  const dedicatedReady = isDeviceActiveAndOnline(input.dedicatedDeviceState, input.dedicatedOnlineState);
  const wellSupportsRole = input.role === 'pump'
    ? supportsPumpControl(input.wellFeatureModules)
    : supportsValveControl(input.wellFeatureModules);
  const dedicatedAvailable = Boolean(input.dedicatedDeviceId && input.dedicatedImei);
  const wellAvailable = Boolean(input.wellDeviceId && input.wellImei);

  if (dedicatedReady && dedicatedAvailable) {
    return {
      route: 'dedicated' as const,
      deviceId: input.dedicatedDeviceId ?? null,
      imei: input.dedicatedImei ?? null,
    };
  }

  if (wellSupportsRole && wellReady && wellAvailable) {
    return {
      route: 'well' as const,
      deviceId: input.wellDeviceId ?? null,
      imei: input.wellImei ?? null,
    };
  }

  if (dedicatedAvailable) {
    return {
      route: 'dedicated' as const,
      deviceId: input.dedicatedDeviceId ?? null,
      imei: input.dedicatedImei ?? null,
    };
  }

  if (wellSupportsRole && wellAvailable) {
    return {
      route: 'well' as const,
      deviceId: input.wellDeviceId ?? null,
      imei: input.wellImei ?? null,
    };
  }

  return {
    route: null,
    deviceId: null,
    imei: null,
  };
}

export function collectControlRouteDeviceIds(input: {
  integratedControl?: boolean;
  deviceId?: string | null;
  wellFeatureModules?: unknown;
  wellDeviceState?: string | null;
  wellOnlineState?: string | null;
  wellDeviceId?: string | null;
  pumpDeviceState?: string | null;
  pumpOnlineState?: string | null;
  pumpDeviceId?: string | null;
  valveDeviceState?: string | null;
  valveOnlineState?: string | null;
  valveDeviceId?: string | null;
}) {
  const fallbackIds = [input.wellDeviceId, input.pumpDeviceId, input.valveDeviceId, input.deviceId].filter(
    (value): value is string => Boolean(value)
  );
  if (input.integratedControl) {
    return [...new Set([input.wellDeviceId ?? input.deviceId].filter((value): value is string => Boolean(value)))];
  }

  const pumpRoute = resolveRoleControlRoute({
    role: 'pump',
    wellFeatureModules: input.wellFeatureModules,
    wellDeviceState: input.wellDeviceState,
    wellOnlineState: input.wellOnlineState,
    wellDeviceId: input.wellDeviceId,
    wellImei: input.wellDeviceId,
    dedicatedDeviceState: input.pumpDeviceState,
    dedicatedOnlineState: input.pumpOnlineState,
    dedicatedDeviceId: input.pumpDeviceId,
    dedicatedImei: input.pumpDeviceId,
  });
  const valveRoute = resolveRoleControlRoute({
    role: 'valve',
    wellFeatureModules: input.wellFeatureModules,
    wellDeviceState: input.wellDeviceState,
    wellOnlineState: input.wellOnlineState,
    wellDeviceId: input.wellDeviceId,
    wellImei: input.wellDeviceId,
    dedicatedDeviceState: input.valveDeviceState,
    dedicatedOnlineState: input.valveOnlineState,
    dedicatedDeviceId: input.valveDeviceId,
    dedicatedImei: input.valveDeviceId,
  });

  const selectedIds = [pumpRoute.deviceId, valveRoute.deviceId].filter((value): value is string => Boolean(value));
  return selectedIds.length > 0 ? [...new Set(selectedIds)] : [...new Set(fallbackIds)];
}
