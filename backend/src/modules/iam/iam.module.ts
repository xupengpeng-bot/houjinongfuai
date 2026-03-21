import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

interface CreateUserDto {
  displayName: string;
  mobile: string;
  userType: string;
}

interface AssignRolesDto {
  roleIds: string[];
}

@Controller('system')
class IamController {
  @Get('users')
  listUsers() {
    return ok({ items: [] });
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return ok({ created: dto });
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: Partial<CreateUserDto>) {
    return ok({ id, changes: dto });
  }

  @Post('users/:id/roles')
  assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto) {
    return ok({ id, roles: dto.roleIds });
  }

  @Get('roles')
  listRoles() {
    return ok({ items: [] });
  }

  @Get('permissions')
  listPermissions() {
    return ok({ items: [] });
  }
}

@Module({
  controllers: [IamController]
})
export class IamModule {}
