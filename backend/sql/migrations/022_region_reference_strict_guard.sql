-- 行政区划参考库 region_reference：导入完成后禁止 UPDATE/DELETE（维护时仅在会话内 set_config 临时放开，见 import-region-reference.ts）

create or replace function protect_region_reference_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.region_reference_guard_disabled', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'region_reference is immutable: delete is forbidden';
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'region_reference is immutable: update is forbidden';
  end if;

  return new;
end;
$$;
