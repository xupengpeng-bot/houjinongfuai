/**
 * Spatial location v1 — aligns with `docs/uat/location-model-v1.md`.
 * Effective coordinates are the only map/list default; canvas edits are not persisted truth.
 */

import {
  SPATIAL_LOCATION_LAYERS_CONTRACT_V1,
  type SpatialLocationLayersContractV1
} from './spatial-location-semantics';

export type LocationSourceStrategy =
  | 'manual_preferred'
  | 'reported_preferred'
  | 'manual_only'
  | 'reported_only'
  | 'auto';

export type EffectiveSpatialSource = 'manual' | 'reported' | 'none';

export interface LatLng {
  lat: number | null;
  lng: number | null;
}

function pairComplete(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
}

/**
 * Resolves which coordinate pair is authoritative for maps and list defaults.
 */
export function resolveEffectiveLocation(params: {
  strategy: string | null | undefined;
  manual: LatLng;
  reported: LatLng;
}): { lat: number | null; lng: number | null; source: EffectiveSpatialSource } {
  const s = (params.strategy ?? 'manual_preferred') as LocationSourceStrategy;
  const m = params.manual;
  const r = params.reported;
  const mOk = pairComplete(m.lat, m.lng);
  const rOk = pairComplete(r.lat, r.lng);

  switch (s) {
    case 'manual_only':
      return mOk ? { lat: m.lat, lng: m.lng, source: 'manual' } : { lat: null, lng: null, source: 'none' };
    case 'reported_only':
      return rOk ? { lat: r.lat, lng: r.lng, source: 'reported' } : { lat: null, lng: null, source: 'none' };
    case 'reported_preferred':
    case 'auto':
      if (rOk) return { lat: r.lat, lng: r.lng, source: 'reported' };
      if (mOk) return { lat: m.lat, lng: m.lng, source: 'manual' };
      return { lat: null, lng: null, source: 'none' };
    case 'manual_preferred':
    default:
      if (mOk) return { lat: m.lat, lng: m.lng, source: 'manual' };
      if (rOk) return { lat: r.lat, lng: r.lng, source: 'reported' };
      return { lat: null, lng: null, source: 'none' };
  }
}

/** Postgres CASE for asset table alias `a` — keep in sync with {@link resolveEffectiveLocation}. */
export const ASSET_EFFECTIVE_LATITUDE_SQL = `
  CASE coalesce(a.location_source_strategy, 'manual_preferred')
    WHEN 'manual_only' THEN
      CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL
        THEN a.manual_latitude::float8 ELSE NULL END
    WHEN 'reported_only' THEN
      CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL
        THEN a.reported_latitude::float8 ELSE NULL END
    WHEN 'reported_preferred' THEN
      COALESCE(
        CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL
          THEN a.reported_latitude::float8 END,
        CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL
          THEN a.manual_latitude::float8 END
      )
    WHEN 'auto' THEN
      COALESCE(
        CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL
          THEN a.reported_latitude::float8 END,
        CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL
          THEN a.manual_latitude::float8 END
      )
    ELSE
      COALESCE(
        CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL
          THEN a.manual_latitude::float8 END,
        CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL
          THEN a.reported_latitude::float8 END
      )
  END
`.trim();

export const ASSET_EFFECTIVE_LONGITUDE_SQL = `
  CASE coalesce(a.location_source_strategy, 'manual_preferred')
    WHEN 'manual_only' THEN
      CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL
        THEN a.manual_longitude::float8 ELSE NULL END
    WHEN 'reported_only' THEN
      CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL
        THEN a.reported_longitude::float8 ELSE NULL END
    WHEN 'reported_preferred' THEN
      COALESCE(
        CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL
          THEN a.reported_longitude::float8 END,
        CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL
          THEN a.manual_longitude::float8 END
      )
    WHEN 'auto' THEN
      COALESCE(
        CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL
          THEN a.reported_longitude::float8 END,
        CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL
          THEN a.manual_longitude::float8 END
      )
    ELSE
      COALESCE(
        CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL
          THEN a.manual_longitude::float8 END,
        CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL
          THEN a.reported_longitude::float8 END
      )
  END
`.trim();

