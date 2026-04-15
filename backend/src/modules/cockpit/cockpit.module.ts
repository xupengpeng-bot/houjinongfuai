import { Body, Controller, Get, Module, Put, Query } from '@nestjs/common';
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
  device_name: string;
  project_name: string | null;
  block_name: string | null;
  description: string;
  work_order_id: string | null;
  work_order_status: string | null;
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

/** COD-2026-03-27-013: auto-scheduling cockpit aggregate */
export interface AutoSchedulingRecentDispatchRow {
  dispatch_id: string;
  session_id: string;
  session_no: string | null;
  command_code: string;
  dispatch_status: string;
  target_device_name: string | null;
  created_at: string;
}

export interface AutoSchedulingInsightRow {
  kind: 'session_note' | 'alarm';
  id: string;
  summary: string;
  severity: string | null;
  created_at: string;
}

export interface AutoSchedulingDto {
  /** command_dispatch rows whose created_at falls on Asia/Shanghai local today */
  today_dispatch_count: number;
  today_success_count: number;
  today_failed_count: number;
  today_pending_count: number;
  recent_dispatches: AutoSchedulingRecentDispatchRow[];
  /** 最近解释 / 风险提示壳：会话备注 + 未关闭告警摘要 */
  recent_insights: AutoSchedulingInsightRow[];
}

export interface SchedulingParamsDto {
  auto_dispatch_enabled: boolean;
  dispatch_window_start: string;
  dispatch_window_end: string;
  max_parallel_sessions: number;
  alert_auto_pause_enabled: boolean;
  high_severity_pause_threshold: number;
  dispatch_retry_limit: number;
  updated_at: string | null;
}

export interface AlertRulesDto {
  auto_create_work_order: boolean;
  default_work_order_priority: string;
  notify_operator_enabled: boolean;
  notify_manager_enabled: boolean;
  high_pressure_enabled: boolean;
  comm_loss_enabled: boolean;
  updated_at: string | null;
}

/** COD-2026-03-27-013: cost & finance cockpit aggregate */
export interface CostFinanceProjectBlockRow {
  project_id: string;
  project_name: string;
  block_id: string;
  block_code: string;
  block_name: string;
  period_usage_m3: number;
  period_cost_yuan: number;
  /** Phase 1 placeholder until metering energy is persisted on orders */
  period_energy_kwh: number;
}

export interface CostFinanceDto {
  period: {
    kind: 'calendar_month';
    timezone: string;
    month_start: string;
    month_end: string;
  };
  today_water_m3: number;
  today_energy_kwh: number;
  today_cost_yuan: number;
  period_water_m3: number;
  period_energy_kwh: number;
  period_cost_yuan: number;
  project_block_costs: CostFinanceProjectBlockRow[];
}

@Controller('ops')
class CockpitOpsController {
  constructor(private readonly db: DatabaseService) {}

  private readonly demoTenantId = '00000000-0000-0000-0000-000000000001';

  private normalizeSchedulingParams(promptJson: unknown, updatedAt: Date | string | null): SchedulingParamsDto {
    const prompt = promptJson && typeof promptJson === 'object' ? (promptJson as Record<string, unknown>) : {};
    const runtimeDefaults =
      prompt.runtimeDefaults && typeof prompt.runtimeDefaults === 'object'
        ? (prompt.runtimeDefaults as Record<string, unknown>)
        : {};
    const alertRules =
      prompt.alertRules && typeof prompt.alertRules === 'object'
        ? (prompt.alertRules as Record<string, unknown>)
        : {};

    const toBoolean = (value: unknown, fallback: boolean) =>
      typeof value === 'boolean' ? value : fallback;
    const toNumber = (value: unknown, fallback: number) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };
    const toTime = (value: unknown, fallback: string) =>
      typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;

