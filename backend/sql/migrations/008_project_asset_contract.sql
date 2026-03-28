CREATE TABLE IF NOT EXISTS project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  project_code varchar(64) NOT NULL,
  project_name varchar(128) NOT NULL,
  region_id uuid NOT NULL REFERENCES region(id),
  status varchar(16) NOT NULL DEFAULT 'draft',
  owner varchar(128) NOT NULL DEFAULT '',
  operator varchar(128) NOT NULL DEFAULT '',
  remarks text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_code)
);

CREATE INDEX IF NOT EXISTS idx_project_region_id ON project(region_id);

CREATE TABLE IF NOT EXISTS asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  asset_code varchar(64) NOT NULL,
  asset_name varchar(128) NOT NULL,
  asset_type varchar(32) NOT NULL,
  parent_asset_id uuid NULL REFERENCES asset(id),
  project_id uuid NOT NULL REFERENCES project(id),
  lifecycle_status varchar(16) NOT NULL DEFAULT 'draft',
  install_status varchar(16) NOT NULL DEFAULT 'planned',
  manual_region_id uuid NULL REFERENCES region(id),
  manual_address_text varchar(256) NULL,
  manual_latitude numeric(10, 6) NULL,
  manual_longitude numeric(10, 6) NULL,
  install_position_desc varchar(256) NULL,
  location_source_strategy varchar(32) NOT NULL DEFAULT 'manual_preferred',
  reported_latitude numeric(10, 6) NULL,
  reported_longitude numeric(10, 6) NULL,
  reported_at timestamptz NULL,
  reported_source varchar(64) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, asset_code)
);

CREATE INDEX IF NOT EXISTS idx_asset_project_id ON asset(project_id);
CREATE INDEX IF NOT EXISTS idx_asset_parent_asset_id ON asset(parent_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_manual_region_id ON asset(manual_region_id);
