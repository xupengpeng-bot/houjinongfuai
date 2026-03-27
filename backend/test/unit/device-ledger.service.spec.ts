import { DeviceLedgerService } from '../../src/modules/device-ledger/device-ledger.service';
import { DeviceLedgerRepository } from '../../src/modules/device-ledger/device-ledger.repository';

describe('DeviceLedgerService option helpers', () => {
  const svc = new DeviceLedgerService({} as DeviceLedgerRepository);

  it('displayStatusOptions matches ledger list semantics', () => {
    expect(svc.displayStatusOptions().map((o) => o.value)).toEqual(['online', 'offline', 'alarm']);
  });

  it('locationSourceStrategyOptions includes auto and four explicit strategies', () => {
    expect(svc.locationSourceStrategyOptions()).toHaveLength(5);
  });

  it('commIdentityTypeOptions has five kinds', () => {
    expect(svc.commIdentityTypeOptions()).toHaveLength(5);
  });
});
