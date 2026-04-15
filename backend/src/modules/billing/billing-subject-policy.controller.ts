import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { BillingSubjectPolicyService } from './billing-subject-policy.service';

type BatchApplyDto = {
  subject_type?: string;
  billing_package_id?: string;
  subject_ids?: string[];
  overwrite?: boolean;
};

@Controller('billing-subject-policies')
export class BillingSubjectPolicyController {
  constructor(private readonly service: BillingSubjectPolicyService) {}

  @Get('projects/:projectId/options')
  async listProjectOptions(@Param('projectId') projectId: string, @Query('subject_type') subjectType?: string) {
    const normalizedSubjectType = this.service.normalizeSubjectType(subjectType);
    if (!normalizedSubjectType) {
      throw new BadRequestException('subject_type is required and must be one of well, pump, valve');
    }
    return ok(await this.service.listProjectSubjectOptions(projectId, normalizedSubjectType));
  }

  @Post('projects/:projectId/batch-apply')
  async batchApply(@Param('projectId') projectId: string, @Body() body?: BatchApplyDto) {
    const normalizedSubjectType = this.service.normalizeSubjectType(body?.subject_type);
    if (!normalizedSubjectType) {
      throw new BadRequestException('subject_type is required and must be one of well, pump, valve');
    }
    if (!body?.billing_package_id?.trim()) {
      throw new BadRequestException('billing_package_id is required');
    }

    return ok(
      await this.service.batchApplyProject({
        projectId,
        subjectType: normalizedSubjectType,
        billingPackageId: body.billing_package_id.trim(),
        subjectIds: body.subject_ids,
        overwrite: body.overwrite
      })
    );
  }
}
