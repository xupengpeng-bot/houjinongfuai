import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { ok } from '../http/api-response';
import { ArchiveService } from './archive.service';

type ArchiveLogRow = {
  id: string;
  archive_table: string;
  archive_record_id: string;
  origin_table: string;
  origin_id: string;
  origin_code: string | null;
  entity_name: string | null;
  trigger_type: string;
  archive_reason: string;
  reason_text: string | null;
  source_module: string;
  source_action: string;
  ui_entry: string | null;
  batch_id: string | null;
  operator_name: string | null;
  created_at: Date;
  snapshot_json: Record<string, unknown>;
};

@Controller('archive')
class ArchiveController {
  constructor(private readonly archiveService: ArchiveService) {}

  @Get('operations')
  async listOperations(
    @Query('page') pageRaw?: string,
    @Query('page_size') pageSizeRaw?: string,
    @Query('origin_table') originTable?: string,
    @Query('origin_id') originId?: string,
    @Query('origin_code') originCode?: string,
    @Query('archive_reason') archiveReason?: string,
    @Query('trigger_type') triggerType?: string,
    @Query('batch_id') batchId?: string,
    @Query('source_module') sourceModule?: string,
  ) {
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSizeRaw ?? '20', 10) || 20));
    const offset = (page - 1) * pageSize;

    const conds: string[] = [];
    const args: unknown[] = [];
    let index = 1;

    if (originTable?.trim()) {
      conds.push(`origin_table = $${index++}`);
      args.push(originTable.trim());
    }
    if (originId?.trim()) {
      conds.push(`origin_id::text = $${index++}`);
      args.push(originId.trim());
    }
    if (originCode?.trim()) {
      conds.push(`coalesce(origin_code, '') ilike $${index++}`);
      args.push(`%${originCode.trim()}%`);
    }
    if (archiveReason?.trim()) {
      conds.push(`archive_reason = $${index++}`);
      args.push(archiveReason.trim());
    }
    if (triggerType?.trim()) {
      conds.push(`trigger_type = $${index++}`);
      args.push(triggerType.trim());
    }
    if (batchId?.trim()) {
      conds.push(`coalesce(batch_id, '') ilike $${index++}`);
      args.push(`%${batchId.trim()}%`);
    }
    if (sourceModule?.trim()) {
      conds.push(`coalesce(source_module, '') ilike $${index++}`);
      args.push(`%${sourceModule.trim()}%`);
    }

    const where = conds.length > 0 ? `where ${conds.join(' and ')}` : '';
    const totalSql = `select count(*)::int as total from archive_operation_log ${where}`;
    const totalResult = await this.archiveService.query<{ total: number }>(totalSql, args);

    const listSql = `
      select
        id,
        archive_table,
        archive_record_id::text as archive_record_id,
        origin_table,
        origin_id::text as origin_id,
        origin_code,
        entity_name,
        trigger_type,
        archive_reason,
        reason_text,
        source_module,
        source_action,
        ui_entry,
        batch_id,
        operator_name,
        created_at,
        snapshot_json
      from archive_operation_log
      ${where}
      order by created_at desc
      limit $${index} offset $${index + 1}
    `;
    const listResult = await this.archiveService.query<ArchiveLogRow>(listSql, [...args, pageSize, offset]);

    return ok({
      items: listResult.rows.map((row) => ({
        ...row,
        created_at: row.created_at.toISOString(),
      })),
      total: totalResult.rows[0]?.total ?? 0,
      page,
      page_size: pageSize,
    });
  }
}

@Global()
@Module({
  controllers: [ArchiveController],
  providers: [ArchiveService],
  exports: [ArchiveService],
})
export class ArchiveModule {}
