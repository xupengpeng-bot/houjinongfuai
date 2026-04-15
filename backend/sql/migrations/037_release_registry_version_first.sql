-- 037_release_registry_version_first.sql
-- Align release registry with the version-first model:
-- 1. device_type_id becomes optional
-- 2. embedded release kind is merged into software

update device_release_registry
set release_kind = 'software'
where release_kind = 'embedded';

alter table if exists device_release_registry
  alter column device_type_id drop not null;

alter table if exists device_release_registry
  drop constraint if exists ck_device_release_kind;

alter table if exists device_release_registry
  add constraint ck_device_release_kind
  check (release_kind in ('software', 'hardware'));

create index if not exists ix_device_release_registry_kind_created_at
  on device_release_registry (tenant_id, release_kind, created_at desc);
