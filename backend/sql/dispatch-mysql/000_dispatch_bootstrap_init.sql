-- Minimal bootstrap schema for dispatch MySQL.
-- This is the smallest supported baseline for:
--   GET /api/v1/dispatch/team/:team/bootstrap
--   GET /api/v1/dispatch/team/:team/current
--   GET /api/v1/dispatch/task/:taskId/state
--   POST /api/v1/dispatch/task/:taskId/status
--   POST /api/v1/dispatch/task/:taskId/result-summary
--   POST /api/v1/dispatch/task/:taskId/sequencing
--
-- Recommended server charset: utf8mb4.

CREATE TABLE IF NOT EXISTS dispatch_team_current (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'idle',
  active_task_id VARCHAR(64) NULL,
  work_mode VARCHAR(32) NULL,
  source_of_truth VARCHAR(32) NOT NULL DEFAULT 'dispatch_db',
  execute_now_md TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dispatch_team_current_team (team)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatch_task (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id VARCHAR(64) NOT NULL,
  team VARCHAR(64) NOT NULL,
  task_type VARCHAR(32) NULL COMMENT 'INTEREST | ENGINEERING | LANGUAGE | SYSTEM',
  title VARCHAR(255) NULL,
  mode VARCHAR(32) NULL COMMENT 'BACKEND | SYNC | VERIFY | other typed execution mode',
  status VARCHAR(32) NOT NULL DEFAULT 'draft_local_only',
  purpose VARCHAR(500) NULL,
  source_file VARCHAR(255) NULL,
  payload_md MEDIUMTEXT NULL,
  summary_json JSON NULL,
  artifact_ref VARCHAR(512) NULL,
  next_task_id VARCHAR(64) NULL,
  depends_on_task_id VARCHAR(64) NULL,
  queue_order INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dispatch_task_task_id (task_id),
  KEY idx_dispatch_task_team_status (team, status),
  KEY idx_dispatch_task_next (next_task_id),
  KEY idx_dispatch_task_depends (depends_on_task_id),
  KEY idx_dispatch_task_queue (team, queue_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dispatch_artifact (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id VARCHAR(64) NOT NULL,
  artifact_type VARCHAR(64) NOT NULL DEFAULT 'doc_export',
  artifact_path VARCHAR(512) NULL,
  content_md MEDIUMTEXT NULL,
  checksum VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dispatch_artifact_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
