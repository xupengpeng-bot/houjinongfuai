import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

interface CreateUatCaseDto {
  caseCode: string;
  roleType: string;
  scenarioName: string;
  expectedResult: string;
}

@Controller('uat')
class UatController {
  @Get('cases')
  listCases() {
    return ok({ items: [] });
  }

  @Post('cases')
  createCase(@Body() dto: CreateUatCaseDto) {
    return ok({ created: dto });
  }

  @Get('executions')
  listExecutions() {
    return ok({ items: [] });
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
