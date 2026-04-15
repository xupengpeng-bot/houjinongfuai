import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import iconv from 'iconv-lite';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { DeviceGatewayMaintainerService } from '../device-gateway/device-gateway-maintainer.service';
import { DeviceGatewayService } from '../device-gateway/device-gateway.service';
import { TcpJsonV1Server } from '../device-gateway/tcp-json-v1.server';
import { SolverService } from '../solver/solver.service';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

type WorkbenchSaveConfigInput = {
  project_id?: string;
  block_id?: string;
  version_id?: string;
  source_name?: string;
  source_kind?: string;
  source_file_ref?: string;
  map_provider?: string;
  layer_hint?: string;
  relation_strategy?: string;
  notes?: string;
  publish?: boolean;
  auto_generate_relations?: boolean;
  layer_mapping?: WorkbenchLayerMapping;
  graph_draft?: WorkbenchGraphDraft;
};

type WorkbenchLayerMapping = {
  well_layer?: string | null;
  pump_layer?: string | null;
  valve_layer?: string | null;
  pipe_layer?: string | null;
  outlet_layer?: string | null;
  sensor_layer?: string | null;
};

type SimulatorScriptInput = {
  project_id?: string;
  block_id?: string;
  pump_valve_relation_id?: string;
  session_ref?: string;
  imei_prefix?: string;
};

type RelationGenerationResult = {
  scanned_pump_valve_relations: number;
  created_relation_count: number;
  updated_relation_count: number;
  created_relation_ids: string[];
  updated_relation_ids: string[];
  device_relations: {
    total: number;
    auto_generated_total: number;
    items: any[];
  };
  readiness: {
    ready: boolean;
    blockers: string[];
    next_actions: string[];
  };
};

type WorkbenchModelVersionSummary = {
  id: string;
  block_id: string | null;
  version_no: number;
  is_published: boolean;
  published_at: string | null;
  source_file_ref: string | null;
  source_meta: Record<string, unknown>;
  created_at: string | null;
  node_count: number;
  pipe_count: number;
};

type WorkbenchGraphDraftNode = {
  node_code?: string;
  node_name?: string | null;
  node_type?: string;
  asset_id?: string | null;
  asset_ids?: string[];
  device_ids?: string[];
  node_params?: Record<string, string | number | null> | null;
  pump_units?: Array<{
    unit_code?: string;
    unit_name?: string | null;
    enabled?: boolean;
    rated_flow_m3h?: number | string | null;
    rated_head_m?: number | string | null;
    rated_power_kw?: number | string | null;
    source_node_code?: string | null;
    intake_node_code?: string | null;
    well_node_code?: string | null;
    device_role?: string | null;
    asset_ids?: string[];
    device_ids?: string[];
  }>;
  cad_x?: number | string | null;
  cad_y?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  altitude?: number | string | null;
};

type WorkbenchGraphDraftPipe = {
  pipe_code?: string;
  pipe_type?: string;
  from_node_code?: string;
  to_node_code?: string;
  length_m?: number | string | null;
  diameter_mm?: number | string | null;
  geometry_points?: Array<{
    x?: number | string | null;
    y?: number | string | null;
    z?: number | string | null;
  }>;
};

type WorkbenchGraphDraft = {
  import_mode?: string;
  overwrite_existing?: boolean;
  nodes?: WorkbenchGraphDraftNode[];
  pipes?: WorkbenchGraphDraftPipe[];
};

type DraftBoundDeviceRow = {
  id: string;
  device_code: string | null;
  device_name: string | null;
  asset_id: string | null;
  asset_name: string | null;
  asset_type: string | null;
  type_code: string | null;
  type_name: string | null;
  lifecycle_state: string | null;
};

type DraftReachableValveEndpoint = {
  node: WorkbenchGraphDraftNode;
  node_code: string;
  endpoint_type: 'valve' | 'outlet';
  valve_device: DraftBoundDeviceRow;
};

type GraphMaterializationResult = {
  version_id: string;
  graph_source: string;
  generated_node_count: number;
  generated_pipe_count: number;
  replaced_existing_graph: boolean;
  generated_from_relation_count: number;
  has_coordinates: boolean;
};

type WorkbenchSourcePreviewInput = {
  project_id?: string;
  block_id?: string;
  source_kind?: string;
  source_file_ref?: string;
  map_provider?: string;
  layer_hint?: string;
  layer_mapping?: WorkbenchLayerMapping;
  graph_draft?: WorkbenchGraphDraft;
};

type WorkbenchUploadSourceInput = {
  project_id?: string;
  block_id?: string;
  source_kind?: string;
};

type WorkbenchUploadedFile = {
  buffer: Buffer;
  originalname?: string;
  size?: number;
};

type WorkbenchSourcePreviewResult = {
  source_ref: string | null;
  resolved_source_ref: string | null;
  parser_mode: string;
  source_kind: string;
  file_exists: boolean;
  file_name: string | null;
  file_size_bytes: number | null;
  file_digest: string | null;
  detected_layers: string[];
  suggested_layer_mapping: WorkbenchLayerMapping;
  import_contract: {
    supports_direct_graph: boolean;
    requires_layer_mapping: boolean;
    accepted_formats: string[];
    sidecar_manifest_ref: string | null;
    next_step: string;
  };
  graph_preview: {
    node_count: number;
    pipe_count: number;
    has_coordinates: boolean;
    sample_nodes: Array<{
      node_code: string;
      node_type: string;
      latitude: number | null;
      longitude: number | null;
    }>;
    sample_pipes: Array<{
      pipe_code: string;
      pipe_type: string;
      from_node_code: string;
      to_node_code: string;
    }>;
    node_type_counts: Record<string, number>;
    /** 供前端地图绘制（与 DB id 无关，用 node_code 关联管段） */
    map_nodes: Array<{
      node_code: string;
      node_type: string;
      latitude: number | null;
      longitude: number | null;
    }>;
    map_pipes: Array<{
      pipe_code: string;
      pipe_type: string;
      from_node_code: string;
      to_node_code: string;
    }>;
  } | null;
  /** 与 QGIS/Leaflet 类似：完整 GeoJSON 要素用于前端平面预览（图纸坐标系，非经纬度底图） */
  display_geojson: Record<string, unknown> | null;
  readiness: {
    ready: boolean;
    blockers: string[];
    next_actions: string[];
  };
};

type WorkbenchUploadedSource = {
  storage_mode: 'backend_managed_upload';
  source_kind: string;
  source_file_ref: string;
  source_file_name: string;
  source_file_size_bytes: number;
  source_file_digest: string;
  sidecar_manifest_ref: string | null;
  sidecar_file_name: string | null;
  uploaded_at: string;
  next_step: string;
};

type WorkbenchHandoffPackage = {
  handoff_version: string;
  selector_options: {
    projects: any[];
    blocks: any[];
    selected_block: any | null;
  };
  scope: {
    project_id: string | null;
    project_name: string | null;
    block_id: string | null;
    block_name: string | null;
    block_code: string | null;
  };
  config_readiness: {
    ready: boolean;
    blockers: string[];
    next_actions: string[];
  };
  network_model: {
    model_id: string | null;
    model_name: string | null;
    source_type: string | null;
    published_version: Record<string, unknown> | null;
    graph_stats: {
      node_count: number;
      pipe_count: number;
      with_coordinates_count: number;
    };
    source_import: {
      parser_mode: string | null;
      source_kind: string | null;
      map_provider: string | null;
      relation_strategy: string | null;
      source_file_ref: string | null;
      source_file_name: string | null;
      source_file_digest: string | null;
      sidecar_manifest_ref: string | null;
      detected_layers: string[];
      layer_mapping: WorkbenchLayerMapping;
      import_next_step: string | null;
    };
  };
  topology: {
    pump_valve_relations: {
      total: number;
      default_relation_id: string | null;
      items: any[];
    };
    device_relations: {
      total: number;
      auto_generated_total: number;
      items: any[];
    };
  };
  dispatch_runtime: {
    scheduling_params: Record<string, unknown>;
    runtime_summary: Record<string, unknown>;
    solver: Record<string, unknown>;
    simulator: Record<string, unknown>;
  };
  gateway_observability: {
    recent_events: Array<Record<string, unknown>>;
    pending_commands?: Array<Record<string, unknown>>;
    pending_queue_total?: number;
    queue_health?: Record<string, unknown>;
    connection_health?: Record<string, unknown>;
    recovery_health?: Record<string, unknown>;
    recovery_recommendations?: Record<string, unknown>;
    recent_dead_letters?: Array<Record<string, unknown>>;
  };
  embedded_contract: {
    backend_truth_rule: string;
    interface_owner: string;
    device_protocol: Record<string, unknown>;
    backend_endpoints: {
      config: string;
      graph: string;
      dispatch: string;
      handoff_package: string;
      generate_relations: string;
      solver_preview: string;
      simulator_preview: string;
      simulator_script: string;
      runtime_event_ingest?: string;
      gateway_events?: string;
      gateway_queue_command?: string;
      gateway_pending_commands?: string;
      gateway_queue_health?: string;
      gateway_connection_health?: string;
      gateway_recovery_health?: string;
      gateway_recovery_recommendations?: string;
      gateway_bridge_connect?: string;
      gateway_bridge_heartbeat?: string;
      gateway_bridge_disconnect?: string;
      gateway_dead_letters?: string;
      gateway_sweep_retries?: string;
      gateway_sweep_connections?: string;
      gateway_manual_requeue?: string;
    };
    expectations: string[];
  };
  solver_preview: Record<string, unknown> | null;
  simulator_script: Record<string, unknown> | null;
};

type ResolvedSourceImport = WorkbenchSourcePreviewResult & {
  graph_draft: WorkbenchGraphDraft | null;
  normalized_layer_mapping: WorkbenchLayerMapping;
  sidecar_resolved_path: string | null;
};

