import { Body, Controller, Get, HttpException, HttpStatus, Injectable, Module, Param, Post } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_MANAGER_ID = '00000000-0000-0000-0000-000000000102';
const DEFAULT_OPERATOR_ID = '00000000-0000-0000-0000-000000000103';
const WORK_ORDER_STATUSES = ['created', 'assigned', 'in_progress', 'completed', 'closed'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;

type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
type WorkOrderPriority = (typeof PRIORITIES)[number];

interface CreateWorkOrderDto {
  sourceAlarmId?: string;
  sourceSessionId?: string;
  workOrderType?: string;
  type?: string;
  assigneeUserId?: string;
  title?: string;
  priority?: WorkOrderPriority;
  deadline?: string;
}

interface TransitionWorkOrderDto {
  assigneeUserId?: string;
  remark?: string;
  notes?: string;
  lat?: number;
  lng?: number;
}

interface WorkOrderRow {
  id: string;
  work_order_no: string;
  source_alarm_id: string | null;
  source_session_id: string | null;
  assignee_user_id: string | null;
  title: string;
  type: string;
  alert: string;
  area: string;
  well: string | null;
  assignee: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  created: string;
  deadline: string;
}

function appException(status: HttpStatus, code: string, message: string, data: Record<string, unknown> = {}) {
  return new HttpException({ requestId: 'local-dev', code, message, data }, status);
}

function pickWorkOrderType(dto: CreateWorkOrderDto) {
  return dto.workOrderType?.trim() || dto.type?.trim() || '';
}

function normalizePriority(value?: string | null): WorkOrderPriority {
  return PRIORITIES.includes((value ?? '') as WorkOrderPriority) ? (value as WorkOrderPriority) : 'medium';
}

@Injectable()
class WorkOrderService {
  constructor(private readonly db: DatabaseService) {}

  private async ensureUserExists(userId: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from sys_user
      where tenant_id = $1 and id = $2 and status = 'active'
      `,
      [TENANT_ID, userId],
      client
    );

    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { assigneeUserId: 'assigneeUserId is invalid' }
      });
    }
  }

  private async resolveAlarm(alarmId: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string; device_id: string | null; session_id: string | null; alarm_code: string }>(
      `
      select id, device_id, session_id, alarm_code
      from alarm_event
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, alarmId],
      client
    );

    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { sourceAlarmId: 'sourceAlarmId is invalid' }
      });
    }
    return row;
  }

  private async ensureSessionExists(sessionId: string, client?: PoolClient) {
    const result = await this.db.query<{ id: string }>(
      `
      select id
      from runtime_session
      where tenant_id = $1 and id = $2
      `,
      [TENANT_ID, sessionId],
      client
    );

    if (!result.rows[0]) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { sourceSessionId: 'sourceSessionId is invalid' }
      });
    }
  }

  private async generateWorkOrderNo(client: PoolClient) {
    const stamp = await this.db.query<{ work_order_no: string }>(
      `
      select 'WO-HJ-' || to_char(now() at time zone 'Asia/Shanghai', 'YYYYMMDDHH24MISSMS') as work_order_no
      `,
      [],
      client
    );
    return stamp.rows[0].work_order_no;
  }

  private async insertActionLog(
    workOrderId: string,
    actionCode: string,
    fromStatus: string | null,
    toStatus: WorkOrderStatus,
    operatorId: string,
    remark: string,
    client: PoolClient
  ) {
    await this.db.query(
      `
      insert into work_order_action_log (
        tenant_id,
        work_order_id,
        action_code,
        from_status,
        to_status,
        operator_id,
        remark
      ) values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [TENANT_ID, workOrderId, actionCode, fromStatus, toStatus, operatorId, remark],
      client
    );
  }

  private baseSelect() {
    return `
      select
        wo.id,
        wo.work_order_no,
        wo.source_alarm_id,
        wo.source_session_id,
        wo.assignee_user_id,
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
      where wo.tenant_id = $1
    `;
  }

  async list() {
    const result = await this.db.query<WorkOrderRow>(
      `
      ${this.baseSelect()}
      order by wo.created_at desc
      `,
      [TENANT_ID]
    );
    return { items: result.rows, total: result.rows.length };
  }

  async getById(id: string) {
    const result = await this.db.query<WorkOrderRow>(
      `
      ${this.baseSelect()}
      and wo.id = $2
      limit 1
      `,
      [TENANT_ID, id]
    );
    const row = result.rows[0];
    if (!row) {
      throw appException(HttpStatus.NOT_FOUND, 'TARGET_NOT_FOUND', 'Work order not found', { id });
    }
    return row;
  }

  async create(dto: CreateWorkOrderDto) {
    const workOrderType = pickWorkOrderType(dto);
    if (!workOrderType) {
      throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
        fieldErrors: { workOrderType: 'workOrderType is required' }
      });
    }

    const priority = normalizePriority(dto.priority);
    const remark = 'created by codex phase1 backend';

    const createdId = await this.db.withTransaction(async (client) => {
      const workOrderNo = await this.generateWorkOrderNo(client);
      const assigneeUserId = dto.assigneeUserId?.trim() || null;
      if (assigneeUserId) {
        await this.ensureUserExists(assigneeUserId, client);
      }

      const sourceAlarmId = dto.sourceAlarmId?.trim() || null;
      const sourceSessionIdInput = dto.sourceSessionId?.trim() || null;
      let sourceSessionId = sourceSessionIdInput;
      let deviceId: string | null = null;
      let defaultTitle = workOrderNo;

      if (sourceAlarmId) {
        const alarm = await this.resolveAlarm(sourceAlarmId, client);
        deviceId = alarm.device_id;
        sourceSessionId = sourceSessionId ?? alarm.session_id;
        defaultTitle = `Alarm ${alarm.alarm_code}`;
      }
      if (sourceSessionId) {
        await this.ensureSessionExists(sourceSessionId, client);
      }

      const title = dto.title?.trim() || defaultTitle;
      const deadline = dto.deadline?.trim() ? new Date(dto.deadline) : null;
      if (deadline && Number.isNaN(deadline.getTime())) {
        throw appException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Validation failed', {
          fieldErrors: { deadline: 'deadline is invalid' }
        });
      }

      const inserted = await this.db.query<{ id: string }>(
        `
        insert into work_order (
          tenant_id,
          work_order_no,
          source_alarm_id,
          source_session_id,
          device_id,
          work_order_type,
          status,
          assignee_user_id,
          sla_deadline_at,
          result_json
        ) values ($1, $2, $3, $4, $5, $6, 'created', $7, $8, $9)
        returning id
        `,
        [
          TENANT_ID,
          workOrderNo,
          sourceAlarmId,
          sourceSessionId,
          deviceId,
          workOrderType,
          assigneeUserId,
          deadline?.toISOString() ?? null,
          JSON.stringify({ title, priority })
        ],
        client
      );

      const workOrderId = inserted.rows[0].id;
      await this.insertActionLog(workOrderId, 'create', null, 'created', DEFAULT_MANAGER_ID, remark, client);
      return workOrderId;
    });

    return this.getById(createdId);
  }

  private async transition(
    id: string,
    actionCode: 'assign' | 'accept' | 'process' | 'check_in' | 'complete',
    nextStatus: WorkOrderStatus,
    dto: TransitionWorkOrderDto,
    allowedStatuses: WorkOrderStatus[]
  ) {
    const current = await this.getById(id);
    if (!allowedStatuses.includes(current.status)) {
      throw appException(HttpStatus.CONFLICT, 'INVALID_STATUS_TRANSITION', 'Status transition is not allowed', {
        id,
        fromStatus: current.status,
        actionCode,
        nextStatus
      });
    }

    await this.db.withTransaction(async (client) => {
      let assigneeUserId = current.assignee_user_id;
      if (actionCode === 'assign') {
        assigneeUserId = dto.assigneeUserId?.trim() || assigneeUserId || DEFAULT_OPERATOR_ID;
        await this.ensureUserExists(assigneeUserId, client);
      }

      await this.db.query(
        `
        update work_order
        set status = $3,
            assignee_user_id = $4,
            updated_at = now()
        where tenant_id = $1 and id = $2
        `,
        [TENANT_ID, id, nextStatus, assigneeUserId],
        client
      );

      await this.insertActionLog(
        id,
        actionCode,
        current.status,
        nextStatus,
        actionCode === 'assign' ? DEFAULT_MANAGER_ID : assigneeUserId || DEFAULT_MANAGER_ID,
        dto.remark?.trim() || actionCode,
        client
      );
    });

    return this.getById(id);
  }

  assign(id: string, dto: TransitionWorkOrderDto) {
    return this.transition(id, 'assign', 'assigned', dto, ['created', 'assigned']);
  }

  accept(id: string, dto: TransitionWorkOrderDto) {
    return this.transition(id, 'accept', 'in_progress', dto, ['assigned', 'in_progress']);
  }

  process(id: string, dto: TransitionWorkOrderDto) {
    return this.transition(id, 'process', 'in_progress', dto, ['assigned', 'in_progress']);
  }

  checkIn(id: string, dto: TransitionWorkOrderDto) {
    return this.transition(id, 'check_in', 'in_progress', dto, ['assigned', 'in_progress']);
  }

  complete(id: string, dto: TransitionWorkOrderDto) {
    return this.transition(id, 'complete', 'completed', dto, ['in_progress']);
  }

  async todos() {
    const result = await this.db.query<WorkOrderRow>(
      `
      ${this.baseSelect()}
      and wo.status in ('created', 'assigned', 'in_progress')
      order by wo.created_at desc
      `,
      [TENANT_ID]
    );
    return { items: result.rows, total: result.rows.length };
  }

  async myWorkOrders() {
    const result = await this.db.query<WorkOrderRow>(
      `
      ${this.baseSelect()}
      order by wo.created_at desc
      `,
      [TENANT_ID]
    );
    return { items: result.rows, total: result.rows.length };
  }

  async inspections() {
    const result = await this.db.query<
      WorkOrderRow & {
        wells: number | string | null;
      }
    >(
      `
      select
        base.*,
        1 as wells
      from (
        ${this.baseSelect()}
      ) base
      where lower(base.type) in ('inspection', '巡检')
      order by base.created desc
      `,
      [TENANT_ID]
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        area: row.area,
        wells: Number(row.wells ?? 1),
        deadline: row.deadline,
        status: row.status === 'in_progress' ? 'in_progress' : 'pending',
        type: row.type
      })),
      total: result.rows.length
    };
  }
}

@Controller()
class WorkOrderController {
  constructor(private readonly service: WorkOrderService) {}

  @Get('work-orders')
  async list() {
    return ok(await this.service.list());
  }

  @Post('work-orders')
  async create(@Body() dto: CreateWorkOrderDto) {
    return ok(await this.service.create(dto));
  }

  @Get('work-orders/:id')
  async detail(@Param('id') id: string) {
    return ok(await this.service.getById(id));
  }

  @Post('work-orders/:id/assign')
  async assign(@Param('id') id: string, @Body() dto: TransitionWorkOrderDto = {}) {
    return ok(await this.service.assign(id, dto));
  }

  @Post('work-orders/:id/accept')
  async accept(@Param('id') id: string, @Body() dto: TransitionWorkOrderDto = {}) {
    return ok(await this.service.accept(id, dto));
  }

  @Post('work-orders/:id/process')
  async process(@Param('id') id: string, @Body() dto: TransitionWorkOrderDto = {}) {
    return ok(await this.service.process(id, dto));
  }

  @Post('mobile/work-orders/:id/check-in')
  async checkIn(@Param('id') id: string, @Body() dto: TransitionWorkOrderDto = {}) {
    return ok({ success: true, item: await this.service.checkIn(id, dto) });
  }

  @Post('mobile/work-orders/:id/complete')
  async complete(@Param('id') id: string, @Body() dto: TransitionWorkOrderDto = {}) {
    return ok(await this.service.complete(id, dto));
  }

  @Get('m/my/todos')
  async todos() {
    return ok(await this.service.todos());
  }

  @Get('m/my/work-orders')
  async myWorkOrders() {
    return ok(await this.service.myWorkOrders());
  }

  @Get('mobile/inspections')
  async inspections() {
    return ok(await this.service.inspections());
  }
}

@Module({
  controllers: [WorkOrderController],
  providers: [WorkOrderService]
})
export class WorkOrderModule {}
