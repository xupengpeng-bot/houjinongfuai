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
  (
    '61',
    'Shaanxi Province',
    'province',
    null,
    'Shaanxi Province',
    '61',
    true,
    'official_national_code',
    'CN-2025-01',
    '2025-01-01'
  ),
  (
    '6104',
    'Xianyang City',
    'city',
    '61',
    'Shaanxi Province / Xianyang City',
    '61/6104',
    true,
    'official_national_code',
    'CN-2025-01',
    '2025-01-01'
  ),
  (
    '610431',
    'Wugong County',
    'county',
    '6104',
    'Shaanxi Province / Xianyang City / Wugong County',
    '61/6104/610431',
    true,
    'official_national_code',
    'CN-2025-01',
    '2025-01-01'
  ),
  (
    '610431001',
    'Puju Town',
    'town',
    '610431',
    'Shaanxi Province / Xianyang City / Wugong County / Puju Town',
    '61/6104/610431/610431001',
    true,
    'provincial_civil_affairs_bulletin',
    'SN-2025-TOWN-01',
    '2025-01-01'
  ),
  (
    '610431001001',
    'East Village',
    'village',
    '610431001',
    'Shaanxi Province / Xianyang City / Wugong County / Puju Town / East Village',
    '61/6104/610431/610431001/610431001001',
    true,
    'village_reference_registry',
    'WG-2025-VILLAGE-01',
    '2025-01-01'
  ),
  (
    '610431001002',
    'South Village',
    'village',
    '610431001',
    'Shaanxi Province / Xianyang City / Wugong County / Puju Town / South Village',
    '61/6104/610431/610431001/610431001002',
    true,
    'village_reference_registry',
    'WG-2025-VILLAGE-01',
    '2025-01-01'
  ),
  (
    '610431001003',
    'West Village',
    'village',
    '610431001',
    'Shaanxi Province / Xianyang City / Wugong County / Puju Town / West Village',
    '61/6104/610431/610431001/610431001003',
    true,
    'village_reference_registry',
    'WG-2025-VILLAGE-01',
    '2025-01-01'
  )
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
  updated_at = now();
