import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { PumpValveRelationDto, UpdatePumpValveRelationDto } from './topology.dto';
import { TopologyRepository } from './topology.repository';
import { TopologyService } from './topology.service';

@Controller('pump-valve-relations')
class TopologyController {
  constructor(private readonly topologyRepository: TopologyRepository) {}

  @Get()
  async list() {
    return ok({ items: await this.topologyRepository.findAll() });
  }

  @Post()
  async create(@Body() dto: PumpValveRelationDto) {
    return ok({
      created: await this.topologyRepository.create({
        wellId: dto.wellId,
        pumpId: dto.pumpId,
        valveId: dto.valveId,
        relationRole: dto.relationRole,
        topologyRelationTypeState: dto.topology_relation_types
          ? { ...dto.topology_relation_types }
          : undefined
      })
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePumpValveRelationDto) {
    return ok({
      id,
      updated: await this.topologyRepository.update(id, {
        relationRole: dto.relationRole,
        topologyRelationTypeStatePatch: dto.topology_relation_types
          ? { ...dto.topology_relation_types }
          : undefined
      })
    });
  }
}

@Module({
  controllers: [TopologyController],
  providers: [TopologyRepository, TopologyService],
  exports: [TopologyRepository, TopologyService]
})
export class TopologyModule {}
