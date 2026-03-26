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

/** COD-2026-03-27-002: run-monitor cockpit aggregate */
export interface RunMonitorRecentSessionRow {
  session_id: string;
  session_no: string;
  status: string;
  well_id: string;
  project_id: string | null;
  project_name: string | null;
  block_id: string | null;
  block_name: string | null;
  started_at: string | null;
  updated_at: string;
}

export interface RunMonitorDto {
  running_session_count: number;
  running_well_count: number;
  online_device_count: number;
  today_usage_m3: number;
  recent_sessions: RunMonitorRecentSessionRow[];
}

/** COD-2026-03-27-002: alert-center cockpit aggregate */
export interface AlertSeverityCountsDto {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface AlertCenterRecentRow {
  id: string;
  alarm_code: string;
  severity: string;
  status: string;
  device_id: string | null;
  session_id: string | null;
  created_at: string;
}

export interface AlertCenterDto {
  open_count: number;
  processing_count: number;
  closed_count: number;
  severity_counts: AlertSeverityCountsDto;
  recent_alerts: AlertCenterRecentRow[];
}

/** COD-2026-03-27-002: history-replay cockpit aggregate */
export interface HistoryReplaySessionRow {
  session_id: string;
  session_no: string;
  status: string;
  well_id: string;
  project_id: string | null;
  project_name: string | null;
  block_id: string | null;
  block_name: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface HistoryReplayDto {
  time_range: { from: string; to: string };
  filter: { project_id: string | null; block_id: string | null };
  total: number;
  sessions: HistoryReplaySessionRow[];
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

  @Get('run-monitor')
  async runMonitor(): Promise<ReturnType<typeof ok<RunMonitorDto>>> {
    const summary = await this.db.query<{
      running_session_count: number;
      running_well_count: number;
      online_device_count: number;
      today_usage_m3: number;
    }>(
      `
      select
        (
          select count(*)::int
          from runtime_session
          where status in ('pending_start', 'running', 'billing', 'stopping')
        ) as running_session_count,
        (
          select count(distinct well_id)::int
          from runtime_session
          where status in ('pending_start', 'running', 'billing', 'stopping')
        ) as running_well_count,
        (
          select count(*)::int
          from device
          where online_state = 'online'
        ) as online_device_count,
        coalesce((
          select sum(coalesce(io.charge_volume, 0))::numeric
          from irrigation_order io
          where (io.created_at at time zone 'Asia/Shanghai')::date =
            (current_timestamp at time zone 'Asia/Shanghai')::date
        ), 0)::float8 as today_usage_m3
      `
    );

    const recent = await this.db.query<{
      session_id: string;
      session_no: string;
      status: string;
      well_id: string;
      project_id: string | null;
      project_name: string | null;
      block_id: string | null;
      block_name: string | null;
      started_at: Date | null;
      updated_at: Date;
    }>(
      `
      select
        rs.id as session_id,
        rs.session_no,
        rs.status,
        rs.well_id,
        pb.project_id,
        p.project_name,
        w.block_id,
        pb.block_name,
        rs.started_at,
        rs.updated_at
      from runtime_session rs
      join well w on w.id = rs.well_id
      left join project_block pb on pb.id = w.block_id
      left join project p on p.id = pb.project_id
      where rs.status in ('pending_start', 'running', 'billing', 'stopping')
      order by rs.updated_at desc
      limit 20
      `
    );

    const row = summary.rows[0];
    const recent_sessions: RunMonitorRecentSessionRow[] = recent.rows.map((r) => ({
      session_id: r.session_id,
      session_no: r.session_no,
      status: r.status,
      well_id: r.well_id,
      project_id: r.project_id,
      project_name: r.project_name,
      block_id: r.block_id,
      block_name: r.block_name,
      started_at: r.started_at ? r.started_at.toISOString() : null,
      updated_at: r.updated_at.toISOString()
    }));

    return ok({
      running_session_count: row.running_session_count,
      running_well_count: row.running_well_count,
      online_device_count: row.online_device_count,
      today_usage_m3: row.today_usage_m3,
      recent_sessions
    });
  }

  @Get('alert-center')
  async alertCenter(): Promise<ReturnType<typeof ok<AlertCenterDto>>> {
    const agg = await this.db.query<{
      open_count: number;
      processing_count: number;
      closed_count: number;
      low: number;
      medium: number;
      high: number;
      critical: number;
    }>(
      `
      select
        count(*) filter (where status in ('open', 'pending'))::int as open_count,
        count(*) filter (where status = 'processing')::int as processing_count,
        count(*) filter (where status in ('resolved', 'closed'))::int as closed_count,
        count(*) filter (where severity = 'low')::int as low,
        count(*) filter (where severity = 'medium')::int as medium,
        count(*) filter (where severity = 'high')::int as high,
        count(*) filter (where severity = 'critical')::int as critical
      from alarm_event
      `
    );

    const recent = await this.db.query<{
      id: string;
      alarm_code: string;
      severity: string;
      status: string;
      device_id: string | null;
      session_id: string | null;
      created_at: Date;
    }>(
      `
      select id, alarm_code, severity, status, device_id, session_id, created_at
      from alarm_event
      order by created_at desc
      limit 20
      `
    );

    const a = agg.rows[0];
    return ok({
      open_count: a.open_count,
      processing_count: a.processing_count,
      closed_count: a.closed_count,
      severity_counts: {
        low: a.low,
        medium: a.medium,
        high: a.high,
        critical: a.critical
      },
      recent_alerts: recent.rows.map((r) => ({
        id: r.id,
        alarm_code: r.alarm_code,
        severity: r.severity,
        status: r.status,
        device_id: r.device_id,
        session_id: r.session_id,
        created_at: r.created_at.toISOString()
      }))
    });
  }

  @Get('history-replay')
  async historyReplay(
    @Query('project_id') projectId?: string,
    @Query('block_id') blockId?: string,
    @Query('from') fromIso?: string,
    @Query('to') toIso?: string
  ): Promise<ReturnType<typeof ok<HistoryReplayDto>>> {
    let to = toIso?.trim() ? new Date(toIso) : new Date();
    if (Number.isNaN(to.getTime())) {
      to = new Date();
    }
    let from = fromIso?.trim()
      ? new Date(fromIso)
      : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime())) {
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const pid = projectId?.trim() || null;
    const bid = blockId?.trim() || null;
    const params: unknown[] = [from, to];
    let p = 3;
    let projectClause = '';
    let blockClause = '';
    if (pid) {
      projectClause = `and pb.project_id = $${p}::uuid`;
      params.push(pid);
      p++;
    }
    if (bid) {
      blockClause = `and w.block_id = $${p}::uuid`;
      params.push(bid);
      p++;
    }

    const countResult = await this.db.query<{ c: string }>(
      `
      select count(*)::text as c
      from runtime_session rs
      join well w on w.id = rs.well_id
      left join project_block pb on pb.id = w.block_id
      where rs.created_at >= $1 and rs.created_at <= $2
      ${projectClause}
      ${blockClause}
      `,
      params
    );
    const total = Number.parseInt(countResult.rows[0]?.c ?? '0', 10);

    const list = await this.db.query<{
      session_id: string;
      session_no: string;
      status: string;
      well_id: string;
      project_id: string | null;
      project_name: string | null;
      block_id: string | null;
      block_name: string | null;
      started_at: Date | null;
      ended_at: Date | null;
      created_at: Date;
    }>(
      `
      select
        rs.id as session_id,
        rs.session_no,
        rs.status,
        rs.well_id,
        pb.project_id,
        p.project_name,
        w.block_id,
        pb.block_name,
        rs.started_at,
        rs.ended_at,
        rs.created_at
      from runtime_session rs
      join well w on w.id = rs.well_id
      left join project_block pb on pb.id = w.block_id
      left join project p on p.id = pb.project_id
      where rs.created_at >= $1 and rs.created_at <= $2
      ${projectClause}
      ${blockClause}
      order by rs.created_at desc
      limit 100
      `,
      params
    );

    const sessions: HistoryReplaySessionRow[] = list.rows.map((r) => ({
      session_id: r.session_id,
      session_no: r.session_no,
      status: r.status,
      well_id: r.well_id,
      project_id: r.project_id,
      project_name: r.project_name,
      block_id: r.block_id,
      block_name: r.block_name,
      started_at: r.started_at ? r.started_at.toISOString() : null,
      ended_at: r.ended_at ? r.ended_at.toISOString() : null,
      created_at: r.created_at.toISOString()
    }));

    return ok({
      time_range: { from: from.toISOString(), to: to.toISOString() },
      filter: { project_id: pid, block_id: bid },
      total,
      sessions
    });
  }
}

@Module({
  controllers: [CockpitOpsController]
})
export class CockpitModule {}
