import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeviceRelationsRepository, PHASE1_TENANT_ID } from './device-relations.repository';
import type { CreateDeviceRelationDto, UpdateDeviceRelationDto } from './device-relations.dto';

@Injectable()
export class DeviceRelationsService {
  constructor(private readonly repo: DeviceRelationsRepository) {}

  private tenant() {
    return PHASE1_TENANT_ID;
  }

  async list(page: number, pageSize: number) {
    return this.repo.findMany({ tenantId: this.tenant(), page, pageSize });
  }

  async getById(id: string) {
    const row = await this.repo.findById(this.tenant(), id);
    if (!row) throw new NotFoundException('device relation not found');
    return row;
  }

  async create(dto: CreateDeviceRelationDto) {
    if (dto.source_device_id === dto.target_device_id) {
      throw new BadRequestException('source and target must differ');
    }
    const status = dto.enabled === false ? 'inactive' : 'active';
    const priority = dto.priority ?? 0;
    const config: Record<string, unknown> = {};
    if (dto.sequence_rule !== undefined) config.sequence_rule = dto.sequence_rule;
    if (dto.delay_seconds !== undefined) config.delay_seconds = dto.delay_seconds;
    if (dto.remarks !== undefined) config.remarks = dto.remarks;
    if (dto.enabled !== undefined) config.enabled = dto.enabled;

    const created = await this.repo.insert({
      tenantId: this.tenant(),
      sourceDeviceId: dto.source_device_id,
      targetDeviceId: dto.target_device_id,
      relationType: dto.relation_type,
      priority,
      status,
      config
    });
    return this.getById(created.id);
  }

  async update(id: string, dto: UpdateDeviceRelationDto) {
    const existing = await this.repo.findById(this.tenant(), id);
    if (!existing) throw new NotFoundException('device relation not found');

    const configMerge: Record<string, unknown> = {};
    if (dto.sequence_rule !== undefined) configMerge.sequence_rule = dto.sequence_rule;
    if (dto.delay_seconds !== undefined) configMerge.delay_seconds = dto.delay_seconds;
    if (dto.remarks !== undefined) configMerge.remarks = dto.remarks;
    if (dto.enabled !== undefined) configMerge.enabled = dto.enabled;

    let status: string | undefined;
    if (dto.enabled !== undefined) {
      status = dto.enabled ? 'active' : 'inactive';
    }

    const ok = await this.repo.update(this.tenant(), id, {
      sourceDeviceId: dto.source_device_id,
      targetDeviceId: dto.target_device_id,
      relationType: dto.relation_type,
      priority: dto.priority === undefined ? undefined : (dto.priority ?? 0),
      status,
      configMerge: Object.keys(configMerge).length ? configMerge : undefined
    });
    if (!ok) throw new BadRequestException('update failed');
    return this.getById(id);
  }

  async remove(id: string) {
    const ok = await this.repo.delete(this.tenant(), id);
    if (!ok) throw new NotFoundException('device relation not found');
    return { id };
  }

  sourceDeviceOptions() {
    return this.repo.listDeviceOptions(this.tenant());
  }

  targetDeviceOptions() {
    return this.repo.listDeviceOptions(this.tenant());
  }

  /** Frozen Phase-1 enum; labels are Chinese for ops UI. */
  relationTypeOptions() {
    return [
      { value: 'control', label: '控制', description: '主从或点对点控制关系' },
      { value: 'linkage', label: '联动', description: '条件触发联动' },
      { value: 'interlock', label: '联锁', description: '安全互锁' },
      { value: 'master_slave', label: '主从', description: '一主多从拓扑' },
      { value: 'gateway_access', label: '网关接入', description: '经网关转发' },
      { value: 'sequence_delayed', label: '顺序延时', description: '按时序与延时执行' }
    ];
  }

  /** Matches `topology_relation.config_json.sequence_rule` accepted values. */
  sequenceRuleOptions() {
    return [
      { value: 'source_first', label: '源设备优先' },
      { value: 'target_first', label: '目标设备优先' },
      { value: 'simultaneous', label: '同时' }
    ];
  }
}
