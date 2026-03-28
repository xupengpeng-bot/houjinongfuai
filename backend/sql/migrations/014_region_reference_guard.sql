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

  if tg_op = 'UPDATE' and old.enabled = true and new.enabled = false then
    raise exception 'region_reference is immutable: disabling active rows is forbidden';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_region_reference_mutation on region_reference;
create trigger trg_protect_region_reference_mutation
before update or delete on region_reference
for each row
execute function protect_region_reference_mutation();
