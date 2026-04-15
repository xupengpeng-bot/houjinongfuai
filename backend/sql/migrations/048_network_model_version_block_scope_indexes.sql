-- 048_network_model_version_block_scope_indexes.sql
-- Stabilize block-scoped version ordering after block-level uniqueness moved into 027.

create index if not exists ix_network_model_version_block_scope_order
  on network_model_version (network_model_id, block_id, version_no desc, created_at desc);
