import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';

@Injectable()
export class SessionStatusLogRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(
    input: {
      tenantId: string;
      sessionId: string;
      fromStatus: string | null;
      toStatus: string;
      actionCode: string;
      reasonCode?: string | null;
      reasonText?: string | null;
      source: 'runtime_engine' | 'manual' | 'system';
      actorId?: string | null;
      snapshot?: Record<string, unknown>;
    },
    client: PoolClient
  ) {
    await this.db.query(
      `
      insert into session_status_log (
        id, tenant_id, session_id, from_status, to_status, action_code,
        reason_code, reason_text, source, actor_id, snapshot_json
      ) values (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11::jsonb
      )
      `,
      [
        randomUUID(),
        input.tenantId,
        input.sessionId,
        input.fromStatus,
        input.toStatus,
        input.actionCode,
        input.reasonCode ?? null,
        input.reasonText ?? null,
        input.source,
        input.actorId ?? null,
        JSON.stringify(input.snapshot ?? {})
      ],
      client
    );
  }

  async findBySessionId(sessionId: string, client?: PoolClient) {
    const result = await this.db.query<{
      createdAt: string;
      fromStatus: string | null;
      toStatus: string;
      actionCode: string;
      reasonCode: string | null;
      reasonText: string | null;
      source: string;
      actorId: string | null;
      snapshot: Record<string, unknown>;
    }>(
      `
      select
        created_at as "createdAt",
        from_status as "fromStatus",
        to_status as "toStatus",
        action_code as "actionCode",
        reason_code as "reasonCode",
        reason_text as "reasonText",
        source,
        actor_id as "actorId",
        snapshot_json as snapshot
      from session_status_log
      where session_id = $1
      order by created_at asc, id asc
      `,
      [sessionId],
      client
    );
    return result.rows;
  }
}
