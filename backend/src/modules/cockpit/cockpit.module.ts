import { Controller, Get, Module, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

export interface ProjectOverviewDto {
  project_count: number;
  block_count: number;
  active_well_count: number;
  online_metering_point_count: number;
  running_session_count: number;
  open_alert_count: number;
  open_work_order_count: number;
  /** COD-032: additive aliases for frontend cockpit cards (LVB-4025/4026) */
  well_count: number;
  device_count: number;
  running_wells: number;
  today_usage_m3: number;
  today_revenue_yuan: number;
  pending_alerts: number;
}

export interface BlockCockpitRowDto {
  block_id: string;
  block_code: string;
  block_name: string;
  project_id: string;
  project_name: string;
  status: string;
  running_well_count: number;
  total_well_count: number;
  today_usage_m3: number;
  open_alert_count: number;
}

@Controller('ops')
class CockpitOpsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('project-overview')
  async projectOverview(): Promise<ReturnType<typeof ok<ProjectOverviewDto>>> {
    const result = await this.db.query<ProjectOverviewDto>(`
      select
        (select count(*)::int from project) as project_count,
        (select count(*)::int from project_block) as block_count,
        (
          select count(*)::int
          from well w
          join device d on d.id = w.device_id
          where d.lifecycle_state = 'active'
        ) as active_well_count,
        (
          select count(*)::int
          from metering_point mp
          left join device d on d.id = mp.primary_meter_device_id
          where mp.status in ('active')
            and (mp.primary_meter_device_id is null or d.online_state = 'online')
        ) as online_metering_point_count,
        (
          select count(*)::int
          from runtime_session
          where status in ('pending_start', 'running', 'billing', 'stopping')
        ) as running_session_count,
        (
          select count(*)::int
          from alarm_event
          where status in ('open', 'processing')
        ) as open_alert_count,
        (
          select count(*)::int
          from work_order
          where status in ('created', 'assigned', 'in_progress')
        ) as open_work_order_count,
        (select count(*)::int from well) as well_count,
        (select count(*)::int from device) as device_count,
        (
          select count(distinct well_id)::int
          from runtime_session
          where status in ('pending_start', 'running', 'billing', 'stopping')
        ) as running_wells,
        coalesce((
          select sum(coalesce(io.charge_volume, 0))::numeric
          from irrigation_order io
          where (io.created_at at time zone 'Asia/Shanghai')::date =
            (current_timestamp at time zone 'Asia/Shanghai')::date
        ), 0)::float8 as today_usage_m3,
        coalesce((
          select sum(io.amount)::numeric
          from irrigation_order io
          where (io.created_at at time zone 'Asia/Shanghai')::date =
            (current_timestamp at time zone 'Asia/Shanghai')::date
        ), 0)::float8 as today_revenue_yuan,
        (
          select count(*)::int
          from alarm_event
          where status in ('open', 'processing')
        ) as pending_alerts
    `);
    const row = result.rows[0];
    return ok(row);
  }

  @Get('block-cockpit')
  async blockCockpit(
    @Query('project_id') projectId?: string,
    @Query('q') q?: string
  ): Promise<ReturnType<typeof ok<{ items: BlockCockpitRowDto[]; total: number }>>> {
    const params: unknown[] = [];
    let idx = 1;
    let projectFilter = '';
    const pid = projectId?.trim();
    if (pid) {
      projectFilter = `and pb.project_id = $${idx++}::uuid`;
      params.push(pid);
    }
    const qNorm = q?.trim() ?? '';
    let qFilter = '';
    if (qNorm !== '') {
      qFilter = `and (pb.block_name ilike $${idx} or pb.block_code ilike $${idx})`;
      params.push(`%${qNorm}%`);
    }

    const result = await this.db.query<BlockCockpitRowDto>(
      `
      select
        pb.id as block_id,
        pb.block_code,
        pb.block_name,
        pb.project_id,
        p.project_name,
        pb.status,
        coalesce((
          select count(distinct rs.well_id)::int
          from runtime_session rs
          join well w on w.id = rs.well_id
          where w.block_id = pb.id
            and rs.status in ('pending_start', 'running', 'billing', 'stopping')
        ), 0) as running_well_count,
        coalesce((
          select count(*)::int
          from well w
          where w.block_id = pb.id
        ), 0) as total_well_count,
        coalesce((
          select sum(coalesce(io.charge_volume, 0))::numeric
          from irrigation_order io
          join runtime_session rs on rs.id = io.session_id
          join well w on w.id = rs.well_id
          where w.block_id = pb.id
            and (io.created_at at time zone 'Asia/Shanghai')::date =
                (current_timestamp at time zone 'Asia/Shanghai')::date
        ), 0)::float8 as today_usage_m3,
        coalesce((
          select count(*)::int
          from alarm_event ae
          where ae.status in ('open', 'processing')
            and (
              exists (
                select 1 from well w
                where w.device_id = ae.device_id and w.block_id = pb.id
              )
              or exists (
                select 1
                from pump p
                join well w on w.id = p.well_id
                where p.device_id = ae.device_id and w.block_id = pb.id
              )
              or exists (
                select 1
                from valve v
                join well w on w.id = v.well_id
                where v.device_id = ae.device_id and w.block_id = pb.id
              )
            )
        ), 0) as open_alert_count
      from project_block pb
      join project p on p.id = pb.project_id
      where 1 = 1
      ${projectFilter}
      ${qFilter}
      order by p.project_name asc, pb.block_name asc
      `,
      params
    );

    const items = result.rows;
    return ok({ items, total: items.length });
  }
}

@Module({
  controllers: [CockpitOpsController]
})
export class CockpitModule {}
