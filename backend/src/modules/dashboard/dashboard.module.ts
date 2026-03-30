import { Controller, Get, Module } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

@Controller('dashboard')
class DashboardController {
  constructor(private readonly db: DatabaseService) {}

  @Get('stats')
  async stats() {
    const result = await this.db.query<{
      total_wells: number;
      running_wells: number;
      total_devices: number;
      online_devices: number;
      today_orders: number;
      today_usage: number;
      today_revenue: number;
      pending_alerts: number;
      open_work_orders: number;
      monthly_usage: number;
      monthly_revenue: number;
      device_online_rate: number;
    }>(`
      with today_orders as (
        select
          count(*)::int as count_orders,
          coalesce(sum(coalesce(charge_volume, 0)), 0)::numeric as total_usage,
          coalesce(sum(amount), 0)::numeric as total_revenue
        from irrigation_order
        where created_at::date = current_date
      ),
      month_orders as (
        select
          coalesce(sum(coalesce(charge_volume, 0)), 0)::numeric as total_usage,
          coalesce(sum(amount), 0)::numeric as total_revenue
        from irrigation_order
        where date_trunc('month', created_at) = date_trunc('month', current_date)
      )
      select
        (select count(*)::int from well) as total_wells,
        (
          select count(distinct well_id)::int
          from runtime_session
          where status in ('pending_start', 'running', 'billing', 'stopping')
        ) as running_wells,
        (select count(*)::int from device) as total_devices,
        (
          select count(*)::int
          from device
          where lifecycle_state = 'active' and online_state = 'online'
        ) as online_devices,
        (select count_orders from today_orders) as today_orders,
        (select total_usage from today_orders) as today_usage,
        (select total_revenue from today_orders) as today_revenue,
        (
          select count(*)::int
          from alarm_event
          where status in ('open', 'processing')
        ) as pending_alerts,
        (
          select count(*)::int
          from work_order
          where status in ('created', 'assigned', 'in_progress')
        ) as open_work_orders,
        (select total_usage from month_orders) as monthly_usage,
        (select total_revenue from month_orders) as monthly_revenue,
        case
          when (select count(*) from device) = 0 then 0
          else round((
            (select count(*)::numeric from device where lifecycle_state = 'active' and online_state = 'online') /
            greatest((select count(*)::numeric from device), 1)
          ) * 100, 1)
        end as device_online_rate
    `);
    const stats = result.rows[0];

    return {
      ...ok(stats),
      ...stats
    };
  }

  @Get('overview')
  async overview() {
    const result = await this.db.query<{
      total_wells: number;
      running_wells: number;
      total_devices: number;
      online_devices: number;
      today_orders: number;
      today_usage: number;
      today_revenue: number;
      pending_alerts: number;
      open_work_orders: number;
      monthly_usage: number;
      monthly_revenue: number;
      device_online_rate: number;
    }>(`
      with today_orders as (
        select
          count(*)::int as count_orders,
          coalesce(sum(coalesce(charge_volume, 0)), 0)::numeric as total_usage,
          coalesce(sum(amount), 0)::numeric as total_revenue
        from irrigation_order
        where created_at::date = current_date
      ),
      month_orders as (
        select
          coalesce(sum(coalesce(charge_volume, 0)), 0)::numeric as total_usage,
          coalesce(sum(amount), 0)::numeric as total_revenue
        from irrigation_order
        where date_trunc('month', created_at) = date_trunc('month', current_date)
      )
      select
        (select count(*)::int from well) as total_wells,
        (
          select count(distinct well_id)::int
          from runtime_session
          where status in ('pending_start', 'running', 'billing', 'stopping')
        ) as running_wells,
        (select count(*)::int from device) as total_devices,
        (
          select count(*)::int
          from device
          where lifecycle_state = 'active' and online_state = 'online'
        ) as online_devices,
        (select count_orders from today_orders) as today_orders,
        (select total_usage from today_orders) as today_usage,
        (select total_revenue from today_orders) as today_revenue,
        (
          select count(*)::int
          from alarm_event
          where status in ('open', 'processing')
        ) as pending_alerts,
        (
          select count(*)::int
          from work_order
          where status in ('created', 'assigned', 'in_progress')
        ) as open_work_orders,
        (select total_usage from month_orders) as monthly_usage,
        (select total_revenue from month_orders) as monthly_revenue,
        case
          when (select count(*) from device) = 0 then 0
          else round((
            (select count(*)::numeric from device where lifecycle_state = 'active' and online_state = 'online') /
            greatest((select count(*)::numeric from device), 1)
          ) * 100, 1)
        end as device_online_rate
    `);
    const row = result.rows[0];

    return ok({
      deviceSummary: {
        total_devices: row.total_devices,
        online_devices: row.online_devices,
        device_online_rate: row.device_online_rate,
        total_wells: row.total_wells,
        running_wells: row.running_wells
      },
      orderSummary: {
        today_orders: row.today_orders,
        today_usage: row.today_usage,
        today_revenue: row.today_revenue,
        monthly_usage: row.monthly_usage,
        monthly_revenue: row.monthly_revenue
      },
      alarmSummary: {
        pending_alerts: row.pending_alerts
      },
      todoSummary: {
        open_work_orders: row.open_work_orders
      }
    });
  }
}

@Module({
  controllers: [DashboardController]
})
export class DashboardModule {}
