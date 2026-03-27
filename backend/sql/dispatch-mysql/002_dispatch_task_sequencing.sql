-- COD-2026-03-27-034 — additive sequencing columns on MySQL `dispatch_task`.
-- Apply manually on dispatch RDS; duplicate column errors mean already applied.

ALTER TABLE dispatch_task
  ADD COLUMN next_task_id VARCHAR(64) NULL COMMENT 'Explicit next task id in chain (nullable)',
  ADD COLUMN depends_on_task_id VARCHAR(64) NULL COMMENT 'Prerequisite task must be closed before next can activate',
  ADD COLUMN queue_order INT NULL COMMENT 'Optional ordering hint within a wave';

CREATE INDEX idx_dispatch_task_next ON dispatch_task (next_task_id);
CREATE INDEX idx_dispatch_task_depends ON dispatch_task (depends_on_task_id);
