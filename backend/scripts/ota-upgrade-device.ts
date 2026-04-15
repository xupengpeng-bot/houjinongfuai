import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

type ApiEnvelope<T> = {
  code?: string;
  message?: string;
  data?: T;
};

type DeviceRow = {
  id: string;
  imei: string;
  device_code: string | null;
  device_name: string | null;
  device_type_id: string | null;
  device_type_code: string | null;
};

type ReleaseRow = {
  id: string;
  release_code: string;
  version_semver: string | null;
  checksum: string | null;
  artifacts?: Array<{
    id: string;
    artifact_kind: string;
    file_name: string;
  }>;
};

type UpgradeJobDetail = {
  id: string;
  status: string;
  target_version: string;
  items?: UpgradeJobItem[];
};

type UpgradeJobItem = {
  id: string;
  imei: string;
  status: string;
  stage: string;
  progress_percent: number;
  last_error_code?: string | null;
  last_error_message?: string | null;
  package_file_name?: string | null;
};

type CliOptions = {
  apiBase: string;
  databaseUrl: string;
  imei: string;
  binPath: string;
  versionSemver: string;
  releaseNotes: string;
  protocolVersion: string;
  dryRun: boolean;
  autoDispatch: boolean;
  waitSeconds: number;
  pollSeconds: number;
  fireOnly: boolean;
};

const DEFAULT_API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api/v1';
const DEFAULT_DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/houji_p1';
const DEFAULT_IMEI = process.env.OTA_IMEI || '';
const DEFAULT_BIN = process.env.OTA_BIN || '';
const DEFAULT_PROTOCOL_VERSION = process.env.OTA_PROTOCOL_VERSION || 'tcp-json-v1';
const DEFAULT_VERSION_BASE = process.env.OTA_VERSION_BASE || detectWorkspaceFirmwareVersion() || '0.1.22';

function detectWorkspaceFirmwareVersion() {
  const candidates = [
    path.resolve(__dirname, '../../../hartware/code/firmware/config/scan_trial_defs.h'),
    path.resolve(__dirname, '../../../../houjinongfuAI-Cursor/hartware/code/firmware/config/scan_trial_defs.h'),
  ];

  for (const filePath of candidates) {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const match = text.match(/SCAN_TRIAL_SOFTWARE_VERSION\s+"([^"]+)"/);
      if (match?.[1]) {
        return match[1].trim();
      }
    } catch {
      // Best-effort lookup only.
    }
  }

  return '';
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const normalized = token.slice(2);
    if (!normalized) continue;
    if (normalized.startsWith('no-')) {
      out[normalized.slice(3)] = false;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      out[normalized] = true;
      continue;
    }
    out[normalized] = next;
    index += 1;
  }
  return out;
}

function formatTimestampVersion(baseVersion = DEFAULT_VERSION_BASE, now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${baseVersion}-r${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildOptions(argv: string[]): CliOptions {
  const args = parseArgs(argv);
  const versionSemver = asString(args.version) || asString(process.env.OTA_VERSION_SEMVER) || formatTimestampVersion();
  const releaseNotes =
    asString(args.notes) ||
    asString(process.env.OTA_RELEASE_NOTES) ||
    `Codex OTA dev build ${versionSemver}`;
  return {
    apiBase: asString(args['api-base']) || DEFAULT_API_BASE,
    databaseUrl: asString(args['database-url']) || DEFAULT_DATABASE_URL,
    imei: asString(args.imei) || DEFAULT_IMEI,
    binPath: asString(args.bin) || DEFAULT_BIN,
    versionSemver,
    releaseNotes,
    protocolVersion: asString(args['protocol-version']) || DEFAULT_PROTOCOL_VERSION,
    dryRun: asBoolean(args['dry-run'], false),
    autoDispatch: asBoolean(args['auto-dispatch'], true),
    waitSeconds: asNumber(args['wait-seconds'], 120),
    pollSeconds: asNumber(args['poll-seconds'], 3),
    fireOnly: asBoolean(args['fire-only'], false),
  };
}

function ensureFileReadable(filePath: string) {
  if (!filePath) {
    throw new Error('缺少 --bin，无法确定要发布的固件文件。');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`固件文件不存在: ${filePath}`);
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`目标不是文件: ${filePath}`);
  }
}

function sha256Hex(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as ApiEnvelope<T>) : {};
  if (!response.ok || payload.code && payload.code !== 'OK') {
    const detail = payload.message || response.statusText || 'unknown error';
    throw new Error(`API ${response.status} ${url} failed: ${detail}`);
  }
  return payload;
}

async function loadDevice(client: Client, imei: string): Promise<DeviceRow> {
  const result = await client.query<DeviceRow>(
    `
    select
      d.id::text,
      d.imei,
      d.device_code,
      d.device_name,
      d.device_type_id::text,
      dt.type_code as device_type_code
    from device d
    left join device_type dt on dt.id = d.device_type_id
    where d.tenant_id = '00000000-0000-0000-0000-000000000001'
      and d.imei = $1
    limit 1
    `,
    [imei],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`数据库里找不到 IMEI=${imei} 对应的设备。`);
  }
  return row;
}

function printHeader(title: string) {
  console.log(`\n== ${title} ==`);
}

function printSummary(label: string, value: unknown) {
  console.log(`${label}: ${value ?? ''}`);
}

