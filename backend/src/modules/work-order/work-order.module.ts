import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

interface CreateWorkOrderDto {
  sourceAlarmId?: string;
  sourceSessionId?: string;
  workOrderType: string;
  assigneeUserId?: string;
}

@Controller()
class WorkOrderController {
  constructor(private readonly db: DatabaseService) {}

  @Get('work-orders')
  async list() {
    const result = await this.db.query(`
      select
        wo.id,
        coalesce(wo.result_json->>'title', wo.work_order_no) as title,
        wo.work_order_type as type,
        coalesce(a.alarm_code, '--') as alert,
        coalesce(r.region_name, '--') as area,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as well,
        coalesce(su.display_name, '--') as assignee,
        coalesce(wo.result_json->>'priority', 'medium') as priority,
        wo.status,
        to_char(wo.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as created,
        to_char(coalesce(wo.sla_deadline_at, wo.created_at) at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as deadline
      from work_order wo
      left join alarm_event a on a.id = wo.source_alarm_id
      left join device d on d.id = wo.device_id
      left join runtime_session rs on rs.id = wo.source_session_id
      left join well w on w.id = coalesce(
        rs.well_id,
        (select v.well_id from valve v where v.device_id = d.id limit 1),
        (select p.well_id from pump p where p.device_id = d.id limit 1),
        (select ow.id from well ow where ow.device_id = d.id limit 1)
      )
      left join device wd on wd.id = w.device_id
      left join region r on r.id = coalesce(d.region_id, wd.region_id)
      left join sys_user su on su.id = wo.assignee_user_id
      order by wo.created_at desc
    `);
    return ok({ items: result.rows });
  }

  @Post('work-orders')
  create(@Body() dto: CreateWorkOrderDto) {
    return ok({ created: dto });
  }

  @Get('work-orders/:id')
  detail(@Param('id') id: string) {
    return ok({ id });
  }

  @Post('work-orders/:id/assign')
  assign(@Param('id') id: string) {
    return ok({ id, status: 'assigned' });
  }

  @Post('work-orders/:id/accept')
  accept(@Param('id') id: string) {
    return ok({ id, status: 'accepted' });
  }

  @Post('work-orders/:id/process')
  process(@Param('id') id: string) {
    return ok({ id, status: 'processing' });
  }

  @Get('m/my/todos')
  async todos() {
    const result = await this.db.query(`
      select
        wo.id,
        coalesce(wo.result_json->>'title', wo.work_order_no) as title,
        wo.work_order_type as type,
        coalesce(r.region_name, '--') as area,
        coalesce(su.display_name, '--') as assignee,
        coalesce(wo.result_json->>'priority', 'medium') as priority,
        wo.status,
        to_char(coalesce(wo.sla_deadline_at, wo.created_at) at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as deadline
      from work_order wo
      left join device d on d.id = wo.device_id
      left join region r on r.id = d.region_id
      left join sys_user su on su.id = wo.assignee_user_id
      where wo.status in ('created', 'assigned', 'in_progress')
      order by wo.created_at desc
    `);
    return ok({ items: result.rows });
  }

  @Get('m/my/work-orders')
  async myWorkOrders() {
    const result = await this.db.query(`
      select
        wo.id,
        coalesce(wo.result_json->>'title', wo.work_order_no) as title,
        wo.work_order_type as type,
        coalesce(a.alarm_code, '--') as alert,
        coalesce(r.region_name, '--') as area,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as well,
        coalesce(su.display_name, '--') as assignee,
        coalesce(wo.result_json->>'priority', 'medium') as priority,
        wo.status,
        to_char(wo.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as created,
        to_char(coalesce(wo.sla_deadline_at, wo.created_at) at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as deadline
      from work_order wo
      left join alarm_event a on a.id = wo.source_alarm_id
      left join device d on d.id = wo.device_id
      left join runtime_session rs on rs.id = wo.source_session_id
      left join well w on w.id = coalesce(
        rs.well_id,
        (select v.well_id from valve v where v.device_id = d.id limit 1),
        (select p.well_id from pump p where p.device_id = d.id limit 1),
        (select ow.id from well ow where ow.device_id = d.id limit 1)
      )
      left join device wd on wd.id = w.device_id
      left join region r on r.id = coalesce(d.region_id, wd.region_id)
      left join sys_user su on su.id = wo.assignee_user_id
      order by wo.created_at desc
    `);
    return ok({ items: result.rows });
  }
}

@Module({
  controllers: [WorkOrderController]
})
export class WorkOrderModule {}
