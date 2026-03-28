-- Additive bootstrap metadata for existing dispatch MySQL deployments.
-- Apply manually on the dispatch MySQL database; duplicate-column errors mean already applied.

ALTER TABLE dispatch_team_current
  ADD COLUMN source_of_truth VARCHAR(32) NOT NULL DEFAULT 'dispatch_db' COMMENT 'Current lane truth source',
  ADD COLUMN execute_now_md TEXT NULL COMMENT 'Short lane-level execute-now instruction';

ALTER TABLE dispatch_task
  ADD COLUMN task_type VARCHAR(32) NULL COMMENT 'INTEREST | ENGINEERING | LANGUAGE | SYSTEM';
