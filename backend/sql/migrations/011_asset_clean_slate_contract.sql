create sequence if not exists asset_code_seq start 1;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'asset'
      and column_name = 'manual_region_id'
      and data_type = 'uuid'
  ) then
    alter table asset add column if not exists manual_region_code varchar(32);

    update asset a
    set manual_region_code = r.region_code
    from region r
    where a.manual_region_id = r.id;

    alter table asset drop constraint if exists asset_manual_region_id_fkey;
    drop index if exists idx_asset_manual_region_id;

    alter table asset drop column manual_region_id;
    alter table asset rename column manual_region_code to manual_region_id;
  end if;
end $$;

create index if not exists idx_asset_manual_region_id on asset(manual_region_id);
