-- 015_block_metering_network_scope_solver.sql
-- COD-2026-03-26-013: Phase 1 additive skeleton for project blocks, metering points,
-- network hydraulic model (versioned graph), and project/block data-scope policy rows.
-- Does not modify runtime_session, irrigation_order, or existing HTTP runtime semantics.

CREATE SEQUENCE IF NOT EXISTS block_code_seq START 1 INCREMENT 1 MINVALUE 1;
CREATE SEQUENCE IF NOT EXISTS metering_point_code_seq START 1 INCREMENT 1 MINVALUE 1;

COMMENT ON SEQUENCE block_code_seq IS 'Feeds application-side BLK-HJ-### style codes; block count per project is derived, not stored.';
COMMENT ON SEQUENCE metering_point_code_seq IS 'Feeds application-side MP-HJ-### style metering_point_code values.';

CREATE TABLE IF NOT EXISTS project_block (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  block_code varchar(64) NOT NULL,
  project_id uuid NOT NULL REFERENCES project (id),
  block_name varchar(128) NOT NULL,
  center_latitude numeric(10, 6) NULL,
  center_longitude numeric(10, 6) NULL,
  boundary_geojson jsonb NULL,
  area_size numeric(18, 4) NULL,
  priority integer NOT NULL DEFAULT 0,
  default_metering_point_id uuid NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  remarks text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, block_code)
);

COMMENT ON TABLE project_block IS 'Irrigation / ops block under a project; block_code is system-generated; boundary in WGS84 GeoJSON.';
COMMENT ON COLUMN project_block.area_size IS 'Arbitrary display unit agreed with frontend; numeric only at this layer.';
COMMENT ON COLUMN project_block.default_metering_point_id IS 'Optional primary metering point for UI defaults; FK added after metering_point exists.';

CREATE INDEX IF NOT EXISTS idx_project_block_project_id ON project_block (tenant_id, project_id);

CREATE TABLE IF NOT EXISTS metering_point (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  metering_point_code varchar(64) NOT NULL,
  project_id uuid NOT NULL REFERENCES project (id),
  block_id uuid NOT NULL REFERENCES project_block (id),
  asset_id uuid NULL REFERENCES asset (id),
  primary_meter_device_id uuid NULL REFERENCES device (id),
  metering_type varchar(32) NOT NULL,
  tariff_plan_id uuid NULL REFERENCES billing_package (id),
  allocation_rule_id uuid NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  remarks text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metering_point_code)
);

COMMENT ON TABLE metering_point IS 'Formal accounting boundary; transformer area is asset domain, grid meter is device domain.';
COMMENT ON COLUMN metering_point.tariff_plan_id IS 'Phase 1: points to billing_package.id until a dedicated tariff_plan table exists.';
COMMENT ON COLUMN metering_point.allocation_rule_id IS 'Reserved for future allocation_rule table; no FK in Phase 1 skeleton.';

CREATE INDEX IF NOT EXISTS idx_metering_point_project ON metering_point (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_metering_point_block ON metering_point (tenant_id, block_id);

ALTER TABLE project_block
  DROP CONSTRAINT IF EXISTS fk_project_block_default_metering_point;

ALTER TABLE project_block
  ADD CONSTRAINT fk_project_block_default_metering_point FOREIGN KEY (default_metering_point_id) REFERENCES metering_point (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS network_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  project_id uuid NOT NULL REFERENCES project (id),
  model_name varchar(128) NOT NULL,
  source_type varchar(32) NOT NULL DEFAULT 'import',
  status varchar(16) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE network_model IS 'Hydraulic / pipe network header per project; geometry lives in versioned node/pipe tables.';

CREATE INDEX IF NOT EXISTS idx_network_model_project ON network_model (tenant_id, project_id);

CREATE TABLE IF NOT EXISTS network_model_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_model_id uuid NOT NULL REFERENCES network_model (id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  is_published boolean NOT NULL DEFAULT false,
  source_file_ref varchar(512) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network_model_id, version_no)
);

COMMENT ON COLUMN network_model_version.source_file_ref IS 'Opaque storage key for imported source; not interpreted by DB.';

CREATE TABLE IF NOT EXISTS network_node (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES network_model_version (id) ON DELETE CASCADE,
  node_code varchar(64) NOT NULL,
  node_type varchar(32) NOT NULL,
  asset_id uuid NULL REFERENCES asset (id),
  latitude numeric(10, 6) NULL,
  longitude numeric(10, 6) NULL,
  altitude numeric(10, 2) NULL,
  UNIQUE (version_id, node_code)
);

CREATE INDEX IF NOT EXISTS idx_network_node_version ON network_node (version_id);

CREATE TABLE IF NOT EXISTS network_pipe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES network_model_version (id) ON DELETE CASCADE,
  pipe_code varchar(64) NOT NULL,
  pipe_type varchar(32) NOT NULL,
  from_node_id uuid NOT NULL REFERENCES network_node (id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES network_node (id) ON DELETE CASCADE,
  length_m numeric(12, 3) NULL,
  diameter_mm numeric(12, 3) NULL,
  UNIQUE (version_id, pipe_code)
);

CREATE INDEX IF NOT EXISTS idx_network_pipe_version ON network_pipe (version_id);

CREATE TABLE IF NOT EXISTS data_scope_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  subject_type varchar(32) NOT NULL,
  subject_id uuid NOT NULL,
  scope_type varchar(16) NOT NULL,
  project_id uuid NULL REFERENCES project (id),
  block_id uuid NULL REFERENCES project_block (id),
  effect varchar(16) NOT NULL DEFAULT 'allow',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_data_scope_policy_scope_type CHECK (scope_type IN ('project', 'block')),
  CONSTRAINT chk_data_scope_policy_shape CHECK (
    (scope_type = 'project' AND project_id IS NOT NULL AND block_id IS NULL)
    OR (scope_type = 'block' AND project_id IS NOT NULL AND block_id IS NOT NULL)
  )
);

COMMENT ON TABLE data_scope_policy IS 'Primary IAM grain: project or block; device-level is exceptional, not modeled as default.';
COMMENT ON COLUMN data_scope_policy.subject_type IS 'Examples: user, role, api_client — validated in application layer.';

CREATE INDEX IF NOT EXISTS idx_data_scope_policy_subject ON data_scope_policy (tenant_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_data_scope_policy_project ON data_scope_policy (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_data_scope_policy_block ON data_scope_policy (tenant_id, block_id);
