import type { RowDataPacket } from 'mysql2';

/**
 * Slim API shape: prefer `summary` + scalar fields; expose long markdown only as legacy fallback.
 */
export interface DispatchTaskReadModel {
  task_id: string;
  team: string;
  title: string | null;
  mode: string | null;
  status: string;
  purpose: string | null;
  source_file: string | null;
  artifact_ref: string | null;
  summary: Record<string, unknown> | null;
  updated_at: unknown;
  created_at: unknown;
  /** Full markdown body — only when `summary_json` is absent (legacy path). */
  payload_md_legacy?: string;
}

export function parseSummaryJson(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw) as unknown;
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function buildDispatchTaskReadModel(row: RowDataPacket): DispatchTaskReadModel {
  const summary = parseSummaryJson(row.summary_json);
  const base: DispatchTaskReadModel = {
    task_id: String(row.task_id),
    team: String(row.team),
    title: row.title != null ? String(row.title) : null,
    mode: row.mode != null ? String(row.mode) : null,
    status: String(row.status),
    purpose: row.purpose != null ? String(row.purpose) : null,
    source_file: row.source_file != null ? String(row.source_file) : null,
    artifact_ref: row.artifact_ref != null ? String(row.artifact_ref) : null,
    summary,
    updated_at: row.updated_at,
    created_at: row.created_at
  };
  if (summary == null && row.payload_md != null && String(row.payload_md).length > 0) {
    base.payload_md_legacy = String(row.payload_md);
  }
  return base;
}
