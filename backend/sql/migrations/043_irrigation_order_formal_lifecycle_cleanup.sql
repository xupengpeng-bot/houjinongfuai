-- Normalize legacy order lifecycle markers into the formal lifecycle vocabulary.
-- This keeps historical rows consistent with the platform-facing lifecycle state machine.

with normalized as (
  select
    io.id,
    case
      when coalesce(io.pricing_detail_json->>'stop_pending_review', 'false') = 'true'
        or io.pricing_detail_json ? 'stop_pending_review_at'
        then 'stop_pending_review'
      when lower(coalesce(io.pricing_detail_json->>'lifecycle_stage', '')) = 'draft'
        then 'draft'
      when lower(coalesce(io.pricing_detail_json->>'lifecycle_stage', '')) in (
        'pending_start',
        'waiting_start',
        'paid_waiting_start',
        'locked_waiting_start'
      )
        then 'pending_start'
      when lower(coalesce(io.pricing_detail_json->>'lifecycle_stage', '')) in (
        'running',
        'running_paid',
        'running_locked',
        'billing',
        'pausing'
      )
        then 'running'
      when lower(coalesce(io.pricing_detail_json->>'lifecycle_stage', '')) in ('paused', 'resuming')
        then 'paused'
      when lower(coalesce(io.pricing_detail_json->>'lifecycle_stage', '')) in ('stopping', 'stopping_settling')
        then 'stopping'
      when lower(coalesce(io.pricing_detail_json->>'lifecycle_stage', '')) = 'ended'
        then 'ended'
      when lower(coalesce(io.pricing_detail_json->>'lifecycle_stage', '')) in (
        'settled',
        'refunded',
        'start_failed',
        'start_failed_refunded'
      )
        then 'settled'
      when lower(coalesce(io.status, '')) = 'settled'
        then 'settled'
      when lower(coalesce(rs.status, '')) = 'pending_start'
        then 'pending_start'
      when lower(coalesce(rs.status, '')) in ('running', 'billing', 'pausing')
        then 'running'
      when lower(coalesce(rs.status, '')) in ('paused', 'resuming')
        then 'paused'
      when lower(coalesce(rs.status, '')) = 'stopping'
        then 'stopping'
      when lower(coalesce(rs.status, '')) = 'ended'
        then 'ended'
      when lower(coalesce(io.status, '')) = 'created'
        then 'draft'
      else 'running'
    end as lifecycle_stage
  from irrigation_order io
  join runtime_session rs on rs.id = io.session_id
)
update irrigation_order io
set pricing_detail_json = jsonb_set(
      coalesce(io.pricing_detail_json, '{}'::jsonb),
      '{lifecycle_stage}',
      to_jsonb(normalized.lifecycle_stage),
      true
    ),
    updated_at = now()
from normalized
where normalized.id = io.id
  and coalesce(io.pricing_detail_json->>'lifecycle_stage', '') is distinct from normalized.lifecycle_stage;

update irrigation_order
set pricing_detail_json = jsonb_set(
      coalesce(pricing_detail_json, '{}'::jsonb),
      '{stop_pending_review}',
      'true'::jsonb,
      true
    ),
    updated_at = now()
where pricing_detail_json ? 'stop_pending_review_at'
  and coalesce(pricing_detail_json->>'stop_pending_review', 'false') <> 'true';

create index if not exists ix_irrigation_order_lifecycle_stage_json
  on irrigation_order ((pricing_detail_json->>'lifecycle_stage'));

create index if not exists ix_irrigation_order_stop_pending_review_json
  on irrigation_order ((pricing_detail_json->>'stop_pending_review'))
  where pricing_detail_json->>'stop_pending_review' = 'true';
