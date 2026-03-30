import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

interface CreateUserDto {
  displayName: string;
  mobile: string;
  userType: string;
}

interface AssignRolesDto {
  roleIds: string[];
}

@Controller('system')
class IamController {
  constructor(private readonly db: DatabaseService) {}

  @Get('users')
  async listUsers() {
    const result = await this.db.query(`
      select
        u.id,
        u.display_name as name,
        lower(replace(u.display_name, ' ', '_')) as username,
        case
          when coalesce(sr.role_type, u.user_type) in ('tenant_admin', 'admin', 'project_manager') then 'admin'
          when coalesce(sr.role_type, u.user_type) in ('operator', 'ops_operator', 'maintenance_operator') then 'operator'
          else 'farmer'
        end as role,
        coalesce(r.region_name, '--') as area,
        u.mobile as phone,
        case when u.status = 'active' then 'active' else 'disabled' end as status
      from sys_user u
      left join lateral (
        select r1.role_type
        from sys_user_role ur
        join sys_role r1 on r1.id = ur.role_id
        where ur.user_id = u.id
        order by r1.created_at asc
        limit 1
      ) sr on true
      left join lateral (
        select ds.scope_ref_id
        from sys_user_role ur2
        join sys_data_scope ds on ds.role_id = ur2.role_id
        where ur2.user_id = u.id and ds.scope_type = 'region'
        order by ds.created_at asc
        limit 1
      ) scope on true
      left join region r on r.id = scope.scope_ref_id
      order by u.created_at asc
    `);
    return ok({ items: result.rows });
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return ok({ created: dto });
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: Partial<CreateUserDto>) {
    return ok({ id, changes: dto });
  }

  @Post('users/:id/roles')
  assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto) {
    return ok({ id, roles: dto.roleIds });
  }

  @Get('roles')
  async listRoles() {
    const result = await this.db.query(`
      select
        id,
        role_code as code,
        role_name as name,
        role_type as type,
        status
      from sys_role
      order by created_at asc
    `);
    return ok({ items: result.rows });
  }

  @Get('permissions')
  async listPermissions() {
    const result = await this.db.query(`
      select
        id,
        permission_code as code,
        resource_code as resource,
        action_code as action
      from sys_permission
      order by permission_code asc
    `);
    return ok({ items: result.rows });
  }

  @Get('audit-logs')
  async listAuditLogs(
    @Query('page') pageRaw?: string,
    @Query('page_size') pageSizeRaw?: string
  ) {
    const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(pageSizeRaw ?? '20', 10) || 20));
    const offset = (page - 1) * pageSize;

    const result = await this.db.query<{
      id: string;
      time: Date;
      user: string | null;
      action: string;
      target: string;
      detail: string;
      ip: string;
    }>(
      `
      select
        al.id,
        al.created_at as time,
        coalesce(u.display_name, 'system') as "user",
        upper(al.action_code) as action,
        concat(al.resource_type, '/', coalesce(al.resource_id::text, '--')) as target,
        trim(
          both ' ' from concat_ws(
            ' ',
            'module=' || al.module_code,
            case when al.after_json <> '{}'::jsonb then 'after=' || left(al.after_json::text, 120) else null end,
            case when al.before_json <> '{}'::jsonb then 'before=' || left(al.before_json::text, 120) else null end
          )
        ) as detail,
        'internal' as ip
      from audit_log al
      left join sys_user u on u.id = al.actor_user_id
      order by al.created_at desc
      offset $1
      limit $2
      `,
      [offset, pageSize]
    );

    const totalResult = await this.db.query<{ total: string }>(`select count(*)::text as total from audit_log`);
    return ok({
      items: result.rows.map((row) => ({
        ...row,
        time: row.time.toISOString()
      })),
      total: Number.parseInt(totalResult.rows[0]?.total ?? '0', 10),
      page,
      page_size: pageSize
    });
  }
}

@Module({
  controllers: [IamController]
})
export class IamModule {}
