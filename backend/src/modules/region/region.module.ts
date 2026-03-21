import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

interface CreateRegionDto {
  parentId?: string;
  regionCode: string;
  regionName: string;
  regionType: 'project' | 'service_area' | 'village' | 'plot_group' | 'plot';
}

@Controller('regions')
class RegionController {
  @Get('tree')
  tree() {
    return ok({ items: [] });
  }

  @Get()
  list() {
    return ok({ items: [] });
  }

  @Post()
  create(@Body() dto: CreateRegionDto) {
    return ok({ created: dto });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateRegionDto>) {
    return ok({ id, changes: dto });
  }
}

@Module({
  controllers: [RegionController]
})
export class RegionModule {}
