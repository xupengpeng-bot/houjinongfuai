alter table device_card_audit_log
  add column if not exists tcp_audit_log_id uuid references device_tcp_audit_log(id);

create index if not exists ix_device_card_audit_log_tcp_audit
  on device_card_audit_log (tcp_audit_log_id);

with raw_card_frames as (
  select
    dtal.id,
    dtal.tenant_id,
    d.id as device_id,
    dtal.imei,
    dtal.msg_type,
    dtal.created_at,
    dtal.request_snapshot_json,
    lower(
      coalesce(
        dtal.request_snapshot_json #>> '{p,ec}',
        dtal.request_snapshot_json #>> '{payload,ec}',
        dtal.request_snapshot_json #>> '{p,event_code}',
        dtal.request_snapshot_json #>> '{payload,event_code}',
        ''
      )
    ) as event_code,
    lower(
      coalesce(
        dtal.request_snapshot_json #>> '{p,qc}',
        dtal.request_snapshot_json #>> '{payload,qc}',
        dtal.request_snapshot_json #>> '{p,query_code}',
        dtal.request_snapshot_json #>> '{payload,query_code}',
        ''
      )
    ) as query_code,
    lower(
      coalesce(
        dtal.request_snapshot_json #>> '{p,rc}',
        dtal.request_snapshot_json #>> '{payload,rc}',
        dtal.request_snapshot_json #>> '{p,reason_code}',
        dtal.request_snapshot_json #>> '{payload,reason_code}',
        dtal.request_snapshot_json #>> '{p,reject_code}',
        dtal.request_snapshot_json #>> '{payload,reject_code}',
        ''
      )
    ) as reason_code,
    lower(
      coalesce(
        dtal.request_snapshot_json #>> '{p,tr}',
        dtal.request_snapshot_json #>> '{payload,tr}',
        dtal.request_snapshot_json #>> '{p,target_ref}',
        dtal.request_snapshot_json #>> '{payload,target_ref}',
        ''
      )
    ) as target_ref,
    coalesce(
      dtal.request_snapshot_json #>> '{p,msg}',
      dtal.request_snapshot_json #>> '{payload,msg}',
      ''
    ) as raw_message
  from device_tcp_audit_log dtal
  left join device d
    on d.tenant_id = dtal.tenant_id
   and d.imei = dtal.imei
  where lower(coalesce(dtal.msg_type, dtal.request_snapshot_json ->> 't', '')) in ('event_report', 'query')
), normalized_card_frames as (
  select
    id,
    tenant_id,
    device_id,
    imei,
    msg_type,
    created_at,
    request_snapshot_json,
    case
      when event_code <> '' then event_code
      when query_code = 'card_swipe' then 'card_swipe_requested'
      else null
    end as normalized_event_code,
    nullif(reason_code, '') as normalized_reason_code,
    nullif(target_ref, '') as normalized_target_ref,
    nullif(raw_message, '') as normalized_raw_message
  from raw_card_frames
  where
    event_code in ('cse', 'card_swipe_requested', 'card_swipe_rejected')
    or query_code = 'card_swipe'
    or target_ref = 'card'
)
insert into device_card_audit_log (
  id,
  tenant_id,
  device_id,
  message_log_id,
  tcp_audit_log_id,
  imei,
  msg_id,
  seq_no,
  msg_type,
  event_type,
  event_code,
  reason_code,
  audit_outcome,
  audit_source,
  swipe_action,
  swipe_event_id,
  target_ref,
  card_token,
  card_token_suffix,
  occurred_at,
  server_rx_ts,
  idempotency_key,
  raw_message,
  payload_json
)
select
  gen_random_uuid(),
  frame.tenant_id,
  frame.device_id,
  null,
  frame.id,
  frame.imei,
  nullif(frame.request_snapshot_json ->> 'm', ''),
  nullif(frame.request_snapshot_json ->> 's', '')::integer,
  coalesce(nullif(frame.msg_type, ''), nullif(frame.request_snapshot_json ->> 't', ''), 'EVENT_REPORT'),
  case
    when frame.normalized_event_code = 'card_swipe_requested' then 'DEVICE_CARD_SWIPE_REQUESTED'
    when frame.normalized_event_code = 'card_swipe_rejected' then 'DEVICE_CARD_SWIPE_REJECTED'
    when frame.normalized_event_code = 'cse' then 'DEVICE_CARD_AUDIT'
    else null
  end,
  frame.normalized_event_code,
  frame.normalized_reason_code,
  nullif(split_part(coalesce(frame.normalized_raw_message, ''), '|', 1), ''),
  nullif(split_part(coalesce(frame.normalized_raw_message, ''), '|', 2), ''),
  nullif(
    lower(
      coalesce(
        frame.request_snapshot_json #>> '{p,swipe_action}',
        frame.request_snapshot_json #>> '{payload,swipe_action}',
        frame.request_snapshot_json #>> '{p,swipeAction}',
        frame.request_snapshot_json #>> '{payload,swipeAction}',
        ''
      )
    ),
    ''
  ),
  coalesce(
    nullif(frame.request_snapshot_json #>> '{p,swipe_event_id}', ''),
    nullif(frame.request_snapshot_json #>> '{payload,swipe_event_id}', ''),
    nullif(frame.request_snapshot_json #>> '{p,swipeEventId}', ''),
    nullif(frame.request_snapshot_json #>> '{payload,swipeEventId}', ''),
    nullif(frame.request_snapshot_json ->> 'm', '')
  ),
  frame.normalized_target_ref,
  coalesce(
    nullif(frame.request_snapshot_json #>> '{p,card_token}', ''),
    nullif(frame.request_snapshot_json #>> '{payload,card_token}', ''),
    nullif(frame.request_snapshot_json #>> '{p,cardToken}', ''),
    nullif(frame.request_snapshot_json #>> '{payload,cardToken}', ''),
    nullif(frame.request_snapshot_json #>> '{p,access_token}', ''),
    nullif(frame.request_snapshot_json #>> '{payload,access_token}', ''),
    nullif(frame.request_snapshot_json #>> '{p,accessToken}', ''),
    nullif(frame.request_snapshot_json #>> '{payload,accessToken}', '')
  ),
  nullif(split_part(coalesce(frame.normalized_raw_message, ''), '|', 3), ''),
  coalesce(nullif(frame.request_snapshot_json ->> 'ts', '')::timestamptz, frame.created_at),
  frame.created_at,
  'tcp_audit:' || frame.id::text,
  frame.normalized_raw_message,
  coalesce(frame.request_snapshot_json, '{}'::jsonb)
from normalized_card_frames frame
on conflict (tenant_id, idempotency_key) do update
set device_id = coalesce(device_card_audit_log.device_id, excluded.device_id),
    tcp_audit_log_id = coalesce(device_card_audit_log.tcp_audit_log_id, excluded.tcp_audit_log_id),
    msg_id = coalesce(device_card_audit_log.msg_id, excluded.msg_id),
    seq_no = coalesce(device_card_audit_log.seq_no, excluded.seq_no),
    msg_type = coalesce(device_card_audit_log.msg_type, excluded.msg_type),
    event_type = coalesce(device_card_audit_log.event_type, excluded.event_type),
    event_code = coalesce(device_card_audit_log.event_code, excluded.event_code),
    reason_code = coalesce(device_card_audit_log.reason_code, excluded.reason_code),
    audit_outcome = coalesce(device_card_audit_log.audit_outcome, excluded.audit_outcome),
    audit_source = coalesce(device_card_audit_log.audit_source, excluded.audit_source),
    swipe_action = coalesce(device_card_audit_log.swipe_action, excluded.swipe_action),
    swipe_event_id = coalesce(device_card_audit_log.swipe_event_id, excluded.swipe_event_id),
    target_ref = coalesce(device_card_audit_log.target_ref, excluded.target_ref),
    card_token = coalesce(device_card_audit_log.card_token, excluded.card_token),
    card_token_suffix = coalesce(device_card_audit_log.card_token_suffix, excluded.card_token_suffix),
    occurred_at = coalesce(device_card_audit_log.occurred_at, excluded.occurred_at),
    server_rx_ts = coalesce(device_card_audit_log.server_rx_ts, excluded.server_rx_ts),
    raw_message = coalesce(device_card_audit_log.raw_message, excluded.raw_message),
    payload_json = coalesce(device_card_audit_log.payload_json, '{}'::jsonb) || excluded.payload_json,
    updated_at = now();
