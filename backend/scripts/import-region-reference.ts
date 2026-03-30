import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createInterface } from 'readline';
import { Pool } from 'pg';

type RegionLevel = 'province' | 'city' | 'county' | 'town' | 'village';

interface RawRegionRecord {
  code: string;
  name: string;
  level: RegionLevel;
  parentCode: string | null;
}

interface NormalizedRegionRecord {
  code: string;
  name: string;
  level: RegionLevel;
  parent_code: string | null;
  full_path_name: string;
  full_path_code: string;
  enabled: boolean;
  source_type: string;
  source_version: string;
  effective_date: string;
}

interface ImportOptions {
  sourceDir: string;
  normalizedDir: string;
  normalizedFile: string;
  sourceVersion: string;
  effectiveDate: string;
  disableMissing: boolean;
  allowDangerousDisable: boolean;
}

interface ImportStats {
  province: number;
  city: number;
  county: number;
  town: number;
  village: number;
  skipped: number;
  invalid: number;
  insertedOrUpdated: number;
  disabled: number;
  /** 同步到业务表 region（供 /regions/options、项目「所属区域」选用） */
  provinces_mirrored_to_region: number;
}

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const LEVEL_CODE_LENGTH: Record<RegionLevel, number> = {
  province: 2,
  city: 4,
  county: 6,
  town: 9,
  village: 12
};

const DEFAULT_SOURCE_VERSION = 'china-division-2.7.0+2023-09-11';
const DEFAULT_EFFECTIVE_DATE = '2023-06-30';
const BACKEND_ROOT = resolve(__dirname, '..');

function parseArgs(argv: string[]): ImportOptions {
  const options: ImportOptions = {
    sourceDir: resolve(BACKEND_ROOT, 'data', 'region-reference', 'raw'),
    normalizedDir: resolve(BACKEND_ROOT, 'data', 'region-reference', 'normalized'),
    normalizedFile: resolve(BACKEND_ROOT, 'data', 'region-reference', 'normalized', 'region-reference.normalized.ndjson'),
    sourceVersion: DEFAULT_SOURCE_VERSION,
    effectiveDate: DEFAULT_EFFECTIVE_DATE,
    disableMissing: false,
    allowDangerousDisable: false
  };

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const [key, rawValue] = arg.slice(2).split('=', 2);
    const value = rawValue ?? 'true';
    switch (key) {
      case 'source-dir':
        options.sourceDir = resolve(process.cwd(), value);
        break;
      case 'normalized-dir':
        options.normalizedDir = resolve(process.cwd(), value);
        options.normalizedFile = join(options.normalizedDir, 'region-reference.normalized.ndjson');
        break;
      case 'normalized-file':
        options.normalizedFile = resolve(process.cwd(), value);
        options.normalizedDir = dirname(options.normalizedFile);
        break;
      case 'source-version':
        options.sourceVersion = value;
        break;
      case 'effective-date':
        options.effectiveDate = value;
        break;
      case 'disable-missing':
        options.disableMissing = value === 'true';
        break;
      case 'allow-dangerous-disable':
        options.allowDangerousDisable = value === 'true';
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (options.disableMissing && !options.allowDangerousDisable) {
    throw new Error(
      'Refusing to disable region_reference rows. ' +
      'Use --allow-dangerous-disable=true only for explicit emergency maintenance.'
    );
  }

  return options;
}

function ensureDirectory(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((value) => value.trim());
}

async function readCsvRows(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input, crlfDelay: Infinity });

  let headers: string[] | null = null;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line) {
      continue;
    }

    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }

    const columns = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = columns[index] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function assertFileExists(path: string) {
  if (!existsSync(path)) {
    throw new Error(`Required raw file not found: ${path}`);
  }
}

function normalizeSourceType(level: RegionLevel): string {
  if (level === 'province' || level === 'city' || level === 'county') {
    return 'official_national_division_code';
  }
  if (level === 'town') {
    return 'formal_township_reference';
  }
  return 'village_reference_registry';
}

function validateCode(level: RegionLevel, code: string) {
  const expectedLength = LEVEL_CODE_LENGTH[level];
  if (code.length !== expectedLength) {
    throw new Error(`Invalid ${level} code length for ${code}: expected ${expectedLength}`);
  }
}

