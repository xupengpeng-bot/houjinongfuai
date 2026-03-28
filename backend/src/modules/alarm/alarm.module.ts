import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

@Controller(['alarms', 'alerts'])
class AlarmController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list() {
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
        coalesce(a.trigger_reason_json->>'message', a.alarm_code) as desc
      from alarm_event a
      left join device d on d.id = a.device_id
      left join region r on r.id = d.region_id
      order by a.created_at desc
    `);
    return ok({ items: result.rows });
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
          coalesce(a.trigger_reason_json->>'message', a.alarm_code) as desc
        from alarm_event a
        left join device d on d.id = a.device_id
        left join region r on r.id = d.region_id
        where a.id = $1
      `,
      [id]
    );

    return ok(result.rows[0] ?? { id });
  }

  @Post(':id/acknowledge')
  async acknowledge(@Param('id') id: string) {
    await this.db.query(
      `
        update alarm_event
        set status = 'processing',
            updated_at = now()
        where id = $1
      `,
      [id]
    );
    return ok({ id, status: 'processing' });
  }

  @Post(':id/resolve')
  async resolve(@Param('id') id: string) {
    await this.db.query(
      `
        update alarm_event
        set status = 'resolved',
            updated_at = now()
        where id = $1
      `,
      [id]
    );
    return ok({ id, status: 'resolved' });
  }

  @Patch(':id')
  async updateStatus(@Param('id') id: string, @Body() body: { status?: 'pending' | 'processing' | 'resolved' }) {
    const requestedStatus = body?.status ?? 'pending';
    const status = requestedStatus === 'pending' ? 'open' : requestedStatus;

    await this.db.query(
      `
        update alarm_event
        set status = $2,
            updated_at = now()
        where id = $1
      `,
      [id, status]
    );

    return this.detail(id);
  }
}

@Module({
  controllers: [AlarmController]
})
export class AlarmModule {}
