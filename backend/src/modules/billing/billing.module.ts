import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
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
  @Get()
  list() {
    return ok({ items: [] });
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
