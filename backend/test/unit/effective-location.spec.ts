import { resolveEffectiveLocation } from '../../src/common/location/effective-location';

describe('effective-location', () => {
  const manual = { lat: 1 as number, lng: 2 as number };
  const reported = { lat: 3 as number, lng: 4 as number };

  it('manual_preferred uses manual when complete', () => {
    const r = resolveEffectiveLocation({
      strategy: 'manual_preferred',
      manual,
      reported
    });
    expect(r.source).toBe('manual');
    expect(r.lat).toBe(1);
  });

  it('manual_preferred falls back to reported when manual incomplete', () => {
    const r = resolveEffectiveLocation({
      strategy: 'manual_preferred',
      manual: { lat: null, lng: 2 },
      reported
    });
    expect(r.source).toBe('reported');
    expect(r.lat).toBe(3);
  });

  it('reported_preferred prefers reported', () => {
    const r = resolveEffectiveLocation({
      strategy: 'reported_preferred',
      manual,
      reported
    });
    expect(r.source).toBe('reported');
    expect(r.lat).toBe(3);
  });

  it('auto matches reported_preferred', () => {
    const r = resolveEffectiveLocation({
      strategy: 'auto',
      manual,
      reported
    });
    expect(r.source).toBe('reported');
  });
});
