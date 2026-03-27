import { HttpException } from '@nestjs/common';
import { assertNoForbiddenSpatialWriteKeys } from '../../src/common/location/spatial-location-semantics';

describe('spatial-location-semantics', () => {
  it('allows manual-only bodies', () => {
    expect(() =>
      assertNoForbiddenSpatialWriteKeys({
        manual_latitude: 1,
        manual_longitude: 2,
        location_source_strategy: 'manual_preferred'
      })
    ).not.toThrow();
  });

  it('rejects reported_* on ordinary write boundary', () => {
    expect(() =>
      assertNoForbiddenSpatialWriteKeys({
        manual_latitude: 1,
        reported_latitude: 3
      })
    ).toThrow(HttpException);
  });

  it('rejects effective_* on ordinary write boundary', () => {
    expect(() =>
      assertNoForbiddenSpatialWriteKeys({
        effective_latitude: 1
      })
    ).toThrow(HttpException);
  });
});
