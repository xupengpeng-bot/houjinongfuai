import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { DispatchMysqlService } from './dispatch-mysql.service';

@Controller('dispatch')
class DispatchMysqlController {
  constructor(private readonly dispatch: DispatchMysqlService) {}

  @Get('team/:team/current')
  async teamCurrent(@Param('team') team: string) {
    const row = await this.dispatch.getTeamCurrent(team);
    if (!row) {
      throw new NotFoundException(`no dispatch_team_current row for team=${team}`);
    }
    return ok(row);
  }

  /** Prefer this for execution: structured fields + optional legacy markdown. */
  @Get('task/:taskId/state')
  async taskState(@Param('taskId') taskId: string) {
    const model = await this.dispatch.getTaskReadModel(taskId);
    if (!model) {
      throw new NotFoundException(`dispatch_task not found: ${taskId}`);
    }
    return ok(model);
  }

  /** Raw row (`SELECT *`) — backward compatible; large `payload_md` may be heavy. */
  @Get('task/:taskId')
  async task(@Param('taskId') taskId: string) {
    const row = await this.dispatch.getTask(taskId);
    if (!row) {
      throw new NotFoundException(`dispatch_task not found: ${taskId}`);
    }
    return ok(row);
  }
}

@Module({
  controllers: [DispatchMysqlController],
  providers: [DispatchMysqlService],
  exports: [DispatchMysqlService]
})
export class DispatchMysqlModule {}