@Injectable()
export class NetworkWorkbenchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: DeviceGatewayService,
    private readonly gatewayMaintainer: DeviceGatewayMaintainerService,
    private readonly tcpServer: TcpJsonV1Server,
    private readonly solver: SolverService
  ) {}

  private toIso(value: Date | string | null | undefined) {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private normalizeModelVersionRow(row: any): WorkbenchModelVersionSummary {
    return {
      id: row.id,
      block_id: row.block_id ?? null,
      version_no: Number(row.version_no ?? 0),
      is_published: Boolean(row.is_published),
      published_at: this.toIso(row.published_at),
      source_file_ref: row.source_file_ref ?? null,
      source_meta: this.asObject(row.source_meta_json),
      created_at: this.toIso(row.created_at),
      node_count: Number(row.node_count ?? 0),
      pipe_count: Number(row.pipe_count ?? 0)
    };
  }

  private hasUsableGraph(version: Pick<WorkbenchModelVersionSummary, 'node_count' | 'pipe_count'> | null | undefined) {
    return Boolean(version && version.node_count > 0 && version.pipe_count > 0);
  }

  private isCurrentDraft(
    version: Pick<WorkbenchModelVersionSummary, 'is_published' | 'published_at'> | null | undefined,
  ) {
    return Boolean(version && !version.is_published && !version.published_at);
  }

  private getVersionBlockId(
    version: Pick<WorkbenchModelVersionSummary, 'block_id' | 'source_meta'> | null | undefined,
  ): string | null {
    const relationalBlockId =
      typeof version?.block_id === 'string'
        ? version.block_id.trim()
        : '';
    if (relationalBlockId) return relationalBlockId;
    const sourceMeta = this.asObject(version?.source_meta);
    const blockId = typeof sourceMeta.block_id === 'string' ? sourceMeta.block_id.trim() : '';
    return blockId || null;
  }

  private filterVersionsForBlock(
    versions: WorkbenchModelVersionSummary[],
    preferredBlockId?: string | null,
    fallbackToAnyBlock = true,
  ) {
    const blockId = preferredBlockId?.trim();
    if (!blockId) return versions;
    const scopedVersions = versions.filter((item) => this.getVersionBlockId(item) === blockId);
    if (scopedVersions.length > 0) return scopedVersions;
    return fallbackToAnyBlock ? versions : [];
  }

  private isVersionInBlockScope(
    version: Pick<WorkbenchModelVersionSummary, 'block_id' | 'source_meta'> | null | undefined,
    preferredBlockId?: string | null,
  ) {
    const blockId = preferredBlockId?.trim();
    if (!blockId) return true;
    return this.getVersionBlockId(version) === blockId;
  }

  private pickVersionForConfig(
    versions: WorkbenchModelVersionSummary[],
    preferredVersionId?: string | null,
    options?: { preferredBlockId?: string | null; fallbackToAnyBlock?: boolean },
  ): WorkbenchModelVersionSummary | null {
    if (preferredVersionId) {
      const explicit = versions.find(
        (item) => item.id === preferredVersionId && this.isVersionInBlockScope(item, options?.preferredBlockId),
      );
      if (explicit) return explicit;
    }

    const candidates = this.filterVersionsForBlock(
      versions,
      options?.preferredBlockId,
      options?.fallbackToAnyBlock ?? true,
    );
    return (
      candidates.find((item) => item.is_published && this.hasUsableGraph(item)) ??
      candidates.find((item) => this.hasUsableGraph(item)) ??
      candidates.find((item) => item.is_published) ??
      candidates.find((item) => this.isCurrentDraft(item)) ??
      candidates.find((item) => !item.is_published) ??
      candidates[0] ??
      null
    );
  }

  private pickDraftVersionForSave(
    versions: WorkbenchModelVersionSummary[],
    preferredBlockId?: string | null,
  ): WorkbenchModelVersionSummary | null {
    const candidates = this.filterVersionsForBlock(versions, preferredBlockId, false);
    return candidates.find((item) => this.isCurrentDraft(item)) ?? null;
  }

  private pickExplicitDraftVersionForSave(
    versions: WorkbenchModelVersionSummary[],
    preferredVersionId?: string | null,
    preferredBlockId?: string | null,
  ): WorkbenchModelVersionSummary | null {
    const versionId = preferredVersionId?.trim();
    if (!versionId) return null;
    return (
      versions.find(
        (item) =>
          item.id === versionId &&
          this.isCurrentDraft(item) &&
          this.isVersionInBlockScope(item, preferredBlockId),
      ) ?? null
    );
  }

  private buildSourceMeta(input: WorkbenchSaveConfigInput, selectedBlockId: string | null) {
    return {
      source_name: input.source_name?.trim() || '未命名图源',
      source_kind: input.source_kind?.trim() || 'dwg',
      map_provider: input.map_provider?.trim() || 'manual_upload',
      layer_hint: input.layer_hint?.trim() || 'main-network',
      relation_strategy: input.relation_strategy?.trim() || 'pump_chain_auto',
      block_id: selectedBlockId,
      notes: input.notes?.trim() || null,
      saved_from: 'network_workbench',
      saved_at: new Date().toISOString()
    };
  }

  private buildNormalizedSourceMeta(input: WorkbenchSaveConfigInput, selectedBlockId: string | null): Record<string, unknown> {
    return {
      source_name: input.source_name?.trim() || 'Network Source',
      source_kind: input.source_kind?.trim() || 'dwg',
      map_provider: input.map_provider?.trim() || 'manual_upload',
      layer_hint: input.layer_hint?.trim() || 'main-network',
      layer_mapping: this.normalizeLayerMapping(input.layer_mapping),
      relation_strategy: input.relation_strategy?.trim() || 'pump_chain_auto',
      block_id: selectedBlockId,
      notes: input.notes?.trim() || null,
      saved_from: 'network_workbench',
      saved_at: new Date().toISOString()
    };
  }

  private toNullableNumber(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
      .filter(Boolean);
  }

  private normalizeNodeParams(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      if (typeof item === 'string' || typeof item === 'number' || item === null) {
        return [[key, item] as const];
      }
      return [];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  }

  private isSourceStationNodeType(nodeType: unknown) {
    const normalized = this.sanitizeCode(nodeType, '').toLowerCase();
    return normalized === 'source_station' || normalized === 'well' || normalized === 'pump';
  }

  private normalizeSourceKind(value: unknown, fallback: string = 'groundwater') {
    const normalized = String(value ?? '').trim().toLowerCase();
    switch (normalized) {
      case 'groundwater':
      case 'well':
      case 'jijing':
        return 'groundwater';
      case 'river':
        return 'river';
      case 'pond':
        return 'pond';
      case 'canal':
        return 'canal';
      case 'reservoir':
        return 'reservoir';
      case 'surface':
      case 'surface_water':
      case 'surfacewater':
      case 'pump_station':
      case 'pumpstation':
        return 'surface_water';
      default:
        return fallback;
    }
  }

  private normalizeDraftNodeType(nodeType: unknown) {
    return this.isSourceStationNodeType(nodeType)
      ? 'source_station'
      : this.sanitizeCode(nodeType, 'junction').toLowerCase();
  }

  private withNormalizedSourceStationParams(nodeType: unknown, nodeParams: Record<string, string | number | null> | null) {
    if (!this.isSourceStationNodeType(nodeType)) return nodeParams;
    const next = nodeParams ? { ...nodeParams } : {};
    next.source_kind = this.normalizeSourceKind(next.source_kind, this.normalizeSourceKind(nodeType, 'groundwater'));
    return next;
  }

  private normalizePumpUnits(value: unknown, nodeCode: string) {
    if (!Array.isArray(value)) return [];
    return value.map((item, index) => {
      const unit = this.asObject(item);
      return {
        unit_code: this.sanitizeCode(unit.unit_code, `${nodeCode}-P${index + 1}`),
        unit_name: typeof unit.unit_name === 'string' ? unit.unit_name.trim() || null : null,
        enabled: typeof unit.enabled === 'boolean' ? unit.enabled : true,
        rated_flow_m3h: this.toNullableNumber(unit.rated_flow_m3h),
        rated_head_m: this.toNullableNumber(unit.rated_head_m),
        rated_power_kw: this.toNullableNumber(unit.rated_power_kw),
        source_node_code:
          typeof unit.source_node_code === 'string' && unit.source_node_code.trim()
            ? this.sanitizeCode(unit.source_node_code, '')
            : null,
        intake_node_code:
          typeof unit.intake_node_code === 'string' && unit.intake_node_code.trim()
            ? this.sanitizeCode(unit.intake_node_code, '')
            : null,
        well_node_code:
          typeof unit.well_node_code === 'string' && unit.well_node_code.trim()
            ? this.sanitizeCode(unit.well_node_code, '')
            : null,
        device_role: typeof unit.device_role === 'string' ? unit.device_role.trim() || null : null,
        asset_ids: this.normalizeStringArray(unit.asset_ids),
        device_ids: this.normalizeStringArray(unit.device_ids)
      };
    });
  }

  private normalizePipeGeometryPoints(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const points = value
      .map((item) => {
        const point = this.asObject(item);
        const x = this.toNullableNumber(point.x);
        const y = this.toNullableNumber(point.y);
        const z = this.toNullableNumber(point.z);
        if (x === null || y === null) return null;
        return { x, y, z };
      })
      .filter((item): item is { x: number; y: number; z: number | null } => item !== null);
    return points.length >= 2 ? points : undefined;
  }

  private sanitizeCode(value: unknown, fallback: string) {
    const text = typeof value === 'string' ? value.trim() : '';
    const normalized = text.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized || fallback;
  }

  private ensureUniqueCode(baseCode: string, usedCodes: Set<string>, fallbackPrefix: string, index: number) {
    const normalized = baseCode.trim() || `${fallbackPrefix}_${index + 1}`;
    if (!usedCodes.has(normalized)) {
      usedCodes.add(normalized);
      return normalized;
    }

    let suffix = 2;
    let candidate = `${normalized}_${suffix}`;
    while (usedCodes.has(candidate)) {
      suffix += 1;
      candidate = `${normalized}_${suffix}`;
    }
    usedCodes.add(candidate);
    return candidate;
  }

  private buildGraphSourceMeta(
    sourceMeta: Record<string, unknown>,
    graphResult: GraphMaterializationResult,
    graphDraftSnapshot?: WorkbenchGraphDraft | null
  ): Record<string, unknown> {
    return {
      ...sourceMeta,
      graph_source: graphResult.graph_source,
      graph_node_count: graphResult.generated_node_count,
      graph_pipe_count: graphResult.generated_pipe_count,
      graph_generated_at: new Date().toISOString(),
      graph_has_coordinates: graphResult.has_coordinates,
      generated_from_relation_count: graphResult.generated_from_relation_count,
      ...(graphDraftSnapshot
        ? {
            graph_draft_snapshot: graphDraftSnapshot
          }
        : {})
    };
  }

  private sanitizePathSegment(value: string | null | undefined, fallback: string) {
    const normalized = (value ?? '')
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || fallback;
  }

  private inferSourceKind(fileName: string, preferredKind?: string | null) {
    const preferred = preferredKind?.trim();
    if (preferred && preferred !== 'auto') return preferred;

    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.dwg') return 'dwg';
    if (extension === '.geojson') return 'geojson';
    if (extension === '.json') return 'json';
    return 'dwg';
  }

  private getWorkbenchUploadRoot() {
    return path.resolve(process.cwd(), 'var', 'network-workbench', 'uploads');
  }

  private persistUploadedFile(file: WorkbenchUploadedFile, targetDir: string, fallbackName: string) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('uploaded source file is empty');
    }

    fs.mkdirSync(targetDir, { recursive: true });
    const digest = createHash('sha1').update(file.buffer).digest('hex');
    const parsed = path.parse(file.originalname || fallbackName);
    const safeBase = this.sanitizeCode(parsed.name || fallbackName, fallbackName).slice(0, 80);
    const safeExt = (parsed.ext || '').replace(/[^A-Za-z0-9.]+/g, '').slice(0, 16);
    const storedName = `${Date.now()}-${digest.slice(0, 12)}-${safeBase}${safeExt}`;
    const absolutePath = path.join(targetDir, storedName);

    fs.writeFileSync(absolutePath, file.buffer);

    return {
      absolute_path: absolutePath,
      source_file_ref: path.relative(process.cwd(), absolutePath).replace(/\\/g, '/'),
      file_name: file.originalname || storedName,
      file_size_bytes: file.size ?? file.buffer.length,
      file_digest: digest.slice(0, 16)
    };
  }

  private normalizeLayerMapping(mapping?: WorkbenchLayerMapping | null): WorkbenchLayerMapping {
    const normalize = (value: unknown) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed ? this.normalizeTextForWorkbenchStorage(trimmed) : null;
    };

    return {
      well_layer: normalize(mapping?.well_layer),
      pump_layer: normalize(mapping?.pump_layer),
      valve_layer: normalize(mapping?.valve_layer),
      pipe_layer: normalize(mapping?.pipe_layer),
      outlet_layer: normalize(mapping?.outlet_layer),
      sensor_layer: normalize(mapping?.sensor_layer)
    };
  }

  private readString(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private guessRoleFromLayerName(layerName: string | null) {
    if (!layerName) return null;
    const normalized = layerName.toLowerCase();
    if (normalized.includes('well') || normalized.includes('井')) return 'well';
    if (normalized.includes('pump') || normalized.includes('泵')) return 'pump';
    if (normalized.includes('valve') || normalized.includes('阀')) return 'valve';
    if (normalized.includes('pipe') || normalized.includes('line') || normalized.includes('管')) return 'pipe';
    if (normalized.includes('outlet') || normalized.includes('meter') || normalized.includes('出水')) return 'outlet';
    if (normalized.includes('sensor') || normalized.includes('probe') || normalized.includes('传感')) return 'sensor';
    return null;
  }

  private recommendLayerMapping(layerCandidates: string[], current?: WorkbenchLayerMapping | null): WorkbenchLayerMapping {
    const currentMapping = this.normalizeLayerMapping(current);
    const pick = (role: keyof WorkbenchLayerMapping, keywords: string[]) => {
      if (currentMapping[role]) return currentMapping[role];
      const matched = layerCandidates.find((item) => keywords.some((keyword) => item.toLowerCase().includes(keyword)));
      return matched ?? null;
    };

    return {
      well_layer: pick('well_layer', ['well', '井']),
      pump_layer: pick('pump_layer', ['pump', '泵']),
      valve_layer: pick('valve_layer', ['valve', '阀']),
      pipe_layer: pick('pipe_layer', ['pipe', 'line', '管']),
      outlet_layer: pick('outlet_layer', ['outlet', 'meter', '出水']),
      sensor_layer: pick('sensor_layer', ['sensor', 'probe', '传感'])
    };
  }

  private collectLayerCandidates(features: any[]) {
    const values = new Set<string>();
    for (const feature of features) {
      const props = this.asObject(feature?.properties);
      const layerName = this.readLayerNameFromFeatureProps(props);
      if (layerName) values.add(layerName);
    }
    return [...values];
  }

  private resolveDwgreadPath() {
    const candidates = [
      process.env.DWGREAD_PATH,
      process.env.DWG_PARSER_CMD,
      'D:\\Tools\\LibreDWG\\dwgread.exe',
      path.join(process.cwd(), 'Tools', 'LibreDWG', 'dwgread.exe'),
      path.join(process.cwd(), 'tools', 'LibreDWG', 'dwgread.exe'),
      path.join(process.cwd(), '..', '..', '..', '..', 'Tools', 'LibreDWG', 'dwgread.exe')
    ].filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));

    return candidates.find((item) => fs.existsSync(item)) ?? null;
  }

  /** Reads AutoCAD DWG magic version tag at file start (e.g. AC1032 ≈ 2018). */
  private readDwgFileVersionTag(filePath: string): string | null {
    try {
      const buf = fs.readFileSync(filePath).subarray(0, 16);
      const head = buf.toString('latin1');
      const m = head.match(/^AC10[0-9]{2}/);
      return m ? m[0] : null;
    } catch {
      return null;
    }
  }

  private dwgVersionUserHint(version: string | null): string {
    if (!version) return '';
    const v = version.toUpperCase();
    const newer = ['AC1032', 'AC1033', 'AC1034', 'AC1035'];
    if (newer.includes(v)) {
      return ` 该文件头为 ${version}（较新 DWG）。LibreDWG 对部分 AC1032+ 图纸仍可能失败；请在 AutoCAD / 浩辰等软件中「另存为」AutoCAD 2013 图形（*.dwg），或导出 GeoJSON/DXF 后作为同名 sidecar 上传。`;
    }
    return ` 文件头版本：${version}。`;
  }

  /**
   * 从可能含前置日志/尾部杂讯的文本中截取并解析第一个完整顶层 JSON 对象（花括号平衡，尊重字符串内引号）。
   */
  private tryParseFirstJsonObjectFromText(text: string): unknown | null {
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\' && inString) {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1)) as unknown;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  /**
   * dwgread 有时写出单个 Feature、Feature 数组，或非数组的 features；统一成 RFC 7946 FeatureCollection。
   */
  private coerceLibredwgOutputToFeatureCollection(parsed: unknown): {
    featureCollection: Record<string, unknown> | null;
    note: string | null;
  } {
    if (Array.isArray(parsed)) {
      const items = parsed as unknown[];
      if (items.length === 0) {
        return {
          featureCollection: { type: 'FeatureCollection', features: [] },
          note: '根节点为空数组，已规范为空 FeatureCollection。'
        };
      }
      if (items.every((item) => this.asObject(item).type === 'Feature')) {
        return {
          featureCollection: { type: 'FeatureCollection', features: items },
          note: '已将根节点从 Feature 数组规范为 FeatureCollection。'
        };
      }
      return { featureCollection: null, note: null };
    }

    const obj = this.asObject(parsed);
    const t = typeof obj.type === 'string' ? obj.type : '';

    if (t === 'FeatureCollection') {
      let features = obj.features;
      if (!Array.isArray(features)) {
        features = [];
      }
      return {
        featureCollection: { ...obj, type: 'FeatureCollection', features },
        note: Array.isArray(obj.features) ? null : 'features 非数组，已按空数组处理。'
      };
    }

    if (t === 'Feature') {
      return {
        featureCollection: { type: 'FeatureCollection', features: [obj] },
        note: '已将根节点从单个 Feature 规范为 FeatureCollection。'
      };
    }

    return { featureCollection: null, note: null };
  }

  /** 读取 dwgread 输出文件：严格 JSON 失败后按编码再试截取首个对象。 */
  private parseDwgreadGeoJsonOutputFile(outputPath: string):
    | { ok: true; parsed: unknown; lenient_note: string | null; head_preview: string }
    | { ok: false; parse_error_message: string | null; head_preview: string } {
    const buf = fs.readFileSync(outputPath);
    const headPreview = buf
      .subarray(0, Math.min(320, buf.length))
      .toString('utf8')
      .replace(/\s+/g, ' ')
      .trim();

    let parseErrorMessage: string | null = null;
    try {
      return {
        ok: true,
        parsed: this.parseJsonBufferAdaptive(buf),
        lenient_note: null,
        head_preview: headPreview
      };
    } catch (e) {
      parseErrorMessage = e instanceof Error ? e.message : String(e);
    }

    const body = this.stripUtf8BomFromBuffer(buf);
    const encodings: Array<'utf8' | 'gb18030' | 'gbk'> = ['utf8', 'gb18030', 'gbk'];
    for (const enc of encodings) {
      const text = enc === 'utf8' ? body.toString('utf8') : iconv.decode(body, enc);
      const trimmed = text.trim();
      try {
        return {
          ok: true,
          parsed: JSON.parse(trimmed) as unknown,
          lenient_note: null,
          head_preview: headPreview
        };
      } catch {
        /* continue */
      }
      const sliced = this.tryParseFirstJsonObjectFromText(text);
      if (sliced != null) {
        return {
          ok: true,
          parsed: sliced,
          lenient_note: `已忽略输出文件中的非 JSON 前后缀并从首个「{…}」对象解析（${enc}）。`,
          head_preview: headPreview
        };
      }
    }

    return {
      ok: false,
      parse_error_message: parseErrorMessage,
      head_preview: headPreview
    };
  }

  private parseRawDwgAsGeoJson(filePath: string) {
    const dwgVersion = this.readDwgFileVersionTag(filePath);
    const dwgreadPath = this.resolveDwgreadPath();
    if (!dwgreadPath) {
      return {
        parser_mode: 'dwg_binary_unavailable',
        feature_collection: null as Record<string, unknown> | null,
        error: 'raw_dwg_parser_not_available',
        dwg_version: dwgVersion,
        tool_stderr: null as string | null
      };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-workbench-dwg-'));
    const outputPath = path.join(tempDir, `${path.parse(filePath).name}.geojson`);

    try {
      const run = spawnSync(dwgreadPath, ['-O', 'GeoJSON', '-o', outputPath, filePath], {
        windowsHide: true,
        timeout: 120_000,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024
      });
      const stderrCombined = [run.stderr, run.stdout]
        .filter((s): s is string => typeof s === 'string' && Boolean(s.trim()))
        .join('\n')
        .trim()
        .slice(0, 2000);

      if (run.error) {
        return {
          parser_mode: 'dwg_binary_failed',
          feature_collection: null as Record<string, unknown> | null,
          error: 'raw_dwg_parser_execution_failed',
          dwg_version: dwgVersion,
          tool_stderr: `${run.error.message}\n${stderrCombined}`.trim().slice(0, 2000) || null
        };
      }

      if (run.status !== 0) {
        return {
          parser_mode: 'dwg_binary_failed',
          feature_collection: null as Record<string, unknown> | null,
          error: 'raw_dwg_parser_execution_failed',
          dwg_version: dwgVersion,
          tool_stderr:
            (stderrCombined || `dwgread 退出码 ${run.status ?? 'unknown'}`).slice(0, 2000) || null
        };
      }

      if (!fs.existsSync(outputPath)) {
        return {
          parser_mode: 'dwg_binary_failed',
          feature_collection: null as Record<string, unknown> | null,
          error: 'raw_dwg_parser_did_not_emit_output',
          dwg_version: dwgVersion,
          tool_stderr: stderrCombined || null
        };
      }

      const readResult = this.parseDwgreadGeoJsonOutputFile(outputPath);
      if (!readResult.ok) {
        const detail = [
          readResult.parse_error_message ? `JSON 解析：${readResult.parse_error_message}` : null,
          `输出文件开头（截断）：${readResult.head_preview || '(空)'}`
        ]
          .filter(Boolean)
          .join(' ');
        return {
          parser_mode: 'dwg_binary_failed',
          feature_collection: null as Record<string, unknown> | null,
          error: 'raw_dwg_parser_invalid_geojson',
          dwg_version: dwgVersion,
          tool_stderr: [stderrCombined || null, detail].filter(Boolean).join('\n').slice(0, 2000) || null
        };
      }

      const { featureCollection, note: coerceNote } = this.coerceLibredwgOutputToFeatureCollection(readResult.parsed);
      if (!featureCollection) {
        const root = this.asObject(readResult.parsed);
        const rootType = typeof root.type === 'string' ? root.type : Array.isArray(readResult.parsed) ? 'Array' : typeof readResult.parsed;
        const detail = `GeoJSON 根节点 type=${rootType}，无法规范为 FeatureCollection。输出开头：${readResult.head_preview || '(空)'}`;
        return {
          parser_mode: 'dwg_binary_failed',
          feature_collection: null as Record<string, unknown> | null,
          error: 'raw_dwg_parser_invalid_geojson',
          dwg_version: dwgVersion,
          tool_stderr: [stderrCombined || null, detail, readResult.lenient_note, coerceNote].filter(Boolean).join('\n').slice(0, 2000) || null
        };
      }

      const diagParts = [stderrCombined || null, readResult.lenient_note, coerceNote].filter(Boolean);
      return {
        parser_mode: 'dwg_libredwg_geojson',
        feature_collection: featureCollection,
        error: null,
        dwg_version: dwgVersion,
        tool_stderr: diagParts.length ? diagParts.join('\n').slice(0, 2000) : null
      };
    } catch {
      return {
        parser_mode: 'dwg_binary_failed',
        feature_collection: null as Record<string, unknown> | null,
        error: 'raw_dwg_parser_execution_failed',
        dwg_version: dwgVersion,
        tool_stderr: null as string | null
      };
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  }

  private resolveSourceFile(sourceFileRef?: string | null) {
    const sourceRef = sourceFileRef?.trim() || null;
    if (!sourceRef) {
      return {
        source_ref: null,
        resolved_source_ref: null,
        file_exists: false,
        file_name: null,
        file_size_bytes: null,
        file_digest: null,
        sidecar_manifest_ref: null,
        sidecar_resolved_path: null
      };
    }

    const resolved = path.isAbsolute(sourceRef) ? sourceRef : path.resolve(sourceRef);
    const exists = fs.existsSync(resolved);
    const stats = exists ? fs.statSync(resolved) : null;
    const digest =
      exists && stats?.isFile()
        ? createHash('sha1').update(fs.readFileSync(resolved)).digest('hex').slice(0, 16)
        : null;

    const parsed = path.parse(resolved);
    const candidates = [
      `${resolved}.import.json`,
      `${resolved}.layers.json`,
      `${parsed.dir}\\${parsed.name}.import.json`,
      `${parsed.dir}\\${parsed.name}.layers.json`,
      `${parsed.dir}\\${parsed.name}.manifest.json`,
      `${parsed.dir}\\${parsed.name}.geojson`,
      `${parsed.dir}\\${parsed.name}.json`
    ];
    const sidecarResolvedPath =
      candidates.find((candidate) => path.normalize(candidate) !== path.normalize(resolved) && fs.existsSync(candidate)) ??
      null;

    return {
      source_ref: sourceRef,
      resolved_source_ref: resolved,
      file_exists: Boolean(exists && stats?.isFile()),
      file_name: exists ? path.basename(resolved) : path.basename(sourceRef),
      file_size_bytes: exists && stats?.isFile() ? stats.size : null,
      file_digest: digest,
      sidecar_manifest_ref: sidecarResolvedPath ? path.relative(process.cwd(), sidecarResolvedPath) : null,
      sidecar_resolved_path: sidecarResolvedPath
    };
  }

  private resolveDownloadableWorkbenchSource(sourceFileRef?: string | null) {
    const fileInfo = this.resolveSourceFile(sourceFileRef);
    const resolved = fileInfo.resolved_source_ref ? path.resolve(fileInfo.resolved_source_ref) : null;
    const uploadRoot = path.resolve(this.getWorkbenchUploadRoot());
    if (!resolved || !fileInfo.file_exists) {
      throw new NotFoundException('source file not found');
    }
    const normalizedResolved = path.normalize(resolved);
    const normalizedUploadRoot = path.normalize(uploadRoot + path.sep);
    if (!normalizedResolved.startsWith(normalizedUploadRoot)) {
      throw new BadRequestException('source file ref is outside of workbench upload root');
    }
    return {
      absolute_path: normalizedResolved,
      file_name: fileInfo.file_name ?? path.basename(normalizedResolved),
    };
  }

  async downloadSourceFile(sourceFileRef?: string | null) {
    return this.resolveDownloadableWorkbenchSource(sourceFileRef);
  }

  private stripUtf8BomFromBuffer(buf: Buffer): Buffer {
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      return buf.subarray(3);
    }
    return buf;
  }

  /**
   * JSON 字节流自适应解码：UTF-8 → GB18030 → GBK（与 dwgread / 国产 CAD 侧车常见输出一致）。
   */
  private parseJsonBufferAdaptive(buf: Buffer): unknown {
    const body = this.stripUtf8BomFromBuffer(buf);
    const attempts: Array<{ label: string; text: string }> = [
      { label: 'utf8', text: body.toString('utf8') },
      { label: 'gb18030', text: iconv.decode(body, 'gb18030') },
      { label: 'gbk', text: iconv.decode(body, 'gbk') }
    ];
    let lastErr: Error | null = null;
    for (const { text } of attempts) {
      try {
        return JSON.parse(text) as unknown;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr ?? new Error('JSON parse failed for all encodings');
  }

  private parseJsonFile(filePath: string): unknown {
    const buf = fs.readFileSync(filePath);
    return this.parseJsonBufferAdaptive(buf);
  }

  /** GeoJSON / dwgread 输出：与 parseJsonFile 相同自适应策略 */
  private parseGeoJsonFileUtf8OrGb18030(filePath: string): unknown {
    return this.parseJsonBufferAdaptive(fs.readFileSync(filePath));
  }

  /**
   * 典型乱码：UTF-8 中文图层名被按 GB18030/GBK 解读（如「出水口及管网」→「鍑烘按鍙ｅ強绠＄綉」）。
   * 将乱码串按对应编码压回字节再按 UTF-8 解读可还原；真·本地中文经此变换后 round-trip 不一致，不会误伤。
   */
  private fixCadLabelUtf8MisreadAsGb18030(raw: string): string {
    const s = raw.trim();
    if (!s) return raw;
    for (const enc of ['gb18030', 'gbk'] as const) {
      try {
        const buf = iconv.encode(s, enc);
        const recovered = buf.toString('utf8');
        if (!recovered || recovered === s) continue;
        if (recovered.includes('\uFFFD')) continue;
        if (!Buffer.from(recovered, 'utf8').equals(buf)) continue;
        return recovered;
      } catch {
        continue;
      }
    }
    return raw;
  }

  /**
   * 入库/接口统一文本：CAD 乱码修复 + Unicode NFC（PostgreSQL jsonb 与前端均以 UTF-8 为准）。
   */
  private normalizeTextForWorkbenchStorage(raw: string): string {
    const repaired = this.fixCadLabelUtf8MisreadAsGb18030(raw.trim());
    try {
      return repaired.normalize('NFC');
    } catch {
      return repaired;
    }
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  /** 深度规范化 JSON 语义树中的全部字符串（用于 source_meta、graph_draft 落库前） */
  private deepNormalizeUnicodeStringsInJson<T>(value: T): T {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return this.normalizeTextForWorkbenchStorage(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.deepNormalizeUnicodeStringsInJson(item)) as T;
    if (this.isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = this.deepNormalizeUnicodeStringsInJson(v);
      }
      return out as T;
    }
    return value;
  }

  private readLayerNameFromFeatureProps(props: Record<string, unknown>): string | null {
    let layerName = this.readString(props, [
      'layer',
      'Layer',
      'LAYER',
      'layer_name',
      'LayerName',
      'cad_layer',
      'group',
      'category'
    ]);
    if (!layerName?.trim()) {
      for (const [k, v] of Object.entries(props)) {
        if (typeof v !== 'string' || !v.trim()) continue;
        if (k.toLowerCase().includes('layer')) {
          layerName = v.trim();
          break;
        }
      }
    }
    if (!layerName?.trim()) return null;
    return this.normalizeTextForWorkbenchStorage(layerName);
  }

  private simplifyRingCoords(ring: unknown[], maxPoints: number): unknown[] {
    if (ring.length <= maxPoints) return ring;
    const out: unknown[] = [];
    const n = ring.length;
    const step = (n - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints - 1; i += 1) {
      out.push(ring[Math.min(n - 1, Math.floor(i * step))]);
    }
    out.push(ring[n - 1]);
    return out;
  }

  private clampGeometryForDisplay(geom: Record<string, unknown>, maxLinePoints: number): Record<string, unknown> | null {
    const t = typeof geom.type === 'string' ? geom.type : '';
    if (t === 'Point' && Array.isArray(geom.coordinates)) {
      return geom;
    }
    if (t === 'LineString' && Array.isArray(geom.coordinates)) {
      return {
        ...geom,
        coordinates: this.simplifyRingCoords(geom.coordinates as unknown[], maxLinePoints)
      };
    }
    if (t === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      const lines = geom.coordinates as unknown[][];
      const first = lines[0];
      if (!Array.isArray(first)) return null;
      return {
        ...geom,
        coordinates: [this.simplifyRingCoords(first as unknown[], maxLinePoints)]
      };
    }
    if (t === 'Polygon' && Array.isArray(geom.coordinates)) {
      const rings = geom.coordinates as unknown[][];
      const outer = rings[0];
      if (!Array.isArray(outer)) return geom;
      const nextRings = [this.simplifyRingCoords(outer as unknown[], maxLinePoints), ...rings.slice(1)];
      return { ...geom, coordinates: nextRings };
    }
    if (t === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
      const polys = geom.coordinates as unknown[][][];
      const first = polys[0];
      if (!first?.[0]) return null;
      return {
        type: 'Polygon',
        coordinates: [this.simplifyRingCoords(first[0] as unknown[], maxLinePoints), ...first.slice(1)]
      };
    }
    return null;
  }

  /**
   * 供前端 Leaflet CRS.Simple 按图纸坐标绘制全部要素；与 graph 草稿独立（草稿可能只含部分几何）。
   */
  private buildDisplayGeoJsonFromFeatureCollection(
    fc: Record<string, unknown> | null,
    opts: { maxFeatures: number; maxLinePoints: number }
  ): Record<string, unknown> | null {
    if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
      return null;
    }
    const outFeatures: unknown[] = [];
    const raw = fc.features as unknown[];
    for (let i = 0; i < raw.length && outFeatures.length < opts.maxFeatures; i += 1) {
      const feat = this.asObject(raw[i]);
      const geom = this.asObject(feat.geometry);
      const clamped = this.clampGeometryForDisplay(geom, opts.maxLinePoints);
      if (!clamped) continue;
      const props = this.asObject(feat.properties);
      const layerNorm = this.readLayerNameFromFeatureProps(props) ?? 'DEFAULT';
      outFeatures.push({
        type: 'Feature',
        id: feat.id,
        properties: { ...props, layer: layerNorm },
        geometry: clamped
      });
    }
    if (outFeatures.length === 0) return null;
    return {
      type: 'FeatureCollection',
      features: outFeatures,
      display_meta: {
        crs_note: 'planar_drawing_units',
        feature_cap: opts.maxFeatures,
        source: 'network_workbench_preview'
      }
    };
  }

  private buildGraphPreview(graphDraft: WorkbenchGraphDraft | null) {
    if (!graphDraft) return null;
    const normalized = this.normalizeGraphDraft(graphDraft);
    const node_type_counts: Record<string, number> = {};
    for (const item of normalized.nodes) {
      const key = typeof item.node_type === 'string' && item.node_type.trim() ? item.node_type : 'unknown';
      node_type_counts[key] = (node_type_counts[key] ?? 0) + 1;
    }
    const mapCap = 200;
    const map_nodes = normalized.nodes.slice(0, mapCap).map((item) => ({
      node_code: item.node_code,
      node_type: item.node_type,
      latitude: item.latitude,
      longitude: item.longitude
    }));
    const map_pipes = normalized.pipes.slice(0, mapCap).map((item) => ({
      pipe_code: item.pipe_code,
      pipe_type: item.pipe_type,
      from_node_code: item.from_node_code,
      to_node_code: item.to_node_code
    }));
    return {
      node_count: normalized.nodes.length,
      pipe_count: normalized.pipes.length,
      has_coordinates: normalized.nodes.some((item) => item.latitude !== null && item.longitude !== null),
      sample_nodes: normalized.nodes.slice(0, 6).map((item) => ({
        node_code: item.node_code,
        node_type: item.node_type,
        latitude: item.latitude,
        longitude: item.longitude
      })),
      sample_pipes: normalized.pipes.slice(0, 6).map((item) => ({
        pipe_code: item.pipe_code,
        pipe_type: item.pipe_type,
        from_node_code: item.from_node_code,
        to_node_code: item.to_node_code
      })),
      node_type_counts,
      map_nodes,
      map_pipes
    };
  }

  private findClosestNodeCode(
    nodes: Array<{ node_code: string; latitude: number | null; longitude: number | null }>,
    latitude: number | null,
    longitude: number | null
  ) {
    if (latitude === null || longitude === null) return null;
    const resolvedNodes = nodes.filter(
      (node): node is { node_code: string; latitude: number; longitude: number } =>
        typeof node.node_code === 'string' &&
        node.latitude !== null &&
        node.longitude !== null
    );
    const latitudes = resolvedNodes.map((item) => item.latitude);
    const longitudes = resolvedNodes.map((item) => item.longitude);
    const spanLatitude =
      latitudes.length > 1 ? Math.max(...latitudes) - Math.min(...latitudes) : 0;
    const spanLongitude =
      longitudes.length > 1 ? Math.max(...longitudes) - Math.min(...longitudes) : 0;
    const networkSpan = Math.max(spanLatitude, spanLongitude);
    let adaptiveThreshold = Math.max(0.003, Number((networkSpan * 0.08).toFixed(6)));

    if (resolvedNodes.length > 1) {
      let minPairDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < resolvedNodes.length; index += 1) {
        for (let inner = index + 1; inner < resolvedNodes.length; inner += 1) {
          const distance = Math.hypot(
            resolvedNodes[index].latitude - resolvedNodes[inner].latitude,
            resolvedNodes[index].longitude - resolvedNodes[inner].longitude
          );
          if (distance > 0 && distance < minPairDistance) {
            minPairDistance = distance;
          }
        }
      }
      if (Number.isFinite(minPairDistance)) {
        adaptiveThreshold = Math.max(
          0.003,
          Math.min(adaptiveThreshold, Number((minPairDistance * 0.45).toFixed(6)))
        );
      }
    }

    let best: { code: string; distance: number } | null = null;
    for (const node of nodes) {
      if (node.latitude === null || node.longitude === null) continue;
      const distance = Math.hypot(node.latitude - latitude, node.longitude - longitude);
      if (!best || distance < best.distance) {
        best = { code: node.node_code, distance };
      }
    }
    return best && best.distance <= adaptiveThreshold ? best.code : null;
  }

  private getFeatureRepresentativePoint(geometry: Record<string, unknown>) {
    const geometryType = typeof geometry.type === 'string' ? geometry.type : '';
    if (geometryType === 'Point' && Array.isArray(geometry.coordinates)) {
      const coordinates = geometry.coordinates as unknown[];
      return {
        longitude: this.toNullableNumber(coordinates[0]),
        latitude: this.toNullableNumber(coordinates[1]),
        altitude: this.toNullableNumber(coordinates[2] ?? null)
      };
    }

    if (geometryType === 'Polygon' && Array.isArray(geometry.coordinates)) {
      const ring = Array.isArray((geometry.coordinates as unknown[])[0]) ? ((geometry.coordinates as unknown[])[0] as unknown[]) : [];
      const pairs = ring.filter((item): item is unknown[] => Array.isArray(item) && item.length >= 2);
      if (pairs.length > 0) {
        const longitudes = pairs.map((item) => this.toNullableNumber(item[0])).filter((item): item is number => item !== null);
        const latitudes = pairs.map((item) => this.toNullableNumber(item[1])).filter((item): item is number => item !== null);
        if (longitudes.length > 0 && latitudes.length > 0) {
          return {
            longitude: Number((longitudes.reduce((sum, item) => sum + item, 0) / longitudes.length).toFixed(6)),
            latitude: Number((latitudes.reduce((sum, item) => sum + item, 0) / latitudes.length).toFixed(6)),
            altitude: null
          };
        }
      }
    }

    return {
      longitude: null,
      latitude: null,
      altitude: null
    };
  }

  private getFeatureLineEndpoints(geometry: Record<string, unknown>) {
    const geometryType = typeof geometry.type === 'string' ? geometry.type : '';
    const normalizeLine = (line: unknown[]) => {
      const first = Array.isArray(line[0]) ? (line[0] as unknown[]) : [];
      const last = Array.isArray(line[line.length - 1]) ? (line[line.length - 1] as unknown[]) : [];
      return {
        first,
        last
      };
    };

    if (geometryType === 'LineString' && Array.isArray(geometry.coordinates)) {
      return normalizeLine(geometry.coordinates as unknown[]);
    }

    if (geometryType === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
      const firstLine = Array.isArray((geometry.coordinates as unknown[])[0]) ? ((geometry.coordinates as unknown[])[0] as unknown[]) : [];
      if (firstLine.length > 0) {
        return normalizeLine(firstLine);
      }
    }

    return null;
  }

  private buildGraphDraftFromFeatureCollection(
    featureCollection: any,
    layerMapping: WorkbenchLayerMapping
  ): { graph_draft: WorkbenchGraphDraft | null; detected_layers: string[] } {
    const features = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
    const detectedLayers = this.collectLayerCandidates(features);
    const effectiveLayerMapping = this.recommendLayerMapping(detectedLayers, layerMapping);
    const nodes: WorkbenchGraphDraftNode[] = [];
    const pipes: WorkbenchGraphDraftPipe[] = [];

    const resolveNodeType = (props: Record<string, unknown>, layerName: string | null) => {
      const fromProps = this.readString(props, [
        'node_type',
        'role',
        'device_role',
        'asset_type',
        'object_type',
        'kind',
        'SubClasses'
      ]);
      if (fromProps) {
        const normalized = fromProps.toLowerCase();
        if (normalized.includes('circle') || normalized.includes('point') || normalized.includes('insert')) {
          const guessed = this.guessRoleFromLayerName(layerName);
          return guessed && guessed !== 'pipe' ? guessed : 'junction';
        }
        if (normalized === 'pipe') return 'junction';
        return normalized;
      }
      const map = effectiveLayerMapping;
      if (layerName) {
        if (map.well_layer && layerName === map.well_layer) return 'well';
        if (map.pump_layer && layerName === map.pump_layer) return 'pump';
        if (map.valve_layer && layerName === map.valve_layer) return 'valve';
        if (map.outlet_layer && layerName === map.outlet_layer) return 'outlet';
        if (map.sensor_layer && layerName === map.sensor_layer) return 'sensor';
      }
      const fromGuess = this.guessRoleFromLayerName(layerName);
      if (fromGuess) {
        return fromGuess === 'pipe' ? 'junction' : fromGuess;
      }
      return 'junction';
    };

    for (const [index, feature] of features.entries()) {
      const props = this.asObject(feature?.properties);
      const geometry = this.asObject(feature?.geometry);
      const geometryType = typeof geometry.type === 'string' ? geometry.type : '';
      const layerName = this.readLayerNameFromFeatureProps(props);

      if (geometryType === 'Point' || geometryType === 'Polygon') {
        const point = this.getFeatureRepresentativePoint(geometry);
        const nodeType = resolveNodeType(props, layerName);
        if (nodeType === 'pipe') continue;
        nodes.push({
          node_code: this.sanitizeCode(
            this.readString(props, ['node_code', 'device_code', 'asset_code', 'code', 'name', 'id', 'EntityHandle']),
            `${nodeType}_${index + 1}`
          ),
          node_type: nodeType,
          asset_id: this.readString(props, ['asset_id']),
          latitude: point.latitude,
          longitude: point.longitude,
          altitude: this.toNullableNumber(props.altitude ?? props.elevation ?? point.altitude)
        });
      }
    }

    const simplifiedNodes = nodes.map((item) => ({
      node_code: item.node_code ?? '',
      latitude: this.toNullableNumber(item.latitude),
      longitude: this.toNullableNumber(item.longitude)
    }));

    for (const [index, feature] of features.entries()) {
      const props = this.asObject(feature?.properties);
      const geometry = this.asObject(feature?.geometry);
      const geometryType = typeof geometry.type === 'string' ? geometry.type : '';
      const layerName = this.readLayerNameFromFeatureProps(props);

      const lineEndpoints = this.getFeatureLineEndpoints(geometry);
      if (lineEndpoints) {
        const { first, last } = lineEndpoints;
        const fromNodeCode =
          this.readString(props, ['from_node_code', 'from_code', 'start_node_code', 'start_code']) ??
          this.findClosestNodeCode(
            simplifiedNodes,
            this.toNullableNumber(first[1]),
            this.toNullableNumber(first[0])
          );
        const toNodeCode =
          this.readString(props, ['to_node_code', 'to_code', 'end_node_code', 'end_code']) ??
          this.findClosestNodeCode(
            simplifiedNodes,
            this.toNullableNumber(last[1]),
            this.toNullableNumber(last[0])
          );

        if (!fromNodeCode || !toNodeCode) {
          continue;
        }

        pipes.push({
          pipe_code: this.sanitizeCode(
            this.readString(props, ['pipe_code', 'code', 'name', 'id', 'EntityHandle']),
            `pipe_${index + 1}`
          ),
          pipe_type:
            this.readString(props, ['pipe_type', 'role', 'kind']) ??
            (layerName && effectiveLayerMapping.pipe_layer === layerName ? 'main' : 'main'),
          from_node_code: fromNodeCode,
          to_node_code: toNodeCode,
          length_m: this.toNullableNumber(props.length_m ?? props.length ?? null),
          diameter_mm: this.toNullableNumber(props.diameter_mm ?? props.diameter ?? null)
        });
      }
    }

    if (nodes.length === 0 || pipes.length === 0) {
      return { graph_draft: null, detected_layers: detectedLayers };
    }

    return {
      graph_draft: {
        import_mode: 'source_feature_collection',
        overwrite_existing: true,
        nodes,
        pipes
      },
      detected_layers: detectedLayers
    };
  }

  private buildSourceImportMeta(sourceAnalysis: ResolvedSourceImport): Record<string, unknown> {
    return {
      parser_mode: sourceAnalysis.parser_mode,
      source_file_name: sourceAnalysis.file_name,
      source_file_digest: sourceAnalysis.file_digest,
      source_file_exists: sourceAnalysis.file_exists,
      detected_layers: sourceAnalysis.detected_layers,
      layer_mapping: sourceAnalysis.normalized_layer_mapping,
      sidecar_manifest_ref: sourceAnalysis.import_contract.sidecar_manifest_ref,
      import_next_step: sourceAnalysis.import_contract.next_step
    };
  }

  private async resolveSourceImport(
    input: WorkbenchSourcePreviewInput,
    context: Awaited<ReturnType<NetworkWorkbenchService['resolveContext']>>
  ): Promise<ResolvedSourceImport> {
    const fileInfo = this.resolveSourceFile(input.source_file_ref);
    const sourceKind = input.source_kind?.trim() || 'dwg';
    const draftInput = input.graph_draft;
    const explicitHasNodes = Array.isArray(draftInput?.nodes) && draftInput.nodes.length > 0;
    const explicitHasPipes = Array.isArray(draftInput?.pipes) && draftInput.pipes.length > 0;
    // 仅当手工草稿里确有节点或管段时才走 manual 分支；空数组曾导致「已上传图源却被忽略、预览全空且几乎无提示」
    const explicitGraphDraft = explicitHasNodes || explicitHasPipes ? draftInput ?? null : null;

    if (explicitGraphDraft) {
      const preview = this.buildGraphPreview(explicitGraphDraft);
      const mapping = this.normalizeLayerMapping(input.layer_mapping);
      return {
        ...fileInfo,
        parser_mode: 'manual_graph_draft',
        source_kind: sourceKind,
        detected_layers: Object.values(mapping).filter((item): item is string => Boolean(item)),
        suggested_layer_mapping: mapping,
        normalized_layer_mapping: mapping,
        import_contract: {
          supports_direct_graph: true,
          requires_layer_mapping: false,
          accepted_formats: ['graph_draft'],
          sidecar_manifest_ref: fileInfo.sidecar_manifest_ref,
          next_step: 'save_config'
        },
        graph_preview: preview,
        display_geojson: null,
        graph_draft: explicitGraphDraft,
        readiness: {
          ready: Boolean(preview && preview.node_count > 0 && preview.pipe_count > 0),
          blockers: preview
            ? preview.node_count > 0 && preview.pipe_count > 0
              ? []
              : ['手工图元草稿中需同时包含至少 1 个节点与 1 条管段才可发布；或清空高级 JSON 改用已上传图源解析']
            : ['manual graph draft is empty'],
          next_actions: preview ? ['save_config'] : ['provide_graph_draft']
        },
        sidecar_resolved_path: fileInfo.sidecar_resolved_path
      };
    }

    const blockers: string[] = [];
    const nextActions: string[] = [];
    let parserMode = 'unresolved_source';
    let detectedLayers: string[] = [];
    let normalizedLayerMapping = this.normalizeLayerMapping(input.layer_mapping);
    let graphDraft: WorkbenchGraphDraft | null = null;
    let sourceFeatureCollectionForDisplay: Record<string, unknown> | null = null;

    const parseJsonCandidate = (content: unknown, candidateKind: string) => {
      const object = this.asObject(content);
      if (Array.isArray(object.nodes) || Array.isArray(object.pipes)) {
        parserMode = `${candidateKind}_graph_json`;
        graphDraft = {
          import_mode: parserMode,
          overwrite_existing: true,
          nodes: Array.isArray(object.nodes) ? (object.nodes as WorkbenchGraphDraftNode[]) : [],
          pipes: Array.isArray(object.pipes) ? (object.pipes as WorkbenchGraphDraftPipe[]) : []
        };
        return;
      }

      const embeddedDraft = this.asObject(object.graph_draft);
      if (Array.isArray(embeddedDraft.nodes) || Array.isArray(embeddedDraft.pipes)) {
        parserMode = `${candidateKind}_embedded_graph`;
        graphDraft = {
          import_mode: parserMode,
          overwrite_existing: true,
          nodes: Array.isArray(embeddedDraft.nodes) ? (embeddedDraft.nodes as WorkbenchGraphDraftNode[]) : [],
          pipes: Array.isArray(embeddedDraft.pipes) ? (embeddedDraft.pipes as WorkbenchGraphDraftPipe[]) : []
        };
        normalizedLayerMapping = this.normalizeLayerMapping({
          ...normalizedLayerMapping,
          ...this.asObject(object.layer_mapping)
        } as WorkbenchLayerMapping);
        return;
      }

      const featureCollection =
        object.type === 'FeatureCollection'
          ? object
          : this.asObject(object.feature_collection).type === 'FeatureCollection'
            ? this.asObject(object.feature_collection)
            : this.asObject(object.geojson).type === 'FeatureCollection'
              ? this.asObject(object.geojson)
              : null;

      if (featureCollection) {
        parserMode = `${candidateKind}_feature_collection`;
        sourceFeatureCollectionForDisplay = featureCollection as Record<string, unknown>;
        const mapped = this.buildGraphDraftFromFeatureCollection(featureCollection, normalizedLayerMapping);
        detectedLayers = mapped.detected_layers;
        normalizedLayerMapping = this.recommendLayerMapping(detectedLayers, {
          ...normalizedLayerMapping,
          ...this.asObject(object.layer_mapping)
        } as WorkbenchLayerMapping);
        graphDraft = mapped.graph_draft;
      } else if (Array.isArray(object.layers)) {
        detectedLayers = (object.layers as unknown[])
          .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
          .map((item) => this.normalizeTextForWorkbenchStorage(item.trim()));
        normalizedLayerMapping = this.recommendLayerMapping(detectedLayers, {
          ...normalizedLayerMapping,
          ...this.asObject(object.layer_mapping)
        } as WorkbenchLayerMapping);
      }
    };

    if (!fileInfo.source_ref) {
      blockers.push('请先提供图源引用或直接提供图元草稿');
      nextActions.push('provide_source_file_ref');
    } else if (!fileInfo.file_exists) {
      blockers.push('当前图源引用在后端主机上不存在，不能做导入预检');
      nextActions.push('fix_source_file_ref');
    } else {
      const extension = path.extname(fileInfo.resolved_source_ref ?? '').toLowerCase();
      if (extension === '.dwg') {
        const rawDwg = this.parseRawDwgAsGeoJson(fileInfo.resolved_source_ref!);
        parserMode = rawDwg.parser_mode;
        if (rawDwg.feature_collection) {
          parseJsonCandidate(rawDwg.feature_collection, 'dwg_libredwg');
        } else if (fileInfo.sidecar_resolved_path) {
          parserMode = 'dwg_sidecar_contract';
          parseJsonCandidate(
            this.parseJsonFile(fileInfo.sidecar_resolved_path),
            path.extname(fileInfo.sidecar_resolved_path).toLowerCase() === '.geojson' ? 'dwg_sidecar_geojson' : 'dwg_sidecar_json'
          );
        } else {
          const verHint = this.dwgVersionUserHint(rawDwg.dwg_version ?? null);
          const stderrHint =
            rawDwg.tool_stderr != null && rawDwg.tool_stderr.length > 0
              ? ` 解析器日志（摘录）：${rawDwg.tool_stderr.slice(0, 480)}${rawDwg.tool_stderr.length > 480 ? '…' : ''}`
              : '';
          if (rawDwg.error === 'raw_dwg_parser_not_available') {
            blockers.push(
              `原生 DWG 解析器未找到：请安装 LibreDWG 的 dwgread，并设置环境变量 DWGREAD_PATH 指向可执行文件，或放到 backend/Tools/LibreDWG/dwgread.exe。${verHint}${stderrHint} 也可上传与 DWG 同名的 .import.json / .geojson 辅助文件。`
            );
            nextActions.push('install_raw_dwg_parser');
          } else if (rawDwg.error === 'raw_dwg_parser_invalid_geojson') {
            blockers.push(
              `DWG 已转换但输出不是有效的 GeoJSON FeatureCollection（可能几何为空或工具输出异常）。${verHint}${stderrHint} 请尝试另存为较低版本 DWG 或提供 sidecar。`
            );
            nextActions.push('provide_dwg_sidecar_manifest');
          } else {
            blockers.push(
              `原生 DWG 解析未得到可用图元。${verHint}${stderrHint} 请检查文件是否加密/损坏，或提供同名 sidecar manifest / geojson。`
            );
            nextActions.push('provide_dwg_sidecar_manifest');
          }
        }
      } else if (extension === '.geojson' || extension === '.json') {
        parseJsonCandidate(this.parseJsonFile(fileInfo.resolved_source_ref!), extension === '.geojson' ? 'geojson' : 'json');
      } else {
        blockers.push(`当前图源类型 ${extension || sourceKind} 还没有可解析的导入器`);
        nextActions.push('convert_to_geojson_or_graph_json');
      }
    }

    detectedLayers = detectedLayers.length > 0 ? detectedLayers : Object.values(normalizedLayerMapping).filter((item): item is string => Boolean(item));
    detectedLayers = [...new Set(detectedLayers.map((s) => this.normalizeTextForWorkbenchStorage(s)))];
    normalizedLayerMapping = this.recommendLayerMapping(detectedLayers, normalizedLayerMapping);
    const preview = this.buildGraphPreview(graphDraft);
    const displayGeoJson = this.buildDisplayGeoJsonFromFeatureCollection(sourceFeatureCollectionForDisplay, {
      maxFeatures: 3500,
      maxLinePoints: 400
    });

    if (graphDraft && preview) {
      blockers.length = 0;
      nextActions.length = 0;
      nextActions.push('save_config');
    } else if (!blockers.length) {
      blockers.push('图源预检没有得到可落库的节点和管段草稿');
      nextActions.push('provide_graph_draft_or_sidecar');
    }

    const requiresLayerMapping = sourceKind === 'dwg' || detectedLayers.length > 0;
    const nextStep =
      graphDraft && preview
        ? 'save_config'
        : sourceKind === 'dwg'
          ? parserMode === 'dwg_binary_unavailable'
            ? 'install_raw_dwg_parser'
            : 'provide_dwg_sidecar_manifest'
          : 'provide_graph_draft_or_sidecar';

    return {
      ...fileInfo,
      parser_mode: parserMode,
      source_kind: sourceKind,
      detected_layers: detectedLayers,
      suggested_layer_mapping: normalizedLayerMapping,
      normalized_layer_mapping: normalizedLayerMapping,
      import_contract: {
        supports_direct_graph: Boolean(graphDraft && preview),
        requires_layer_mapping: requiresLayerMapping,
        accepted_formats: ['graph_json', 'geojson', 'raw_dwg_binary', 'dwg+sidecar'],
        sidecar_manifest_ref: fileInfo.sidecar_manifest_ref,
        next_step: nextStep
      },
      graph_preview: preview,
      display_geojson: displayGeoJson,
      graph_draft: graphDraft,
      readiness: {
        ready: blockers.length === 0,
        blockers,
        next_actions: nextActions
      },
      sidecar_resolved_path: fileInfo.sidecar_resolved_path
    };
  }

  async uploadSource(
    input: WorkbenchUploadSourceInput,
    files?: {
      source_file?: WorkbenchUploadedFile[];
      sidecar_file?: WorkbenchUploadedFile[];
    }
  ): Promise<WorkbenchUploadedSource> {
    const sourceFile = files?.source_file?.[0];
    if (!sourceFile) {
      throw new BadRequestException('source_file is required');
    }

    const scope = this.requireExplicitWorkbenchScope(input.project_id, input.block_id);
    const context = await this.resolveContext(scope.projectId, scope.blockId);
    const uploadRoot = this.getWorkbenchUploadRoot();
    const dateFolder = new Date().toISOString().slice(0, 10);
    const scopedDir = path.join(
      uploadRoot,
      `project_${this.sanitizePathSegment(context.selected_project_id, 'unscoped')}`,
      `block_${this.sanitizePathSegment(context.selected_block_id, 'unscoped')}`,
      dateFolder
    );

    const sourceKind = this.inferSourceKind(sourceFile.originalname || 'network-source.dwg', input.source_kind);
    const storedSource = this.persistUploadedFile(sourceFile, scopedDir, `network-source.${sourceKind}`);
    const sidecarFile = files?.sidecar_file?.[0];
    let storedSidecar:
      | {
          source_file_ref: string;
          file_name: string;
        }
      | null = null;

    if (sidecarFile?.buffer && sidecarFile.buffer.length > 0) {
      const sidecarAbsolutePath = `${storedSource.absolute_path}.import.json`;
      fs.writeFileSync(sidecarAbsolutePath, sidecarFile.buffer);
      storedSidecar = {
        source_file_ref: path.relative(process.cwd(), sidecarAbsolutePath).replace(/\\/g, '/'),
        file_name: sidecarFile.originalname || path.basename(sidecarAbsolutePath)
      };
    }

    return {
      storage_mode: 'backend_managed_upload',
      source_kind: sourceKind,
      source_file_ref: storedSource.source_file_ref,
      source_file_name: storedSource.file_name,
      source_file_size_bytes: storedSource.file_size_bytes,
      source_file_digest: storedSource.file_digest,
      sidecar_manifest_ref: storedSidecar?.source_file_ref ?? null,
      sidecar_file_name: storedSidecar?.file_name ?? null,
      uploaded_at: new Date().toISOString(),
      next_step: 'preview_source'
    };
  }

  async previewSource(input: WorkbenchSourcePreviewInput): Promise<WorkbenchSourcePreviewResult> {
    const scope = this.requireExplicitWorkbenchScope(input.project_id, input.block_id);
    const context = await this.resolveContext(scope.projectId, scope.blockId);
    const result = await this.resolveSourceImport(input, context);
    const { graph_draft: _graphDraft, normalized_layer_mapping: _layerMapping, sidecar_resolved_path: _sidecar, ...preview } = result;
    return preview;
  }

  private buildAutoNodeCoordinate(
    centerLatitude: number | null,
    centerLongitude: number | null,
    relationIndex: number,
    role: 'well' | 'pump' | 'valve'
  ) {
    const baseLat = centerLatitude ?? 34.5;
    const baseLon = centerLongitude ?? 113.5;
    const laneOffset = relationIndex * 0.0012;
    const roleOffset =
      role === 'well'
        ? { lat: 0, lon: 0 }
        : role === 'pump'
          ? { lat: 0.00018, lon: 0.00045 }
          : { lat: -0.00018, lon: 0.0009 };

    return {
      latitude: Number((baseLat + laneOffset + roleOffset.lat).toFixed(6)),
      longitude: Number((baseLon + laneOffset + roleOffset.lon).toFixed(6))
    };
  }

  private async loadGraphSeedRows(projectId: string, blockId: string | null, client?: any) {
    const params: unknown[] = [TENANT_ID, projectId];
    const blockFilter = blockId ? `and w.block_id = $3::uuid` : '';
    if (blockId) params.push(blockId);

    const result = await this.db.query(
      `
      select
        pvr.id as relation_id,
        w.id as well_id,
        w.device_id as well_device_id,
        w.well_code,
        coalesce(w.safety_profile_json->>'displayName', wd.device_name, w.well_code) as well_name,
        coalesce(wa.manual_latitude, wa.reported_latitude)::float8 as well_latitude,
        coalesce(wa.manual_longitude, wa.reported_longitude)::float8 as well_longitude,
        p.id as pump_id,
        p.device_id as pump_device_id,
        p.pump_code,
        coalesce(pd.device_name, p.pump_code) as pump_name,
        coalesce(pa.manual_latitude, pa.reported_latitude)::float8 as pump_latitude,
        coalesce(pa.manual_longitude, pa.reported_longitude)::float8 as pump_longitude,
        v.id as valve_id,
        v.device_id as valve_device_id,
        v.valve_code,
        coalesce(vd.device_name, v.valve_code) as valve_name,
        coalesce(va.manual_latitude, va.reported_latitude)::float8 as valve_latitude,
        coalesce(va.manual_longitude, va.reported_longitude)::float8 as valve_longitude
      from pump_valve_relation pvr
      join well w on w.id = pvr.well_id
      left join project_block pb on pb.id = w.block_id
      join pump p on p.id = pvr.pump_id
      join valve v on v.id = pvr.valve_id
      left join device wd on wd.id = w.device_id
      left join device pd on pd.id = p.device_id
      left join device vd on vd.id = v.device_id
      left join asset wa on wa.id = wd.asset_id
      left join asset pa on pa.id = pd.asset_id
      left join asset va on va.id = vd.asset_id
      where pvr.tenant_id = $1
        and pb.project_id = $2::uuid
        ${blockFilter}
      order by w.created_at asc, p.created_at asc, v.created_at asc
      `,
      params,
      client
    );
    return result.rows;
  }

  private buildAutoGraphDraft(
    seedRows: any[],
    context: Awaited<ReturnType<NetworkWorkbenchService['resolveContext']>>
  ): WorkbenchGraphDraft {
    const nodesByDeviceId = new Map<string, WorkbenchGraphDraftNode>();
    const pipes: WorkbenchGraphDraftPipe[] = [];
    const centerLatitude = this.toNullableNumber(context.selected_block?.center_latitude);
    const centerLongitude = this.toNullableNumber(context.selected_block?.center_longitude);

    const upsertNode = (
      deviceId: string,
      relationIndex: number,
      role: 'well' | 'pump' | 'valve',
      rawCode: unknown,
      assetId: string | null,
      latitude: unknown,
      longitude: unknown
    ) => {
      if (nodesByDeviceId.has(deviceId)) return;
      const coords =
        this.toNullableNumber(latitude) !== null && this.toNullableNumber(longitude) !== null
          ? {
              latitude: this.toNullableNumber(latitude),
              longitude: this.toNullableNumber(longitude)
            }
          : this.buildAutoNodeCoordinate(centerLatitude, centerLongitude, relationIndex, role);
      nodesByDeviceId.set(deviceId, {
        node_code: this.sanitizeCode(rawCode, `${role}_${deviceId.slice(-6)}`),
        node_type: role,
        asset_id: assetId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        altitude: null
      });
    };

    seedRows.forEach((row, index) => {
      upsertNode(
        row.well_device_id,
        index,
        'well',
        row.well_code ?? row.well_name,
        null,
        row.well_latitude,
        row.well_longitude
      );
      upsertNode(
        row.pump_device_id,
        index,
        'pump',
        row.pump_code ?? row.pump_name,
        null,
        row.pump_latitude,
        row.pump_longitude
      );
      upsertNode(
        row.valve_device_id,
        index,
        'valve',
        row.valve_code ?? row.valve_name,
        null,
        row.valve_latitude,
        row.valve_longitude
      );

      const wellNodeCode = nodesByDeviceId.get(row.well_device_id)?.node_code;
      const pumpNodeCode = nodesByDeviceId.get(row.pump_device_id)?.node_code;
      const valveNodeCode = nodesByDeviceId.get(row.valve_device_id)?.node_code;

      if (wellNodeCode && pumpNodeCode) {
        pipes.push({
          pipe_code: this.sanitizeCode(`pipe_${row.well_code}_${row.pump_code}_${index + 1}`, `pipe_wp_${index + 1}`),
          pipe_type: 'well_to_pump',
          from_node_code: wellNodeCode,
          to_node_code: pumpNodeCode,
          length_m: 12,
          diameter_mm: 90
        });
      }

      if (pumpNodeCode && valveNodeCode) {
        pipes.push({
          pipe_code: this.sanitizeCode(`pipe_${row.pump_code}_${row.valve_code}_${index + 1}`, `pipe_pv_${index + 1}`),
          pipe_type: 'pump_to_valve',
          from_node_code: pumpNodeCode,
          to_node_code: valveNodeCode,
          length_m: 18,
          diameter_mm: 65
        });
      }
    });

    return {
      import_mode: 'auto_relation_seed',
      overwrite_existing: true,
      nodes: [...nodesByDeviceId.values()],
      pipes
    };
  }

  private async loadPublishedGraphDraftSnapshot(
    projectId: string,
    blockId?: string | null,
    client?: any
  ): Promise<WorkbenchGraphDraft | null> {
    const result = await this.db.query<{ graph_draft_snapshot: unknown }>(
      `
      select source_meta_json->'graph_draft_snapshot' as graph_draft_snapshot
      from network_model_version nmv
      join network_model nm on nm.id = nmv.network_model_id
      where nm.project_id = $1::uuid
        and nmv.is_published = true
        and (
          $2::uuid is null
          or coalesce(nmv.block_id, nullif(nmv.source_meta_json->>'block_id', '')::uuid) = $2::uuid
        )
      order by nmv.published_at desc nulls last, nmv.created_at desc
      limit 1
      `,
      [projectId, blockId ?? null],
      client
    );
    const rawDraft = this.asObject(result.rows[0]?.graph_draft_snapshot);
    if (!rawDraft) return null;
    return this.normalizeGraphDraft(rawDraft as WorkbenchGraphDraft);
  }

  private dedupeDraftPipesByEdge(pipes: WorkbenchGraphDraftPipe[] | undefined | null) {
    const unique = new Map<string, WorkbenchGraphDraftPipe>();
    for (const pipe of pipes ?? []) {
      const from = this.sanitizeCode(pipe.from_node_code, '');
      const to = this.sanitizeCode(pipe.to_node_code, '');
      if (!from || !to) continue;
      const key = `${from}->${to}`;
      if (!unique.has(key)) {
        unique.set(key, {
          ...pipe,
          from_node_code: from,
          to_node_code: to
        });
      }
    }
    return [...unique.values()];
  }

  private scoreDraftDeviceRole(device: DraftBoundDeviceRow, expectedRole: 'well' | 'pump' | 'valve') {
    const haystack = [
      device.type_code,
      device.type_name,
      device.device_name,
      device.asset_type,
      device.asset_name
    ]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join(' ')
      .toLowerCase();

    const hasAny = (...candidates: string[]) => candidates.some((candidate) => haystack.includes(candidate));
    const roleSignals = {
      well: hasAny('well', '井'),
      pump: hasAny('pump', '泵'),
      valve: hasAny('valve', '阀')
    };
    const sensorSignals = hasAny('meter', 'collector', 'sensor', 'flow', 'pressure', '水表', '采集', '传感');

    let score = 0;
    if (roleSignals[expectedRole]) score += 100;
    if (expectedRole === 'well' && (device.asset_type === 'well' || device.asset_type === 'pump_station')) score += 40;
    if (expectedRole === 'pump' && device.asset_type === 'pump') score += 40;
    if (expectedRole === 'valve' && (device.asset_type === 'valve' || device.asset_type === 'valve_group')) score += 40;
    if (sensorSignals) score -= 60;

    for (const otherRole of ['well', 'pump', 'valve'] as const) {
      if (otherRole !== expectedRole && roleSignals[otherRole]) {
        score -= 30;
      }
    }

    return score;
  }

  private scoreDraftDeviceRoleWithContext(
    device: DraftBoundDeviceRow,
    expectedRole: 'well' | 'pump' | 'valve',
    nodeType?: string | null
  ) {
    const haystack = [
      device.type_code,
      device.type_name,
      device.device_name,
      device.device_code,
      device.asset_type,
      device.asset_name
    ]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join(' ')
      .toLowerCase();

    const hasAny = (candidates: string[]) => candidates.some((candidate) => haystack.includes(candidate));
    const normalizedNodeType = this.normalizeDraftNodeType(nodeType);
    const roleSignals = {
      well: hasAny([
        'well',
        'source_station',
        'pump_station',
        'water_source',
        '\u4e95',
        '\u673a\u4e95',
        '\u6cf5\u7ad9',
        '\u6c34\u6e90',
        '\u6e90\u7ad9'
      ]),
      pump: hasAny([
        'pump',
        'pump_unit',
        '\u6cf5',
        '\u6cf5\u63a7',
        '\u6c34\u6cf5',
        '\u673a\u6cf5'
      ]),
      valve: hasAny([
        'valve',
        'svctrl',
        'solenoid',
        'outlet',
        '\u9600',
        '\u7535\u78c1\u9600',
        '\u9600\u95e8',
        '\u9600\u63a7'
      ])
    };
    const sensorSignals = hasAny([
      'meter',
      'collector',
      'sensor',
      'flow',
      'pressure',
      'wmtr',
      '\u91c7\u96c6',
      '\u4f20\u611f',
      '\u6d41\u91cf',
      '\u538b\u529b',
      '\u6c34\u8868'
    ]);
    const controllerSignals = hasAny([
      'controller',
      'ctrl',
      'control',
      '\u4e3b\u63a7',
      '\u63a7\u5236',
      '\u63a7\u5236\u5668',
      '\u6cf5\u63a7',
      '\u9600\u63a7'
    ]);

    let score = 0;
    if (roleSignals[expectedRole]) score += 100;
    if (controllerSignals && !sensorSignals) score += 20;
    if (expectedRole === 'well' && (device.asset_type === 'well' || device.asset_type === 'pump_station')) score += 40;
    if (expectedRole === 'pump' && device.asset_type === 'pump') score += 40;
    if (expectedRole === 'valve' && (device.asset_type === 'valve' || device.asset_type === 'valve_group')) score += 40;
    if (
      expectedRole === 'well' &&
      normalizedNodeType === 'source_station' &&
      hasAny(['source_station', 'pump_station', '\u6cf5\u7ad9', '\u6e90\u7ad9', '\u4e3b\u63a7'])
    ) {
      score += 60;
    }
    if (
      expectedRole === 'valve' &&
      (normalizedNodeType === 'outlet' || normalizedNodeType === 'valve') &&
      hasAny(['valve', 'svctrl', 'solenoid', '\u9600', '\u7535\u78c1\u9600', '\u9600\u95e8', '\u9600\u63a7'])
    ) {
      score += 60;
    }
    if (sensorSignals) score -= 60;

    for (const otherRole of ['well', 'pump', 'valve'] as const) {
      if (otherRole !== expectedRole && roleSignals[otherRole]) {
        score -= 30;
      }
    }

    return score;
  }

  private pickDraftNodeDeviceByRole(
    node: WorkbenchGraphDraftNode,
    devicesById: Map<string, DraftBoundDeviceRow>,
    expectedRole: 'well' | 'pump' | 'valve'
  ) {
    const candidates = (node.device_ids ?? [])
      .map((deviceId) => devicesById.get(deviceId))
      .filter((device): device is DraftBoundDeviceRow => Boolean(device))
      .map((device) => ({
        device,
        score: this.scoreDraftDeviceRoleWithContext(device, expectedRole, node.node_type)
      }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.score > 0 ? candidates[0].device : null;
  }

  private pickDraftSourceStationDevice(
    node: WorkbenchGraphDraftNode,
    devicesById: Map<string, DraftBoundDeviceRow>
  ) {
    return this.pickDraftNodeDeviceByRole(node, devicesById, 'well');
  }

  private pickDraftPumpUnitDevices(
    node: WorkbenchGraphDraftNode,
    devicesById: Map<string, DraftBoundDeviceRow>
  ) {
    const pumpDevices = new Map<string, { device: DraftBoundDeviceRow; unitCode: string | null; ratedPowerKw: number | null }>();

    for (const unit of node.pump_units ?? []) {
      if (unit?.enabled === false) continue;
      const unitCode = typeof unit?.unit_code === 'string' ? unit.unit_code : null;
      const ratedPowerKw = this.toNullableNumber(unit?.rated_power_kw);
      for (const deviceId of this.normalizeStringArray(unit?.device_ids)) {
        const device = devicesById.get(deviceId);
        if (!device) continue;
        pumpDevices.set(device.id, {
          device,
          unitCode,
          ratedPowerKw
        });
      }
    }

    if (pumpDevices.size === 0) {
      const fallback = this.pickDraftNodeDeviceByRole(node, devicesById, 'pump');
      if (fallback) {
        pumpDevices.set(fallback.id, {
          device: fallback,
          unitCode: null,
          ratedPowerKw: this.toNullableNumber(node.node_params?.rated_power_kw)
        });
      }
    }

    return [...pumpDevices.values()];
  }

  private collectReachableValveEndpoints(
    sourceNodeCode: string,
    nodesByCode: Map<string, WorkbenchGraphDraftNode>,
    adjacency: Map<string, Set<string>>,
    devicesById: Map<string, DraftBoundDeviceRow>
  ) {
    const valves = new Map<string, DraftReachableValveEndpoint>();
    const queue = [sourceNodeCode];
    const visited = new Set<string>(queue);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of [...(adjacency.get(current) ?? [])]) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
        const node = nodesByCode.get(next);
        if (!node) continue;
        const normalizedNodeType = this.normalizeDraftNodeType(node.node_type);
        const endpointType =
          normalizedNodeType === 'valve' ? 'valve' : normalizedNodeType === 'outlet' ? 'outlet' : null;
        if (!endpointType) continue;
        const valveDevice = this.pickDraftNodeDeviceByRole(node, devicesById, 'valve');
        if (!valveDevice) continue;
        const nodeCode = this.sanitizeCode(node.node_code, next);
        valves.set(valveDevice.id, {
          node,
          node_code: nodeCode,
          endpoint_type: endpointType,
          valve_device: valveDevice
        });
      }
    }

    return [...valves.values()];
  }

  private buildScopedDraftCode(prefix: 'WELL' | 'PUMP' | 'VALVE', nodeCode: string, deviceId: string) {
    return this.sanitizeCode(`${prefix}-${nodeCode}-${deviceId.slice(-6)}`.toUpperCase(), `${prefix}-${deviceId.slice(-6)}`);
  }

  private async ensureScopedPumpValveRelationsFromDraft(projectId: string, blockId: string, client: any): Promise<void> {
    const draft = await this.loadPublishedGraphDraftSnapshot(projectId, blockId, client);
    if (!draft?.nodes?.length) return;

    const nodesByCode = new Map(
      (draft.nodes ?? []).map((node) => [this.sanitizeCode(node.node_code, ''), node] as const).filter(([code]) => Boolean(code))
    );
    const adjacency = new Map<string, Set<string>>();
    for (const pipe of this.dedupeDraftPipesByEdge(draft.pipes)) {
      const from = pipe.from_node_code ? this.sanitizeCode(pipe.from_node_code, '') : '';
      const to = pipe.to_node_code ? this.sanitizeCode(pipe.to_node_code, '') : '';
      if (!from || !to) continue;
      if (!adjacency.has(from)) adjacency.set(from, new Set());
      if (!adjacency.has(to)) adjacency.set(to, new Set());
      adjacency.get(from)!.add(to);
      adjacency.get(to)!.add(from);
    }

    const deviceIds = [
      ...new Set(
        (draft.nodes ?? []).flatMap((node) => [
          ...this.normalizeStringArray(node.device_ids),
          ...(node.pump_units ?? []).flatMap((unit) => this.normalizeStringArray(unit?.device_ids))
        ])
      )
    ];
    if (deviceIds.length === 0) return;

    const deviceRows = await this.db.query<DraftBoundDeviceRow>(
      `
      select
        d.id::text as id,
        d.device_code,
        d.device_name,
        d.asset_id::text as asset_id,
        a.asset_name,
        a.asset_type,
        dt.type_code,
        dt.type_name,
        d.lifecycle_state
      from device d
      left join asset a on a.id = d.asset_id
      left join device_type dt on dt.id = d.device_type_id
      where d.id = any($1::uuid[])
      `,
      [deviceIds],
      client
    );
    const devicesById = new Map(deviceRows.rows.map((row) => [row.id, row] as const));

    const existingWells = await this.db.query<{ id: string; device_id: string | null; block_id: string | null }>(
      `select id::text as id, device_id::text as device_id, block_id::text as block_id from well where tenant_id = $1 and device_id = any($2::uuid[])`,
      [TENANT_ID, deviceIds],
      client
    );
    const wellByDeviceId = new Map(
      existingWells.rows
        .filter((row): row is { id: string; device_id: string; block_id: string | null } => Boolean(row.device_id))
        .map((row) => [row.device_id, row] as const)
    );

    const existingPumps = await this.db.query<{ id: string; device_id: string | null; well_id: string | null }>(
      `select id::text as id, device_id::text as device_id, well_id::text as well_id from pump where tenant_id = $1 and device_id = any($2::uuid[])`,
      [TENANT_ID, deviceIds],
      client
    );
    const pumpByDeviceId = new Map(
      existingPumps.rows
        .filter((row): row is { id: string; device_id: string; well_id: string | null } => Boolean(row.device_id))
        .map((row) => [row.device_id, row] as const)
    );

    const existingValves = await this.db.query<{ id: string; device_id: string | null; well_id: string | null }>(
      `select id::text as id, device_id::text as device_id, well_id::text as well_id from valve where tenant_id = $1 and device_id = any($2::uuid[])`,
      [TENANT_ID, deviceIds],
      client
    );
    const valveByDeviceId = new Map(
      existingValves.rows
        .filter((row): row is { id: string; device_id: string; well_id: string | null } => Boolean(row.device_id))
        .map((row) => [row.device_id, row] as const)
    );

    for (const [sourceStationNodeCode, sourceStationNode] of nodesByCode.entries()) {
      if (this.normalizeDraftNodeType(sourceStationNode.node_type) !== 'source_station') continue;

      const sourceStationDevice = this.pickDraftSourceStationDevice(sourceStationNode, devicesById);
      const pumpDevices = this.pickDraftPumpUnitDevices(sourceStationNode, devicesById);
      const valveEndpoints = this.collectReachableValveEndpoints(sourceStationNodeCode, nodesByCode, adjacency, devicesById);
      if (!sourceStationDevice || pumpDevices.length === 0 || valveEndpoints.length === 0) continue;

      const sourceKind = this.normalizeSourceKind(sourceStationNode.node_params?.source_kind, 'groundwater');
      let wellId = wellByDeviceId.get(sourceStationDevice.id)?.id ?? null;
      const sourceStationProfile = JSON.stringify({
        source: 'network_workbench_graph_bridge',
        displayName:
          sourceStationNode.node_name ?? sourceStationDevice.asset_name ?? sourceStationDevice.device_name ?? sourceStationNodeCode,
        nodeCode: sourceStationNodeCode,
        sourceKind
      });

      if (wellId) {
        await this.db.query(
          `
          update well
          set block_id = $3::uuid,
              rated_flow = coalesce($4, rated_flow),
              rated_pressure = coalesce($5, rated_pressure),
              water_source_type = coalesce($6, water_source_type),
              safety_profile_json = coalesce(safety_profile_json, '{}'::jsonb) || $7::jsonb,
              updated_at = now()
          where tenant_id = $1 and id = $2::uuid
          `,
          [
            TENANT_ID,
            wellId,
            blockId,
            this.toNullableNumber(sourceStationNode.node_params?.design_flow_m3h ?? sourceStationNode.node_params?.rated_flow_m3h),
            this.toNullableNumber(sourceStationNode.node_params?.pump_head_m ?? sourceStationNode.node_params?.rated_head_m),
            sourceKind,
            sourceStationProfile
          ],
          client
        );
      } else {
        const insertedWell = await this.db.query<{ id: string }>(
          `
          insert into well (
            tenant_id,
            device_id,
            block_id,
            well_code,
            water_source_type,
            rated_flow,
            rated_pressure,
            safety_profile_json
          )
          values ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb)
          returning id
          `,
          [
            TENANT_ID,
            sourceStationDevice.id,
            blockId,
            this.buildScopedDraftCode('WELL', sourceStationNodeCode, sourceStationDevice.id),
            sourceKind,
            this.toNullableNumber(sourceStationNode.node_params?.design_flow_m3h ?? sourceStationNode.node_params?.rated_flow_m3h),
            this.toNullableNumber(sourceStationNode.node_params?.pump_head_m ?? sourceStationNode.node_params?.rated_head_m),
            sourceStationProfile
          ],
          client
        );
        wellId = insertedWell.rows[0].id;
        wellByDeviceId.set(sourceStationDevice.id, { id: wellId, device_id: sourceStationDevice.id, block_id: blockId });
      }

      if (!wellId) continue;

      for (const { device: pumpDevice, unitCode, ratedPowerKw } of pumpDevices) {
        let pumpId = pumpByDeviceId.get(pumpDevice.id)?.id ?? null;
        if (pumpId) {
          await this.db.query(
            `
            update pump
            set well_id = $3::uuid,
                rated_power_kw = coalesce($4, rated_power_kw),
                updated_at = now()
            where tenant_id = $1 and id = $2::uuid
            `,
            [TENANT_ID, pumpId, wellId, ratedPowerKw],
            client
          );
        } else {
          const insertedPump = await this.db.query<{ id: string }>(
            `
            insert into pump (tenant_id, device_id, well_id, pump_code, rated_power_kw)
            values ($1, $2::uuid, $3::uuid, $4, $5)
            returning id
            `,
            [
              TENANT_ID,
              pumpDevice.id,
              wellId,
              this.sanitizeCode(unitCode ?? this.buildScopedDraftCode('PUMP', sourceStationNodeCode, pumpDevice.id), this.buildScopedDraftCode('PUMP', sourceStationNodeCode, pumpDevice.id)),
              ratedPowerKw
            ],
            client
          );
          pumpId = insertedPump.rows[0].id;
          pumpByDeviceId.set(pumpDevice.id, { id: pumpId, device_id: pumpDevice.id, well_id: wellId });
        }

        for (const valveEndpoint of valveEndpoints) {
          const valveNode = valveEndpoint.node;
          const valveNodeCode = valveEndpoint.node_code;
          const valveDevice = valveEndpoint.valve_device;

          let valveId = valveByDeviceId.get(valveDevice.id)?.id ?? null;
          if (valveId) {
            await this.db.query(
              `
              update valve
              set well_id = $3::uuid,
                  valve_kind = coalesce($4, valve_kind),
                  updated_at = now()
              where tenant_id = $1 and id = $2::uuid
              `,
              [
                TENANT_ID,
                valveId,
                wellId,
                typeof valveNode.node_params?.valve_mode === 'string' && valveNode.node_params.valve_mode.trim()
                  ? valveNode.node_params.valve_mode.trim()
                  : null
              ],
              client
            );
          } else {
            const insertedValve = await this.db.query<{ id: string }>(
              `
              insert into valve (tenant_id, device_id, well_id, valve_code, valve_kind)
              values ($1, $2::uuid, $3::uuid, $4, $5)
              returning id
              `,
              [
                TENANT_ID,
                valveDevice.id,
                wellId,
                this.buildScopedDraftCode('VALVE', valveNodeCode, valveDevice.id),
                typeof valveNode.node_params?.valve_mode === 'string' && valveNode.node_params.valve_mode.trim()
                  ? valveNode.node_params.valve_mode.trim()
                  : 'solenoid'
              ],
              client
            );
            valveId = insertedValve.rows[0].id;
            valveByDeviceId.set(valveDevice.id, { id: valveId, device_id: valveDevice.id, well_id: wellId });
          }

          if (!pumpId || !valveId) continue;

          const existingRelation = await this.db.query<{ id: string }>(
            `
            select id
            from pump_valve_relation
            where tenant_id = $1
              and well_id = $2::uuid
              and pump_id = $3::uuid
              and valve_id = $4::uuid
            limit 1
            `,
            [TENANT_ID, wellId, pumpId, valveId],
            client
          );

          const relationConfig = {
            sequence: 'valve_first',
            valveDelaySeconds: 0,
            pumpDelaySeconds: 0,
            source: 'network_workbench_graph_bridge',
            source_station_node_code: sourceStationNodeCode,
            pump_unit_code: unitCode,
            valve_node_code: valveNodeCode,
            valve_endpoint_type: valveEndpoint.endpoint_type
          };

          if (existingRelation.rows[0]) {
            await this.db.query(
              `
              update pump_valve_relation
              set status = 'active',
                  relation_config_json = coalesce(relation_config_json, '{}'::jsonb) || $3::jsonb,
                  updated_at = now()
              where tenant_id = $1 and id = $2::uuid
              `,
              [TENANT_ID, existingRelation.rows[0].id, JSON.stringify(relationConfig)],
              client
            );
          } else {
            await this.db.query(
              `
              insert into pump_valve_relation (
                tenant_id,
                well_id,
                pump_id,
                valve_id,
                relation_role,
                billing_inherit_mode,
                relation_config_json,
                status,
                topology_relation_type_state
              )
              values ($1, $2::uuid, $3::uuid, $4::uuid, 'primary', 'well_policy', $5::jsonb, 'active', '{}'::jsonb)
              `,
              [TENANT_ID, wellId, pumpId, valveId, JSON.stringify(relationConfig)],
              client
            );
          }
        }
      }
    }
  }

  private normalizeGraphDraft(draft: WorkbenchGraphDraft | undefined | null) {
    const usedPipeCodes = new Set<string>();
    const nodes = Array.isArray(draft?.nodes)
      ? draft!.nodes
          .map((item, index) => ({
            node_code: this.sanitizeCode(item.node_code, `node_${index + 1}`),
            node_name: typeof item.node_name === 'string' ? item.node_name.trim() || null : null,
            node_type: this.normalizeDraftNodeType(item.node_type),
            asset_id: item.asset_id ?? null,
            asset_ids: this.normalizeStringArray(item.asset_ids),
            device_ids: this.normalizeStringArray(item.device_ids),
            node_params: this.withNormalizedSourceStationParams(item.node_type, this.normalizeNodeParams(item.node_params)),
            pump_units: this.normalizePumpUnits(item.pump_units, this.sanitizeCode(item.node_code, `node_${index + 1}`)),
            cad_x: this.toNullableNumber(item.cad_x),
            cad_y: this.toNullableNumber(item.cad_y),
            latitude: this.toNullableNumber(item.latitude),
            longitude: this.toNullableNumber(item.longitude),
            altitude: this.toNullableNumber(item.altitude)
          }))
          .filter((item) => Boolean(item.node_code))
      : [];

    const nodeCodes = new Set(nodes.map((item) => item.node_code));

    const pipes = Array.isArray(draft?.pipes)
      ? draft!.pipes
          .map((item, index) => ({
            pipe_code: this.ensureUniqueCode(
              this.sanitizeCode(item.pipe_code, `pipe_${index + 1}`),
              usedPipeCodes,
              'pipe',
              index
            ),
            pipe_type: this.sanitizeCode(item.pipe_type, 'main').toLowerCase(),
            from_node_code: this.sanitizeCode(item.from_node_code, ''),
            to_node_code: this.sanitizeCode(item.to_node_code, ''),
            length_m: this.toNullableNumber(item.length_m),
            diameter_mm: this.toNullableNumber(item.diameter_mm),
            geometry_points: this.normalizePipeGeometryPoints(item.geometry_points)
          }))
          .filter((item) => Boolean(item.from_node_code && item.to_node_code))
      : [];

    const dedupedPipes = new Map<string, (typeof pipes)[number]>();
    for (const pipe of pipes) {
      const edgeKey = `${pipe.from_node_code}->${pipe.to_node_code}:${pipe.pipe_type || 'main'}`;
      if (!dedupedPipes.has(edgeKey)) {
        dedupedPipes.set(edgeKey, pipe);
      }
    }

    for (const pipe of dedupedPipes.values()) {
      if (!nodeCodes.has(pipe.from_node_code) || !nodeCodes.has(pipe.to_node_code)) {
        throw new BadRequestException(`graph_draft pipe ${pipe.pipe_code} references unknown node_code`);
      }
    }

    return {
      import_mode: draft?.import_mode?.trim() || 'manual_graph_draft',
      overwrite_existing: draft?.overwrite_existing !== false,
      nodes,
      pipes: [...dedupedPipes.values()]
    };
  }

  private async materializeGraphForVersion(
    versionId: string,
    graphDraft: WorkbenchGraphDraft,
    generatedFromRelationCount: number,
    client: any
  ): Promise<GraphMaterializationResult> {
    const normalized = this.normalizeGraphDraft(graphDraft);
    const existingCounts = await this.db.query(
      `
      select
        (select count(*)::int from network_node where version_id = $1::uuid) as node_count,
        (select count(*)::int from network_pipe where version_id = $1::uuid) as pipe_count
      `,
      [versionId],
      client
    );
    const existingNodeCount = Number(existingCounts.rows[0]?.node_count ?? 0);
    const existingPipeCount = Number(existingCounts.rows[0]?.pipe_count ?? 0);
    const replacedExistingGraph = existingNodeCount > 0 || existingPipeCount > 0;

    if (normalized.overwrite_existing !== false) {
      await this.db.query(`delete from network_pipe where version_id = $1::uuid`, [versionId], client);
      await this.db.query(`delete from network_node where version_id = $1::uuid`, [versionId], client);
    } else if (replacedExistingGraph) {
      throw new BadRequestException('graph_draft append mode is not supported when graph already exists');
    }

    const nodeIdByCode = new Map<string, string>();
    let hasCoordinates = false;

    for (const node of normalized.nodes ?? []) {
      const inserted = await this.db.query(
        `
        insert into network_node (version_id, node_code, node_type, asset_id, latitude, longitude, altitude)
        values ($1::uuid, $2, $3, $4::uuid, $5, $6, $7)
        returning id
        `,
        [
          versionId,
          node.node_code,
          node.node_type,
          node.asset_id,
          node.latitude,
          node.longitude,
          node.altitude
        ],
        client
      );
      nodeIdByCode.set(node.node_code, inserted.rows[0].id);
      if (node.latitude !== null && node.longitude !== null) {
        hasCoordinates = true;
      }
    }

    for (const pipe of normalized.pipes ?? []) {
      const fromNodeId = nodeIdByCode.get(pipe.from_node_code);
      const toNodeId = nodeIdByCode.get(pipe.to_node_code);
      if (!fromNodeId || !toNodeId) {
        throw new BadRequestException(`graph_draft pipe ${pipe.pipe_code} could not resolve node ids`);
      }

      await this.db.query(
        `
        insert into network_pipe (version_id, pipe_code, pipe_type, from_node_id, to_node_id, length_m, diameter_mm)
        values ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6, $7)
        `,
        [versionId, pipe.pipe_code, pipe.pipe_type, fromNodeId, toNodeId, pipe.length_m, pipe.diameter_mm],
        client
      );
    }

    return {
      version_id: versionId,
      graph_source: normalized.import_mode,
      generated_node_count: normalized.nodes.length,
      generated_pipe_count: normalized.pipes.length,
      replaced_existing_graph: replacedExistingGraph,
      generated_from_relation_count: generatedFromRelationCount,
      has_coordinates: hasCoordinates
    };
  }

  private async assertVersionHasPublishableSourceStations(versionId: string, client: any) {
    const invalidSourceStations = await this.db.query<{ node_code: string }>(
      `
      select node_code
      from network_node
      where version_id = $1::uuid
        and node_type = 'source_station'
        and (
          latitude is null
          or longitude is null
          or abs(latitude::float8) > 90
          or abs(longitude::float8) > 180
          or (latitude::float8 = 0 and longitude::float8 = 0)
        )
      order by node_code
      limit 5
      `,
      [versionId],
      client
    );

    if (invalidSourceStations.rows.length === 0) {
      return;
    }

    const labels = invalidSourceStations.rows
      .map((item) => String(item.node_code ?? '').trim())
      .filter(Boolean);
    throw new BadRequestException(
      `以下点位尚未补齐经纬度：${labels.join('、')}。请先设置基准点经纬度，或在 graph_draft 中回填点位坐标后再发布。`,
    );
  }

  getDeviceContract() {
    const transportPolicy = this.gateway.getTransportPolicy();
    const socketInfo = this.tcpServer.getSocketInfo();
    return {
      protocol_name: this.gateway.getProtocolName(),
      gateway_mode: socketInfo.enabled
        ? 'tcp_socket_plus_http_bridge_plus_serial_bridge_ready'
        : 'http_bridge_plus_serial_bridge_ready',
      simulator_mode: 'backend_scripted',
      transport: 'tcp+http',
      transport_socket: socketInfo,
      transport_modes: ['tcp_socket', 'http_bridge', 'serial_bridge'],
      transport_policy: transportPolicy,
      supported_event_types: [
        'DEVICE_REGISTERED',
        'DEVICE_HEARTBEAT',
        'DEVICE_STATE_SNAPSHOT',
        'DEVICE_QUERY_RESULT',
        'DEVICE_RUNTIME_TICK',
        'DEVICE_RUNTIME_STOPPED',
        'DEVICE_ALARM_RAISED',
        'DEVICE_COMMAND_ACKED',
        'DEVICE_COMMAND_NACKED'
      ],
      suggested_command_codes: ['QUERY', 'EXECUTE_ACTION', 'SYNC_CONFIG'],
      envelope_fields: [
        'protocol',
        'imei',
        'msg_id',
        'seq',
        'type',
        'ts',
        'correlation_id',
        'session_ref',
        'payload',
        'integrity'
      ],
      command_contracts: [
        {
          command_code: 'QUERY',
          wire_type: 'QUERY',
          expected_ack: 'DEVICE_QUERY_RESULT',
          followup_events: ['DEVICE_STATE_SNAPSHOT']
        },
        {
          command_code: 'EXECUTE_ACTION',
          wire_type: 'EXECUTE_ACTION',
          expected_ack: 'DEVICE_COMMAND_ACKED',
          followup_events: ['DEVICE_STATE_SNAPSHOT', 'DEVICE_RUNTIME_TICK', 'DEVICE_RUNTIME_STOPPED']
        },
        {
          command_code: 'SYNC_CONFIG',
          wire_type: 'SYNC_CONFIG',
          expected_ack: 'DEVICE_COMMAND_ACKED',
          followup_events: ['DEVICE_STATE_SNAPSHOT']
        }
      ],
      command_reference_rule: {
        accepted_correlation_keys: [
          'correlation_id',
          'device_command.command_id',
          'command_dispatch <- command_id mapping',
          'session_ref + logical command_code'
        ],
        preferred_embedded_key: 'correlation_id',
        backend_fallbacks: ['payload.command_code', 'session_ref + logical command_code']
      },
      session_reference_rule: {
        pattern: 'SIM-<timestamp>',
        source_of_truth: 'backend',
        frontend_role: 'read-only'
      },
      simulator_endpoints: {
        preview: '/api/v1/ops/device-gateway/simulator/preview',
        scripted_flow: '/api/v1/ops/device-gateway/simulator/script'
      },
      runtime_event_endpoints: {
        ingest: '/api/v1/ops/device-gateway/runtime-events',
        recent_events: '/api/v1/ops/device-gateway/events'
      },
      bridge_endpoints: {
        connect: '/api/v1/ops/device-gateway/bridge/connect',
        heartbeat: '/api/v1/ops/device-gateway/bridge/heartbeat',
        disconnect: '/api/v1/ops/device-gateway/bridge/disconnect'
      },
      serial_bridge: {
        mode: 'external_python_bridge',
        script_path: 'backend/scripts/device_gateway_serial_bridge.py',
        python_module: 'pyserial',
        line_protocol: 'newline_delimited_json',
        default_heartbeat_interval_seconds: 15,
        default_idle_state_snapshot_interval_seconds: 120,
        default_running_state_snapshot_interval_seconds: 10,
        supported_port_examples: ['COM3', 'loop://'],
        lifecycle: ['connect', 'heartbeat', 'disconnect']
      },
      bridge_capabilities: {
        heartbeat_dispatch_pending_default: false,
        heartbeat_can_embed_pending_commands: true,
        heartbeat_default_pending_limit: 20
      },
      command_queue_endpoints: {
        queue: '/api/v1/ops/device-gateway/commands',
        pending: '/api/v1/ops/device-gateway/pending-commands',
        queue_health: '/api/v1/ops/device-gateway/queue-health',
        connection_health: '/api/v1/ops/device-gateway/connection-health',
        recovery_health: '/api/v1/ops/device-gateway/recovery-health',
        dead_letters: '/api/v1/ops/device-gateway/dead-letters',
        sweep_retries: '/api/v1/ops/device-gateway/sweep-retries',
        sweep_connections: '/api/v1/ops/device-gateway/sweep-connections',
        manual_requeue: '/api/v1/ops/device-gateway/commands/:id/requeue'
      },
      transport_message_types: [
        'REGISTER',
        'HEARTBEAT',
        'STATE_SNAPSHOT',
        'EVENT_REPORT',
        'QUERY_RESULT',
        'COMMAND_ACK',
        'COMMAND_NACK'
      ],
      outbound_command_fields: [
        'v',
        't',
        'i',
        'm',
        's',
        'c',
        'r',
        'p'
      ],
      sample_payloads: {
        register: {
          v: 1,
          t: 'RG',
          p: {
            controller_code: 'scan_irrigation_controller_trial_v1',
            hs: 'SCAN-IRR-CTRL-4G',
            hr: 'A01',
            ff: 'SCAN-IRRIGATION-CONTROL',
            fv: '0.1.0',
            cv: 1,
            fm: ['pdc', 'svl', 'cdr', 'pay'],
            cap_ver: 3,
            cap_hash: 'sha256:8d1a97f4c4d0f2b8',
            config_bitmap: '0x0000001f',
            actions_bitmap: '0x0000003f',
            queries_bitmap: '0x00000007',
            limits: {
              max_inflight_control: 1,
              event_queue_depth: 8,
              ota_block_bytes: 512,
            },
          }
        },
        heartbeat: {
          v: 1,
          t: 'HB',
          p: {
            csq: 19,
            bs: 86,
            rd: true,
            cv: 1,
            cap_hash: 'sha256:8d1a97f4c4d0f2b8',
          }
        },
        state_snapshot: {
          v: 1,
          t: 'SS',
          p: {
            wf: 'RI',
            ch: [
              { mc: 'prs', cc: 'pressure_1', v: 0.1264 },
              { mc: 'flw', cc: 'flow_1', v: 0 }
            ]
          }
        },
        alarm: {
          v: 1,
          t: 'ER',
          p: { event_code: 'pressure_high', severity: 'high', message: 'pressure exceeded threshold' }
        },
        command_acked: {
          v: 1,
          t: 'AK',
          c: 'device-command-token-or-dispatch-id',
          p: {
            command_code: 'START_SESSION',
            ac: 'st',
            result: 'accepted'
          }
        },
        command_nacked: {
          v: 1,
          t: 'NK',
          c: 'device-command-token-or-dispatch-id',
          p: {
            command_code: 'START_PUMP',
            ac: 'sv',
            result: 'rejected',
            retryable: true,
            reason_code: 'pump_not_ready'
          }
        },
        pending_command: {
          v: 1,
          t: 'EX',
          c: 'device-command-token-or-dispatch-id',
          p: {
            sc: 'wf',
            ac: 'st',
            sid: 'S-6601D010'
          }
        }
      }
    };
  }

  previewSimulator(input?: {
    scenario?: string;
    imei?: string;
    action?: string;
    session_ref?: string;
    command_id?: string;
  }) {
    const scenario = input?.scenario ?? 'heartbeat';
    const imei = input?.imei ?? 'SIM-DEVICE-0001';
    const now = new Date().toISOString();
    const msgId = `preview-${scenario}-${Date.now()}`;
    const seqNo = Number(String(Date.now()).slice(-6));

    const picked =
      {
        heartbeat: {
          eventType: 'DEVICE_HEARTBEAT',
          msgType: 'HB',
          payload: { signal_dbm: -65, battery_percent: 88 }
        },
        state_snapshot: {
          eventType: 'DEVICE_STATE_SNAPSHOT',
          msgType: 'SS',
          payload: { pump_state: 'running', valve_state: 'open', pressure_kpa: 131.8, flow_m3h: 22.4 }
        },
        alarm: {
          eventType: 'DEVICE_ALARM_RAISED',
          msgType: 'ER',
          alarmCodes: ['PRESSURE_HIGH'],
          payload: { alarm_code: 'PRESSURE_HIGH', severity: 'high', message: 'pressure exceeded threshold' }
        },
        command_acked: {
          eventType: 'DEVICE_COMMAND_ACKED',
          msgType: 'AK',
          payload: {
            command_code: input?.action ?? 'START_SESSION',
            command_id: input?.command_id ?? 'preview-command',
            result: 'acked'
          }
        }
      }[scenario] ??
      {
        eventType: 'DEVICE_HEARTBEAT',
        msgType: 'HB',
        payload: { signal_dbm: -65, battery_percent: 88 }
      };

    return {
      mode: 'preview_only',
      envelope: {
        v: 1,
        i: imei,
        m: msgId,
        s: seqNo,
        t: picked.msgType,
        ts: now,
        c: input?.command_id ?? null,
        r: input?.session_ref ?? null,
        p: picked.payload,
        integrity: { checksum: 'preview-only' }
      },
      runtime_event: {
        eventType: picked.eventType,
        imei,
        msgId,
        seqNo,
        msgType: picked.msgType,
        deviceTs: now,
        serverRxTs: now,
        sessionRef: input?.session_ref ?? null,
        commandId: input?.command_id ?? null,
        startToken: null,
        counters: { runtimeSec: 3600, energyWh: 12800, flow: 52.3 },
        payload: picked.payload,
        idempotencyKey: `${imei}:${msgId}`,
        orderingKey: `${imei}:${input?.session_ref ?? 'standalone'}`,
        clockDriftSec: 0
      }
    };
  }

  private normalizeSchedulingParams(promptJson: unknown, updatedAt: Date | string | null) {
    const prompt = this.asObject(promptJson);
    const runtimeDefaults = this.asObject(prompt.runtimeDefaults);
    const alertRules = this.asObject(prompt.alertRules);
    const toBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
    const toNumber = (value: unknown, fallback: number) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };
    const toTime = (value: unknown, fallback: string) =>
      typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;

    return {
      auto_dispatch_enabled: toBoolean(prompt.autoDispatchEnabled, true),
      dispatch_window_start: toTime(prompt.dispatchWindowStart, '05:00'),
      dispatch_window_end: toTime(prompt.dispatchWindowEnd, '21:00'),
      max_parallel_sessions: toNumber(runtimeDefaults.concurrencyLimit, 4),
      alert_auto_pause_enabled: toBoolean(alertRules.autoPauseEnabled, true),
      high_severity_pause_threshold: toNumber(alertRules.highSeverityPauseThreshold, 2),
      dispatch_retry_limit: toNumber(prompt.dispatchRetryLimit, 2),
      updated_at: this.toIso(updatedAt)
    };
  }

  async resolveContext(projectId?: string, blockId?: string) {
    const projectsResult = await this.db.query(
      `select id, project_code, project_name, status from project order by created_at asc`
    );
    const projects = projectsResult.rows;
    const selectedProjectId = projectId ?? projects[0]?.id ?? null;
    const blocksResult = selectedProjectId
      ? await this.db.query(
          `
          select id, project_id, block_code, block_name, status
          from project_block
          where tenant_id = $1 and project_id = $2::uuid
          order by priority desc, created_at asc
          `,
          [TENANT_ID, selectedProjectId]
        )
      : { rows: [] as any[] };
    const blocks = blocksResult.rows;
    const selectedBlockId = blockId ?? blocks[0]?.id ?? null;
    const selectedBlockResult = selectedBlockId
      ? await this.db.query(
          `
          select id, project_id, block_code, block_name, status, area_size, center_latitude, center_longitude, boundary_geojson
          from project_block
          where tenant_id = $1 and id = $2::uuid
          limit 1
          `,
          [TENANT_ID, selectedBlockId]
        )
      : { rows: [] as any[] };
    return {
      projects,
      blocks,
      selected_project_id: selectedProjectId,
      selected_block_id: selectedBlockId,
      selected_block: selectedBlockResult.rows[0] ?? null
    };
  }

  private requireExplicitWorkbenchScope(projectId?: string, blockId?: string) {
    const normalizedProjectId = projectId?.trim();
    if (!normalizedProjectId) {
      throw new BadRequestException('project_id is required');
    }

    const normalizedBlockId = blockId?.trim();
    if (!normalizedBlockId) {
      throw new BadRequestException('block_id is required');
    }

    return {
      projectId: normalizedProjectId,
      blockId: normalizedBlockId
    };
  }

  private async resolveOrCreateNetworkModel(projectId: string) {
    const existing = await this.db.query(
      `
      select id, project_id, model_name, source_type, status
      from network_model
      where tenant_id = $1 and project_id = $2::uuid
      order by updated_at desc, created_at desc
      limit 1
      `,
      [TENANT_ID, projectId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const project = await this.db.query(`select project_name from project where id = $1::uuid limit 1`, [projectId]);
    const inserted = await this.db.query(
      `
      insert into network_model (tenant_id, project_id, model_name, source_type, status)
      values ($1, $2::uuid, $3, 'dwg', 'draft')
      returning id, project_id, model_name, source_type, status
      `,
      [TENANT_ID, projectId, `${project.rows[0]?.project_name ?? '项目'}网络模型`]
    );
    return inserted.rows[0];
  }

  private async loadGraph(versionId: string) {
    const [nodesResult, pipesResult] = await Promise.all([
      this.db.query(
        `
        select
          nn.id,
          nn.node_code,
          nn.node_type,
          nn.asset_id,
          a.asset_name,
          nn.latitude::float8 as latitude,
          nn.longitude::float8 as longitude,
          nn.altitude::float8 as altitude
        from network_node nn
        left join asset a on a.id = nn.asset_id
        where nn.version_id = $1::uuid
        order by nn.node_code asc
        limit 300
        `,
        [versionId]
      ),
      this.db.query(
        `
        select
          np.id,
          np.pipe_code,
          np.pipe_type,
          np.from_node_id,
          np.to_node_id,
          fn.node_code as from_node_code,
          tn.node_code as to_node_code,
          np.length_m::float8 as length_m,
          np.diameter_mm::float8 as diameter_mm
        from network_pipe np
        join network_node fn on fn.id = np.from_node_id
        join network_node tn on tn.id = np.to_node_id
        where np.version_id = $1::uuid
        order by np.pipe_code asc
        limit 300
        `,
        [versionId]
      )
    ]);

    return {
      nodes: nodesResult.rows,
      pipes: pipesResult.rows
    };
  }

  private async loadModelVersionRows(networkModelId: string | null, client?: any) {
    if (!networkModelId) return [];
    const result = await this.db.query(
      `
      select
        nmv.id,
        nmv.block_id::text as block_id,
        nmv.version_no,
        nmv.is_published,
        nmv.published_at,
        nmv.source_file_ref,
        nmv.source_meta_json,
        nmv.created_at,
        count(distinct nn.id)::int as node_count,
        count(distinct np.id)::int as pipe_count
      from network_model_version nmv
      left join network_node nn on nn.version_id = nmv.id
      left join network_pipe np on np.version_id = nmv.id
      where nmv.network_model_id = $1::uuid
      group by nmv.id
      order by nmv.version_no desc, nmv.created_at desc
      `,
      [networkModelId],
      client
    );
    return result.rows;
  }

  async loadModelVersions(networkModelId: string | null) {
    return (await this.loadModelVersionRows(networkModelId)).map((item) => this.normalizeModelVersionRow(item));
  }

  async loadMeteringPoints(projectId: string | null, blockId: string | null) {
    if (!projectId) return [];
    const params: unknown[] = [TENANT_ID, projectId];
    const blockFilter = blockId ? `and mp.block_id = $3::uuid` : '';
    if (blockId) params.push(blockId);
    const result = await this.db.query(
      `
      select
        mp.id,
        mp.metering_point_code,
        coalesce(mp.point_name, mp.metering_point_code) as point_name,
        mp.status,
        coalesce(d.device_name, d.device_code) as primary_meter_device_name
      from metering_point mp
      left join device d on d.id = mp.primary_meter_device_id
      where mp.tenant_id = $1
        and mp.project_id = $2::uuid
        ${blockFilter}
      order by mp.created_at asc
      limit 20
      `,
      params
    );
    return result.rows;
  }

  async loadNetworkModel(projectId: string | null, blockId?: string | null) {
    if (!projectId) return null;
    const result = await this.db.query(
      `
      select id, model_name, source_type, status
      from network_model
      where tenant_id = $1
        and project_id = $2::uuid
      order by updated_at desc, created_at desc
      limit 1
      `,
      [TENANT_ID, projectId]
    );
    const model = result.rows[0];
    if (!model) return null;

    const versions = await this.loadModelVersions(model.id);
    const scopedPublishedVersion =
      this.filterVersionsForBlock(versions, blockId, false).find((item) => item.is_published) ?? null;

    if (!scopedPublishedVersion) {
      return {
        id: model.id,
        model_name: model.model_name,
        source_type: model.source_type,
        status: model.status,
        published_version: null,
        preview_nodes: [],
        preview_pipes: []
      };
    }

    const graph = this.hasUsableGraph(scopedPublishedVersion)
      ? await this.loadGraph(scopedPublishedVersion.id)
      : { nodes: [], pipes: [] };

    return {
      id: model.id,
      model_name: model.model_name,
      source_type: model.source_type,
      status: model.status,
      published_version: scopedPublishedVersion,
      preview_nodes: graph.nodes.slice(0, 80),
      preview_pipes: graph.pipes.slice(0, 80)
    };
  }

  async loadPumpValveRelations(projectId: string | null, blockId: string | null, client?: any) {
    const params: unknown[] = [TENANT_ID];
    const filters: string[] = [];
    if (projectId) {
      params.push(projectId);
      filters.push(`pb.project_id = $${params.length}::uuid`);
    }
    if (blockId) {
      params.push(blockId);
      filters.push(`w.block_id = $${params.length}::uuid`);
    }
    const where = filters.length ? `and ${filters.join(' and ')}` : '';
    const result = await this.db.query(
      `
      select
        pvr.id,
        w.device_id as well_device_id,
        w.id as well_id,
        coalesce(w.safety_profile_json->>'displayName', w.well_code) as well_name,
        p.device_id as pump_device_id,
        coalesce(pd.device_name, p.pump_code) as pump_name,
        v.device_id as valve_device_id,
        coalesce(vd.device_name, v.valve_code) as valve_name,
        coalesce(pvr.relation_config_json->>'sequence', 'valve_first') as sequence,
        coalesce((pvr.relation_config_json->>'valveDelaySeconds')::int, 0) as valve_delay_seconds,
        coalesce((pvr.relation_config_json->>'pumpDelaySeconds')::int, 0) as pump_delay_seconds,
        pvr.status
      from pump_valve_relation pvr
      join well w on w.id = pvr.well_id
      left join project_block pb on pb.id = w.block_id
      join pump p on p.id = pvr.pump_id
      join valve v on v.id = pvr.valve_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      where pvr.tenant_id = $1
      ${where}
      order by pvr.created_at asc
      `,
      params,
      client
    );
    return result.rows;
  }

  async loadDeviceRelations(projectId: string | null, blockId: string | null) {
    const params: unknown[] = [TENANT_ID];
    let scopeSql = '';
    if (blockId) {
      params.push(blockId);
      scopeSql = `and w.block_id = $${params.length}::uuid`;
    } else if (projectId) {
      params.push(projectId);
      scopeSql = `and pb.project_id = $${params.length}::uuid`;
    }
    const result = await this.db.query(
      `
      with scoped_devices as (
        select w.device_id
        from well w
        left join project_block pb on pb.id = w.block_id
        where w.tenant_id = $1
        ${scopeSql}
        union
        select p.device_id
        from pump p
        join well w on w.id = p.well_id
        left join project_block pb on pb.id = w.block_id
        where p.tenant_id = $1
        ${scopeSql}
        union
        select v.device_id
        from valve v
        join well w on w.id = v.well_id
        left join project_block pb on pb.id = w.block_id
        where v.tenant_id = $1
        ${scopeSql}
      )
      select
        tr.id,
        tr.source_id as source_device_id,
        sd.device_name as source_device_name,
        tr.target_id as target_device_id,
        td.device_name as target_device_name,
        tr.relation_type,
        tr.status,
        coalesce(tr.config_json->>'sequence_rule', null) as sequence_rule,
        coalesce((tr.config_json->>'delay_seconds')::int, null) as delay_seconds,
        coalesce(tr.config_json->>'generated_source', null) as generated_source,
        coalesce(tr.config_json->>'generation_strategy', null) as generation_strategy
      from topology_relation tr
      join device sd on sd.id = tr.source_id
      join device td on td.id = tr.target_id
      where tr.tenant_id = $1
        and tr.source_type = 'device'
        and tr.target_type = 'device'
        and (
          tr.source_id in (select device_id from scoped_devices)
          or tr.target_id in (select device_id from scoped_devices)
        )
      order by tr.updated_at desc, tr.created_at desc
      `,
      params
    );
    return result.rows;
  }

  buildConfigReadiness(input: {
    selected_project_id: string | null;
    selected_block_id: string | null;
    metering_points: any[];
    network_model: any;
    pump_valve_relations: any[];
    device_relations: any[];
  }) {
    const blockers: string[] = [];
    const nextActions: string[] = [];
    if (!input.selected_project_id) blockers.push('缺少项目上下文');
    if (!input.selected_block_id) blockers.push('缺少区块上下文');
    if (!input.network_model) blockers.push('当前项目还没有网络模型');
    if (input.network_model && !input.network_model.published_version) blockers.push('当前网络模型还没有已发布版本');
    if (
      input.network_model?.published_version &&
      !input.network_model?.published_version?.source_file_ref
    ) {
      blockers.push('当前网络模型还没有登记图源 / DWG 引用');
    }
    if (input.pump_valve_relations.length === 0) blockers.push('当前范围内还没有井泵阀关系');
    if (input.pump_valve_relations.length > 0 && input.device_relations.length === 0) {
      nextActions.push('请先在台账中维护设备联动关系');
    }
    if (!input.network_model?.published_version) nextActions.push('先登记图源并发布网络模型版本，再进入调度');
    if (input.metering_points.length === 0) nextActions.push('建议补齐区块默认计量点，便于后续计费、核算与报表');
    if (nextActions.length === 0) nextActions.push('配置已具备，可进入调度工作台');
    return { ready: blockers.length === 0, blockers, next_actions: nextActions };
  }

  private buildRuntimeReadiness(input: {
    selected_project_id: string | null;
    selected_block_id: string | null;
    metering_points: any[];
    network_model: any;
    pump_valve_relations: any[];
    device_relations: any[];
  }) {
    const blockers: string[] = [];
    const nextActions: string[] = [];
    const publishedVersion = input.network_model?.published_version ?? null;

    if (!input.selected_project_id) blockers.push('missing project context');
    if (!input.selected_block_id) blockers.push('missing block context');
    if (!input.network_model) blockers.push('project has no network model');
    if (input.network_model && !publishedVersion) blockers.push('network model has no published version');
    if (publishedVersion && !publishedVersion.source_file_ref) {
      blockers.push('published network model has no DWG/source reference');
    }
    if (publishedVersion && !this.hasUsableGraph(publishedVersion)) {
      blockers.push('published network model still has no usable node/pipe graph');
    }
    if (input.pump_valve_relations.length === 0) blockers.push('current scope has no well-pump-valve relation');
    if (input.pump_valve_relations.length > 0 && input.device_relations.length === 0) {
      nextActions.push('save config and let backend auto-generate device relations');
    }
    if (!publishedVersion) nextActions.push('publish a network model version before dispatch');
    if (publishedVersion && !this.hasUsableGraph(publishedVersion)) {
      nextActions.push('import or persist graph nodes/pipes onto the published version');
    }
    if (input.metering_points.length === 0) {
      nextActions.push('create a default metering point later for billing, accounting, and reporting');
    }
    if (nextActions.length === 0) nextActions.push('configuration is ready for backend scheduling and backend simulation');
    return { ready: blockers.length === 0, blockers, next_actions: nextActions };
  }

  async getConfig(projectId?: string, blockId?: string) {
    const context = await this.resolveContext(projectId, blockId);
    const [meteringPoints, networkModel, pumpValveRelations, deviceRelations] = await Promise.all([
      this.loadMeteringPoints(context.selected_project_id, context.selected_block_id),
      this.loadNetworkModel(context.selected_project_id, context.selected_block_id),
      this.loadPumpValveRelations(context.selected_project_id, context.selected_block_id),
      this.loadDeviceRelations(context.selected_project_id, context.selected_block_id)
    ]);
    const modelVersions = this.filterVersionsForBlock(
      await this.loadModelVersions(networkModel?.id ?? null),
      context.selected_block_id,
      false,
    );
    const autoGeneratedTotal = deviceRelations.filter((item: any) => item.generated_source === 'network_workbench').length;
    return {
      ...context,
      metering_points: meteringPoints,
      network_model: networkModel,
      model_versions: modelVersions,
      pump_valve_relations: { total: pumpValveRelations.length, items: pumpValveRelations },
      device_relations: { total: deviceRelations.length, auto_generated_total: autoGeneratedTotal, items: deviceRelations },
      device_contract: this.getDeviceContract(),
      readiness: this.buildRuntimeReadiness({
        selected_project_id: context.selected_project_id,
        selected_block_id: context.selected_block_id,
        metering_points: meteringPoints,
        network_model: networkModel,
        pump_valve_relations: pumpValveRelations,
        device_relations: deviceRelations
      })
    };
  }

  async getGraph(projectId?: string, blockId?: string, versionId?: string) {
    const context = await this.resolveContext(projectId, blockId);
    const networkModel = await this.loadNetworkModel(context.selected_project_id, context.selected_block_id);
    const modelVersions = await this.loadModelVersions(networkModel?.id ?? null);
    const selectedVersion =
      this.pickVersionForConfig(modelVersions, versionId, {
        preferredBlockId: context.selected_block_id,
        fallbackToAnyBlock: false,
      }) ?? null;

    if (!selectedVersion) {
      return {
        ...context,
        network_model: networkModel,
        selected_version: null,
        nodes: [],
        pipes: [],
        stats: {
          node_count: 0,
          pipe_count: 0,
          with_coordinates_count: 0
        }
      };
    }

    const graph = await this.loadGraph(selectedVersion.id);
    return {
      ...context,
      network_model: networkModel,
      selected_version: selectedVersion,
      nodes: graph.nodes,
      pipes: graph.pipes,
      stats: {
        node_count: graph.nodes.length,
        pipe_count: graph.pipes.length,
        with_coordinates_count: graph.nodes.filter(
          (item: any) => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))
        ).length
      }
    };
  }

  async getDispatch(projectId?: string, blockId?: string) {
    const config = await this.getConfig(projectId, blockId);
    const paramsResult = await this.db.query(
      `
      select prompt_json, updated_at
      from interaction_policy
      where tenant_id = $1
        and target_type = 'system'
        and scene_code = 'auto_scheduling'
      order by updated_at desc
      limit 1
      `,
      [TENANT_ID]
    );

    const params: unknown[] = [TENANT_ID];
    let scopeSql = '';
    if (config.selected_block_id) {
      params.push(config.selected_block_id);
      scopeSql = `and w.block_id = $${params.length}::uuid`;
    } else if (config.selected_project_id) {
      params.push(config.selected_project_id);
      scopeSql = `and pb.project_id = $${params.length}::uuid`;
    }

    const runtimeResult = await this.db.query(
      `
      select
        coalesce((
          select count(*)::int
          from runtime_session rs
          join well w on w.id = rs.well_id
          left join project_block pb on pb.id = w.block_id
          where w.tenant_id = $1
            and rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
          ${scopeSql}
        ), 0) as running_session_count,
        coalesce((
          select count(distinct rs.well_id)::int
          from runtime_session rs
          join well w on w.id = rs.well_id
          left join project_block pb on pb.id = w.block_id
          where w.tenant_id = $1
            and rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
          ${scopeSql}
        ), 0) as running_well_count,
        coalesce((
          select count(*)::int
          from runtime_container rc
          join well w on w.id = rc.well_id
          left join project_block pb on pb.id = w.block_id
          where w.tenant_id = $1
          ${scopeSql}
        ), 0) as runtime_container_count
      `,
      params
    );

    const defaultPumpValveRelationId = config.pump_valve_relations.items[0]?.id ?? null;
    const solverReady = Boolean(
      config.network_model?.published_version?.id &&
        this.hasUsableGraph(config.network_model?.published_version) &&
        defaultPumpValveRelationId
    );
    const blockers = [...config.readiness.blockers];
    if (!solverReady) blockers.push('求解器缺少已发布网络模型或井泵阀关系输入');

    return {
      ...config,
      scheduling_params: this.normalizeSchedulingParams(
        paramsResult.rows[0]?.prompt_json ?? {},
        paramsResult.rows[0]?.updated_at ?? null
      ),
      runtime_summary: runtimeResult.rows[0] ?? {
        running_session_count: 0,
        running_well_count: 0,
        runtime_container_count: 0
      },
      solver: {
        ready: solverReady,
        contract_version: 'solver-v2-published-network',
        network_model_version_id: config.network_model?.published_version?.id ?? null,
        default_pump_valve_relation_id: defaultPumpValveRelationId,
        request_preview: solverReady
          ? {
              network_model_version_id: config.network_model?.published_version?.id ?? null,
              project_id: config.selected_project_id ?? null,
              block_ids: config.selected_block_id ? [config.selected_block_id] : [],
              pump_valve_relation_id: defaultPumpValveRelationId
            }
          : null
      },
      simulator: {
        simulator_mode: 'backend_scripted',
        flow_preview_available: Boolean(defaultPumpValveRelationId),
        script_endpoint: '/api/v1/ops/device-gateway/simulator/script',
        default_relation_id: defaultPumpValveRelationId
      },
      readiness: {
        ready: blockers.length === 0,
        blockers,
        next_actions:
          blockers.length === 0
            ? ['可以直接进入后端调度与设备模拟联调']
            : ['先回配置工作台补齐已发布模型、图源登记，并在台账中维护联动关系']
      }
    };
  }

  async getHandoffPackage(projectId?: string, blockId?: string): Promise<WorkbenchHandoffPackage> {
    const dispatch = await this.getDispatch(projectId, blockId);
    const graph = await this.getGraph(
      dispatch.selected_project_id ?? undefined,
      dispatch.selected_block_id ?? undefined,
      dispatch.network_model?.published_version?.id ?? undefined
    );
    const sourceMeta = this.asObject(dispatch.network_model?.published_version?.source_meta);
    const defaultRelationId =
      dispatch.solver?.default_pump_valve_relation_id ??
      dispatch.simulator?.default_relation_id ??
      dispatch.pump_valve_relations.items[0]?.id ??
      null;

    const solverPreview =
      dispatch.solver?.ready && dispatch.solver?.request_preview?.network_model_version_id
        ? await this.solver.preview({
            network_model_version_id: dispatch.solver.request_preview.network_model_version_id,
            project_id: dispatch.solver.request_preview.project_id,
            block_ids: dispatch.solver.request_preview.block_ids ?? [],
            pump_valve_relation_id: dispatch.solver.request_preview.pump_valve_relation_id,
            constraints: {
              run_minutes: 20
            }
          })
        : null;

    const simulatorScript = defaultRelationId
      ? await this.simulateScript({
          project_id: dispatch.selected_project_id ?? undefined,
          block_id: dispatch.selected_block_id ?? undefined,
          pump_valve_relation_id: defaultRelationId
        })
      : null;
    const recentGatewayEvents = await this.gateway.listRecentEvents({ limit: 8 });
    const recentPendingCommands = await this.gateway.pullPendingCommands({
      limit: 8,
      include_sent: true,
      mark_sent: false
    });
    const queueHealth = await this.gateway.getQueueHealth();
    const connectionHealth = await this.gateway.getConnectionHealth();
    const recoveryHealth = this.gatewayMaintainer.getRecoveryHealth();
    const recoveryRecommendations = await this.gateway.getRecoveryRecommendations();
    const recentDeadLetters = await this.gateway.listDeadLetters({ limit: 5 });

    return {
      handoff_version: 'network-workbench-handoff-v1',
      selector_options: {
        projects: dispatch.projects,
        blocks: dispatch.blocks,
        selected_block: dispatch.selected_block ?? null
      },
      scope: {
        project_id: dispatch.selected_project_id ?? null,
        project_name:
          dispatch.projects.find((item: any) => item.id === dispatch.selected_project_id)?.project_name ?? null,
        block_id: dispatch.selected_block_id ?? null,
        block_name: dispatch.selected_block?.block_name ?? null,
        block_code: dispatch.selected_block?.block_code ?? null
      },
      config_readiness: dispatch.readiness,
      network_model: {
        model_id: dispatch.network_model?.id ?? null,
        model_name: dispatch.network_model?.model_name ?? null,
        source_type: dispatch.network_model?.source_type ?? null,
        published_version: dispatch.network_model?.published_version ?? null,
        graph_stats: graph.stats,
        source_import: {
          parser_mode: typeof sourceMeta.parser_mode === 'string' ? sourceMeta.parser_mode : null,
          source_kind: typeof sourceMeta.source_kind === 'string' ? sourceMeta.source_kind : null,
          map_provider: typeof sourceMeta.map_provider === 'string' ? sourceMeta.map_provider : null,
          relation_strategy: typeof sourceMeta.relation_strategy === 'string' ? sourceMeta.relation_strategy : null,
          source_file_ref: dispatch.network_model?.published_version?.source_file_ref ?? null,
          source_file_name: typeof sourceMeta.source_file_name === 'string' ? sourceMeta.source_file_name : null,
          source_file_digest: typeof sourceMeta.source_file_digest === 'string' ? sourceMeta.source_file_digest : null,
          sidecar_manifest_ref:
            typeof sourceMeta.sidecar_manifest_ref === 'string' ? sourceMeta.sidecar_manifest_ref : null,
          detected_layers: Array.isArray(sourceMeta.detected_layers)
            ? sourceMeta.detected_layers.filter((item): item is string => typeof item === 'string')
            : [],
          layer_mapping: this.normalizeLayerMapping(sourceMeta.layer_mapping as WorkbenchLayerMapping | null),
          import_next_step: typeof sourceMeta.import_next_step === 'string' ? sourceMeta.import_next_step : null
        }
      },
      topology: {
        pump_valve_relations: {
          total: dispatch.pump_valve_relations.total,
          default_relation_id: defaultRelationId,
          items: dispatch.pump_valve_relations.items
        },
        device_relations: dispatch.device_relations
      },
      dispatch_runtime: {
        scheduling_params: dispatch.scheduling_params,
        runtime_summary: dispatch.runtime_summary,
        solver: dispatch.solver,
        simulator: dispatch.simulator
      },
      gateway_observability: {
        recent_events: recentGatewayEvents.items,
        pending_commands: recentPendingCommands.items,
        pending_queue_total: recentPendingCommands.total,
        queue_health: queueHealth,
        connection_health: connectionHealth,
        recovery_health: recoveryHealth,
        recovery_recommendations: recoveryRecommendations,
        recent_dead_letters: recentDeadLetters.items
      },
      embedded_contract: {
        backend_truth_rule: 'frontend_read_only_backend_truth',
        interface_owner: 'backend',
        device_protocol: this.getDeviceContract(),
        backend_endpoints: {
          config: '/api/v1/ops/network-workbench/config',
          graph: '/api/v1/ops/network-workbench/network-model/graph',
          dispatch: '/api/v1/ops/network-workbench/dispatch',
          handoff_package: '/api/v1/ops/network-workbench/handoff-package',
          generate_relations: '/api/v1/ops/network-workbench/generate-relations',
            solver_preview: '/api/v1/ops/solver/preview',
            simulator_preview: '/api/v1/ops/device-gateway/simulator/preview',
            simulator_script: '/api/v1/ops/device-gateway/simulator/script',
            runtime_event_ingest: '/api/v1/ops/device-gateway/runtime-events',
            gateway_events: '/api/v1/ops/device-gateway/events',
            gateway_queue_command: '/api/v1/ops/device-gateway/commands',
            gateway_pending_commands: '/api/v1/ops/device-gateway/pending-commands',
            gateway_queue_health: '/api/v1/ops/device-gateway/queue-health',
            gateway_connection_health: '/api/v1/ops/device-gateway/connection-health',
            gateway_recovery_health: '/api/v1/ops/device-gateway/recovery-health',
            gateway_recovery_recommendations: '/api/v1/ops/device-gateway/recovery-recommendations',
            gateway_bridge_connect: '/api/v1/ops/device-gateway/bridge/connect',
            gateway_bridge_heartbeat: '/api/v1/ops/device-gateway/bridge/heartbeat',
            gateway_bridge_disconnect: '/api/v1/ops/device-gateway/bridge/disconnect',
            gateway_dead_letters: '/api/v1/ops/device-gateway/dead-letters',
            gateway_sweep_retries: '/api/v1/ops/device-gateway/sweep-retries',
            gateway_sweep_connections: '/api/v1/ops/device-gateway/sweep-connections',
            gateway_manual_requeue: '/api/v1/ops/device-gateway/commands/:id/requeue'
          },
        expectations: [
          '配置完成后由后端持久化网络模型，设备与联动关系需由台账流程维护',
          '前端只消费后端交接包，不承担设备模拟器或求解器职责',
          '嵌入式联调以 backend handoff package、solver preview 和 simulator script 为准',
          '真实硬件 ACK 接入后，应继续复用同一 protocol_name、command_contracts 和 session_reference_rule'
        ]
      },
      solver_preview: solverPreview,
      simulator_script: simulatorScript
    };
  }

  async generateRelations(
    projectId?: string,
    blockId?: string,
    generationStrategy = 'pump_chain_auto'
  ): Promise<RelationGenerationResult> {
    let pumpValveRelations = await this.loadPumpValveRelations(projectId ?? null, blockId ?? null);
    const createdRelationIds: string[] = [];
    const updatedRelationIds: string[] = [];

    await this.db.withTransaction(async (client) => {
      for (const relation of pumpValveRelations as any[]) {
        for (const item of [
          {
            sourceDeviceId: relation.well_device_id,
            targetDeviceId: relation.pump_device_id,
            relationType: 'control',
            priority: 100,
            status: relation.status,
            config: {
              generated_source: 'network_workbench',
              generation_strategy: generationStrategy,
              generated_from_pump_valve_relation_id: relation.id,
              sequence_rule: 'source_first',
              delay_seconds: relation.pump_delay_seconds,
              remarks: `auto-generated from pump-valve relation ${relation.id}`
            }
          },
          {
            sourceDeviceId: relation.pump_device_id,
            targetDeviceId: relation.valve_device_id,
            relationType: 'sequence_delayed',
            priority: 90,
            status: relation.status,
            config: {
              generated_source: 'network_workbench',
              generation_strategy: generationStrategy,
              generated_from_pump_valve_relation_id: relation.id,
              sequence_rule: relation.sequence === 'simultaneous' ? 'simultaneous' : 'target_first',
              delay_seconds: relation.valve_delay_seconds,
              remarks: `auto-generated from pump-valve relation ${relation.id}`
            }
          }
        ]) {
          const existing = await this.db.query(
            `
            select id
            from topology_relation
            where tenant_id = $1
              and source_type = 'device'
              and target_type = 'device'
              and source_id = $2::uuid
              and target_id = $3::uuid
              and relation_type = $4
            limit 1
            `,
            [TENANT_ID, item.sourceDeviceId, item.targetDeviceId, item.relationType],
            client
          );

          if (existing.rows[0]) {
            await this.db.query(
              `
              update topology_relation
              set priority = $3,
                  status = $4,
                  config_json = coalesce(config_json, '{}'::jsonb) || $5::jsonb,
                  updated_at = now()
              where id = $1::uuid and tenant_id = $2
              `,
              [existing.rows[0].id, TENANT_ID, item.priority, item.status, JSON.stringify(item.config)],
              client
            );
            updatedRelationIds.push(existing.rows[0].id);
          } else {
            const inserted = await this.db.query(
              `
              insert into topology_relation (
                tenant_id, source_type, source_id, target_type, target_id, relation_type, priority, status, config_json
              )
              values ($1, 'device', $2::uuid, 'device', $3::uuid, $4, $5, $6, $7::jsonb)
              returning id
              `,
              [
                TENANT_ID,
                item.sourceDeviceId,
                item.targetDeviceId,
                item.relationType,
                item.priority,
                item.status,
                JSON.stringify(item.config)
              ],
              client
            );
            createdRelationIds.push(inserted.rows[0].id);
          }
        }
      }
    });

    const config = await this.getConfig(projectId, blockId);
    return {
      scanned_pump_valve_relations: pumpValveRelations.length,
      created_relation_count: createdRelationIds.length,
      updated_relation_count: updatedRelationIds.length,
      created_relation_ids: createdRelationIds,
      updated_relation_ids: updatedRelationIds,
      device_relations: config.device_relations,
      readiness: config.readiness
    };
  }

  async saveConfig(input: WorkbenchSaveConfigInput) {
    const scope = this.requireExplicitWorkbenchScope(input.project_id, input.block_id);
    const context = await this.resolveContext(scope.projectId, scope.blockId);
    if (!context.selected_project_id) {
      throw new BadRequestException('project_id is required');
    }
    if (!context.selected_block_id) {
      throw new BadRequestException('block_id is required');
    }

    const networkModel = await this.resolveOrCreateNetworkModel(context.selected_project_id);
    const sourceAnalysis = await this.resolveSourceImport(input, context);
    const textEncodingPolicy = {
      charset: 'utf-8',
      unicode_normal_form: 'NFC',
      cad_label_mojibake: 'repair_utf8_bytes_read_as_gb18030_v1'
    };
    let effectiveSourceMeta: Record<string, unknown> = {
      ...(this.deepNormalizeUnicodeStringsInJson({
        ...this.buildNormalizedSourceMeta(input, context.selected_block_id),
        ...this.buildSourceImportMeta(sourceAnalysis)
      }) as Record<string, unknown>),
      text_encoding_policy: textEncodingPolicy
    };
    const publish = input.publish !== false;

    const saveResult = await this.db.withTransaction(async (client) => {
      const existingVersions = (await this.loadModelVersionRows(networkModel.id, client)).map((item) =>
        this.normalizeModelVersionRow(item)
      );
      const explicitVersionId = input.version_id?.trim() || null;
      const selectedVersion =
        this.pickExplicitDraftVersionForSave(existingVersions, explicitVersionId, context.selected_block_id) ??
        this.pickDraftVersionForSave(existingVersions, context.selected_block_id);
      let versionId = selectedVersion?.id ?? null;

      if (versionId) {
        await this.db.query(
          `
          update network_model_version
          set block_id = $2::uuid,
              source_file_ref = $3,
              source_meta_json = $4::jsonb
          where id = $1::uuid
          `,
          [
            versionId,
            context.selected_block_id,
            input.source_file_ref?.trim() || null,
            JSON.stringify(effectiveSourceMeta),
          ],
          client
        );
      } else {
        const nextVersion = await this.db.query(
          `
          select coalesce(max(version_no), 0) + 1 as next_version_no
          from network_model_version
          where network_model_id = $1::uuid
          `,
          [networkModel.id],
          client
        );
        const inserted = await this.db.query(
          `
          insert into network_model_version (
            network_model_id,
            block_id,
            version_no,
            is_published,
            source_file_ref,
            source_meta_json
          )
          values ($1::uuid, $2::uuid, $3, false, $4, $5::jsonb)
          returning id
          `,
          [
            networkModel.id,
            context.selected_block_id,
            Number(nextVersion.rows[0]?.next_version_no ?? 1),
            input.source_file_ref?.trim() || null,
            JSON.stringify(effectiveSourceMeta)
          ],
          client
        );
        versionId = inserted.rows[0].id;
      }

      let graphGeneration: GraphMaterializationResult | null = null;
      const explicitGraphDraft = sourceAnalysis.graph_draft
        ? this.normalizeGraphDraft(
            this.deepNormalizeUnicodeStringsInJson(sourceAnalysis.graph_draft) as WorkbenchGraphDraft
          )
        : null;
      let persistedGraphDraftSnapshot: WorkbenchGraphDraft | null = explicitGraphDraft;

      if (!versionId) {
        throw new BadRequestException('failed to resolve network model version');
      }

      if (explicitGraphDraft) {
        graphGeneration = await this.materializeGraphForVersion(versionId, explicitGraphDraft, 0, client);
      } else if (!this.hasUsableGraph(selectedVersion)) {
        const seedRows = await this.loadGraphSeedRows(context.selected_project_id, context.selected_block_id, client);
        if (seedRows.length > 0) {
          const autoGraphDraft = this.buildAutoGraphDraft(seedRows, context);
          persistedGraphDraftSnapshot = this.normalizeGraphDraft(autoGraphDraft);
          graphGeneration = await this.materializeGraphForVersion(versionId, autoGraphDraft, seedRows.length, client);
        }
      }

      if (graphGeneration) {
        effectiveSourceMeta = this.deepNormalizeUnicodeStringsInJson(
          this.buildGraphSourceMeta(effectiveSourceMeta, graphGeneration, persistedGraphDraftSnapshot)
        ) as Record<string, unknown>;
        effectiveSourceMeta = { ...effectiveSourceMeta, text_encoding_policy: textEncodingPolicy };
        await this.db.query(
          `
          update network_model_version
          set source_meta_json = $2::jsonb
          where id = $1::uuid
          `,
          [versionId, JSON.stringify(effectiveSourceMeta)],
          client
        );
      }

      await this.db.query(
        `
        update network_model
        set source_type = $2,
            status = 'configured',
            updated_at = now()
        where id = $1::uuid
        `,
        [networkModel.id, input.source_kind?.trim() || 'dwg'],
        client
      );

      if (publish) {
        await this.assertVersionHasPublishableSourceStations(versionId, client);
        await this.db.query(
          `
          update network_model_version
          set is_published = false
          where network_model_id = $1::uuid
            and id <> $2::uuid
            and block_id is not distinct from $3::uuid
            and is_published = true
          `,
          [networkModel.id, versionId, context.selected_block_id],
          client
        );
        await this.db.query(
          `
          update network_model_version
          set is_published = true,
              published_at = now()
          where id = $1::uuid
          `,
          [versionId],
          client
        );
      }

      const versionRows = await this.loadModelVersionRows(networkModel.id, client);
      const savedRow = versionRows.find((item) => item.id === versionId);
      if (!savedRow) {
        throw new BadRequestException('failed to reload saved network model version');
      }

      return {
        savedVersion: this.normalizeModelVersionRow(savedRow),
        graphGeneration
      };
    });

    const relationGeneration = null;

    const config = await this.getConfig(context.selected_project_id ?? undefined, context.selected_block_id ?? undefined);

    return {
      saved_version: saveResult.savedVersion,
      graph_generation: saveResult.graphGeneration,
      relation_generation: relationGeneration,
      device_relations: config.device_relations,
      readiness: config.readiness
    };
  }

  async simulateScript(input: SimulatorScriptInput) {
    const config = await this.getConfig(input.project_id, input.block_id);
    const relation =
      config.pump_valve_relations.items.find((item: any) => item.id === input.pump_valve_relation_id) ??
      config.pump_valve_relations.items[0];

    if (!relation) {
      throw new BadRequestException('no pump-valve relation is available for simulator script');
    }

    const sessionRef = input.session_ref?.trim() || `SIM-${Date.now()}`;
    const imeiPrefix = input.imei_prefix?.trim() || 'SIM-DEVICE';
    const sequence =
      relation.sequence === 'simultaneous'
        ? 'simultaneous'
        : relation.sequence === 'pump_first'
          ? 'pump_first'
          : 'valve_first';

    const startActions =
      sequence === 'simultaneous'
        ? [
            { role: 'well', device_name: relation.well_name, imei: `${imeiPrefix}-WELL`, command_code: 'START_SESSION', delay_seconds: 0 },
            { role: 'pump', device_name: relation.pump_name, imei: `${imeiPrefix}-PUMP`, command_code: 'START_PUMP', delay_seconds: Number(relation.pump_delay_seconds ?? 0) },
            { role: 'valve', device_name: relation.valve_name, imei: `${imeiPrefix}-VALVE`, command_code: 'OPEN_VALVE', delay_seconds: Number(relation.valve_delay_seconds ?? 0) }
          ]
        : sequence === 'pump_first'
          ? [
              { role: 'well', device_name: relation.well_name, imei: `${imeiPrefix}-WELL`, command_code: 'START_SESSION', delay_seconds: 0 },
              { role: 'pump', device_name: relation.pump_name, imei: `${imeiPrefix}-PUMP`, command_code: 'START_PUMP', delay_seconds: Number(relation.pump_delay_seconds ?? 0) },
              { role: 'valve', device_name: relation.valve_name, imei: `${imeiPrefix}-VALVE`, command_code: 'OPEN_VALVE', delay_seconds: Number(relation.valve_delay_seconds ?? 0) }
            ]
          : [
              { role: 'well', device_name: relation.well_name, imei: `${imeiPrefix}-WELL`, command_code: 'START_SESSION', delay_seconds: 0 },
              { role: 'valve', device_name: relation.valve_name, imei: `${imeiPrefix}-VALVE`, command_code: 'OPEN_VALVE', delay_seconds: Number(relation.valve_delay_seconds ?? 0) },
              { role: 'pump', device_name: relation.pump_name, imei: `${imeiPrefix}-PUMP`, command_code: 'START_PUMP', delay_seconds: Number(relation.pump_delay_seconds ?? 0) }
            ];

    const stopActions = [
      { role: 'valve', device_name: relation.valve_name, imei: `${imeiPrefix}-VALVE`, command_code: 'CLOSE_VALVE', delay_seconds: 0 },
      { role: 'pump', device_name: relation.pump_name, imei: `${imeiPrefix}-PUMP`, command_code: 'STOP_PUMP', delay_seconds: 3 },
      { role: 'well', device_name: relation.well_name, imei: `${imeiPrefix}-WELL`, command_code: 'STOP_SESSION', delay_seconds: 6 }
    ];

    const commandTimeline = [...startActions, ...stopActions].map((item, index) => ({
      step_no: index + 1,
      ...item,
      direction: 'platform_to_device',
      command_id: `sim-command-${index + 1}`,
      envelope: this.previewSimulator({
        scenario: 'command_acked',
        action: item.command_code,
        imei: item.imei,
        session_ref: sessionRef,
        command_id: `sim-command-${index + 1}`
      }).envelope
    }));

    const deviceEventTimeline = [
      {
        step_no: 1,
        role: 'pump',
        device_name: relation.pump_name,
        event_type: 'DEVICE_STATE_SNAPSHOT',
        envelope: this.previewSimulator({
          scenario: 'state_snapshot',
          imei: `${imeiPrefix}-PUMP`,
          session_ref: sessionRef
        }).envelope
      },
      {
        step_no: 2,
        role: 'well',
        device_name: relation.well_name,
        event_type: 'DEVICE_HEARTBEAT',
        envelope: this.previewSimulator({
          scenario: 'heartbeat',
          imei: `${imeiPrefix}-WELL`,
          session_ref: sessionRef
        }).envelope
      },
      {
        step_no: 3,
        role: 'pump',
        device_name: relation.pump_name,
        event_type: 'DEVICE_RUNTIME_TICK',
        envelope: {
          ...this.previewSimulator({
            scenario: 'state_snapshot',
            imei: `${imeiPrefix}-PUMP`,
            session_ref: sessionRef
          }).envelope,
          msgType: 'RUNTIME_TICK',
          payload: {
            pressure_kpa: 131.8,
            flow_m3h: 22.4,
            runtime_sec: 900
          }
        }
      },
      {
        step_no: 4,
        role: 'well',
        device_name: relation.well_name,
        event_type: 'DEVICE_RUNTIME_STOPPED',
        envelope: {
          ...this.previewSimulator({
            scenario: 'state_snapshot',
            imei: `${imeiPrefix}-WELL`,
            session_ref: sessionRef
          }).envelope,
          msgType: 'RUNTIME_STOPPED',
          payload: {
            result: 'completed',
            final_flow_m3: 52.3,
            final_energy_wh: 12800
          }
        }
      }
    ];

    return {
      mode: 'backend_scripted',
      session_ref: sessionRef,
      relation_summary: {
        pump_valve_relation_id: relation.id,
        well_name: relation.well_name,
        pump_name: relation.pump_name,
        valve_name: relation.valve_name,
        sequence,
        pump_delay_seconds: relation.pump_delay_seconds,
        valve_delay_seconds: relation.valve_delay_seconds
      },
      solver_request_preview: {
        network_model_version_id: config.network_model?.published_version?.id ?? null,
        project_id: config.selected_project_id ?? null,
        block_ids: config.selected_block_id ? [config.selected_block_id] : [],
        pump_valve_relation_id: relation.id
      },
      command_timeline: commandTimeline,
      device_event_timeline: deviceEventTimeline
    };
  }
}
