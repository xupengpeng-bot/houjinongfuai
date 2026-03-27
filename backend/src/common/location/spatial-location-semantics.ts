import { HttpException, HttpStatus } from '@nestjs/common';

/** Keys that must never appear on ordinary ops POST/PUT bodies (manual layer only for form truth). */
export const FORBIDDEN_SPATIAL_WRITE_KEYS = [
  'reported_latitude',
  'reported_longitude',
  'reported_at',
  'reported_source',
  'effective_latitude',
  'effective_longitude',
  'effective_location_source',
  'map_display_latitude',
  'map_display_longitude',
  'location_read_model'
] as const;

/**
 * Machine-readable contract: truth vs derived vs map display vs downstream references.
 * Static — safe to cache on the frontend.
 */
export const SPATIAL_LOCATION_LAYERS_CONTRACT_V1 = {
  version: 'spatial-location-layers-contract-v1',
  truth_input_layer: {
    description:
      'Only manual_* and location_source_strategy are writable via ordinary ops forms (asset/device POST/PUT).',
    fields: {
      asset: [
        'manual_region_id',
        'manual_address_text',
        'manual_latitude',
        'manual_longitude',
        'install_position_desc',
        'location_source_strategy'
      ],
      device: [
        'manual_region_id',
        'manual_address_text',
        'manual_latitude',
        'manual_longitude',
        'install_position_desc',
        'location_source_strategy'
      ]
    }
  },
  read_only_derived_layer: {
    description:
      'reported_* is written only by telemetry ingestion or trusted import; effective_* is computed by the backend from strategy and must not be written by clients.',
    fields: [
      'reported_latitude',
      'reported_longitude',
      'reported_at',
      'reported_source',
      'effective_latitude',
      'effective_longitude',
      'effective_location_source'
    ]
  },
  map_and_list_display: {
    description:
      'Default map pins and list geo columns must use effective_* or map_display_* from API responses — not raw manual/reported, and never ad-hoc map canvas coordinates as persisted truth.',
    fields: ['effective_latitude', 'effective_longitude', 'map_display_latitude', 'map_display_longitude', 'location_read_model.mapDisplay']
  },
  downstream_stable_reference: {
    description:
      'Solver and network graph bind by published network_model_version_id; spatial truth for coordinates is effective_* — do not persist temporary map canvas coordinates as database truth.',
    fields: ['network_model_version_id (published graph)', 'effective_latitude', 'effective_longitude']
  },
  frontend_prohibitions: [
    'do_not_persist_map_canvas_coordinates_as_database_truth',
    'do_not_submit_reported_or_effective_fields_on_ordinary_ops_forms'
  ]
} as const;

export type SpatialLocationLayersContractV1 = typeof SPATIAL_LOCATION_LAYERS_CONTRACT_V1;

/**
 * Asset module uses interface DTOs (no class-validator whitelist). Reject any server-controlled spatial keys explicitly.
 * Device module uses class DTOs + forbidNonWhitelisted; this remains available for defense-in-depth or internal callers.
 */
export function assertNoForbiddenSpatialWriteKeys(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== 'object') return;
  const found: string[] = [];
  for (const k of FORBIDDEN_SPATIAL_WRITE_KEYS) {
    if (k in body && (body as Record<string, unknown>)[k] !== undefined) {
      found.push(k);
    }
  }
  if (found.length > 0) {
    throw new HttpException(
      {
        requestId: 'local-dev',
        code: 'SPATIAL_WRITE_BOUNDARY',
        message:
          'reported_*, effective_*, map_display_*, and location_read_model are server-controlled; not writable via ordinary ops forms',
        data: { forbiddenKeys: found }
      },
      HttpStatus.BAD_REQUEST
    );
  }
}