async function createRelease(options: CliOptions, device: DeviceRow, filePath: string, checksum: string) {
  const form = new FormData();
  form.set('release_kind', 'software');
  form.set('version_semver', options.versionSemver);
  form.set('release_notes', options.releaseNotes);
  form.set('protocol_version', options.protocolVersion);
  form.set('checksum', checksum);
  if (device.device_type_id) {
    form.set('device_type_id', device.device_type_id);
  }

  const fileBuffer = await fs.promises.readFile(filePath);
  const fileBlob = new Blob([fileBuffer], { type: 'application/octet-stream' });
  form.set('binary_file', fileBlob, path.basename(filePath));

  const response = await apiJson<ReleaseRow>(`${options.apiBase}/firmware/releases`, {
    method: 'POST',
    body: form,
  });
  if (!response.data) {
    throw new Error('创建 release 成功但返回体缺少 data。');
  }
  return response.data;
}

async function createSingleUpgradeJob(options: CliOptions, device: DeviceRow, release: ReleaseRow) {
  const response = await apiJson<UpgradeJobDetail>(`${options.apiBase}/firmware/upgrade-jobs/single`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      device_id: device.id,
      release_id: release.id,
      auto_dispatch: options.autoDispatch,
    }),
  });
  if (!response.data) {
    throw new Error('创建升级任务成功但返回体缺少 data。');
  }
  return response.data;
}

async function loadJob(options: CliOptions, jobId: string) {
  const response = await apiJson<UpgradeJobDetail>(`${options.apiBase}/firmware/upgrade-jobs/${jobId}`, {
    method: 'GET',
  });
  if (!response.data) {
    throw new Error('读取升级任务详情成功但返回体缺少 data。');
  }
  return response.data;
}

function jobIsTerminal(job: UpgradeJobDetail) {
  return ['success', 'failed', 'partial_success', 'paused'].includes(asString(job.status));
}

function formatItem(item: UpgradeJobItem) {
  const errorParts = [item.last_error_code, item.last_error_message].filter(Boolean).join(' / ');
  const suffix = errorParts ? ` error=${errorParts}` : '';
  return `${item.imei} stage=${item.stage} status=${item.status} progress=${item.progress_percent}${suffix}`;
}

async function waitForJobProgress(options: CliOptions, jobId: string) {
  const deadline = Date.now() + options.waitSeconds * 1000;
  let lastSnapshot = '';
  while (Date.now() < deadline) {
    const job = await loadJob(options, jobId);
    const items = job.items ?? [];
    const snapshot = JSON.stringify({
      status: job.status,
      items: items.map((item) => ({
        id: item.id,
        stage: item.stage,
        status: item.status,
        progress_percent: item.progress_percent,
        last_error_code: item.last_error_code ?? null,
      })),
    });
    if (snapshot !== lastSnapshot) {
      printHeader(`升级任务 ${job.id}`);
      printSummary('job_status', job.status);
      printSummary('target_version', job.target_version);
      for (const item of items) {
        console.log(`- ${formatItem(item)}`);
      }
      lastSnapshot = snapshot;
    }
    if (jobIsTerminal(job)) {
      return job;
    }
    await sleep(options.pollSeconds * 1000);
  }
  return loadJob(options, jobId);
}

function printUsage() {
  console.log('用法: ts-node ./scripts/ota-upgrade-device.ts --imei <IMEI> --bin <controller_fw.bin> [--version 0.1.21-r20260412170000] [--dry-run] [--fire-only]');
  console.log('环境变量: API_BASE_URL DATABASE_URL OTA_IMEI OTA_BIN OTA_VERSION_SEMVER OTA_RELEASE_NOTES');
}

async function main() {
  const options = buildOptions(process.argv.slice(2));
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  if (!options.imei) {
    throw new Error('缺少 --imei，无法确定 OTA 目标设备。');
  }
  ensureFileReadable(options.binPath);

  const fileBuffer = await fs.promises.readFile(options.binPath);
  const checksum = sha256Hex(fileBuffer);
  const fileSize = fileBuffer.length;

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    const device = await loadDevice(client, options.imei);

    printHeader('OTA 计划');
    printSummary('device_id', device.id);
    printSummary('imei', device.imei);
    printSummary('device_code', device.device_code || '');
    printSummary('device_name', device.device_name || '');
    printSummary('device_type_id', device.device_type_id || '');
    printSummary('device_type_code', device.device_type_code || '');
    printSummary('binary', options.binPath);
    printSummary('size_bytes', fileSize);
    printSummary('sha256', checksum);
    printSummary('version_semver', options.versionSemver);
    printSummary('protocol_version', options.protocolVersion);
    printSummary('dry_run', options.dryRun);
    printSummary('fire_only', options.fireOnly);

    if (options.dryRun) {
      console.log('\nDry run 完成，未创建 release，也未派发升级任务。');
      return;
    }

    const release = await createRelease(options, device, options.binPath, checksum);
    printHeader('Release 已创建');
    printSummary('release_id', release.id);
    printSummary('release_code', release.release_code);
    printSummary('release_checksum', release.checksum || checksum);

    const job = await createSingleUpgradeJob(options, device, release);
    printHeader('升级任务已创建');
    printSummary('job_id', job.id);
    printSummary('job_status', job.status);
    printSummary('target_version', job.target_version);

    if (options.fireOnly) {
      console.log('\n快发模式完成，已下发升级任务，不等待设备 ACK/进度。');
      return;
    }

    const finalJob = await waitForJobProgress(options, job.id);
    printHeader('OTA 观察结束');
    printSummary('final_job_status', finalJob.status);
    const items = finalJob.items ?? [];
    for (const item of items) {
      console.log(`- ${formatItem(item)}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n[OTA ERROR] ${message}`);
  process.exitCode = 1;
});
