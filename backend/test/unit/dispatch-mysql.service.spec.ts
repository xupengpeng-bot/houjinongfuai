import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { DispatchMysqlService } from '../../src/modules/dispatch-mysql/dispatch-mysql.service';

describe('DispatchMysqlService', () => {
  it('getTeamCurrent throws when dispatch MySQL is not configured', async () => {
    const config = {
      get: (key: string) => {
        if (key === 'DISPATCH_DB_ENABLED') return 'false';
        return undefined;
      }
    } as unknown as ConfigService;
    const svc = new DispatchMysqlService(config);
    await expect(svc.getTeamCurrent('cursor')).rejects.toThrow(ServiceUnavailableException);
  });
});
