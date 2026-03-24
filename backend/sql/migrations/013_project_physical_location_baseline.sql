alter table project
add column if not exists manual_region_id varchar(32) null;

create index if not exists idx_project_manual_region_id on project(manual_region_id);