export const ASSET_EFFECTIVE_SOURCE_SQL = `
  CASE coalesce(a.location_source_strategy, 'manual_preferred')
    WHEN 'manual_only' THEN
      CASE WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL THEN 'manual' ELSE NULL END
    WHEN 'reported_only' THEN
      CASE WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL THEN 'reported' ELSE NULL END
    WHEN 'reported_preferred' THEN
      CASE
        WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL THEN 'reported'
        WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL THEN 'manual'
        ELSE NULL
      END
    WHEN 'auto' THEN
      CASE
        WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL THEN 'reported'
        WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL THEN 'manual'
        ELSE NULL
      END
    ELSE
      CASE
        WHEN a.manual_latitude IS NOT NULL AND a.manual_longitude IS NOT NULL THEN 'manual'
        WHEN a.reported_latitude IS NOT NULL AND a.reported_longitude IS NOT NULL THEN 'reported'
        ELSE NULL
      END
  END
`.trim();

export const MAP_TRUTH_NOTICE =
  'map_and_list_defaults_use_effective_*_only; temporary_map_canvas_coordinates_are_not_persisted_truth';

export interface SpatialLocationReadModelV1 {
  truthKind: 'spatial_location_v1';
  entity: 'asset' | 'device';
  /** Static taxonomy: truth input vs derived vs map display vs downstream refs. */
  layersContract: SpatialLocationLayersContractV1;
  layers: {
    manual: {
      latitude: number | null;
      longitude: number | null;
      region_id?: string | null;
      address_text?: string | null;
    };
    reported: {
      latitude: number | null;
      longitude: number | null;
      reported_at?: string | null;
      reported_source?: string | null;
    };
  };
  effective: {
    latitude: number | null;
    longitude: number | null;
    source: string | null;
  };
  strategy: string | null;
  mapDisplay: {
    latitude: number | null;
    longitude: number | null;
    usesField: 'effective';
  };
  mapTruthNotice: string;
}

export function buildSpatialLocationReadModelAsset(row: {
  manual_region_id?: string | null;
  manual_address_text?: string | null;
  manual_latitude: number | null;
  manual_longitude: number | null;
  reported_latitude: number | null;
  reported_longitude: number | null;
  reported_at?: string | null;
  reported_source?: string | null;
  location_source_strategy: string | null;
  effective_latitude: number | null;
  effective_longitude: number | null;
  effective_location_source: string | null;
}): SpatialLocationReadModelV1 {
  return {
    truthKind: 'spatial_location_v1',
    entity: 'asset',
    layersContract: SPATIAL_LOCATION_LAYERS_CONTRACT_V1,
    layers: {
      manual: {
        latitude: row.manual_latitude,
        longitude: row.manual_longitude,
        region_id: row.manual_region_id ?? null,
        address_text: row.manual_address_text ?? null
      },
      reported: {
        latitude: row.reported_latitude,
        longitude: row.reported_longitude,
        reported_at: row.reported_at ?? null,
        reported_source: row.reported_source ?? null
      }
    },
    effective: {
      latitude: row.effective_latitude,
      longitude: row.effective_longitude,
      source: row.effective_location_source
    },
    strategy: row.location_source_strategy,
    mapDisplay: {
      latitude: row.effective_latitude,
      longitude: row.effective_longitude,
      usesField: 'effective'
    },
    mapTruthNotice: MAP_TRUTH_NOTICE
  };
}

export function buildSpatialLocationReadModelDevice(row: {
  manual_region_id: string | null;
  manual_address_text: string | null;
  manual_latitude: number | null;
  manual_longitude: number | null;
  reported_latitude: number | null;
  reported_longitude: number | null;
  reported_at: string | null;
  reported_source: string | null;
  location_source_strategy: string | null;
  effective_latitude: number | null;
  effective_longitude: number | null;
  effective_location_source: string | null;
}): SpatialLocationReadModelV1 {
  return {
    truthKind: 'spatial_location_v1',
    entity: 'device',
    layersContract: SPATIAL_LOCATION_LAYERS_CONTRACT_V1,
    layers: {
      manual: {
        latitude: row.manual_latitude,
        longitude: row.manual_longitude,
        region_id: row.manual_region_id,
        address_text: row.manual_address_text
      },
      reported: {
        latitude: row.reported_latitude,
        longitude: row.reported_longitude,
        reported_at: row.reported_at,
        reported_source: row.reported_source
      }
    },
    effective: {
      latitude: row.effective_latitude,
      longitude: row.effective_longitude,
      source: row.effective_location_source
    },
    strategy: row.location_source_strategy,
    mapDisplay: {
      latitude: row.effective_latitude,
      longitude: row.effective_longitude,
      usesField: 'effective'
    },
    mapTruthNotice: MAP_TRUTH_NOTICE
  };
}
