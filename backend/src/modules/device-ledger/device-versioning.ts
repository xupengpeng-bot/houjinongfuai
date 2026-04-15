type VersionContractInput = {
  protocolType?: string | null;
  controllerRole?: string | null;
  deploymentMode?: string | null;
  softwareFamily?: string | null;
  softwareVersion?: string | null;
  firmwareFamily?: string | null;
  firmwareVersion?: string | null;
  hardwareSku?: string | null;
  hardwareRev?: string | null;
  configVersion?: number | null;
  typeVersioning?: Record<string, unknown> | null;
};

export type DeviceVersionContract = {
  naming_scheme: {
    policy_code: string;
    business_domain: string;
    bundle_code: string;
    software_pattern: string;
    hardware_pattern: string;
    config_pattern: string;
    normalization_rules: string[];
  };
  current: {
    software_family: string | null;
    software_version: string | null;
    software_release_name: string | null;
    hardware_sku: string | null;
    hardware_rev: string | null;
    hardware_release_name: string | null;
    config_version: number | null;
    config_release_name: string | null;
  };
  governance: {
    software_source: string;
    hardware_source: string;
    config_source: string;
    upgrade_units: string[];
    compatibility_keys: string[];
    missing_fields: string[];
  };
};

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeToken(value: unknown, fallback: string) {
  const normalized = asString(value)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  return normalized || fallback;
}

function normalizeSemver(value: unknown) {
  const normalized = asString(value).replace(/^v/i, '');
  return normalized || null;
}

function roleCode(role: string | null | undefined) {
  const normalized = asString(role).toLowerCase();
  if (normalized === 'source_controller') return 'SRC';
  if (normalized === 'valve_controller') return 'VAL';
  if (normalized === 'monitor_controller') return 'MON';
  if (normalized === 'hybrid_controller') return 'HYB';
  if (normalized === 'gateway_integrated') return 'GTW';
  return 'GEN';
}

function deploymentCode(deploymentMode: string | null | undefined) {
  const normalized = asString(deploymentMode).toLowerCase();
  if (normalized === 'standalone') return 'STD';
  if (normalized === 'gateway_integrated') return 'INT';
  if (normalized === 'gateway_managed_subdevice') return 'SUB';
  return 'GEN';
}

function bundleCode(input: VersionContractInput) {
  const typeVersioning = asObject(input.typeVersioning);
  const explicitSeed = asString(typeVersioning.bundle_code_seed);
  if (explicitSeed) return explicitSeed;
  const protocolCode = normalizeToken(input.protocolType, 'HJV2');
  return ['IRR', roleCode(input.controllerRole), deploymentCode(input.deploymentMode), protocolCode].join('-');
}

function softwareReleaseName(input: VersionContractInput, resolvedBundleCode: string) {
  const version = normalizeSemver(input.softwareVersion ?? input.firmwareVersion);
  if (!version) return null;
  return `SW-${resolvedBundleCode}-v${version}`;
}

function hardwareReleaseName(input: VersionContractInput) {
  const sku = normalizeToken(input.hardwareSku, '');
  const rev = normalizeToken(input.hardwareRev, '');
  if (!sku && !rev) return null;
  if (sku && rev) return `HW-${sku}-${rev}`;
  return `HW-${sku || 'UNSPEC'}${rev ? `-${rev}` : ''}`;
}

function configReleaseName(configVersion: number | null | undefined) {
  return typeof configVersion === 'number' && Number.isFinite(configVersion)
    ? `CFG-v${Math.trunc(configVersion)}`
    : null;
}

export function buildDeviceVersionContract(input: VersionContractInput): DeviceVersionContract {
  const typeVersioning = asObject(input.typeVersioning);
  const namingScheme = asObject(typeVersioning.naming_scheme);
  const resolvedBundleCode = bundleCode(input);
  const softwareVersion = normalizeSemver(input.softwareVersion ?? input.firmwareVersion);
  const missingFields: string[] = [];

  if (!softwareVersion) missingFields.push('software_version');
  if (!asString(input.hardwareSku)) missingFields.push('hardware_sku');
  if (!asString(input.hardwareRev)) missingFields.push('hardware_rev');

  return {
    naming_scheme: {
      policy_code: asString(typeVersioning.policy_code) || 'smart_irrigation_device_version_policy_v1',
      business_domain: asString(typeVersioning.business_domain) || 'smart_irrigation_controller',
      bundle_code: resolvedBundleCode,
      software_pattern: asString(namingScheme.software_pattern) || 'SW-{bundle_code}-v{semver}',
      hardware_pattern: asString(namingScheme.hardware_pattern) || 'HW-{hardware_sku}-{hardware_rev}',
      config_pattern: asString(namingScheme.config_pattern) || 'CFG-v{config_version}',
      normalization_rules:
        asArray(typeVersioning.normalization_rules).map((item) => asString(item)).filter(Boolean).length > 0
          ? asArray(typeVersioning.normalization_rules).map((item) => asString(item)).filter(Boolean)
          : [
              'software_version uses semver without a leading v in storage',
              'hardware version is split into hardware_sku and hardware_rev instead of one free-text field',
              'legacy firmware_version can be folded into software_version for old devices during transition',
              'bundle_code is derived from business domain, controller role, deployment mode and protocol family',
            ],
    },
    current: {
      software_family: asString(input.softwareFamily) || asString(input.firmwareFamily) || 'edge-control',
      software_version: softwareVersion,
      software_release_name: softwareReleaseName(input, resolvedBundleCode),
      hardware_sku: asString(input.hardwareSku) || null,
      hardware_rev: asString(input.hardwareRev) || null,
      hardware_release_name: hardwareReleaseName(input),
      config_version:
        typeof input.configVersion === 'number' && Number.isFinite(input.configVersion)
          ? Math.trunc(input.configVersion)
          : null,
      config_release_name: configReleaseName(input.configVersion),
    },
    governance: {
      software_source: 'software release registry / device REGISTER',
      hardware_source: 'hardware release registry / device REGISTER',
      config_source: 'platform SYNC_CONFIG',
      upgrade_units:
        asArray(typeVersioning.upgrade_units).map((item) => asString(item)).filter(Boolean).length > 0
          ? asArray(typeVersioning.upgrade_units).map((item) => asString(item)).filter(Boolean)
          : ['software_version', 'config_version'],
      compatibility_keys:
        asArray(typeVersioning.compatibility_keys).map((item) => asString(item)).filter(Boolean).length > 0
          ? asArray(typeVersioning.compatibility_keys).map((item) => asString(item)).filter(Boolean)
          : [
              'hardware_sku',
              'hardware_rev',
              'software_version',
              'protocol_version',
              'config_version',
            ],
      missing_fields: missingFields,
    },
  };
}
