-- 049_network_model_version_history_draft_scope.sql
-- Preserve published history while still enforcing at most one current draft per scope.

drop index if exists uq_network_model_version_one_draft_per_model_block;
drop index if exists uq_network_model_version_one_draft_per_model_unscoped;

create unique index if not exists uq_network_model_version_one_draft_per_model_block
  on network_model_version (network_model_id, block_id)
  where is_published = false
    and published_at is null
    and block_id is not null;

create unique index if not exists uq_network_model_version_one_draft_per_model_unscoped
  on network_model_version (network_model_id)
  where is_published = false
    and published_at is null
    and block_id is null;
