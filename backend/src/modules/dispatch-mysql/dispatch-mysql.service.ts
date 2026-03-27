import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingHttpHeaders } from 'http';
import type { ResultSetHeader } from 'mysql2';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createPool } from 'mysql2/promise';
import { DISPATCH_TASK_STATUS_WHITELIST } from './dispatch-mysql.dto';
import { buildDispatchTaskReadModel, type DispatchTaskReadModel } from './dispatch-task-read-model';

/**
 * MySQL `dispatch_*` access (separate from main Postgres `DATABASE_URL`).
 * Reads always allowed when pool is configured; writes require `DISPATCH_DB_WRITE_ENABLED=true`.
 */
@Injectable()
export class DispatchMysqlService implements OnModuleDestroy {
  private readonly pool: Pool | null;

  constructor(private readonly config: ConfigService) {
    const enabled = this.config.get<string>('DISPATCH_DB_ENABLED') === 'true';
    const host = this.config.get<string>('DISPATCH_DB_HOST')?.trim();
    if (!enabled || !host) {
      this.pool = null;
      return;
    }
    const password = this.config.get<string>('DISPATCH_DB_PASSWORD') ?? '';
    const user = this.config.get<string>('DISPATCH_DB_USER') ?? '';
    const database = this.config.get<string>('DISPATCH_DB_NAME') ?? '';
    const port = Number(this.config.get<string>('DISPATCH_DB_PORT') ?? '3306');
    this.pool = createPool({
      host,
      port,
      user,
      password,
      database,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 4,
      enableKeepAlive: true
    });
  }

  isConfigured(): boolean {
    return this.pool !== null;
  }

  /** Writes to dispatch MySQL (status / summary). */
  isWriteEnabled(): boolean {
    return (
      this.pool !== null && this.config.get<string>('DISPATCH_DB_WRITE_ENABLED') === 'true'
    );
  }

  assertWriteHeaders(headers: IncomingHttpHeaders): void {
    if (!this.isWriteEnabled()) {
      throw new ForbiddenException(
        'Dispatch DB writes are disabled (set DISPATCH_DB_WRITE_ENABLED=true and DISPATCH_DB_*)'
      );
    }
    const expected = this.config.get<string>('DISPATCH_WRITE_KEY')?.trim();
    if (!expected) return;
    const raw = headers['x-dispatch-write-key'];
    const got = Array.isArray(raw) ? raw[0] : raw;
    if (got !== expected) {
      throw new ForbiddenException('Invalid or missing X-Dispatch-Write-Key');
    }
  }

  private ensurePool(): Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'Dispatch MySQL is not configured (set DISPATCH_DB_ENABLED=true and DISPATCH_DB_HOST, etc.)'
      );
    }
    return this.pool;
  }

  async getTeamCurrent(team: string): Promise<RowDataPacket | null> {
    const pool = this.ensurePool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM dispatch_team_current WHERE team = ? LIMIT 1',
      [team]
    );
    return rows[0] ?? null;
  }

  async getTask(taskId: string): Promise<RowDataPacket | null> {
    const pool = this.ensurePool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM dispatch_task WHERE task_id = ? LIMIT 1',
      [taskId]
    );
    return rows[0] ?? null;
  }

  /**
   * Hot-path read model: prefers `summary_json` + scalars; includes `payload_md_legacy` only when no summary.
   */
  async getTaskReadModel(taskId: string): Promise<DispatchTaskReadModel | null> {
    const row = await this.getTask(taskId);
    if (!row) return null;
    return buildDispatchTaskReadModel(row);
  }

  async updateTaskStatus(
    taskId: string,
    status: string,
    syncTeam: boolean
  ): Promise<{ task: RowDataPacket; team: RowDataPacket | null }> {
    const pool = this.ensurePool();
    if (!DISPATCH_TASK_STATUS_WHITELIST.has(status)) {
      throw new BadRequestException(
        `invalid status (allowed: ${[...DISPATCH_TASK_STATUS_WHITELIST].join(', ')})`
      );
    }
    const existing = await this.getTask(taskId);
    if (!existing) throw new NotFoundException(`dispatch_task not found: ${taskId}`);

    const [upd] = await pool.query<ResultSetHeader>(
      'UPDATE dispatch_task SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?',
      [status, taskId]
    );
    if (upd.affectedRows === 0) {
      throw new NotFoundException(`dispatch_task not found: ${taskId}`);
    }

    const task = (await this.getTask(taskId))!;
    let teamRow: RowDataPacket | null = null;

    if (syncTeam) {
      const team = String(task.team);
      const cur = await this.getTeamCurrent(team);
      const active = cur?.active_task_id != null ? String(cur.active_task_id) : null;
      if (active === taskId) {
        if (status === 'closed') {
          await pool.query(
            `UPDATE dispatch_team_current
             SET active_task_id = NULL, status = 'idle', work_mode = 'IDLE', updated_at = CURRENT_TIMESTAMP
             WHERE team = ?`,
            [team]
          );
        } else if (status === 'waiting_verify') {
          await pool.query(
            `UPDATE dispatch_team_current
             SET status = 'waiting_verify', work_mode = 'VERIFY', updated_at = CURRENT_TIMESTAMP
             WHERE team = ?`,
            [team]
          );
        }
        teamRow = await this.getTeamCurrent(team);
      }
    }

    return { task, team: teamRow };
  }

  async updateTaskResultSummary(
    taskId: string,
    summary: Record<string, unknown>,
    artifactRef?: string
  ): Promise<DispatchTaskReadModel> {
    const pool = this.ensurePool();
    const existing = await this.getTask(taskId);
    if (!existing) throw new NotFoundException(`dispatch_task not found: ${taskId}`);

    const json = JSON.stringify(summary);
    try {
      if (artifactRef !== undefined && artifactRef !== '') {
        await pool.query(
          `UPDATE dispatch_task
           SET summary_json = CAST(? AS JSON), artifact_ref = ?, updated_at = CURRENT_TIMESTAMP
           WHERE task_id = ?`,
          [json, artifactRef, taskId]
        );
      } else {
        await pool.query(
          `UPDATE dispatch_task SET summary_json = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP WHERE task_id = ?`,
          [json, taskId]
        );
      }
    } catch (e: unknown) {
      const err = e as { errno?: number };
      if (err.errno === 1054) {
        throw new ServiceUnavailableException(
          'summary_json column missing — apply backend/sql/dispatch-mysql/001_dispatch_task_hotpath.sql'
        );
      }
      throw e;
    }

    const row = await this.getTask(taskId);
    if (!row) throw new NotFoundException(`dispatch_task not found: ${taskId}`);
    return buildDispatchTaskReadModel(row);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
