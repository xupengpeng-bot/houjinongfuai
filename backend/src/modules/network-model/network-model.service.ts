import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';

export interface NetworkModelVersionRow {
  id: string;
  network_model_id: string;
  block_id: string | null;
  version_no: number;
  is_published: boolean;
  published_at: Date | null;
  source_file_ref: string | null;
  created_at: Date;
}

@Injectable()
export class NetworkModelService {
  constructor(private readonly db: DatabaseService) {}

  async getPublishedVersion(networkModelId: string): Promise<NetworkModelVersionRow | null> {
    const r = await this.db.query<NetworkModelVersionRow>(
      `
      select id, network_model_id, block_id, version_no, is_published, published_at, source_file_ref, created_at
      from network_model_version
      where network_model_id = $1 and is_published = true
      order by published_at desc nulls last, created_at desc
      limit 1
      `,
      [networkModelId]
    );
    return r.rows[0] ?? null;
  }

  /**
   * Marks one version published for the model block; clears only sibling rows in the same block scope.
   */
  async publishVersion(networkModelId: string, versionId: string): Promise<NetworkModelVersionRow> {
    const check = await this.db.query<{ id: string; block_id: string | null }>(
      `select id, block_id::text as block_id from network_model_version where id = $1 and network_model_id = $2`,
      [versionId, networkModelId]
    );
    const targetVersion = check.rows[0];
    if (!targetVersion) {
      throw new NotFoundException('network_model_version not found for this network_model');
    }

    const row = await this.db.withTransaction(async (client) => {
      await client.query(
        `
        update network_model_version
        set is_published = false, published_at = null
        where network_model_id = $1
          and block_id is not distinct from $2::uuid
        `,
        [networkModelId, targetVersion.block_id]
      );
      const r = await client.query<NetworkModelVersionRow>(
        `
        update network_model_version
        set is_published = true, published_at = now()
        where id = $1 and network_model_id = $2
        returning id, network_model_id, block_id, version_no, is_published, published_at, source_file_ref, created_at
        `,
        [versionId, networkModelId]
      );
      return r.rows[0];
    });
    if (!row?.is_published) {
      throw new BadRequestException('publish failed');
    }
    return row;
  }

  async getPublishedVersionById(versionId: string): Promise<NetworkModelVersionRow | null> {
    const r = await this.db.query<NetworkModelVersionRow>(
      `
      select id, network_model_id, block_id, version_no, is_published, published_at, source_file_ref, created_at
      from network_model_version
      where id = $1 and is_published = true
      `,
      [versionId]
    );
    return r.rows[0] ?? null;
  }

  async countGraphElements(versionId: string): Promise<{ nodeCount: number; pipeCount: number }> {
    const nodes = await this.db.query<{ c: string }>(
      `select count(*)::text as c from network_node where version_id = $1`,
      [versionId]
    );
    const pipes = await this.db.query<{ c: string }>(
      `select count(*)::text as c from network_pipe where version_id = $1`,
      [versionId]
    );
    return {
      nodeCount: Number(nodes.rows[0]?.c ?? 0),
      pipeCount: Number(pipes.rows[0]?.c ?? 0)
    };
  }
}