function createNormalizedRecord(
  raw: RawRegionRecord,
  ancestors: NormalizedRegionRecord[],
  sourceVersion: string,
  effectiveDate: string
): NormalizedRegionRecord {
  validateCode(raw.level, raw.code);
  const pathNames = [...ancestors.map((item) => item.name), raw.name];
  const pathCodes = [...ancestors.map((item) => item.code), raw.code];

  return {
    code: raw.code,
    name: raw.name,
    level: raw.level,
    parent_code: raw.parentCode,
    full_path_name: pathNames.join(' / '),
    full_path_code: pathCodes.join('/'),
    enabled: true,
    source_type: normalizeSourceType(raw.level),
    source_version: sourceVersion,
    effective_date: effectiveDate
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDirectory(options.sourceDir);
  ensureDirectory(options.normalizedDir);
  if (existsSync(options.normalizedFile)) {
    rmSync(options.normalizedFile, { force: true });
  }

  const requiredFiles = {
    provinces: join(options.sourceDir, 'provinces.csv'),
    cities: join(options.sourceDir, 'cities.csv'),
    areas: join(options.sourceDir, 'areas.csv'),
    streets: join(options.sourceDir, 'streets.csv'),
    villages: join(options.sourceDir, 'villages.csv')
  };

  Object.values(requiredFiles).forEach(assertFileExists);

  const stats: ImportStats = {
    province: 0,
    city: 0,
    county: 0,
    town: 0,
    village: 0,
    skipped: 0,
    invalid: 0,
    insertedOrUpdated: 0,
    disabled: 0,
    provinces_mirrored_to_region: 0
  };

  const known = new Map<string, NormalizedRegionRecord>();
  const normalizedWriter = createWriteStream(options.normalizedFile, { encoding: 'utf8' });

  const pushRecord = (record: NormalizedRegionRecord) => {
    known.set(record.code, record);
    normalizedWriter.write(`${JSON.stringify(record)}\n`);
    stats[record.level] += 1;
  };

  const provinces = await readCsvRows(requiredFiles.provinces);
  for (const row of provinces) {
    const raw: RawRegionRecord = {
      code: row.code,
      name: row.name,
      level: 'province',
      parentCode: null
    };
    pushRecord(createNormalizedRecord(raw, [], options.sourceVersion, options.effectiveDate));
  }

  const cities = await readCsvRows(requiredFiles.cities);
  for (const row of cities) {
    const parent = known.get(row.provinceCode);
    if (!parent) {
      stats.invalid += 1;
      throw new Error(`City ${row.code} is missing province parent ${row.provinceCode}`);
    }
    const raw: RawRegionRecord = {
      code: row.code,
      name: row.name,
      level: 'city',
      parentCode: parent.code
    };
    pushRecord(createNormalizedRecord(raw, [parent], options.sourceVersion, options.effectiveDate));
  }

  const areas = await readCsvRows(requiredFiles.areas);
  for (const row of areas) {
    const parent = known.get(row.cityCode);
    if (!parent) {
      stats.invalid += 1;
      throw new Error(`County ${row.code} is missing city parent ${row.cityCode}`);
    }
    const province = known.get(row.provinceCode);
    if (!province) {
      stats.invalid += 1;
      throw new Error(`County ${row.code} is missing province parent ${row.provinceCode}`);
    }
    const raw: RawRegionRecord = {
      code: row.code,
      name: row.name,
      level: 'county',
      parentCode: parent.code
    };
    pushRecord(createNormalizedRecord(raw, [province, parent], options.sourceVersion, options.effectiveDate));
  }

  const streets = await readCsvRows(requiredFiles.streets);
  for (const row of streets) {
    const county = known.get(row.areaCode);
    const city = known.get(row.cityCode);
    const province = known.get(row.provinceCode);
    if (!county || !city || !province) {
      stats.invalid += 1;
      throw new Error(`Town ${row.code} is missing parent chain province=${row.provinceCode} city=${row.cityCode} county=${row.areaCode}`);
    }
    const raw: RawRegionRecord = {
      code: row.code,
      name: row.name,
      level: 'town',
      parentCode: county.code
    };
    pushRecord(createNormalizedRecord(raw, [province, city, county], options.sourceVersion, options.effectiveDate));
  }

  const villages = await readCsvRows(requiredFiles.villages);
  for (const row of villages) {
    const town = known.get(row.streetCode);
    const county = known.get(row.areaCode);
    const city = known.get(row.cityCode);
    const province = known.get(row.provinceCode);
    if (!town || !county || !city || !province) {
      stats.invalid += 1;
      throw new Error(
        `Village ${row.code} is missing parent chain province=${row.provinceCode} city=${row.cityCode} county=${row.areaCode} town=${row.streetCode}`
      );
    }
    const raw: RawRegionRecord = {
      code: row.code,
      name: row.name,
      level: 'village',
      parentCode: town.code
    };
    pushRecord(createNormalizedRecord(raw, [province, city, county, town], options.sourceVersion, options.effectiveDate));
  }

  await new Promise<void>((resolvePromise, reject) => {
    normalizedWriter.end(() => resolvePromise());
    normalizedWriter.on('error', reject);
  });

  const databaseUrl = process.env.DATABASE_URL ?? readDatabaseUrlFromEnv(resolve(BACKEND_ROOT, '.env'));
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for region_reference import');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`select set_config('app.region_reference_guard_disabled', 'on', true)`);

    const values = Array.from(known.values());
    for (const batch of chunk(values, 500)) {
      const params: unknown[] = [];
      const rowsSql = batch
        .map((record, index) => {
          const base = index * 10;
          params.push(
            record.code,
            record.name,
            record.level,
            record.parent_code,
            record.full_path_name,
            record.full_path_code,
            record.enabled,
            record.source_type,
            record.source_version,
            record.effective_date
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        })
        .join(',\n');

      await client.query(
        `
        insert into region_reference (
          code,
          name,
          level,
          parent_code,
          full_path_name,
          full_path_code,
          enabled,
          source_type,
          source_version,
          effective_date
        )
        values
        ${rowsSql}
        on conflict (code) do update
        set
          name = excluded.name,
          level = excluded.level,
          parent_code = excluded.parent_code,
          full_path_name = excluded.full_path_name,
          full_path_code = excluded.full_path_code,
          enabled = excluded.enabled,
          source_type = excluded.source_type,
          source_version = excluded.source_version,
          effective_date = excluded.effective_date,
          updated_at = now()
        `,
        params
      );

      stats.insertedOrUpdated += batch.length;
    }

    if (options.disableMissing) {
      await client.query(`select set_config('app.region_reference_guard_disabled', 'on', true)`);
      const importedCodes = Array.from(known.keys());
      await client.query(
        `
        update region_reference
        set enabled = false, updated_at = now()
        where source_version = $1
          and code <> all($2::varchar[])
        `,
        [options.sourceVersion, importedCodes]
      );
      const disabledResult = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from region_reference
        where source_version = $1
          and enabled = false
        `,
        [options.sourceVersion]
      );
      stats.disabled = Number(disabledResult.rows[0]?.count ?? '0');
    }

    const mirrorResult = await client.query(
      `
      insert into region (
        tenant_id,
        parent_id,
        region_code,
        region_name,
        region_type,
        full_path,
        manager_user_id,
        status,
        created_at,
        updated_at
      )
      select
        $1::uuid,
        null,
        rr.code,
        rr.name,
        'province',
        '/' || rr.code,
        null,
        'active',
        now(),
        now()
      from region_reference rr
      where rr.level = 'province'
        and rr.parent_code is null
        and rr.enabled = true
      on conflict (tenant_id, region_code) do nothing
      returning id
      `,
      [DEFAULT_TENANT_ID]
    );
    stats.provinces_mirrored_to_region = mirrorResult.rowCount ?? 0;

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(JSON.stringify({
    source_dir: options.sourceDir,
    normalized_file: options.normalizedFile,
    source_version: options.sourceVersion,
    effective_date: options.effectiveDate,
    stats
  }, null, 2));
}

function readDatabaseUrlFromEnv(envFile: string) {
  if (!existsSync(envFile)) {
    return undefined;
  }
  const content = readFileSync(envFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    if (key === 'DATABASE_URL') {
      return rest.join('=').trim();
    }
  }
  return undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
