import { Controller, Get, Module, Post } from '@nestjs/common';
import { ok } from '../../common/http/api-response';

@Controller('auth')
class AuthController {
  @Post('login')
  login() {
    return ok({ accessToken: 'todo', refreshToken: 'todo' });
  }

  @Post('logout')
  logout() {
    return ok({ success: true });
  }

  @Get('me')
  me() {
    return ok({
      userId: 'todo',
      roles: ['project_manager'],
      dataScopes: []
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
