import { Body, Controller, Get, Headers, Module, NotFoundException, Param, Post } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import { ok } from '../../common/http/api-response';
import {
  DispatchTaskResultSummaryBodyDto,
  DispatchTaskSequencingBodyDto,
  DispatchTaskStatusBodyDto
} from './dispatch-mysql.dto';
import { DispatchMysqlService } from './dispatch-mysql.service';

@Controller('dispatch')
class DispatchMysqlController {
  constructor(private readonly dispatch: DispatchMysqlService) {}

  @Post('task/:taskId/status')
  async postTaskStatus(
    @Param('taskId') taskId: string,
    @Body() body: DispatchTaskStatusBodyDto,
    @Headers() headers: IncomingHttpHeaders
  ) {
    this.dispatch.assertWriteHeaders(headers);
    const syncTeam = body.sync_team !== false;
    const autoActivateNext = body.auto_activate_next === true;
    const { task, team } = await this.dispatch.updateTaskStatus(
      taskId,
      body.status,
      syncTeam,
      autoActivateNext
    );
    return ok({ task, team });
  }

  @Post('task/:taskId/sequencing')
  async postTaskSequencing(
    @Param('taskId') taskId: string,
    @Body() body: DispatchTaskSequencingBodyDto,
    @Headers() headers: IncomingHttpHeaders
  ) {
    this.dispatch.assertWriteHeaders(headers);
    const row = await this.dispatch.updateTaskSequencing(taskId, body);
    return ok(row);
  }

  @Post('task/:taskId/result-summary')
  async postResultSummary(
    @Param('taskId') taskId: string,
    @Body() body: DispatchTaskResultSummaryBodyDto,
    @Headers() headers: IncomingHttpHeaders
  ) {
    this.dispatch.assertWriteHeaders(headers);
    const model = await this.dispatch.updateTaskResultSummary(taskId, body.summary, body.artifact_ref);
    return ok(model);
  }

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
