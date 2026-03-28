import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { ok } from '../../common/http/api-response';

interface CreateBillingPackageDto {
  packageCode: string;
  packageName: string;
  billingMode: 'duration' | 'volume' | 'flat' | 'free';
  unitPrice: number;
  unitType: string;
  scopeType: string;
  scopeRefId: string;
}

@Controller('billing-packages')
class BillingController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list() {
    const result = await this.db.query(`
      select
        bp.id,
        bp.package_name as name,
        case
          when bp.billing_mode = 'volume' then 'volume'
          when bp.billing_mode = 'duration' then 'duration'
          else 'free'
        end as type,
        bp.unit_type as unit,
        bp.unit_price as price,
        bp.min_charge_amount as min_charge,
        (
          select count(*)::int
          from well_runtime_policy p
          where p.billing_package_id = bp.id
        ) as wells,
        case when bp.status = 'active' then 'active' else 'trial' end as status
      from billing_package bp
      order by bp.created_at asc
    `);
    return ok({ items: result.rows });
  }

  @Post()
  create(@Body() dto: CreateBillingPackageDto) {
    return ok({ created: dto });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateBillingPackageDto>) {
    return ok({ id, changes: dto });
  }
}

@Module({
  controllers: [BillingController]
})
export class BillingModule {}
