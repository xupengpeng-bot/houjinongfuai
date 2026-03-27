import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createPool } from 'mysql2/promise';

/**
 * Read-only access to MySQL `dispatch_*` tables (separate from main Postgres `DATABASE_URL`).
 * Configure via DISPATCH_DB_* env; disabled when DISPATCH_DB_ENABLED is not `true`.
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

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
