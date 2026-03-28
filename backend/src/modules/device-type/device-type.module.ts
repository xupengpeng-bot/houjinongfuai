import { Body, Controller, Get, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

interface CreateDeviceTypeDto {
  typeCode: string;
  typeName: string;
  family: string;
  capabilityJson?: Record<string, unknown>;
  defaultConfigJson?: Record<string, unknown>;
}

@Controller('device-types')
class DeviceTypeController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list() {
    const result = await this.db.query(
      `
      select
        dt.id,
        dt.type_name as name,
        dt.family as category,
        coalesce(dt.capability_json->>'protocol', 'modbus') as protocol,
        coalesce(dt.capability_json->'metrics', '[]'::jsonb) as params,
        count(d.id)::int as count
      from device_type dt
      left join device d on d.device_type_id = dt.id
      where dt.tenant_id = $1
      group by dt.id
      order by dt.created_at asc
    `,
      [TENANT_ID]
    );
    return ok({ items: result.rows });
  }

  /** Form / filter options — value = id, label = type_name */
  @Get('options')
  async options() {
    const result = await this.db.query<{ value: string; label: string }>(
      `
      select dt.id as value, dt.type_name as label
      from device_type dt
      where dt.tenant_id = $1 and dt.status = 'active'
      order by dt.type_name asc
    `,
      [TENANT_ID]
    );
    return ok({ items: result.rows });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.db.query(
      `
      select
        dt.id,
        dt.type_code,
        dt.type_name,
        dt.family,
        dt.capability_json,
        dt.default_config_json,
        dt.form_schema_json,
        dt.status,
        dt.created_at,
        dt.updated_at
      from device_type dt
      where dt.tenant_id = $1 and dt.id = $2
    `,
      [TENANT_ID, id]
    );
    if (!result.rows[0]) {
      throw new NotFoundException('device_type not found');
    }
    return ok(result.rows[0]);
  }

  @Post()
  create(@Body() dto: CreateDeviceTypeDto) {
    return ok({ created: dto });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateDeviceTypeDto>) {
    return ok({ id, changes: dto });
  }
}

@Module({
  controllers: [DeviceTypeController]
})
export class DeviceTypeModule {}
