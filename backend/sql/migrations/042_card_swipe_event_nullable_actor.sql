-- Allow journaling all device swipe events, including missing/invalid cards before user resolution.

alter table if exists card_swipe_event
  alter column user_id drop not null,
  alter column card_token drop not null;
