-- COD-2026-03-27-032 — additive hot-path columns on MySQL `dispatch_task`.
-- Target: demeter-dev-v2 (or your dispatch schema). Charset/table default utf8mb4.
-- Apply manually against RDS; safe to re-run only if your server supports idempotent ADD — otherwise ignore "Duplicate column" errors.

ALTER TABLE dispatch_task
  ADD COLUMN summary_json JSON NULL COMMENT 'Structured short task state (preferred over payload_md for hot reads)',
  ADD COLUMN artifact_ref VARCHAR(512) NULL COMMENT 'Optional primary artifact path or logical ref';
