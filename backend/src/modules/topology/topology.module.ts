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
    return ok({ created: await this.topologyRepository.create(dto) });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePumpValveRelationDto) {
    return ok({ id, updated: await this.topologyRepository.update(id, dto) });
  }
}

@Module({
  controllers: [TopologyController],
  providers: [TopologyRepository, TopologyService],
  exports: [TopologyRepository, TopologyService]
})
export class TopologyModule {}
