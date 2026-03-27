import { Controller, Get, Query } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import {
  PHASE1_DEFAULT_TENANT_ID,
  PHASE1_DEFAULT_USER_ID,
  DataScopeService
} from './data-scope.service';

/**
 * Project/block read scope derived from `data_scope_policy`.
 * Query params default to Phase 1 demo identity (same as `GET /auth/me`) until real JWT wiring lands.
 */
@Controller('ops/data-scope')
export class DataScopeController {
  constructor(private readonly dataScopeService: DataScopeService) {}

  @Get('summary')
  async summary(
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string
  ) {
    return ok(
      await this.dataScopeService.getSummary(
        tenantId ?? PHASE1_DEFAULT_TENANT_ID,
        userId ?? PHASE1_DEFAULT_USER_ID
      )
    );
  }

  @Get('projects')
  async projects(
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string
  ) {
    return ok(
      await this.dataScopeService.listProjects(
        tenantId ?? PHASE1_DEFAULT_TENANT_ID,
        userId ?? PHASE1_DEFAULT_USER_ID
      )
    );
  }

  @Get('blocks')
  async blocks(
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
    @Query('projectId') projectId?: string
  ) {
    return ok(
      await this.dataScopeService.listBlocks(
        tenantId ?? PHASE1_DEFAULT_TENANT_ID,
        userId ?? PHASE1_DEFAULT_USER_ID,
        projectId
      )
    );
  }
}
