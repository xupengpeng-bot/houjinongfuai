import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { DataScopeController } from './data-scope.controller';
import { DataScopeRepository } from './data-scope.repository';
import { DataScopeService } from './data-scope.service';
import { EffectivePolicyResolver } from './effective-policy.resolver';
import { UpdateWellRuntimePolicyDto, WellRuntimePolicyDto } from './policy.dto';
import { PolicyRepository } from './policy.repository';

@Controller('well-runtime-policies')
class PolicyController {
  constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly effectivePolicyResolver: EffectivePolicyResolver
  ) {}

  @Get()
  async list() {
    return ok({ items: await this.policyRepository.findAll() });
  }

  @Post()
  async create(@Body() dto: WellRuntimePolicyDto) {
    return ok({ created: await this.policyRepository.create(dto) });
  }

  @Get(':id/effective-preview')
  async preview(@Param('id') id: string) {
    const policies = await this.policyRepository.findAll();
    const policy = policies.find((item: { id: string }) => item.id === id);
    return ok({
      id,
      preview: policy
        ? {
            priorityChain: ['well_runtime_policy', 'pump_valve_relation', 'interaction_policy', 'scenario_template', 'device_type_default'],
            policy
          }
        : null
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateWellRuntimePolicyDto) {
    return ok({ id, updated: await this.policyRepository.update(id, dto) });
  }
}

@Module({
  controllers: [PolicyController, DataScopeController],
  providers: [PolicyRepository, EffectivePolicyResolver, DataScopeRepository, DataScopeService],
  exports: [PolicyRepository, EffectivePolicyResolver, DataScopeRepository, DataScopeService]
})
export class PolicyModule {}
