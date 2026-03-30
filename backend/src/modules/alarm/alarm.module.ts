import { randomUUID } from 'crypto';
import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

@Controller(['alarms', 'alerts'])
class AlarmController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
    @Query('status') status?: string,
    @Query('level') level?: string,
    @Query('device_id') deviceId?: string,
    @Query('session_id') sessionId?: string
  ) {
    const currentPage = Number(page ?? 1) > 0 ? Number(page ?? 1) : 1;
    const currentPageSize = Number(pageSize ?? 20) > 0 ? Number(pageSize ?? 20) : 20;
    const offset = (currentPage - 1) * currentPageSize;
    const params: unknown[] = [];
    const filters: string[] = [];

    if (status?.trim()) {
      const normalizedStatus = status.trim() === 'pending' ? 'open' : status.trim();
      params.push(normalizedStatus);
      filters.push(`a.status = $${params.length}`);
    }
    if (level?.trim()) {
      const normalizedSeverity =
        level.trim() === 'error'
          ? ['critical', 'high']
          : level.trim() === 'warning'
            ? ['medium']
            : ['low', 'info'];
      params.push(normalizedSeverity);
      filters.push(`a.severity = any($${params.length}::text[])`);
    }
    if (deviceId?.trim()) {
      params.push(deviceId.trim());
      filters.push(`a.device_id = $${params.length}::uuid`);
    }
    if (sessionId?.trim()) {
      params.push(sessionId.trim());
      filters.push(`a.session_id = $${params.length}::uuid`);
    }

    params.push(currentPageSize, offset);

    const whereClause = filters.length > 0 ? `where ${filters.join(' and ')}` : '';
    const result = await this.db.query(`
      select
        a.id,
        coalesce(d.device_name, a.alarm_code) as device,
        a.device_id as device_id,
        a.alarm_code as type,
        case
          when a.severity in ('critical', 'high') then 'error'
          when a.severity = 'medium' then 'warning'
          else 'info'
        end as level,
        to_char(a.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as time,
        coalesce(r.region_name, '--') as area,
        case when a.status = 'open' then 'pending' else a.status end as status,
        coalesce(a.trigger_reason_json->>'message', a.alarm_code) as desc,
        count(*) over()::int as total_count
      from alarm_event a
      left join device d on d.id = a.device_id
      left join region r on r.id = d.region_id
      ${whereClause}
      order by a.created_at desc
      limit $${params.length - 1} offset $${params.length}
    `, params);
    return ok({
      items: result.rows.map(({ total_count, ...row }) => row),
      total: result.rows[0]?.total_count ?? 0,
      page: currentPage,
      page_size: currentPageSize
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.db.query(
      `
        select
          a.id,
          coalesce(d.device_name, a.alarm_code) as device,
          a.device_id as device_id,
          a.alarm_code as type,
          case
            when a.severity in ('critical', 'high') then 'error'
            when a.severity = 'medium' then 'warning'
            else 'info'
          end as level,
          to_char(a.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as time,
          coalesce(r.region_name, '--') as area,
          case when a.status = 'open' then 'pending' else a.status end as status,
          coalesce(a.trigger_reason_json->>'message', a.alarm_code) as desc,
          a.source_type,
          a.source_id,
          a.session_id,
          rs.session_no,
          a.auto_create_work_order,
          wo.id as work_order_id,
          wo.work_order_no,
          wo.status as work_order_status,
          coalesce(wo.result_json->>'title', wo.work_order_type) as work_order_title
        from alarm_event a
        left join device d on d.id = a.device_id
        left join region r on r.id = d.region_id
        left join runtime_session rs on rs.id = a.session_id
        left join work_order wo on wo.source_alarm_id = a.id
        where a.id = $1
      `,
      [id]
    );

    return ok(result.rows[0] ?? { id });
  }

  @Post(':id/acknowledge')
  async acknowledge(@Param('id') id: string) {
    await this.transition(id, 'processing', 'acknowledge');
    return ok({ id, status: 'processing' });
  }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string) {
    await this.transition(id, 'resolved', 'resolve');
    return ok({ id, status: 'resolved' });
  }

  @Patch(':id')
  async updateStatus(@Param('id') id: string, @Body() body: { status?: 'pending' | 'processing' | 'resolved' }) {
    const requestedStatus = body?.status ?? 'pending';
    const status = requestedStatus === 'pending' ? 'open' : requestedStatus;

    await this.transition(id, status, 'patch_status');

    return this.detail(id);
  }

  private async transition(id: string, nextStatus: string, actionCode: string) {
    const before = await this.db.query<{
      id: string;
      tenant_id: string;
      status: string;
      session_id: string | null;
      device_id: string | null;
    }>(
      `
      select id, tenant_id, status, session_id, device_id
      from alarm_event
      where id = $1
      limit 1
      `,
      [id]
    );

    const current = before.rows[0];
    if (!current) return;

    await this.db.query(
      `
      update alarm_event
      set status = $2,
          updated_at = now()
      where id = $1
      `,
      [id, nextStatus]
    );

    await this.db.query(
      `
      insert into audit_log (
        id, tenant_id, actor_user_id, module_code, resource_type, resource_id,
        action_code, before_json, after_json
      ) values (
        $1, $2, null, 'alarm', 'alarm_event', $3::uuid,
        $4, $5::jsonb, $6::jsonb
      )
      `,
      [
        randomUUID(),
        current.tenant_id,
        id,
        actionCode,
        JSON.stringify({
          status: current.status,
          session_id: current.session_id,
          device_id: current.device_id
        }),
        JSON.stringify({
          status: nextStatus,
          session_id: current.session_id,
          device_id: current.device_id
        })
      ]
    );
  }
}

@Module({
  controllers: [AlarmController]
})
export class AlarmModule {}
