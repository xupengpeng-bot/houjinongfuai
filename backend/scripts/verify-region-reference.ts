import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';

type RegionLevel = 'province' | 'city' | 'county' | 'town' | 'village';

const LEVEL_CODE_LENGTH: Record<RegionLevel, number> = {
  province: 2,
  city: 4,
  county: 6,
  town: 9,
  village: 12
};
const BACKEND_ROOT = resolve(__dirname, '..');

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

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? readDatabaseUrlFromEnv(resolve(BACKEND_ROOT, '.env'));
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for region_reference verify');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const levelCounts = await pool.query<{ level: RegionLevel; count: string }>(
      `
      select level, count(*)::text as count
      from region_reference
      where enabled = true
      group by level
      order by case level
        when 'province' then 1
        when 'city' then 2
        when 'county' then 3
        when 'town' then 4
        when 'village' then 5
      end
      `
    );

    const duplicateCodes = await pool.query<{ code: string; count: string }>(
      `
      select code, count(*)::text as count
      from region_reference
      group by code
      having count(*) > 1
      `
    );

    const brokenParents = await pool.query<{ code: string; parent_code: string | null }>(
      `
      select child.code, child.parent_code
      from region_reference child
      left join region_reference parent on parent.code = child.parent_code
      where child.parent_code is not null
        and parent.code is null
      `
    );

    const invalidLengths = await pool.query<{ code: string; level: RegionLevel }>(
      `
      select code, level
      from region_reference
      where (
        (level = 'province' and char_length(code) <> 2) or
        (level = 'city' and char_length(code) <> 4) or
        (level = 'county' and char_length(code) <> 6) or
        (level = 'town' and char_length(code) <> 9) or
        (level = 'village' and char_length(code) <> 12)
      )
      `
    );

    const topLevel = await pool.query<{ code: string; name: string }>(
      `
      select code, name
      from region_reference
      where parent_code is null
      order by code
      limit 10
      `
    );

    const stats = {
      province: Number(levelCounts.rows.find((row) => row.level === 'province')?.count ?? '0'),
      city: Number(levelCounts.rows.find((row) => row.level === 'city')?.count ?? '0'),
      county: Number(levelCounts.rows.find((row) => row.level === 'county')?.count ?? '0'),
      town: Number(levelCounts.rows.find((row) => row.level === 'town')?.count ?? '0'),
      village: Number(levelCounts.rows.find((row) => row.level === 'village')?.count ?? '0')
    };

    const errors: string[] = [];
    if ((duplicateCodes.rowCount ?? 0) > 0) {
      errors.push(`duplicate codes: ${duplicateCodes.rowCount ?? 0}`);
    }
    if ((brokenParents.rowCount ?? 0) > 0) {
      errors.push(`broken parent links: ${brokenParents.rowCount ?? 0}`);
    }
    if ((invalidLengths.rowCount ?? 0) > 0) {
      errors.push(`invalid code length rows: ${invalidLengths.rowCount ?? 0}`);
    }
    if (stats.province === 0 || stats.city === 0 || stats.county === 0 || stats.town === 0 || stats.village === 0) {
      errors.push('missing one or more region levels');
    }

    console.log(JSON.stringify({
      stats,
      top_level_sample: topLevel.rows,
      errors
    }, null, 2));

    if (errors.length > 0) {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