    return {
      auto_dispatch_enabled: toBoolean(prompt.autoDispatchEnabled, true),
      dispatch_window_start: toTime(prompt.dispatchWindowStart, '05:00'),
      dispatch_window_end: toTime(prompt.dispatchWindowEnd, '21:00'),
      max_parallel_sessions: toNumber(runtimeDefaults.concurrencyLimit, 4),
      alert_auto_pause_enabled: toBoolean(alertRules.autoPauseEnabled, true),
      high_severity_pause_threshold: toNumber(alertRules.highSeverityPauseThreshold, 2),
      dispatch_retry_limit: toNumber(prompt.dispatchRetryLimit, 2),
      updated_at:
        updatedAt instanceof Date
          ? updatedAt.toISOString()
          : typeof updatedAt === 'string'
            ? new Date(updatedAt).toISOString()
            : null
    };
  }

  private normalizeAlertRules(promptJson: unknown, updatedAt: Date | string | null): AlertRulesDto {
    const prompt = promptJson && typeof promptJson === 'object' ? (promptJson as Record<string, unknown>) : {};
    const notifyRules =
      prompt.notifyRules && typeof prompt.notifyRules === 'object'
        ? (prompt.notifyRules as Record<string, unknown>)
        : {};
    const alarmTypes =
      prompt.alarmTypes && typeof prompt.alarmTypes === 'object'
        ? (prompt.alarmTypes as Record<string, unknown>)
        : {};

    const toBoolean = (value: unknown, fallback: boolean) =>
      typeof value === 'boolean' ? value : fallback;

    return {
      auto_create_work_order: toBoolean(prompt.autoCreateWorkOrder, true),
      default_work_order_priority:
        typeof prompt.defaultWorkOrderPriority === 'string' && prompt.defaultWorkOrderPriority.trim() !== ''
          ? prompt.defaultWorkOrderPriority
          : 'high',
      notify_operator_enabled: toBoolean(notifyRules.operatorEnabled, true),
      notify_manager_enabled: toBoolean(notifyRules.managerEnabled, true),
      high_pressure_enabled: toBoolean(alarmTypes.highPressureEnabled, true),
      comm_loss_enabled: toBoolean(alarmTypes.commLossEnabled, true),
      updated_at:
        updatedAt instanceof Date
          ? updatedAt.toISOString()
          : typeof updatedAt === 'string'
            ? new Date(updatedAt).toISOString()
            : null
    };
  }

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
          where status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
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
          where status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
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
            and rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
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
          where status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
        ) as running_session_count,
        (
          select count(distinct well_id)::int
          from runtime_session
          where status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
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
      where rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
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
      device_name: string | null;
      project_name: string | null;
      block_name: string | null;
      description: string | null;
      work_order_id: string | null;
      work_order_status: string | null;
    }>(
      `
      select
        ae.id,
        ae.alarm_code,
        ae.severity,
        ae.status,
        ae.device_id,
        ae.session_id,
        ae.created_at,
        coalesce(d.device_name, ae.alarm_code) as device_name,
        p.project_name,
        pb.block_name,
        coalesce(ae.trigger_reason_json->>'message', ae.alarm_code) as description,
        wo.id as work_order_id,
        wo.status as work_order_status
      from alarm_event ae
      left join device d on d.id = ae.device_id
      left join runtime_session rs on rs.id = ae.session_id
      left join well w on w.id = coalesce(
        rs.well_id,
        (select v.well_id from valve v where v.device_id = ae.device_id limit 1),
        (select pump.well_id from pump where pump.device_id = ae.device_id limit 1),
        (select own_well.id from well own_well where own_well.device_id = ae.device_id limit 1)
      )
      left join project_block pb on pb.id = w.block_id
      left join project p on p.id = pb.project_id
      left join lateral (
        select id, status
        from work_order
        where source_alarm_id = ae.id
        order by created_at desc
        limit 1
      ) wo on true
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
        created_at: r.created_at.toISOString(),
        device_name: r.device_name ?? r.alarm_code,
        project_name: r.project_name,
        block_name: r.block_name,
        description: r.description ?? r.alarm_code,
        work_order_id: r.work_order_id,
        work_order_status: r.work_order_status
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

  /** COD-2026-03-27-013: device command dispatch as scheduling proxy */
  @Get('auto-scheduling')
  async autoScheduling(): Promise<ReturnType<typeof ok<AutoSchedulingDto>>> {
    const tz = 'Asia/Shanghai';
    const counts = await this.db.query<{
      today_dispatch_count: number;
      today_success_count: number;
      today_failed_count: number;
      today_pending_count: number;
    }>(
      `
      select
        count(*)::int as today_dispatch_count,
        count(*) filter (
          where cd.dispatch_status in ('success', 'acked')
        )::int as today_success_count,
        count(*) filter (
          where cd.dispatch_status in ('timeout', 'failed', 'error', 'rejected', 'nack')
        )::int as today_failed_count,
        count(*) filter (
          where cd.dispatch_status not in (
            'success', 'acked', 'timeout', 'failed', 'error', 'rejected', 'nack'
          )
        )::int as today_pending_count
      from command_dispatch cd
      where (cd.created_at at time zone '${tz}')::date =
        (current_timestamp at time zone '${tz}')::date
      `
    );

    const recent = await this.db.query<{
      dispatch_id: string;
      session_id: string;
      session_no: string | null;
      command_code: string;
      dispatch_status: string;
      target_device_name: string | null;
      created_at: Date;
    }>(
      `
      select
        cd.id as dispatch_id,
        cd.session_id,
        rs.session_no,
        cd.command_code,
        cd.dispatch_status,
        coalesce(d.device_name, d.device_code) as target_device_name,
        cd.created_at
      from command_dispatch cd
      left join runtime_session rs on rs.id = cd.session_id
      join device d on d.id = cd.target_device_id
      order by cd.created_at desc
      limit 20
      `
    );

    const notes = await this.db.query<{
      id: string;
      summary: string;
      created_at: Date;
    }>(
      `
      select id, coalesce(reason_text, action_code) as summary, created_at
      from session_status_log
      where reason_text is not null and trim(reason_text) <> ''
      order by created_at desc
      limit 5
      `
    );

    const alarms = await this.db.query<{
      id: string;
      summary: string;
      severity: string;
      created_at: Date;
    }>(
      `
      select
        id,
        coalesce(trigger_reason_json->>'message', alarm_code) as summary,
        severity,
        created_at
      from alarm_event
      where status in ('open', 'processing', 'pending')
      order by created_at desc
      limit 5
      `
    );

    const insights: AutoSchedulingInsightRow[] = [
      ...notes.rows.map((r) => ({
        kind: 'session_note' as const,
        id: r.id,
        summary: r.summary,
        severity: null,
        created_at: r.created_at.toISOString()
      })),
      ...alarms.rows.map((r) => ({
        kind: 'alarm' as const,
        id: r.id,
        summary: r.summary,
        severity: r.severity,
        created_at: r.created_at.toISOString()
      }))
    ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const c = counts.rows[0];
    return ok({
      today_dispatch_count: c.today_dispatch_count,
      today_success_count: c.today_success_count,
      today_failed_count: c.today_failed_count,
      today_pending_count: c.today_pending_count,
      recent_dispatches: recent.rows.map((r) => ({
        dispatch_id: r.dispatch_id,
        session_id: r.session_id,
        session_no: r.session_no,
        command_code: r.command_code,
        dispatch_status: r.dispatch_status,
        target_device_name: r.target_device_name,
        created_at: r.created_at.toISOString()
      })),
      recent_insights: insights.slice(0, 10)
    });
  }

  @Get('scheduling-params')
  async schedulingParams(): Promise<ReturnType<typeof ok<SchedulingParamsDto>>> {
    const result = await this.db.query<{
      prompt_json: unknown;
      updated_at: Date | string | null;
    }>(
      `
      select prompt_json, updated_at
      from interaction_policy
      where tenant_id = $1
        and target_type = 'system'
        and scene_code = 'auto_scheduling'
      order by updated_at desc
      limit 1
      `,
      [this.demoTenantId]
    );

    const row = result.rows[0];
    return ok(this.normalizeSchedulingParams(row?.prompt_json ?? {}, row?.updated_at ?? null));
  }

  @Put('scheduling-params')
  async updateSchedulingParams(
    @Body() payload: SchedulingParamsDto
  ): Promise<ReturnType<typeof ok<SchedulingParamsDto>>> {
    const promptJson = {
      autoDispatchEnabled: payload.auto_dispatch_enabled,
      dispatchWindowStart: payload.dispatch_window_start,
      dispatchWindowEnd: payload.dispatch_window_end,
      dispatchRetryLimit: payload.dispatch_retry_limit,
      runtimeDefaults: {
        concurrencyLimit: payload.max_parallel_sessions
      },
      alertRules: {
        autoPauseEnabled: payload.alert_auto_pause_enabled,
        highSeverityPauseThreshold: payload.high_severity_pause_threshold
      }
    };

    const existing = await this.db.query<{ id: string }>(
      `
      select id
      from interaction_policy
      where tenant_id = $1
        and target_type = 'system'
        and scene_code = 'auto_scheduling'
      order by updated_at desc
      limit 1
      `,
      [this.demoTenantId]
    );

    if (existing.rows[0]) {
      await this.db.query(
        `
        update interaction_policy
        set confirm_mode = 'single_confirm',
            prompt_json = $2::jsonb,
            status = 'active',
            updated_at = now()
        where id = $1::uuid
        `,
        [existing.rows[0].id, JSON.stringify(promptJson)]
      );
    } else {
      await this.db.query(
        `
        insert into interaction_policy (
          tenant_id, target_type, scene_code, confirm_mode, prompt_json, status, created_at, updated_at
        )
        values ($1, 'system', 'auto_scheduling', 'single_confirm', $2::jsonb, 'active', now(), now())
        `,
        [this.demoTenantId, JSON.stringify(promptJson)]
      );
    }

    const latest = await this.db.query<{
      prompt_json: unknown;
      updated_at: Date | string | null;
    }>(
      `
      select prompt_json, updated_at
      from interaction_policy
      where tenant_id = $1
        and target_type = 'system'
        and scene_code = 'auto_scheduling'
      order by updated_at desc
      limit 1
      `,
      [this.demoTenantId]
    );

    const row = latest.rows[0];
    return ok(this.normalizeSchedulingParams(row?.prompt_json ?? {}, row?.updated_at ?? null));
  }

  @Get('alert-rules')
  async alertRules(): Promise<ReturnType<typeof ok<AlertRulesDto>>> {
    const result = await this.db.query<{
      prompt_json: unknown;
      updated_at: Date | string | null;
    }>(
      `
      select prompt_json, updated_at
      from interaction_policy
      where tenant_id = $1
        and target_type = 'system'
        and scene_code = 'alert_rules'
      order by updated_at desc
      limit 1
      `,
      [this.demoTenantId]
    );

    const row = result.rows[0];
    return ok(this.normalizeAlertRules(row?.prompt_json ?? {}, row?.updated_at ?? null));
  }

  @Put('alert-rules')
  async updateAlertRules(@Body() payload: AlertRulesDto): Promise<ReturnType<typeof ok<AlertRulesDto>>> {
    const promptJson = {
      autoCreateWorkOrder: payload.auto_create_work_order,
      defaultWorkOrderPriority: payload.default_work_order_priority,
      notifyRules: {
        operatorEnabled: payload.notify_operator_enabled,
        managerEnabled: payload.notify_manager_enabled
      },
      alarmTypes: {
        highPressureEnabled: payload.high_pressure_enabled,
        commLossEnabled: payload.comm_loss_enabled
      }
    };

    const existing = await this.db.query<{ id: string }>(
      `
      select id
      from interaction_policy
      where tenant_id = $1
        and target_type = 'system'
        and scene_code = 'alert_rules'
      order by updated_at desc
      limit 1
      `,
      [this.demoTenantId]
    );

    if (existing.rows[0]) {
      await this.db.query(
        `
        update interaction_policy
        set confirm_mode = 'single_confirm',
            prompt_json = $2::jsonb,
            status = 'active',
            updated_at = now()
        where id = $1::uuid
        `,
        [existing.rows[0].id, JSON.stringify(promptJson)]
      );
    } else {
      await this.db.query(
        `
        insert into interaction_policy (
          tenant_id, target_type, scene_code, confirm_mode, prompt_json, status, created_at, updated_at
        )
        values ($1, 'system', 'alert_rules', 'single_confirm', $2::jsonb, 'active', now(), now())
        `,
        [this.demoTenantId, JSON.stringify(promptJson)]
      );
    }

    const latest = await this.db.query<{
      prompt_json: unknown;
      updated_at: Date | string | null;
    }>(
      `
      select prompt_json, updated_at
      from interaction_policy
      where tenant_id = $1
        and target_type = 'system'
        and scene_code = 'alert_rules'
      order by updated_at desc
      limit 1
      `,
      [this.demoTenantId]
    );

    const row = latest.rows[0];
    return ok(this.normalizeAlertRules(row?.prompt_json ?? {}, row?.updated_at ?? null));
  }

  /** COD-2026-03-27-013: billing usage + block cost shell */
  @Get('cost-finance')
  async costFinance(): Promise<ReturnType<typeof ok<CostFinanceDto>>> {
    const tz = 'Asia/Shanghai';
    const col = await this.db.query<{ has_block: boolean }>(
      `
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'well'
          and column_name = 'block_id'
      ) as has_block
      `
    );
    const wellHasBlockId = col.rows[0]?.has_block === true;

    const summary = await this.db.query<{
      today_water_m3: number;
      today_cost_yuan: number;
      period_water_m3: number;
      period_cost_yuan: number;
    }>(
      `
      select
        coalesce(sum(
          case
            when (io.created_at at time zone '${tz}')::date =
              (current_timestamp at time zone '${tz}')::date
            then coalesce(io.charge_volume, 0)
            else 0
          end
        ), 0)::float8 as today_water_m3,
        coalesce(sum(
          case
            when (io.created_at at time zone '${tz}')::date =
              (current_timestamp at time zone '${tz}')::date
            then coalesce(io.amount, 0)
            else 0
          end
        ), 0)::float8 as today_cost_yuan,
        coalesce(sum(
          case
            when date_trunc(
              'month',
              io.created_at at time zone '${tz}'
            ) = date_trunc('month', current_timestamp at time zone '${tz}')
            then coalesce(io.charge_volume, 0)
            else 0
          end
        ), 0)::float8 as period_water_m3,
        coalesce(sum(
          case
            when date_trunc(
              'month',
              io.created_at at time zone '${tz}'
            ) = date_trunc('month', current_timestamp at time zone '${tz}')
            then coalesce(io.amount, 0)
            else 0
          end
        ), 0)::float8 as period_cost_yuan
      from irrigation_order io
      `
    );

    const blocks = wellHasBlockId
      ? await this.db.query<{
          project_id: string;
          project_name: string;
          block_id: string;
          block_code: string;
          block_name: string;
          period_usage_m3: number;
          period_cost_yuan: number;
        }>(
          `
          select
            pb.project_id,
            p.project_name,
            pb.id as block_id,
            pb.block_code,
            pb.block_name,
            coalesce(sum(io.charge_volume), 0)::float8 as period_usage_m3,
            coalesce(sum(io.amount), 0)::float8 as period_cost_yuan
          from project_block pb
          join project p on p.id = pb.project_id
          left join well w on w.block_id = pb.id
          left join runtime_session rs on rs.well_id = w.id
          left join irrigation_order io
            on io.session_id = rs.id
            and date_trunc('month', io.created_at at time zone '${tz}') =
              date_trunc('month', current_timestamp at time zone '${tz}')
          group by pb.id, p.project_name, pb.block_code, pb.block_name, pb.project_id
          order by period_cost_yuan desc, pb.block_name asc
          limit 50
          `
        )
      : await this.db.query<{
          project_id: string;
          project_name: string;
          block_id: string;
          block_code: string;
          block_name: string;
          period_usage_m3: number;
          period_cost_yuan: number;
        }>(
          `
          select
            pb.project_id,
            p.project_name,
            pb.id as block_id,
            pb.block_code,
            pb.block_name,
            0::float8 as period_usage_m3,
            0::float8 as period_cost_yuan
          from project_block pb
          join project p on p.id = pb.project_id
          order by p.project_name asc, pb.block_name asc
          limit 50
          `
        );

    const bounds = await this.db.query<{ month_start: Date; month_end: Date }>(
      `
      select
        (
          date_trunc('month', current_timestamp at time zone '${tz}')
          at time zone '${tz}'
        ) as month_start,
        (
          (
            date_trunc('month', current_timestamp at time zone '${tz}')
            + interval '1 month'
            - interval '1 second'
          ) at time zone '${tz}'
        ) as month_end
      `
    );
    const b = bounds.rows[0];
    const toIso = (v: Date | string) =>
      v instanceof Date ? v.toISOString() : new Date(v).toISOString();

    const s = summary.rows[0];

    return ok({
      period: {
        kind: 'calendar_month',
        timezone: tz,
        month_start: toIso(b.month_start as unknown as Date | string),
        month_end: toIso(b.month_end as unknown as Date | string)
      },
      today_water_m3: s.today_water_m3,
      today_energy_kwh: 0,
      today_cost_yuan: s.today_cost_yuan,
      period_water_m3: s.period_water_m3,
      period_energy_kwh: 0,
      period_cost_yuan: s.period_cost_yuan,
      project_block_costs: blocks.rows.map((b) => ({
        project_id: b.project_id,
        project_name: b.project_name,
        block_id: b.block_id,
        block_code: b.block_code,
        block_name: b.block_name,
        period_usage_m3: b.period_usage_m3,
        period_cost_yuan: b.period_cost_yuan,
        period_energy_kwh: 0
      }))
    });
  }
}

@Module({
  controllers: [CockpitOpsController]
})
export class CockpitModule {}
