import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

interface CreateUatCaseDto {
  caseCode: string;
  roleType: string;
  scenarioName: string;
  expectedResult: string;
}

@Controller('uat')
class UatController {
  constructor(private readonly db: DatabaseService) {}

  @Get('cases')
  async listCases() {
    const result = await this.db.query(`
      select
        c.id,
        initcap(replace(split_part(c.case_code, '-', 2), '_', ' ')) as module,
        c.scenario_name as scenario,
        coalesce(jsonb_array_length(e.evidence_json), 0) as steps,
        case
          when e.status = 'passed' then coalesce(jsonb_array_length(e.evidence_json), 0)
          when e.status = 'blocked' then greatest(coalesce(jsonb_array_length(e.evidence_json), 0) - 1, 0)
          else greatest(coalesce(jsonb_array_length(e.evidence_json), 0) - 2, 0)
        end as passed,
        case when e.status = 'passed' then 'pass' else 'fail' end as status,
        coalesce(u.display_name, '--') as tester,
        to_char(coalesce(e.updated_at, e.created_at, c.created_at) at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as date
      from uat_case c
      left join lateral (
        select *
        from uat_execution ue
        where ue.case_id = c.id
        order by ue.created_at desc
        limit 1
      ) e on true
      left join sys_user u on u.id = e.executor_user_id
      order by c.created_at asc
    `);
    return ok({ items: result.rows });
  }

  @Post('cases')
  createCase(@Body() dto: CreateUatCaseDto) {
    return ok({ created: dto });
  }

  @Get('executions')
  async listExecutions() {
    const result = await this.db.query(`
      select
        ue.id,
        ue.execution_no as execution_no,
        ue.status,
        ue.block_reason_json as block_reason,
        ue.evidence_json as evidence,
        ue.created_at
      from uat_execution ue
      order by ue.created_at desc
    `);
    return ok({ items: result.rows });
  }

  @Post('executions/:id/pass')
  pass(@Param('id') id: string) {
    return ok({ id, status: 'passed' });
  }

  @Post('executions/:id/block')
  block(@Param('id') id: string) {
    return ok({ id, status: 'blocked' });
  }
}

@Module({
  controllers: [UatController]
})
export class UatModule {}
