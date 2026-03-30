import { Body, Controller, Get, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';
import { AuthLoginDto } from './auth.dto';

@Controller('auth')
class AuthController {
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() _body: AuthLoginDto) {
    return ok({
      token: 'phase1-dev-token',
      accessToken: 'phase1-dev-token',
      refreshToken: 'phase1-refresh-token'
    });
  }

  @Post('logout')
  logout() {
    return ok({ success: true });
  }

  @Get('me')
  me() {
    return ok({
      id: '00000000-0000-0000-0000-000000000102',
      userId: '00000000-0000-0000-0000-000000000102',
      name: 'Demo Manager',
      role: 'project_manager',
      area: 'Demo Project',
      roles: ['project_manager'],
      dataScopes: []
    });
  }

  @Get('profile')
  profile() {
    return ok({
      id: '00000000-0000-0000-0000-000000000102',
      name: 'Demo Manager',
      role: 'project_manager',
      area: 'Demo Project'
    });
  }

  @Get('menus')
  menus() {
    return ok({ items: [] });
  }
}

@Module({
  controllers: [AuthController]
})
export class AuthModule {}
