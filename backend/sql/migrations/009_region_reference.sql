CREATE TABLE IF NOT EXISTS region_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL,
  name varchar(128) NOT NULL,
  level varchar(16) NOT NULL,
  parent_code varchar(32) NULL,
  full_path_name varchar(512) NOT NULL,
  full_path_code varchar(512) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  source_type varchar(64) NOT NULL,
  source_version varchar(64) NOT NULL,
  effective_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_region_reference_code UNIQUE (code),
  CONSTRAINT fk_region_reference_parent_code FOREIGN KEY (parent_code) REFERENCES region_reference(code),
  CONSTRAINT chk_region_reference_level CHECK (level IN ('province', 'city', 'county', 'town', 'village'))
);

CREATE INDEX IF NOT EXISTS idx_region_reference_parent_code ON region_reference(parent_code);
CREATE INDEX IF NOT EXISTS idx_region_reference_level ON region_reference(level);
CREATE INDEX IF NOT EXISTS idx_region_reference_enabled ON region_reference(enabled);
