-- Demo seed: one block, one metering point, minimal network graph, one data_scope_policy row.
-- Depends on 002b (project, asset) and 003 (billing_package).

insert into project_block (
  id,
  tenant_id,
  block_code,
  project_id,
  block_name,
  center_latitude,
  center_longitude,
  boundary_geojson,
  area_size,
  priority,
  default_metering_point_id,
  status,
  remarks,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000a01',
  '00000000-0000-0000-0000-000000000001',
  'BLK-HJ-001',
  '00000000-0000-0000-0000-000000000801',
  'North demo block',
  34.258100,
  108.197000,
  '{"type":"Polygon","coordinates":[[[108.196,34.257],[108.198,34.257],[108.198,34.259],[108.196,34.259],[108.196,34.257]]]}'::jsonb,
  125000.0000,
  1,
  null,
  'active',
  'COD-2026-03-26-013 skeleton',
  '2026-03-26 10:00:00+08',
  '2026-03-26 10:00:00+08'
)
on conflict (id) do nothing;

insert into metering_point (
  id,
  tenant_id,
  metering_point_code,
  project_id,
  block_id,
  asset_id,
  primary_meter_device_id,
  point_name,
  metering_type,
  rated_capacity_kva,
  tariff_plan_id,
  allocation_rule_id,
  status,
  remarks,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000a02',
  '00000000-0000-0000-0000-000000000001',
  'MP-HJ-001',
  '00000000-0000-0000-0000-000000000801',
  '00000000-0000-0000-0000-000000000a01',
  '00000000-0000-0000-0000-000000000901',
  '00000000-0000-0000-0000-000000000431',
  'Demo metering point',
  'GRID_METER',
  200.00,
  '00000000-0000-0000-0000-000000000801',
  null,
  'active',
  'Demo metering point',
  '2026-03-26 10:00:00+08',
  '2026-03-26 10:00:00+08'
)
on conflict (id) do nothing;

update project_block
set default_metering_point_id = '00000000-0000-0000-0000-000000000a02',
    updated_at = now()
where id = '00000000-0000-0000-0000-000000000a01'
  and default_metering_point_id is null;

select setval('block_code_seq', 1, true);
select setval('metering_point_code_seq', 1, true);

insert into network_model (
  id,
  tenant_id,
  project_id,
  model_name,
  source_type,
  status,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000a10',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000801',
  'Demo hydraulic network',
  'manual',
  'draft',
  '2026-03-26 10:00:00+08',
  '2026-03-26 10:00:00+08'
)
on conflict (id) do nothing;

insert into network_model_version (
  id,
  network_model_id,
  version_no,
  is_published,
  published_at,
  source_file_ref,
  created_at
)
values (
  '00000000-0000-0000-0000-000000000a11',
  '00000000-0000-0000-0000-000000000a10',
  1,
  true,
  '2026-03-26 10:00:00+08',
  null,
  '2026-03-26 10:00:00+08'
)
on conflict (id) do nothing;

insert into network_node (
  id,
  version_id,
  node_code,
  node_type,
  asset_id,
  latitude,
  longitude,
  altitude
)
values
  (
    '00000000-0000-0000-0000-000000000a12',
    '00000000-0000-0000-0000-000000000a11',
    'N-WELL-01',
    'well',
    '00000000-0000-0000-0000-000000000901',
    34.258100,
    108.197000,
    420.00
  ),
  (
    '00000000-0000-0000-0000-000000000a13',
    '00000000-0000-0000-0000-000000000a11',
    'N-PUMP-01',
    'pump',
    '00000000-0000-0000-0000-000000000911',
    34.258120,
    108.197030,
    418.50
  )
on conflict (id) do nothing;

insert into network_pipe (
  id,
  version_id,
  pipe_code,
  pipe_type,
  from_node_id,
  to_node_id,
  length_m,
  diameter_mm
)
values (
  '00000000-0000-0000-0000-000000000a14',
  '00000000-0000-0000-0000-000000000a11',
  'P-S01-01',
  'pvc',
  '00000000-0000-0000-0000-000000000a12',
  '00000000-0000-0000-0000-000000000a13',
  12.500,
  110.000
)
on conflict (id) do nothing;

insert into data_scope_policy (
  id,
  tenant_id,
  subject_type,
  subject_id,
  scope_type,
  project_id,
  block_id,
  effect,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000a20',
  '00000000-0000-0000-0000-000000000001',
  'user',
  '00000000-0000-0000-0000-000000000102',
  'project',
  '00000000-0000-0000-0000-000000000801',
  null,
  'allow',
  '2026-03-26 10:00:00+08',
  '2026-03-26 10:00:00+08'
)
on conflict (id) do nothing;
