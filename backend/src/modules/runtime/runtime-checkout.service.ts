import { Injectable } from '@nestjs/common';
import {
  collectControlRouteDeviceIds,
  isDeviceActiveAndOnline,
  isRoleControllable,
  supportsIntegratedPumpValveControl,
} from '../../common/device-control-routing';
import { DatabaseService } from '../../common/db/database.service';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { FarmerFundService } from '../farmer-fund/farmer-fund.service';
import { OrderRepository } from '../order/order.repository';
import { OrderSettlementService } from '../order/order-settlement.service';
import { PaymentAccountService } from '../payment-account/payment-account.module';
import { resolvePaymentIntentCompletionGuard } from './payment-intent-completion-guard';
import { buildSolverRuntimeSnapshot } from '../solver/solver-runtime';
import { RuntimeDecisionService, RuntimeService } from './runtime.service';

const CARD_SETTLEMENT_GUARD_SECONDS = 5;

type CheckoutTarget = {
  tenantId: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string | null;
  imei: string;
  deviceRole: string;
  targetType: 'well' | 'valve' | 'pump';
  targetId: string;
  wellId: string | null;
  valveId: string | null;
  relationId: string | null;
  wellName: string | null;
  blockId: string | null;
  blockName: string | null;
  projectId: string | null;
  projectName: string | null;
  wellDeviceId: string | null;
  pumpDeviceId: string | null;
  valveDeviceId: string | null;
  deviceFeatureModules: string[];
  wellFeatureModules: string[];
  integratedControl: boolean;
};

type CheckoutTargetCandidate = CheckoutTarget & {
  relationRole: string | null;
  relationConfigJson: Record<string, unknown>;
  wellDeviceState: string | null;
  pumpDeviceState: string | null;
  valveDeviceState: string | null;
  wellOnlineState: string | null;
  pumpOnlineState: string | null;
  valveOnlineState: string | null;
};

type CheckoutTargetResolution = {
  target: CheckoutTarget | null;
  blockingReason: { code: string; message: string; details: Record<string, unknown> } | null;
};

type EntryModeCapability = {
  supported: boolean;
  reason: { code: string; message: string } | null;
};

type CheckoutCapabilities = {
  qr_payment: EntryModeCapability;
  card_payment: EntryModeCapability;
};

type PaymentFlowType = 'card_swipe' | 'scan_order';
type PaymentFlowOpsStatus = 'unhandled' | 'manual_review' | 'ignored' | 'resolved';
type PaymentFlowAction =
  | 'mark_manual_review'
  | 'mark_ignored'
  | 'mark_resolved'
  | 'attach_work_order'
  | 'reissue_pay_link';

type PaymentFlowOpsHistoryItem = {
  action: PaymentFlowAction;
  status: PaymentFlowOpsStatus;
  note: string | null;
  linked_work_order_id: string | null;
  handled_at: string;
  handled_by: string;
};

type PaymentFlowOpsHandling = {
  status: PaymentFlowOpsStatus;
  note: string | null;
  linked_work_order_id: string | null;
  handled_at: string | null;
  handled_by: string | null;
  last_action: PaymentFlowAction | null;
  history: PaymentFlowOpsHistoryItem[];
};

type PaymentFlowRow = {
  id: string;
  flow_type: PaymentFlowType;
  entry_mode: string;
  action_code: string;
  raw_status: string;
  result_bucket: string;
  imei: string | null;
  device_name: string | null;
  card_token: string | null;
  user_name: string | null;
  order_id: string | null;
  order_no: string | null;
  session_id: string | null;
  session_ref: string | null;
  payment_intent_id: string | null;
  out_trade_no: string | null;
  pay_link: string | null;
  amount: number | null;
  locked_amount: number | null;
  payment_status: string | null;
  result_code: string | null;
  result_message: string | null;
  awaiting_device_ack: boolean;
  reference_no: string | null;
  request_snapshot: Record<string, unknown> | null;
  response_snapshot: Record<string, unknown> | null;
  ops_status?: string | null;
  age_minutes?: number | null;
  sla_level?: string | null;
  occurred_at: string | null;
  created_at: string;
  updated_at: string | null;
};

type PaymentFlowActionResult = {
  flow: Record<string, unknown>;
  action: PaymentFlowAction;
  message: string;
  reissued_payment?: Record<string, unknown> | null;
};

type PaymentFlowBatchActionItem = {
  flow_type: PaymentFlowType;
  id: string;
  ok: boolean;
  flow?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
};

type PaymentFlowBatchActionResult = {
  action: PaymentFlowAction;
  requested_count: number;
  succeeded_count: number;
  failed_count: number;
  items: PaymentFlowBatchActionItem[];
};

@Injectable()
export class RuntimeCheckoutService {
  constructor(
    private readonly db: DatabaseService,
    private readonly runtimeDecisionService: RuntimeDecisionService,
    private readonly runtimeService: RuntimeService,
    private readonly orderRepository: OrderRepository,
    private readonly orderSettlementService: OrderSettlementService,
    private readonly farmerFundService: FarmerFundService,
    private readonly paymentAccountService: PaymentAccountService
  ) {}

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asStringArray(value: unknown) {
    return Array.isArray(value)
      ? value.map((item) => this.asString(item)).filter((item) => item.length > 0)
      : [];
  }

  private supportsIntegratedControl(featureModules: string[]) {
    return supportsIntegratedPumpValveControl(featureModules);
  }

  private hasFeatureModule(featureModules: string[], candidates: string[]) {
    const featureSet = new Set(featureModules.map((item) => item.toLowerCase()));
    return candidates.some((item) => featureSet.has(item.toLowerCase()));
  }

  private buildEntryModeCapabilities(featureModules: string[]) {
    const qrSupported = this.hasFeatureModule(featureModules, ['payment_qr_control', 'pay']);
    const cardSupported = this.hasFeatureModule(featureModules, ['card_auth_reader', 'cdr']);

    const qrCapability: EntryModeCapability = qrSupported
      ? { supported: true, reason: null }
      : {
          supported: false,
          reason: this.buildReason('QR_PAYMENT_NOT_SUPPORTED', '当前设备未开通扫码支付启动能力')
        };
    const cardCapability: EntryModeCapability = cardSupported
      ? { supported: true, reason: null }
      : {
          supported: false,
          reason: this.buildReason('CARD_PAYMENT_NOT_SUPPORTED', '当前设备未开通刷卡支付启动能力')
        };

    return {
      qr_payment: qrCapability,
      card_payment: cardCapability
    };
  }

  private roundMoney(value: number) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private getPublicWebBaseUrl() {
    return String(process.env.PUBLIC_WEB_BASE_URL || process.env.PORTAL_PUBLIC_BASE_URL || 'http://xupengpeng.top')
      .trim()
      .replace(/\/+$/, '');
  }

  private joinPublicUrl(pathOrUrl: string) {
    const normalized = this.asString(pathOrUrl);
    if (!normalized) return this.getPublicWebBaseUrl();
    if (/^https?:\/\//i.test(normalized)) return normalized;
    if (normalized.startsWith('/')) return `${this.getPublicWebBaseUrl()}${normalized}`;
    return `${this.getPublicWebBaseUrl()}/${normalized}`;
  }

  private buildWechatPayLink(paymentIntentId: string, imei: string) {
    const returnUrl = new URL(`${this.getPublicWebBaseUrl()}/u/scan`);
    returnUrl.searchParams.set('imei', imei);
    returnUrl.searchParams.set('payment_intent_id', paymentIntentId);
    return `${this.getPublicWebBaseUrl()}/api/v1/payments/wechat/pay/${encodeURIComponent(paymentIntentId)}?return_url=${encodeURIComponent(
      returnUrl.toString()
    )}`;
  }

  private mapPaymentAccountPreview(value: {
    id: string | null;
    provider: string;
    accountCode: string;
    accountName: string;
    merchantNo: string | null;
    appId: string | null;
    accountIdentity: string | null;
    resolution: string;
    isDefault: boolean;
  }) {
    return {
      id: value.id,
      provider: value.provider,
      account_code: value.accountCode,
      account_name: value.accountName,
      merchant_no: value.merchantNo,
      app_id: value.appId,
      account_identity: value.accountIdentity,
      resolution: value.resolution,
      is_default: value.isDefault
    };
  }

  private mapCheckoutTargetRow(
    row: Omit<CheckoutTargetCandidate, 'deviceFeatureModules' | 'wellFeatureModules' | 'integratedControl' | 'relationConfigJson'> & {
      deviceFeatureModulesJson: unknown;
      wellFeatureModulesJson: unknown;
      relationConfigJson: unknown;
    }
  ): CheckoutTargetCandidate {
    const deviceFeatureModules = this.asStringArray(row.deviceFeatureModulesJson);
    const wellFeatureModules = this.asStringArray(row.wellFeatureModulesJson);
    const targetId = this.asString(row.targetId);
    return {
      ...row,
      targetId,
      deviceFeatureModules,
      wellFeatureModules,
      relationConfigJson: this.asObject(row.relationConfigJson),
      integratedControl: this.supportsIntegratedControl(wellFeatureModules)
    };
  }

  private hasResolvedCheckoutTarget(candidate: Pick<CheckoutTarget, 'targetId'> | null | undefined) {
    if (!candidate) return false;
    return this.asString(candidate.targetId).length > 0;
  }

  private buildMissingCheckoutTargetReason(imei: string, candidate?: Partial<CheckoutTargetCandidate> | null) {
    return this.buildReason(
      ErrorCodes.RELATION_NOT_CONFIGURED,
      '当前控制器未绑定可启动的井/泵/阀目标，请先完成设备关系配置',
      {
        imei: this.asString(imei) || null,
        device_id: candidate?.deviceId ?? null,
        device_role: candidate?.deviceRole ?? null,
        relation_id: candidate?.relationId ?? null
      }
    );
  }

  private isCandidateRuntimeReady(candidate: CheckoutTargetCandidate) {
    if (candidate.relationRole === 'forbidden') return false;
    if (!isDeviceActiveAndOnline(candidate.wellDeviceState, candidate.wellOnlineState)) return false;
    return (
      isRoleControllable({
        role: 'pump',
        wellFeatureModules: candidate.wellFeatureModules,
        wellDeviceState: candidate.wellDeviceState,
        wellOnlineState: candidate.wellOnlineState,
        dedicatedDeviceState: candidate.pumpDeviceState,
        dedicatedOnlineState: candidate.pumpOnlineState,
      }) &&
      isRoleControllable({
        role: 'valve',
        wellFeatureModules: candidate.wellFeatureModules,
        wellDeviceState: candidate.wellDeviceState,
        wellOnlineState: candidate.wellOnlineState,
        dedicatedDeviceState: candidate.valveDeviceState,
        dedicatedOnlineState: candidate.valveOnlineState,
      })
    );
  }

  private normalizeGraphNodeCode(value: unknown) {
    return this.asString(value);
  }

  private async loadPublishedGraphDraftSnapshot(projectId: string, blockId?: string | null) {
    const published = await this.db.query<{ versionId: string; graphDraftSnapshot: unknown }>(
      `
      select
        nmv.id::text as "versionId",
        source_meta_json->'graph_draft_snapshot' as "graphDraftSnapshot"
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
      [projectId, blockId ?? null]
    );
    const publishedRow = published.rows[0];
    const graphDraftSnapshot = this.asObject(publishedRow?.graphDraftSnapshot);
    if (graphDraftSnapshot && (Array.isArray(graphDraftSnapshot.nodes) || Array.isArray(graphDraftSnapshot.pipes))) {
      return graphDraftSnapshot;
    }
    if (!publishedRow?.versionId) return null;

    const [nodesResult, pipesResult] = await Promise.all([
      this.db.query<{ node_code: string; node_type: string; altitude: string | number | null }>(
        `
        select node_code, node_type, altitude
        from network_node
        where version_id = $1::uuid
        order by node_code asc
        `,
        [publishedRow.versionId]
      ),
      this.db.query<{
        pipe_code: string;
        pipe_type: string;
        from_node_code: string;
        to_node_code: string;
        length_m: string | number | null;
        diameter_mm: string | number | null;
      }>(
        `
        select
          np.pipe_code,
          np.pipe_type,
          nfrom.node_code as from_node_code,
          nto.node_code as to_node_code,
          np.length_m,
          np.diameter_mm
        from network_pipe np
        join network_node nfrom on nfrom.id = np.from_node_id
        join network_node nto on nto.id = np.to_node_id
        where np.version_id = $1::uuid
        order by np.pipe_code asc
        `,
        [publishedRow.versionId]
      )
    ]);

    if (nodesResult.rows.length === 0 && pipesResult.rows.length === 0) {
      return null;
    }

    return {
      import_mode: 'published_network_tables',
      overwrite_existing: true,
      nodes: nodesResult.rows.map((row) => ({
        node_code: row.node_code,
        node_type: row.node_type,
        altitude: row.altitude
      })),
      pipes: pipesResult.rows.map((row) => ({
        pipe_code: row.pipe_code,
        pipe_type: row.pipe_type,
        from_node_code: row.from_node_code,
        to_node_code: row.to_node_code,
        length_m: row.length_m,
        diameter_mm: row.diameter_mm
      }))
    };
  }

  private async loadCheckoutTargetCandidates(imei: string): Promise<CheckoutTargetCandidate[]> {
    const result = await this.db.query<
      Omit<CheckoutTargetCandidate, 'deviceFeatureModules' | 'wellFeatureModules' | 'integratedControl' | 'relationConfigJson'> & {
        deviceFeatureModulesJson: unknown;
        wellFeatureModulesJson: unknown;
        relationConfigJson: unknown;
      }
    >(
      `
      select
        d.tenant_id as "tenantId",
        d.id::text as "deviceId",
        d.device_code as "deviceCode",
        d.device_name as "deviceName",
        d.imei,
        case
          when v.id is not null then 'valve'
          when p.id is not null then 'pump'
          when w.id is not null then 'well'
          else 'device'
        end as "deviceRole",
        case
          when v.id is not null then 'valve'
          when p.id is not null then 'pump'
          else 'well'
        end as "targetType",
        case
          when v.id is not null then v.id::text
          when p.id is not null then p.id::text
          else coalesce(rel.well_id::text, w.id::text, v.well_id::text, p.well_id::text)
        end as "targetId",
        effective_well.id::text as "wellId",
        coalesce(rel.valve_id::text, v.id::text) as "valveId",
        rel.id::text as "relationId",
        coalesce(effective_well.safety_profile_json->>'displayName', effective_well.well_code) as "wellName",
        pb.id::text as "blockId",
        pb.block_name as "blockName",
        project.id::text as "projectId",
        project.project_name as "projectName",
        wd.id::text as "wellDeviceId",
        pd.id::text as "pumpDeviceId",
        vd.id::text as "valveDeviceId",
        rel.relation_role as "relationRole",
        coalesce(rel.relation_config_json, '{}'::jsonb) as "relationConfigJson",
        wd.lifecycle_state as "wellDeviceState",
        pd.lifecycle_state as "pumpDeviceState",
        vd.lifecycle_state as "valveDeviceState",
        case
          when wds.online_state = 'online'
           and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else wd.online_state
        end as "wellOnlineState",
        case
          when pds.online_state = 'online'
           and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else pd.online_state
        end as "pumpOnlineState",
        case
          when vds.online_state = 'online'
           and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
            then 'online'
          else vd.online_state
        end as "valveOnlineState",
        coalesce(d.ext_json->'feature_modules', '[]'::jsonb) as "deviceFeatureModulesJson",
        coalesce(wd.ext_json->'feature_modules', '[]'::jsonb) as "wellFeatureModulesJson"
      from device d
      left join well w on w.device_id = d.id
      left join pump p on p.device_id = d.id
      left join valve v on v.device_id = d.id
      left join pump_valve_relation rel
        on rel.status = 'active'
       and (
         rel.well_id = w.id
         or rel.pump_id = p.id
         or rel.valve_id = v.id
       )
      left join well effective_well on effective_well.id = coalesce(rel.well_id, w.id, v.well_id, p.well_id)
      left join pump rp on rp.id = rel.pump_id
      left join valve rv on rv.id = rel.valve_id
      left join project_block pb on pb.id = effective_well.block_id
      left join project on project.id = pb.project_id
      left join device wd on wd.id = effective_well.device_id
      left join device pd on pd.id = coalesce(rp.device_id, p.device_id)
      left join device vd on vd.id = coalesce(rv.device_id, v.device_id)
      left join device_runtime_shadow wds on wds.tenant_id = d.tenant_id and wds.device_id = wd.id
      left join device_runtime_shadow pds on pds.tenant_id = d.tenant_id and pds.device_id = pd.id
      left join device_runtime_shadow vds on vds.tenant_id = d.tenant_id and vds.device_id = vd.id
      where d.imei = $1
      order by
        case
          when wd.lifecycle_state = 'active'
           and pd.lifecycle_state = 'active'
           and vd.lifecycle_state = 'active'
           and (
             case
               when wds.online_state = 'online'
                and coalesce(wds.last_server_rx_ts, wds.last_heartbeat_at, wds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else wd.online_state
             end
           ) = 'online'
           and (
             case
               when pds.online_state = 'online'
                and coalesce(pds.last_server_rx_ts, pds.last_heartbeat_at, pds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else pd.online_state
             end
           ) = 'online'
           and (
             case
               when vds.online_state = 'online'
                and coalesce(vds.last_server_rx_ts, vds.last_heartbeat_at, vds.updated_at) >= now() - interval '15 minutes'
                 then 'online'
               else vd.online_state
             end
           ) = 'online'
          then 0
          else 1
        end,
        case when rel.relation_role = 'primary' then 0 else 1 end,
        rel.updated_at desc nulls last,
        rel.created_at desc nulls last
      `,
      [imei]
    );
    return result.rows.map((row) => this.mapCheckoutTargetRow(row));
  }

  private async resolveValveCheckoutTargetByGraph(
    candidates: CheckoutTargetCandidate[]
  ): Promise<CheckoutTargetResolution | null> {
    const graphCandidates = candidates.filter((candidate) => Boolean(candidate.relationId));
    if (graphCandidates.length === 0) return null;

    const valveNodeCodes = [...new Set(graphCandidates.map((candidate) => this.normalizeGraphNodeCode(candidate.relationConfigJson.valve_node_code)).filter(Boolean))];
    const sourceNodeCodes = [...new Set(graphCandidates.map((candidate) => this.normalizeGraphNodeCode(candidate.relationConfigJson.source_station_node_code)).filter(Boolean))];
    const projectId = this.asString(graphCandidates[0]?.projectId);
    const blockId = this.asString(graphCandidates[0]?.blockId) || null;
    if (valveNodeCodes.length === 0 || sourceNodeCodes.length === 0 || !projectId) {
      return null;
    }
    if (valveNodeCodes.length > 1) {
      return {
        target: null,
        blockingReason: this.buildReason(ErrorCodes.RELATION_NOT_CONFIGURED, '当前出水口绑定了多个图节点编码，无法按图求解', {
          device_id: graphCandidates[0]?.deviceId ?? null,
          valve_node_codes: valveNodeCodes
        })
      };
    }

    const graphDraft = await this.loadPublishedGraphDraftSnapshot(projectId, blockId);
    if (!graphDraft) return null;

    const valveNodeCode = valveNodeCodes[0];
    const graphNode = Array.isArray(graphDraft.nodes)
      ? graphDraft.nodes.find((node) => this.normalizeGraphNodeCode((node as Record<string, unknown>).node_code) === valveNodeCode)
      : null;
    const nodeType = this.normalizeGraphNodeCode((graphNode as Record<string, unknown> | null)?.node_type).toLowerCase();
    if (!graphNode || nodeType !== 'outlet') {
      return {
        target: null,
        blockingReason: this.buildReason(ErrorCodes.RELATION_NOT_CONFIGURED, '当前出水口未正确绑定到已发布图纸的出水口节点', {
          device_id: graphCandidates[0]?.deviceId ?? null,
          valve_node_code: valveNodeCode
        })
      };
    }

    const eligibleSourceNodeIds = [
      ...new Set(
        graphCandidates
          .filter((candidate) => this.isCandidateRuntimeReady(candidate))
          .map((candidate) => this.normalizeGraphNodeCode(candidate.relationConfigJson.source_station_node_code))
          .filter(Boolean)
      )
    ];
    if (eligibleSourceNodeIds.length === 0) {
      return {
        target: null,
        blockingReason: this.buildReason(ErrorCodes.DEVICE_OFFLINE, '当前图上关联的泵站均不在线或不可用', {
          device_id: graphCandidates[0]?.deviceId ?? null,
          valve_node_code: valveNodeCode,
          source_node_codes: sourceNodeCodes
        })
      };
    }

    const outletId = `${valveNodeCode}-outlet`;
    const snapshot = buildSolverRuntimeSnapshot({
      graphDraft: graphDraft as any,
      activeOutletIds: [outletId],
      eligibleSourceNodeIds
    });
    const assigned = snapshot?.allocation?.outlet_allocations?.find((item) => item.outlet_id === outletId) ?? null;
    if (!assigned) {
      return {
        target: null,
        blockingReason: this.buildReason(ErrorCodes.RELATION_NOT_CONFIGURED, '图求解未找到当前出水口的可用供水路径', {
          device_id: graphCandidates[0]?.deviceId ?? null,
          valve_node_code: valveNodeCode,
          source_node_codes: eligibleSourceNodeIds,
          reasons: snapshot?.allocation?.unassigned_outlets ?? []
        })
      };
    }

    const selectedSourceNodeCode = this.normalizeGraphNodeCode(assigned.source_node_code);
    const matched = graphCandidates.filter(
      (candidate) =>
        this.normalizeGraphNodeCode(candidate.relationConfigJson.valve_node_code) === valveNodeCode &&
        this.normalizeGraphNodeCode(candidate.relationConfigJson.source_station_node_code) === selectedSourceNodeCode
    );
    if (matched.length === 0) {
      return {
        target: null,
        blockingReason: this.buildReason(ErrorCodes.RELATION_NOT_CONFIGURED, '图求解结果未映射到有效井泵阀关系', {
          device_id: graphCandidates[0]?.deviceId ?? null,
          valve_node_code: valveNodeCode,
          source_node_code: selectedSourceNodeCode
        })
      };
    }

    return {
      target: matched[0],
      blockingReason: null
    };
  }

  private async resolveCheckoutTargetContext(imei: string): Promise<CheckoutTargetResolution> {
    const candidates = await this.loadCheckoutTargetCandidates(imei);
    if (candidates.length === 0) {
      return {
        target: null,
        blockingReason: this.buildReason(ErrorCodes.TARGET_NOT_FOUND, '未找到该 IMEI 对应的控制器')
      };
    }

    const resolvedCandidates = candidates.filter((candidate) => this.hasResolvedCheckoutTarget(candidate));
    if (resolvedCandidates.length === 0) {
      return {
        target: null,
        blockingReason: this.buildMissingCheckoutTargetReason(imei, candidates[0] ?? null)
      };
    }

    const primary = resolvedCandidates[0];
    if (primary.deviceRole === 'valve' && primary.valveId) {
      const graphResolution = await this.resolveValveCheckoutTargetByGraph(resolvedCandidates);
      if (graphResolution) return graphResolution;
    }

    return {
      target: primary,
      blockingReason: null
    };
  }

  private async resolveCheckoutTarget(imei: string): Promise<CheckoutTarget | null> {
    const resolution = await this.resolveCheckoutTargetContext(imei);
    return resolution.target;
  }

  private async findOpenOrderByImei(imei: string) {
    const result = await this.db.query<{
      orderId: string;
      orderStatus: string;
      paymentStatus: string | null;
      sessionId: string | null;
      sessionStatus: string | null;
      amount: number;
      prepaidAmount: number;
      lockedAmount: number;
    }>(
      `
      select
        io.id as "orderId",
        io.status as "orderStatus",
        io.payment_status as "paymentStatus",
        rs.id::text as "sessionId",
        rs.status as "sessionStatus",
        io.amount,
        io.prepaid_amount as "prepaidAmount",
        io.locked_amount as "lockedAmount"
      from irrigation_order io
      left join runtime_session rs on rs.id = io.session_id
      where io.target_imei = $1
        and (
          io.status <> 'settled'
          or rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
        )
      order by io.created_at desc
      limit 1
      `,
      [imei]
    );
    return result.rows[0] ?? null;
  }

  private async findActiveSessionForUser(userId: string) {
    const result = await this.db.query<{
      sessionId: string;
      sessionRef: string | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      startedAt: string | null;
      starterCardToken: string | null;
    }>(
      `
      select
        rs.id::text as "sessionId",
        rs.session_ref as "sessionRef",
        io.target_imei as "targetImei",
        io.target_device_role as "targetDeviceRole",
        rs.started_at as "startedAt",
        nullif(io.checkout_snapshot_json->>'card_token', '') as "starterCardToken"
      from runtime_session rs
      join irrigation_order io on io.session_id = rs.id
      where rs.user_id = $1::uuid
        and rs.status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
      order by rs.created_at desc
      limit 1
      `,
      [userId]
    );
    return result.rows[0] ?? null;
  }

  private async findRecentEndedCardSession(userId: string, seconds: number) {
    const result = await this.db.query<{
      sessionId: string;
      sessionRef: string | null;
      targetImei: string | null;
      targetDeviceRole: string | null;
      endedAt: string | null;
      orderId: string | null;
    }>(
      `
      select
        rs.id::text as "sessionId",
        rs.session_ref as "sessionRef",
        io.target_imei as "targetImei",
        io.target_device_role as "targetDeviceRole",
        rs.ended_at as "endedAt",
        io.id as "orderId"
      from runtime_session rs
      join irrigation_order io on io.session_id = rs.id
      where rs.user_id = $1::uuid
        and io.order_channel = 'CARD'
        and rs.status = 'ended'
        and rs.ended_at >= now() - make_interval(secs => $2::int)
      order by rs.ended_at desc nulls last
      limit 1
      `,
      [userId, Math.max(1, Math.trunc(seconds))]
    );
    return result.rows[0] ?? null;
  }

  private async findRecordedCardSwipeResult(tenantId: string, userId: string, swipeEventId?: string | null) {
    const normalized = this.asString(swipeEventId);
    if (!normalized) return null;

    const result = await this.db.query<{ responseSnapshot: Record<string, unknown> }>(
      `
      select response_snapshot_json as "responseSnapshot"
      from card_swipe_event
      where tenant_id = $1::uuid
        and user_id = $2::uuid
        and swipe_event_id = $3
      limit 1
      `,
      [tenantId, userId, normalized]
    );
    return result.rows[0]?.responseSnapshot ?? null;
  }

  private async recordCardSwipeResult(input: {
    tenantId: string;
    userId: string;
    imei: string;
    cardToken: string;
    swipeAction: string;
    swipeEventId?: string | null;
    swipeAt?: string | null;
    responseSnapshot: Record<string, unknown>;
  }) {
    const swipeEventId = this.asString(input.swipeEventId);
    if (!swipeEventId) {
      return input.responseSnapshot;
    }

    const swipeAtIso = this.asString(input.swipeAt);
    const resultCategory = this.resolveCardSwipeResultCategory(input.responseSnapshot);
    const resultCode =
      this.asString(input.responseSnapshot.error_code) ||
      this.asString(input.responseSnapshot.errorCode) ||
      this.asString(input.responseSnapshot.action) ||
      null;
    const resultMessage =
      this.asString(input.responseSnapshot.error_message) ||
      this.asString(input.responseSnapshot.errorMessage) ||
      this.asString(input.responseSnapshot.message) ||
      null;
    const awaitingDeviceAck = Boolean(input.responseSnapshot.awaiting_device_ack);
    await this.db.query(
      `
      insert into card_swipe_event (
        tenant_id, user_id, imei, card_token, swipe_action, swipe_event_id, swipe_at,
        request_snapshot_json, response_snapshot_json,
        result_category, result_code, result_message, awaiting_device_ack, resolved_at
      )
      values (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz,
        $8::jsonb, $9::jsonb,
        $10, $11, $12, $13, $14::timestamptz
      )
      on conflict (tenant_id, swipe_event_id) do update
      set user_id = coalesce(card_swipe_event.user_id, excluded.user_id),
          card_token = coalesce(card_swipe_event.card_token, excluded.card_token),
          swipe_action = coalesce(nullif(card_swipe_event.swipe_action, ''), excluded.swipe_action),
          swipe_at = coalesce(card_swipe_event.swipe_at, excluded.swipe_at),
          request_snapshot_json = coalesce(card_swipe_event.request_snapshot_json, '{}'::jsonb) || excluded.request_snapshot_json,
          response_snapshot_json = coalesce(card_swipe_event.response_snapshot_json, '{}'::jsonb) || excluded.response_snapshot_json,
          result_category = excluded.result_category,
          result_code = excluded.result_code,
          result_message = excluded.result_message,
          awaiting_device_ack = excluded.awaiting_device_ack,
          resolved_at = excluded.resolved_at,
          updated_at = now()
      `,
      [
        input.tenantId,
        input.userId,
        input.imei,
        input.cardToken,
        input.swipeAction,
        swipeEventId,
        swipeAtIso || null,
        JSON.stringify({
          imei: input.imei,
          swipe_action: input.swipeAction,
          swipe_event_id: swipeEventId,
          swipe_at: swipeAtIso || null
        }),
        JSON.stringify(input.responseSnapshot),
        resultCategory,
        resultCode,
        resultMessage,
        awaitingDeviceAck,
        awaitingDeviceAck ? null : new Date().toISOString()
      ]
    );

    const existing = await this.findRecordedCardSwipeResult(input.tenantId, input.userId, swipeEventId);
    return existing ?? input.responseSnapshot;
  }

  private resolveCardSwipeResultCategory(responseSnapshot: Record<string, unknown>) {
    if (this.asString(responseSnapshot.error_code) || this.asString(responseSnapshot.errorCode)) {
      return 'platform_explicit_reject';
    }
    if (Boolean(responseSnapshot.awaiting_device_ack)) {
      return 'pending_device_ack';
    }
    if (this.asString(responseSnapshot.action)) {
      return 'accepted';
    }
    return 'unknown';
  }

  private async listOpenAlarms(target: CheckoutTarget) {
    const candidate = target as CheckoutTargetCandidate;
    const deviceIds = collectControlRouteDeviceIds({
      integratedControl: target.integratedControl,
      deviceId: target.deviceId,
      wellFeatureModules: target.wellFeatureModules,
      wellDeviceState: candidate.wellDeviceState,
      wellOnlineState: candidate.wellOnlineState,
      wellDeviceId: target.wellDeviceId,
      pumpDeviceState: candidate.pumpDeviceState,
      pumpOnlineState: candidate.pumpOnlineState,
      pumpDeviceId: target.pumpDeviceId,
      valveDeviceState: candidate.valveDeviceState,
      valveOnlineState: candidate.valveOnlineState,
      valveDeviceId: target.valveDeviceId,
    });
    const freshOnlineDeviceIds = new Set<string>();
    if (deviceIds.length > 0) {
      const shadowResult = await this.db.query<{ deviceId: string }>(
        `
        select device_id::text as "deviceId"
        from device_runtime_shadow
        where tenant_id = $1
          and device_id = any($2::uuid[])
          and online_state = 'online'
          and coalesce(last_server_rx_ts, last_heartbeat_at, updated_at) >= now() - interval '15 minutes'
        `,
        [target.tenantId, deviceIds]
      );
      for (const row of shadowResult.rows) {
        freshOnlineDeviceIds.add(row.deviceId);
      }
    }
    const result = await this.db.query<{ deviceId: string; alarmCode: string; alarmTitle: string | null }>(
      `
      select
        device_id::text as "deviceId",
        alarm_code as "alarmCode",
        null::text as "alarmTitle"
      from alarm_event
      where tenant_id = $1
        and device_id = any($2::uuid[])
        and status in ('open', 'pending', 'processing')
      order by created_at desc
      limit 10
      `,
      [target.tenantId, deviceIds]
    );
    return result.rows.filter(
      (row) => !(row.alarmCode === 'DEVICE_OFFLINE' && freshOnlineDeviceIds.has(row.deviceId))
    );
  }

  private buildReason(code: string, message: string, details?: Record<string, unknown>) {
    return { code, message, details: details ?? {} };
  }

  private pickPrimaryReason(reasons: Array<{ code: string; message: string }>) {
    return reasons[0] ?? this.buildReason(ErrorCodes.FORBIDDEN, '当前设备暂不可启动');
  }

  private ensureEntryModeSupported(capabilities: CheckoutCapabilities, mode: 'qr_payment' | 'card_payment') {
    const capability = capabilities[mode];
    if (capability.supported) return;
    const reason = capability.reason ?? this.buildReason(ErrorCodes.FORBIDDEN, '当前设备未开放对应支付能力');
    throw new AppException(reason.code as keyof typeof ErrorCodes, reason.message, 400, {
      mode,
      capability: capabilities
    });
  }

  private assertPaidAmountMatches(expectedAmount: number, paidAmount?: number | null) {
    if (paidAmount === null || paidAmount === undefined) return;
    const normalizedPaidAmount = this.roundMoney(Number(paidAmount ?? 0));
    const normalizedExpectedAmount = this.roundMoney(Number(expectedAmount ?? 0));
    if (Math.abs(normalizedPaidAmount - normalizedExpectedAmount) > 0.01) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '支付回调金额与支付单不一致', 400, {
        expected_amount: normalizedExpectedAmount,
        paid_amount: normalizedPaidAmount
      });
    }
  }

  private formatStartFailureMessage(error: unknown) {
    if (error instanceof AppException || error instanceof Error) {
      return this.asString(error.message) || '启动设备失败';
    }
    return '启动设备失败';
  }

  private buildCardSwipeErrorSnapshot(error: unknown) {
    if (error instanceof AppException) {
      const payload = error.getResponse() as {
        code?: string;
        message?: string;
        data?: Record<string, unknown>;
      };
      return {
        ...this.asObject(payload?.data),
        error_code: this.asString(payload?.code) || ErrorCodes.INTERNAL_ERROR,
        error_message: this.asString(payload?.message) || 'card swipe checkout failed'
      };
    }

    if (error instanceof Error) {
      return {
        error_code: ErrorCodes.INTERNAL_ERROR,
        error_message: this.asString(error.message) || 'card swipe checkout failed'
      };
    }

    return {
      error_code: ErrorCodes.INTERNAL_ERROR,
      error_message: 'card swipe checkout failed'
    };
  }

  private async recordCardSwipeFailureAndRethrow(
    user: { tenantId: string; id: string },
    input: {
      imei: string;
      cardToken: string;
      swipeAction: string;
      swipeEventId?: string | null;
      swipeAt?: string | null;
      error: unknown;
    }
  ): Promise<never> {
    await this.recordCardSwipeResult({
      tenantId: user.tenantId,
      userId: user.id,
      imei: input.imei,
      cardToken: input.cardToken,
      swipeAction: input.swipeAction,
      swipeEventId: input.swipeEventId,
      swipeAt: input.swipeAt,
      responseSnapshot: this.buildCardSwipeErrorSnapshot(input.error)
    }).catch(() => null);

    throw input.error;
  }

  private async completePaymentIntentById(
    paymentIntentId: string,
    input: {
      provider: 'wechat' | 'alipay';
      callbackToken?: string | null;
      paidAmount?: number | null;
      providerTradeNo?: string | null;
      providerPayload?: Record<string, unknown>;
      startedVia?: string | null;
      skipCallbackTokenValidation?: boolean;
    }
  ) {
    const intent = await this.orderSettlementService.getPaymentIntentById(paymentIntentId);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '支付单不存在', 404, { paymentIntentId });
    }
    const completionGuard = resolvePaymentIntentCompletionGuard({
      status: intent.status,
      sessionId: intent.sessionId,
      orderId: intent.orderId,
    });

    const normalizedProvider = input.provider === 'alipay' ? 'alipay' : 'wechat';
    if (this.asString(intent.paymentMode) !== normalizedProvider) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '支付渠道与支付单不匹配', 400, {
        payment_intent_id: intent.id,
        payment_mode: intent.paymentMode,
        callback_provider: normalizedProvider
      });
    }

    if (!input.skipCallbackTokenValidation) {
      if (this.asString(input.callbackToken) !== this.asString(intent.callbackToken)) {
        throw new AppException(ErrorCodes.FORBIDDEN, '支付回调令牌无效', 403, { paymentIntentId });
      }
    }

    this.assertPaidAmountMatches(Number(intent.amount ?? 0), input.paidAmount ?? null);

    const paymentConfirmationPayload = {
      callback_confirmed_at: new Date().toISOString(),
      callback_provider: normalizedProvider,
      provider_trade_no: this.asString(input.providerTradeNo) || null,
      ...(input.providerPayload ?? {})
    };

    if (completionGuard.mode === 'idempotent') {
      return {
        payment_intent_id: intent.id,
        session_id: intent.sessionId,
        order_id: intent.orderId,
        payment_status: completionGuard.paymentStatus,
        idempotent: true
      };
    }

    if (intent.status !== 'paid') {
      await this.db.withTransaction(async (client) => {
        await this.orderSettlementService.markPaymentIntentPaid(client, {
          id: intent.id,
          sessionId: intent.sessionId,
          orderId: intent.orderId,
          providerPayload: paymentConfirmationPayload
        });
      });
    }

    try {
      const inspection = await this.inspectByImei(intent.imei, null);
      const target = await this.resolveCheckoutTarget(intent.imei);
      if (!inspection.can_start) {
        const reason = this.pickPrimaryReason(inspection.reasons ?? []);
        throw new AppException(reason.code as keyof typeof ErrorCodes, reason.message, 400, {
          imei: intent.imei,
          reasons: inspection.reasons
        });
      }
      if (!target) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '未找到支付目标设备', 404, { imei: intent.imei });
      }

      const decision = await this.runtimeDecisionService.createStartDecision(
        {
          targetType: target.targetType,
          targetId: target.targetId,
          sceneCode: 'farmer_scan_start',
          relationId: target.relationId
        },
        { cardToken: null }
      );

      const session = await this.runtimeService.createSessionSynchronously(decision.decisionId!, null, {
        orderChannel: 'QR',
        fundingMode: 'qr_prepay',
        paymentMode: normalizedProvider,
        paymentStatus: 'paid',
        prepaidAmount: Number(intent.amount ?? 0),
        targetDeviceId: inspection.device_id ?? null,
        targetImei: inspection.imei,
        targetDeviceRole: inspection.device_role ?? null,
        sourcePaymentIntentId: intent.id,
        startedVia:
          this.asString(input.startedVia) ||
          (normalizedProvider === 'alipay' ? 'alipay_callback' : 'wechat_callback'),
        checkoutSnapshot: {
          out_trade_no: intent.outTradeNo,
          paid_amount: Number(intent.amount ?? 0),
          provider_trade_no: this.asString(input.providerTradeNo) || null
        }
      });

      const order = await this.orderRepository.findBySessionId(session.sessionId);
      await this.db.withTransaction(async (client) => {
        await this.orderSettlementService.markPaymentIntentPaid(client, {
          id: intent.id,
          sessionId: session.sessionId,
          orderId: order?.id ?? null,
          providerPayload: {
            ...paymentConfirmationPayload,
            imei: intent.imei,
            start_result: 'started'
          }
        });
      });

      return {
        payment_intent_id: intent.id,
        session_id: session.sessionId,
        order_id: order?.id ?? null,
        session_ref: session.sessionRef ?? null,
        queued_commands: session.queuedCommands ?? []
      };
    } catch (error) {
      const startError = this.formatStartFailureMessage(error);
      await this.db.withTransaction(async (client) => {
        await this.orderSettlementService.markPaymentIntentRefunded(client, {
          id: intent.id,
          refundedAmount: this.roundMoney(Number(intent.amount ?? 0)),
          providerPayload: {
            ...paymentConfirmationPayload,
            imei: intent.imei,
            start_result: 'failed',
            start_error: startError,
            refunded_amount: this.roundMoney(Number(intent.amount ?? 0)),
            start_failed_at: new Date().toISOString()
          }
        });
      });
      throw error;
    }
  }

  async inspectByImei(imei: string, cardToken?: string | null) {
    const normalizedImei = this.asString(imei);
    if (!normalizedImei) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'IMEI is required', 400);
    }

    const targetResolution = await this.resolveCheckoutTargetContext(normalizedImei);
    const target = targetResolution.target;
    if (!target && targetResolution.blockingReason) {
      return {
        imei: normalizedImei,
        availability_status: 'not_found',
        can_start: false,
        reasons: [targetResolution.blockingReason],
        capabilities: {
          qr_payment: { supported: false, reason: this.buildReason('QR_PAYMENT_NOT_SUPPORTED', '当前设备未开通扫码支付启动能力') },
          card_payment: { supported: false, reason: this.buildReason('CARD_PAYMENT_NOT_SUPPORTED', '当前设备未开通刷卡支付启动能力') }
        },
      };
    }
    if (!target) {
      return {
        imei: normalizedImei,
        availability_status: 'not_found',
        can_start: false,
        reasons: [this.buildReason(ErrorCodes.TARGET_NOT_FOUND, '未找到该 IMEI 对应的控制器')],
        capabilities: {
          qr_payment: { supported: false, reason: this.buildReason('QR_PAYMENT_NOT_SUPPORTED', '当前设备未开通扫码支付启动能力') },
          card_payment: { supported: false, reason: this.buildReason('CARD_PAYMENT_NOT_SUPPORTED', '当前设备未开通刷卡支付启动能力') }
        },
      };
    }

    const capabilities = this.buildEntryModeCapabilities(target.deviceFeatureModules);

    const decision = await this.runtimeDecisionService.createStartDecision(
      {
        targetType: target.targetType,
        targetId: target.targetId,
        sceneCode: 'farmer_scan_start',
        relationId: target.relationId
      },
      { cardToken }
    );

    const openOrder = await this.findOpenOrderByImei(normalizedImei);
    const alarms = await this.listOpenAlarms(target);
    const reasons = [
      ...((decision.blockingReasons ?? []).map((item) => ({
        code: this.asString(item.code ?? item.reasonCode) || ErrorCodes.FORBIDDEN,
        message: this.asString(item.message ?? item.reasonText) || '当前设备不可启动'
      }))),
      ...(openOrder
        ? [
            this.buildReason(
              ErrorCodes.ORDER_ALREADY_EXISTS,
              '该设备存在未结束订单',
              { order_id: openOrder.orderId, session_id: openOrder.sessionId }
            )
          ]
        : []),
      ...alarms.map((alarm) =>
        this.buildReason('DEVICE_FAULT', alarm.alarmTitle ?? `设备故障：${alarm.alarmCode}`, {
          alarm_code: alarm.alarmCode
        })
      )
    ];

    const canStart = decision.result === 'allow' && !openOrder && alarms.length === 0;
    const availabilityStatus =
      canStart ? 'idle' : openOrder ? 'busy' : alarms.length > 0 ? 'fault' : 'blocked';
    const user = await this.farmerFundService.resolvePortalUser(cardToken ?? null);
    const wallet = cardToken ? await this.farmerFundService.getWalletSummary(user.id, user.tenantId) : null;
    const paymentAccount = await this.paymentAccountService.resolveEffectiveAccount(
      user.tenantId,
      'wechat',
      target.projectId
    );

    return {
      imei: normalizedImei,
      device_id: target.deviceId,
      device_code: target.deviceCode,
      device_name: target.deviceName ?? target.deviceCode,
      device_role: target.deviceRole,
      target_type: target.targetType,
      target_id: target.targetId,
      well_name: target.wellName ?? '--',
      block_id: target.blockId,
      block_name: target.blockName,
      project_id: target.projectId,
      project_name: target.projectName,
      availability_status: availabilityStatus,
      can_start: canStart,
      reasons,
      capabilities,
      price_preview: decision.pricePreview ?? null,
      payment_account_preview: this.mapPaymentAccountPreview(paymentAccount),
      open_order: openOrder
        ? {
            order_id: openOrder.orderId,
            order_status: openOrder.orderStatus,
            payment_status: openOrder.paymentStatus,
            session_id: openOrder.sessionId,
            session_status: openOrder.sessionStatus,
            amount: Number(openOrder.amount ?? 0),
            prepaid_amount: Number(openOrder.prepaidAmount ?? 0),
            locked_amount: Number(openOrder.lockedAmount ?? 0),
          }
        : null,
      wallet: wallet
        ? {
            balance: Number(wallet.balance ?? 0),
            locked_balance: Number((wallet as Record<string, unknown>).locked_balance ?? 0),
          }
        : null
    };
  }

  async createWechatPaymentLink(imei: string, amount: number) {
    const user = await this.farmerFundService.resolvePortalUser(null);
    const inspection = await this.inspectByImei(imei, null);
    this.ensureEntryModeSupported(inspection.capabilities as CheckoutCapabilities, 'qr_payment');
    if (!inspection.can_start) {
      const reason = this.pickPrimaryReason(inspection.reasons ?? []);
      throw new AppException(reason.code as keyof typeof ErrorCodes, reason.message, 400, {
        imei,
        reasons: inspection.reasons
      });
    }

    const normalizedAmount = this.roundMoney(Math.max(0, Number(amount ?? 0)));
    if (normalizedAmount <= 0) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, '支付金额必须大于 0', 400, { amount });
    }

    const target = await this.resolveCheckoutTarget(this.asString(imei));
    if (!target) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '未找到支付目标设备', 404, { imei });
    }
    const paymentAccount = await this.paymentAccountService.resolveEffectiveAccount(
      user.tenantId,
      'wechat',
      target.projectId
    );
    const configJson = this.asObject(paymentAccount.configJson);
    const notifyUrl = this.joinPublicUrl(this.asString(configJson.notify_url) || '/api/v1/payments/wechat/notify');

    const intent = await this.orderSettlementService.createPaymentIntent({
      tenantId: user.tenantId,
      userId: user.id,
      targetDeviceId: inspection.device_id ?? null,
      imei: this.asString(imei),
      paymentAccountId: paymentAccount.id,
      paymentAccountSnapshot: {
        provider: paymentAccount.provider,
        account_code: paymentAccount.accountCode,
        account_name: paymentAccount.accountName,
        merchant_no: paymentAccount.merchantNo,
        app_id: paymentAccount.appId,
        account_identity: paymentAccount.accountIdentity,
        resolution: paymentAccount.resolution,
        is_default: paymentAccount.isDefault
      },
      paymentChannel: 'wechat_h5',
      paymentMode: 'wechat',
      amount: normalizedAmount,
      payLink: null,
      checkoutSnapshot: {
        imei: this.asString(imei),
        device_name: inspection.device_name ?? null,
        well_name: inspection.well_name ?? null,
        block_id: target.blockId,
        block_name: target.blockName,
        project_id: target.projectId,
        project_name: target.projectName,
        price_preview: inspection.price_preview ?? null,
        created_from: 'farmer_scan'
      },
      providerPayload: {
        provider: 'wechat_jsapi_v2',
        payment_account_code: paymentAccount.accountCode,
        payment_account_name: paymentAccount.accountName,
        payment_account_resolution: paymentAccount.resolution,
        notify_url: notifyUrl
      },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });
    const payLink = this.buildWechatPayLink(intent.id, this.asString(imei));

    return {
      payment_intent_id: intent.id,
      out_trade_no: intent.outTradeNo,
      amount: intent.amount,
      pay_link: payLink,
      callback_token: intent.callbackToken,
      expires_at: intent.expiresAt,
      payment_account: this.mapPaymentAccountPreview(paymentAccount)
    };
  }

  async getWechatPaymentStatus(paymentIntentId: string, cardToken?: string | null) {
    const user = await this.farmerFundService.resolvePortalUser(cardToken ?? null);
    const intent = await this.orderSettlementService.getPaymentIntentById(paymentIntentId);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '支付单不存在', 404, { paymentIntentId });
    }
    if (intent.tenantId !== user.tenantId || intent.userId !== user.id) {
      throw new AppException(ErrorCodes.FORBIDDEN, '无权查看该支付单', 403, { paymentIntentId });
    }

    const sessionResult = intent.sessionId
      ? await this.db.query<{ sessionRef: string | null; sessionStatus: string | null }>(
          `
          select
            session_ref as "sessionRef",
            status as "sessionStatus"
          from runtime_session
          where id = $1::uuid
          limit 1
          `,
          [intent.sessionId]
        )
      : null;

    return {
      payment_intent_id: intent.id,
      imei: intent.imei,
      status: intent.status,
      payment_mode: intent.paymentMode,
      out_trade_no: intent.outTradeNo,
      amount: intent.amount,
      refunded_amount: intent.refundedAmount,
      pay_link: intent.payLink || (intent.status === 'created' ? this.buildWechatPayLink(intent.id, intent.imei) : null),
      session_id: intent.sessionId,
      session_ref: sessionResult?.rows[0]?.sessionRef ?? null,
      session_status: sessionResult?.rows[0]?.sessionStatus ?? null,
      order_id: intent.orderId,
      expires_at: intent.expiredAt,
      paid_at: intent.paidAt,
      refunded_at: intent.refundedAt,
      checkout_snapshot: intent.checkoutSnapshot ?? {},
      provider_payload: intent.providerPayload ?? {},
      payment_account: this.mapPaymentAccountPreview({
        id: intent.paymentAccountId ?? null,
        provider: intent.paymentMode === 'alipay' ? 'alipay' : 'wechat',
        accountCode: this.asString(intent.paymentAccountSnapshot?.account_code) || 'SYS-DEFAULT',
        accountName:
          this.asString(intent.paymentAccountSnapshot?.account_name) ||
          (intent.paymentMode === 'alipay' ? '系统默认支付宝收款账户' : '系统默认微信收款账户'),
        merchantNo: this.asString(intent.paymentAccountSnapshot?.merchant_no) || null,
        appId: this.asString(intent.paymentAccountSnapshot?.app_id) || null,
        accountIdentity: this.asString(intent.paymentAccountSnapshot?.account_identity) || null,
        resolution: this.asString(intent.paymentAccountSnapshot?.resolution) || 'builtin_default',
        isDefault: Boolean(intent.paymentAccountSnapshot?.is_default ?? true)
      })
    };
  }

  async completeProviderPaymentByOutTradeNo(
    outTradeNo: string,
    input: {
      provider: 'wechat' | 'alipay';
      paidAmount?: number | null;
      providerTradeNo?: string | null;
      providerPayload?: Record<string, unknown>;
      startedVia?: string | null;
    }
  ) {
    const normalizedOutTradeNo = this.asString(outTradeNo);
    if (!normalizedOutTradeNo) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'out_trade_no is required', 400);
    }

    const intent = await this.orderSettlementService.getPaymentIntentByOutTradeNo(normalizedOutTradeNo);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '支付单不存在', 404, {
        out_trade_no: normalizedOutTradeNo
      });
    }

    return this.completePaymentIntentById(intent.id, {
      provider: input.provider,
      paidAmount: input.paidAmount ?? null,
      providerTradeNo: input.providerTradeNo ?? null,
      providerPayload: input.providerPayload ?? {},
      startedVia: input.startedVia ?? null,
      skipCallbackTokenValidation: true
    });
  }

  async completeWechatPayment(paymentIntentId: string, callbackToken: string) {
    return this.completePaymentIntentById(paymentIntentId, {
      provider: 'wechat',
      callbackToken,
      startedVia: 'wechat_callback'
    });
    const intent = await this.orderSettlementService.getPaymentIntentById(paymentIntentId);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '支付单不存在', 404, { paymentIntentId });
    }
    if (this.asString(callbackToken) !== this.asString(intent.callbackToken)) {
      throw new AppException(ErrorCodes.FORBIDDEN, '支付回调令牌无效', 403, { paymentIntentId });
    }
    if (intent.sessionId) {
      return {
        payment_intent_id: intent.id,
        session_id: intent.sessionId,
        order_id: intent.orderId,
        payment_status: intent.status,
        idempotent: true
      };
    }

    const inspection = await this.inspectByImei(intent.imei, null);
    const target = await this.resolveCheckoutTarget(intent.imei);
    if (!inspection.can_start) {
      const reason = this.pickPrimaryReason(inspection.reasons ?? []);
      throw new AppException(reason.code as keyof typeof ErrorCodes, reason.message, 400, {
        imei: intent.imei,
        reasons: inspection.reasons
      });
    }
    if (!target) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '未找到支付目标设备', 404, { imei: intent.imei });
    }

    const decision = await this.runtimeDecisionService.createStartDecision(
      {
        targetType: target!.targetType,
        targetId: target!.targetId,
        sceneCode: 'farmer_scan_start',
        relationId: target!.relationId
      },
      { cardToken: null }
    );

    const session = await this.runtimeService.createSessionSynchronously(decision.decisionId!, null, {
      orderChannel: 'QR',
      fundingMode: 'qr_prepay',
      paymentMode: 'wechat',
      paymentStatus: 'paid',
      prepaidAmount: Number(intent.amount ?? 0),
      targetDeviceId: inspection.device_id ?? null,
      targetImei: inspection.imei,
      targetDeviceRole: inspection.device_role ?? null,
      sourcePaymentIntentId: intent.id,
      startedVia: 'wechat_callback',
      checkoutSnapshot: {
        out_trade_no: intent.outTradeNo,
        paid_amount: Number(intent.amount ?? 0)
      }
    });

    const order = await this.orderRepository.findBySessionId(session.sessionId);
    await this.db.withTransaction(async (client) => {
      if (order) {
        await this.orderSettlementService.markPaymentIntentPaid(client, {
          id: intent.id,
          sessionId: session.sessionId,
          orderId: order.id,
          providerPayload: {
            callback_confirmed_at: new Date().toISOString(),
            imei: intent.imei
          }
        });
      }
    });

    return {
      payment_intent_id: intent.id,
      session_id: session.sessionId,
      order_id: order?.id ?? null,
      session_ref: session.sessionRef ?? null,
      queued_commands: session.queuedCommands ?? []
    };
  }

  async handleCardSwipe(
    imei: string,
    providedCardToken?: string | null,
    swipeAction?: string | null,
    swipeEventId?: string | null,
    swipeAt?: string | null
  ) {
    const cardToken = this.asString(providedCardToken);
    if (!cardToken) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'card_token is required', 400);
    }

    const user = await this.farmerFundService.resolvePortalUser(cardToken);
    const recordedResult = await this.findRecordedCardSwipeResult(user.tenantId, user.id, swipeEventId);
    if (recordedResult) {
      return recordedResult;
    }
    const normalizedImei = this.asString(imei);
    const normalizedAction = this.asString(swipeAction).toLowerCase();
    let effectiveSwipeAction = normalizedAction || 'start';
    try {
      const activeSession = await this.findActiveSessionForUser(user.id);
      const recentEndedSession = await this.findRecentEndedCardSession(user.id, CARD_SETTLEMENT_GUARD_SECONDS);

      if (activeSession) {
        const sameTarget = activeSession.targetImei === normalizedImei;
        const startedBySameCard =
          this.asString(activeSession.starterCardToken) &&
          this.asString(activeSession.starterCardToken) === cardToken;
        const inferredStop = normalizedAction === 'stop' || (!normalizedAction && sameTarget);
        if (inferredStop) {
          effectiveSwipeAction = 'stop';
        }

        if (sameTarget && inferredStop && !startedBySameCard) {
          throw new AppException(
            ErrorCodes.FORBIDDEN,
            '当前订单只能由启动该订单的原卡关闭，请使用同一张卡再次刷卡结束',
            403,
            {
              activeSessionId: activeSession.sessionId,
              targetImei: activeSession.targetImei,
              activeCardToken: activeSession.starterCardToken ?? null,
              currentCardToken: cardToken
            }
          );
        }

        if (inferredStop) {
          const stopped = await this.runtimeService.stopSession(activeSession.sessionId, cardToken);
          return this.recordCardSwipeResult({
            tenantId: user.tenantId,
            userId: user.id,
            imei: normalizedImei,
            cardToken,
            swipeAction: effectiveSwipeAction,
            swipeEventId,
            swipeAt,
            responseSnapshot: {
              action: 'stop',
              session_id: activeSession.sessionId,
              session_ref: activeSession.sessionRef,
              awaiting_device_ack: true,
              queued_commands: stopped.queuedCommands ?? []
            }
          });
        }
      }

      if (activeSession && activeSession.targetImei !== normalizedImei) {
        throw new AppException(ErrorCodes.CONCURRENCY_LIMIT_REACHED, '当前卡片已有进行中的订单，请先再次刷卡结束', 400, {
          activeSessionId: activeSession.sessionId,
          targetImei: activeSession.targetImei
        });
      }

      if (recentEndedSession && recentEndedSession.targetImei === normalizedImei) {
        throw new AppException(ErrorCodes.CONCURRENCY_LIMIT_REACHED, 'card settlement is still in progress', 400, {
          endedSessionId: recentEndedSession.sessionId,
          orderId: recentEndedSession.orderId,
          endedAt: recentEndedSession.endedAt,
          guardSeconds: CARD_SETTLEMENT_GUARD_SECONDS
        });
      }

      const inspection = await this.inspectByImei(normalizedImei, cardToken);
      this.ensureEntryModeSupported(inspection.capabilities as CheckoutCapabilities, 'card_payment');
      const target = await this.resolveCheckoutTarget(normalizedImei);
      if (!inspection.can_start) {
        const reason = this.pickPrimaryReason(inspection.reasons ?? []);
        throw new AppException(reason.code as keyof typeof ErrorCodes, reason.message, 400, {
          imei,
          reasons: inspection.reasons
        });
      }
      if (!target) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '未找到刷卡目标设备', 404, { imei });
      }

      const wallet = await this.farmerFundService.getWalletSummary(user.id, user.tenantId);
      const lockAmount = this.roundMoney(Number(wallet.balance ?? 0));
      if (lockAmount <= 0) {
        throw new AppException(ErrorCodes.WALLET_INSUFFICIENT_BALANCE, '卡余额不足，无法启动设备', 400, {
          imei,
          balance: wallet.balance
        });
      }

      const decision = await this.runtimeDecisionService.createStartDecision(
        {
          targetType: target.targetType,
          targetId: target.targetId,
          sceneCode: 'farmer_scan_start',
          relationId: target.relationId
        },
        { cardToken }
      );

      const session = await this.runtimeService.createSessionSynchronously(decision.decisionId!, cardToken, {
        orderChannel: 'CARD',
        fundingMode: 'card_wallet_locked',
        paymentMode: 'card',
        paymentStatus: 'locked',
        lockedAmount: lockAmount,
        targetDeviceId: inspection.device_id ?? null,
        targetImei: inspection.imei,
        targetDeviceRole: inspection.device_role ?? null,
        startedVia: 'card_swipe',
        checkoutSnapshot: {
          card_token: cardToken,
          locked_amount: lockAmount
        }
      });

      const order = await this.orderRepository.findBySessionId(session.sessionId);
      if (!order) {
        throw new AppException(ErrorCodes.TARGET_NOT_FOUND, '订单创建失败', 500, { sessionId: session.sessionId });
      }

      try {
        await this.db.withTransaction(async (client) => {
          await this.farmerFundService.lockWalletAmount(client, {
            tenantId: user.tenantId,
            userId: user.id,
            orderId: order.id,
            amount: lockAmount,
            remark: 'card swipe lock'
          });
          await this.orderSettlementService.attachCheckoutContextToOrder(client, {
            orderId: order.id,
            lockedAmount: lockAmount,
            paymentStatus: 'locked',
            paymentMode: 'card'
          });
        });
      } catch (error) {
        await this.runtimeService.stopSession(session.sessionId, cardToken).catch(() => null);
        throw error;
      }

      return this.recordCardSwipeResult({
        tenantId: user.tenantId,
        userId: user.id,
        imei: normalizedImei,
        cardToken,
        swipeAction: effectiveSwipeAction,
        swipeEventId,
        swipeAt,
        responseSnapshot: {
          action: 'start',
          session_id: session.sessionId,
          order_id: order.id,
          session_ref: session.sessionRef ?? null,
          locked_amount: lockAmount,
          queued_commands: session.queuedCommands ?? []
        }
      });
    } catch (error) {
      return this.recordCardSwipeFailureAndRethrow(user, {
        imei: normalizedImei,
        cardToken,
        swipeAction: effectiveSwipeAction,
        swipeEventId,
        swipeAt,
        error
      });
    }
  }

  private normalizePaymentFlowType(value: unknown): PaymentFlowType {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'card_swipe' || normalized === 'scan_order') {
      return normalized;
    }
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'unsupported payment flow type', 400, {
      flow_type: value
    });
  }

  private normalizePaymentFlowAction(value: unknown): PaymentFlowAction {
    const normalized = this.asString(value).toLowerCase();
    if (
      normalized === 'mark_manual_review' ||
      normalized === 'mark_ignored' ||
      normalized === 'mark_resolved' ||
      normalized === 'attach_work_order' ||
      normalized === 'reissue_pay_link'
    ) {
      return normalized;
    }
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'unsupported payment flow action', 400, {
      action: value
    });
  }

  private normalizePaymentFlowBatchAction(value: unknown): Extract<PaymentFlowAction, 'mark_manual_review' | 'mark_ignored' | 'mark_resolved'> {
    const action = this.normalizePaymentFlowAction(value);
    if (action === 'mark_manual_review' || action === 'mark_ignored' || action === 'mark_resolved') {
      return action;
    }
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'unsupported batch payment flow action', 400, {
      action: value
    });
  }

  private fallbackPaymentFlowAction(value: unknown, fallback: PaymentFlowAction = 'mark_manual_review'): PaymentFlowAction {
    const normalized = this.asString(value).toLowerCase();
    if (
      normalized === 'mark_manual_review' ||
      normalized === 'mark_ignored' ||
      normalized === 'mark_resolved' ||
      normalized === 'attach_work_order' ||
      normalized === 'reissue_pay_link'
    ) {
      return normalized;
    }
    return fallback;
  }

  private normalizePaymentFlowOpsStatus(value: unknown): PaymentFlowOpsStatus {
    const normalized = this.asString(value).toLowerCase();
    if (
      normalized === 'manual_review' ||
      normalized === 'ignored' ||
      normalized === 'resolved' ||
      normalized === 'unhandled'
    ) {
      return normalized;
    }
    return 'unhandled';
  }

  private extractPaymentFlowOpsHandling(
    flowType: PaymentFlowType,
    responseSnapshot?: Record<string, unknown> | null
  ): PaymentFlowOpsHandling {
    const normalizedResponseSnapshot = this.asObject(responseSnapshot);
    const providerPayload =
      flowType === 'scan_order'
        ? this.asObject(normalizedResponseSnapshot.provider_payload)
        : {};
    const opsHandlingSource =
      flowType === 'scan_order'
        ? this.asObject(providerPayload.ops_handling)
        : this.asObject(normalizedResponseSnapshot.ops_handling);
    const rawHistory = Array.isArray(opsHandlingSource.history) ? opsHandlingSource.history : [];
    const history = rawHistory
      .map((item) => this.asObject(item))
      .map((item) => ({
        action: this.fallbackPaymentFlowAction(item.action),
        status: this.normalizePaymentFlowOpsStatus(item.status),
        note: this.asString(item.note) || null,
        linked_work_order_id: this.asString(item.linked_work_order_id ?? item.work_order_id) || null,
        handled_at: this.asString(item.handled_at),
        handled_by: this.asString(item.handled_by) || 'ops_mobile'
      }))
      .filter((item) => item.handled_at);

    return {
      status: this.normalizePaymentFlowOpsStatus(opsHandlingSource.status),
      note: this.asString(opsHandlingSource.note) || null,
      linked_work_order_id:
        this.asString(opsHandlingSource.linked_work_order_id ?? opsHandlingSource.work_order_id) || null,
      handled_at: this.asString(opsHandlingSource.handled_at) || null,
      handled_by: this.asString(opsHandlingSource.handled_by) || null,
      last_action: this.asString(opsHandlingSource.last_action)
        ? this.fallbackPaymentFlowAction(opsHandlingSource.last_action)
        : null,
      history
    };
  }

  private buildPaymentFlowOpsHandling(
    current: PaymentFlowOpsHandling,
    input: {
      action: PaymentFlowAction;
      note?: string | null;
      linkedWorkOrderId?: string | null;
    }
  ): PaymentFlowOpsHandling {
    const handledAt = new Date().toISOString();
    const normalizedNote = this.asString(input.note) || null;
    const linkedWorkOrderId = this.asString(input.linkedWorkOrderId) || current.linked_work_order_id || null;
    const status: PaymentFlowOpsStatus =
      input.action === 'mark_ignored'
        ? 'ignored'
        : input.action === 'mark_resolved'
          ? 'resolved'
          : 'manual_review';

    const historyItem: PaymentFlowOpsHistoryItem = {
      action: input.action,
      status,
      note: normalizedNote,
      linked_work_order_id: linkedWorkOrderId,
      handled_at: handledAt,
      handled_by: 'ops_mobile'
    };

    return {
      status,
      note: normalizedNote ?? current.note ?? null,
      linked_work_order_id: linkedWorkOrderId,
      handled_at: handledAt,
      handled_by: 'ops_mobile',
      last_action: input.action,
      history: [...current.history, historyItem]
    };
  }

  private buildPaymentFlowAvailableActions(
    row: PaymentFlowRow,
    opsHandling: PaymentFlowOpsHandling,
    payLink: string | null
  ) {
    const actions = new Set<string>();
    if (payLink) {
      actions.add('open_pay_link');
    }
    if (row.flow_type === 'scan_order' && row.raw_status !== 'paid' && row.raw_status !== 'refunded') {
      actions.add('reissue_pay_link');
    }
    actions.add('mark_manual_review');
    actions.add('attach_work_order');
    if (opsHandling.status !== 'ignored') {
      actions.add('mark_ignored');
    }
    if (opsHandling.status !== 'resolved') {
      actions.add('mark_resolved');
    }
    return Array.from(actions);
  }

  private mapPaymentFlowRow(row: PaymentFlowRow) {
    const requestSnapshot = this.asObject(row.request_snapshot);
    const responseSnapshot = this.asObject(row.response_snapshot);
    const opsHandling = this.extractPaymentFlowOpsHandling(row.flow_type, responseSnapshot);
    const canOpenPayLink =
      row.flow_type === 'scan_order' && (row.raw_status === 'created' || row.raw_status === 'pending');
    const derivedPayLink =
      canOpenPayLink && row.payment_intent_id && row.imei
        ? this.buildWechatPayLink(row.payment_intent_id, row.imei)
        : null;
    const payLink = canOpenPayLink ? this.asString(row.pay_link) || derivedPayLink || null : null;

    return {
      id: row.id,
      flow_type: row.flow_type,
      entry_mode: row.entry_mode,
      action_code: row.action_code,
      raw_status: row.raw_status,
      result_bucket: row.result_bucket,
      imei: row.imei ?? null,
      device_name: row.device_name ?? null,
      card_token: row.card_token ?? null,
      user_name: row.user_name ?? null,
      order_id: row.order_id ?? null,
      order_no: row.order_no ?? null,
      session_id: row.session_id ?? null,
      session_ref: row.session_ref ?? null,
      payment_intent_id: row.payment_intent_id ?? null,
      out_trade_no: row.out_trade_no ?? null,
      pay_link: payLink,
      amount: Number(row.amount ?? 0),
      locked_amount: Number(row.locked_amount ?? 0),
      payment_status: row.payment_status ?? null,
      result_code: row.result_code ?? null,
      result_message: row.result_message ?? null,
      awaiting_device_ack: Boolean(row.awaiting_device_ack),
      reference_no: row.reference_no ?? null,
      request_snapshot: requestSnapshot,
      response_snapshot: responseSnapshot,
      occurred_at: row.occurred_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at ?? null,
      ops_status: opsHandling.status,
      ops_note: opsHandling.note,
      ops_handled_at: opsHandling.handled_at,
      ops_handled_by: opsHandling.handled_by,
      ops_work_order_id: opsHandling.linked_work_order_id,
      ops_history: opsHandling.history,
      age_minutes: Math.max(0, Number(row.age_minutes ?? 0)),
      sla_level: this.asString(row.sla_level) || 'none',
      available_actions: this.buildPaymentFlowAvailableActions(row, opsHandling, payLink)
    };
  }

  private async getPaymentFlowRowByType(flowType: PaymentFlowType, id: string) {
    if (flowType === 'card_swipe') {
      const result = await this.db.query<PaymentFlowRow>(
        `
        select
          cse.id::text as id,
          'card_swipe'::text as flow_type,
          'card'::text as entry_mode,
          coalesce(nullif(cse.swipe_action, ''), 'swipe') as action_code,
          coalesce(nullif(cse.result_category, ''), 'unknown') as raw_status,
          case
            when cse.result_category = 'accepted' then 'success'
            when cse.result_category = 'pending_device_ack' then 'pending'
            when cse.result_category = 'duplicate_ignored' then 'ignored'
            else 'failed'
          end as result_bucket,
          cse.imei,
          d.device_name as device_name,
          cse.card_token as card_token,
          su.display_name as user_name,
          swipe_order.order_id,
          swipe_order.order_no,
          swipe_session.session_id,
          swipe_session.session_ref,
          null::text as payment_intent_id,
          null::text as out_trade_no,
          null::text as pay_link,
          coalesce(swipe_order.amount, 0)::float8 as amount,
          coalesce(swipe_order.locked_amount, 0)::float8 as locked_amount,
          swipe_order.payment_status,
          cse.result_code,
          coalesce(cse.result_message, nullif(cse.response_snapshot_json->>'message', ''), nullif(cse.response_snapshot_json->>'error_message', '')) as result_message,
          cse.awaiting_device_ack,
          cse.swipe_event_id as reference_no,
          cse.request_snapshot_json as request_snapshot,
          cse.response_snapshot_json as response_snapshot,
          cse.swipe_at as occurred_at,
          cse.created_at,
          cse.updated_at
        from card_swipe_event cse
        left join sys_user su on su.id = cse.user_id
        left join device d on d.imei = cse.imei
        left join lateral (
          select
            io.id::text as order_id,
            io.order_no,
            io.session_id::text as session_id,
            io.amount,
            io.locked_amount,
            io.payment_status
          from irrigation_order io
          where io.id::text = nullif(cse.response_snapshot_json->>'order_id', '')
             or io.session_id::text = nullif(cse.response_snapshot_json->>'session_id', '')
          order by io.created_at desc
          limit 1
        ) swipe_order on true
        left join lateral (
          select
            rs.id::text as session_id,
            rs.session_ref
          from runtime_session rs
          where rs.id::text = coalesce(swipe_order.session_id, nullif(cse.response_snapshot_json->>'session_id', ''))
          limit 1
        ) swipe_session on true
        where cse.id = $1::uuid
        limit 1
        `,
        [id]
      );
      return result.rows[0] ?? null;
    }

    const result = await this.db.query<PaymentFlowRow>(
      `
      select
        pi.id::text as id,
        'scan_order'::text as flow_type,
        coalesce(nullif(pi.payment_mode, ''), 'wechat') as entry_mode,
        'scan_checkout'::text as action_code,
        pi.status as raw_status,
        case
          when pi.status = 'paid' then 'success'
          when pi.status = 'refunded' then 'refunded'
          when pi.status in ('created', 'pending') then 'pending'
          else 'failed'
        end as result_bucket,
        pi.imei,
        coalesce(d.device_name, nullif(pi.checkout_snapshot_json->>'device_name', '')) as device_name,
        nullif(pi.checkout_snapshot_json->>'card_token', '') as card_token,
        su.display_name as user_name,
        pay_order.order_id,
        pay_order.order_no,
        pay_session.session_id,
        pay_session.session_ref,
        pi.id::text as payment_intent_id,
        pi.out_trade_no,
        pi.pay_link,
        coalesce(pi.amount, 0)::float8 as amount,
        coalesce(pay_order.locked_amount, 0)::float8 as locked_amount,
        coalesce(pay_order.payment_status, pi.status) as payment_status,
        pi.status as result_code,
        coalesce(
          nullif(pi.provider_payload_json->>'message', ''),
          nullif(pi.provider_payload_json->>'err_msg', ''),
          nullif(pi.provider_payload_json->>'return_msg', ''),
          nullif(pi.provider_payload_json->>'reason', '')
        ) as result_message,
        false as awaiting_device_ack,
        pi.out_trade_no as reference_no,
        pi.checkout_snapshot_json as request_snapshot,
        jsonb_build_object(
          'provider_payload', coalesce(pi.provider_payload_json, '{}'::jsonb),
          'payment_account_snapshot', coalesce(pi.payment_account_snapshot_json, '{}'::jsonb),
          'paid_at', pi.paid_at,
          'refunded_at', pi.refunded_at,
          'expired_at', pi.expired_at
        ) as response_snapshot,
        coalesce(pi.paid_at, pi.refunded_at, pi.expired_at, pi.created_at) as occurred_at,
        pi.created_at,
        pi.updated_at
      from payment_intent pi
      left join sys_user su on su.id = pi.user_id
      left join device d on d.imei = pi.imei
      left join lateral (
        select
          io.id::text as order_id,
          io.order_no,
          io.session_id::text as session_id,
          io.locked_amount,
          io.payment_status
        from irrigation_order io
        where io.id = pi.order_id
           or io.source_payment_intent_id = pi.id
        order by case when io.id = pi.order_id then 0 else 1 end, io.created_at desc
        limit 1
      ) pay_order on true
      left join lateral (
        select
          rs.id::text as session_id,
          rs.session_ref
        from runtime_session rs
        where rs.id::text = coalesce(pi.session_id::text, pay_order.session_id)
        limit 1
      ) pay_session on true
      where pi.id = $1::uuid
        and coalesce(pi.checkout_snapshot_json->>'created_from', '') = 'farmer_scan'
      limit 1
      `,
      [id]
    );
    return result.rows[0] ?? null;
  }

  private async updateCardSwipeOpsHandling(
    id: string,
    input: { action: PaymentFlowAction; note?: string | null; linkedWorkOrderId?: string | null }
  ) {
    const current = await this.db.query<{ responseSnapshot: Record<string, unknown> }>(
      `
      select response_snapshot_json as "responseSnapshot"
      from card_swipe_event
      where id = $1::uuid
      limit 1
      `,
      [id]
    );
    const row = current.rows[0];
    if (!row) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'payment flow not found', 404, { id, flow_type: 'card_swipe' });
    }

    const responseSnapshot = this.asObject(row.responseSnapshot);
    const currentOps = this.extractPaymentFlowOpsHandling('card_swipe', responseSnapshot);
    const nextOps = this.buildPaymentFlowOpsHandling(currentOps, input);
    const nextResponseSnapshot = {
      ...responseSnapshot,
      ops_handling: nextOps
    };

    await this.db.query(
      `
      update card_swipe_event
      set response_snapshot_json = $2::jsonb,
          updated_at = now()
      where id = $1::uuid
      `,
      [id, JSON.stringify(nextResponseSnapshot)]
    );
  }

  private async updateScanOrderOpsHandling(
    id: string,
    input: { action: PaymentFlowAction; note?: string | null; linkedWorkOrderId?: string | null }
  ) {
    const intent = await this.orderSettlementService.getPaymentIntentById(id);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'payment flow not found', 404, { id, flow_type: 'scan_order' });
    }

    const providerPayload = this.asObject(intent.providerPayload);
    const currentOps = this.extractPaymentFlowOpsHandling('scan_order', {
      provider_payload: providerPayload
    });
    const nextOps = this.buildPaymentFlowOpsHandling(currentOps, input);
    const nextProviderPayload = {
      ...providerPayload,
      ops_handling: nextOps
    };

    await this.db.query(
      `
      update payment_intent
      set provider_payload_json = $2::jsonb,
          updated_at = now()
      where id = $1::uuid
      `,
      [id, JSON.stringify(nextProviderPayload)]
    );
  }

  private async reissueScanOrderPayLink(id: string, note?: string | null): Promise<PaymentFlowActionResult> {
    const intent = await this.orderSettlementService.getPaymentIntentById(id);
    if (!intent) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'payment flow not found', 404, { id, flow_type: 'scan_order' });
    }
    if (intent.status === 'paid' || intent.status === 'refunded') {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'paid or refunded payments cannot be reissued', 400, {
        id,
        status: intent.status
      });
    }

    const checkoutSnapshot = this.asObject(intent.checkoutSnapshot);
    const projectId =
      this.asString(checkoutSnapshot.project_id) ||
      this.asString(checkoutSnapshot.projectId) ||
      null;
    const target = await this.resolveCheckoutTarget(intent.imei);
    const paymentAccount =
      intent.paymentAccountId && Object.keys(this.asObject(intent.paymentAccountSnapshot)).length > 0
        ? {
            id: intent.paymentAccountId,
            snapshot: this.asObject(intent.paymentAccountSnapshot)
          }
        : await this.paymentAccountService
            .resolveEffectiveAccount(intent.tenantId, 'wechat', target?.projectId ?? projectId)
            .then((resolved) => ({
              id: resolved.id,
              snapshot: {
                provider: resolved.provider,
                account_code: resolved.accountCode,
                account_name: resolved.accountName,
                merchant_no: resolved.merchantNo,
                app_id: resolved.appId,
                account_identity: resolved.accountIdentity,
                resolution: resolved.resolution,
                is_default: resolved.isDefault
              }
            }));
    const nowIso = new Date().toISOString();
    const providerPayload = this.asObject(intent.providerPayload);
    delete (providerPayload as Record<string, unknown>).ops_handling;

    const reissuedIntent = await this.orderSettlementService.createPaymentIntent({
      tenantId: intent.tenantId,
      userId: intent.userId,
      targetDeviceId: intent.targetDeviceId,
      imei: intent.imei,
      paymentAccountId: paymentAccount.id,
      paymentAccountSnapshot: paymentAccount.snapshot,
      paymentChannel: intent.paymentChannel,
      paymentMode: intent.paymentMode,
      amount: Number(intent.amount ?? 0),
      payLink: null,
      checkoutSnapshot: {
        ...checkoutSnapshot,
        created_from: this.asString(checkoutSnapshot.created_from) || 'farmer_scan',
        reissued_from_payment_intent_id: intent.id,
        reissued_at: nowIso
      },
      providerPayload: {
        ...providerPayload,
        reissued_from_payment_intent_id: intent.id,
        reissued_at: nowIso
      },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });

    await this.updateScanOrderOpsHandling(id, {
      action: 'reissue_pay_link',
      note: this.asString(note) || `已补发支付链接，新支付单 ${reissuedIntent.outTradeNo}`,
      linkedWorkOrderId: null
    });

    const updated = await this.getPaymentFlowRowByType('scan_order', id);
    if (!updated) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'payment flow not found after reissue', 404, {
        id,
        flow_type: 'scan_order'
      });
    }

    return {
      flow: this.mapPaymentFlowRow(updated),
      action: 'reissue_pay_link',
      message: 'payment link reissued',
      reissued_payment: {
        payment_intent_id: reissuedIntent.id,
        out_trade_no: reissuedIntent.outTradeNo,
        amount: reissuedIntent.amount,
        pay_link: this.buildWechatPayLink(reissuedIntent.id, intent.imei),
        expires_at: reissuedIntent.expiresAt
      }
    };
  }

  async applyPaymentFlowAction(
    flowType: string,
    id: string,
    input?: { action?: string; note?: string; work_order_id?: string }
  ): Promise<PaymentFlowActionResult> {
    const normalizedFlowType = this.normalizePaymentFlowType(flowType);
    const action = this.normalizePaymentFlowAction(input?.action);
    if (action === 'attach_work_order' && !this.asString(input?.work_order_id)) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'work_order_id is required', 400, {
        action
      });
    }
    if (action === 'reissue_pay_link') {
      if (normalizedFlowType !== 'scan_order') {
        throw new AppException(ErrorCodes.VALIDATION_ERROR, 'only scan payments support pay-link reissue', 400, {
          flow_type: normalizedFlowType
        });
      }
      return this.reissueScanOrderPayLink(id, input?.note ?? null);
    }

    const handlingInput = {
      action,
      note: input?.note ?? null,
      linkedWorkOrderId: input?.work_order_id ?? null
    };
    if (normalizedFlowType === 'card_swipe') {
      await this.updateCardSwipeOpsHandling(id, handlingInput);
    } else {
      await this.updateScanOrderOpsHandling(id, handlingInput);
    }

    const updated = await this.getPaymentFlowRowByType(normalizedFlowType, id);
    if (!updated) {
      throw new AppException(ErrorCodes.TARGET_NOT_FOUND, 'payment flow not found', 404, {
        id,
        flow_type: normalizedFlowType
      });
    }

    return {
      flow: this.mapPaymentFlowRow(updated),
      action,
      message:
        action === 'mark_ignored'
          ? 'payment flow ignored'
          : action === 'mark_resolved'
            ? 'payment flow resolved'
            : action === 'attach_work_order'
              ? 'payment flow linked to work order'
              : 'payment flow marked for manual review',
      reissued_payment: null
    };
  }

  async applyPaymentFlowBatchAction(
    actionValue: string,
    input?: {
      note?: string;
      items?: Array<{ flow_type?: string; id?: string }>;
    }
  ): Promise<PaymentFlowBatchActionResult> {
    const action = this.normalizePaymentFlowBatchAction(actionValue);
    const rawItems = Array.isArray(input?.items) ? input?.items : [];
    const normalizedItems = rawItems
      .map((item) => ({
        flow_type: this.normalizePaymentFlowType(item?.flow_type),
        id: this.asString(item?.id)
      }))
      .filter((item) => item.id.length > 0);

    if (!normalizedItems.length) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'batch items are required', 400, {
        action
      });
    }
    if (normalizedItems.length > 50) {
      throw new AppException(ErrorCodes.VALIDATION_ERROR, 'batch size exceeds limit', 400, {
        action,
        limit: 50
      });
    }

    const items: PaymentFlowBatchActionItem[] = [];
    for (const item of normalizedItems) {
      try {
        const result = await this.applyPaymentFlowAction(item.flow_type, item.id, {
          action,
          note: input?.note
        });
        items.push({
          flow_type: item.flow_type,
          id: item.id,
          ok: true,
          flow: result.flow
        });
      } catch (error) {
        if (error instanceof AppException) {
          const payload = error.getResponse() as { code?: string; message?: string };
          items.push({
            flow_type: item.flow_type,
            id: item.id,
            ok: false,
            error: {
              code: payload.code || ErrorCodes.INTERNAL_ERROR,
              message: payload.message || 'payment flow batch action failed'
            }
          });
          continue;
        }
        throw error;
      }
    }

    const succeededCount = items.filter((item) => item.ok).length;
    return {
      action,
      requested_count: normalizedItems.length,
      succeeded_count: succeededCount,
      failed_count: normalizedItems.length - succeededCount,
      items
    };
  }

  async listPaymentFlows(params?: {
    page?: string | number;
    page_size?: string | number;
    q?: string;
    flow_type?: string;
    result_bucket?: string;
    ops_status?: string;
    sla_level?: string;
    imei?: string;
    card_token?: string;
  }) {
    const page = Math.max(1, Number.parseInt(String(params?.page ?? '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(params?.page_size ?? '20'), 10) || 20));
    const q = this.asString(params?.q);
    const flowType = this.asString(params?.flow_type).toLowerCase();
    const resultBucket = this.asString(params?.result_bucket).toLowerCase();
    const opsStatus = this.asString(params?.ops_status).toLowerCase();
    const slaLevel = this.asString(params?.sla_level).toLowerCase();
    const imei = this.asString(params?.imei);
    const cardToken = this.asString(params?.card_token);

    const filters: string[] = [];
    const values: unknown[] = [];
    let cursor = 1;

    if (flowType) {
      filters.push(`flow_type = $${cursor++}`);
      values.push(flowType);
    }
    if (resultBucket) {
      filters.push(`result_bucket = $${cursor++}`);
      values.push(resultBucket);
    }
    if (opsStatus) {
      filters.push(`ops_status = $${cursor++}`);
      values.push(opsStatus);
    }
    if (slaLevel && slaLevel !== 'all') {
      filters.push(`sla_level = $${cursor++}`);
      values.push(slaLevel);
    }
    if (imei) {
      filters.push(`imei = $${cursor++}`);
      values.push(imei);
    }
    if (cardToken) {
      filters.push(`card_token = $${cursor++}`);
      values.push(cardToken);
    }
    if (q) {
      filters.push(`(
        coalesce(imei, '') ilike $${cursor}
        or coalesce(device_name, '') ilike $${cursor}
        or coalesce(card_token, '') ilike $${cursor}
        or coalesce(user_name, '') ilike $${cursor}
        or coalesce(order_id, '') ilike $${cursor}
        or coalesce(order_no, '') ilike $${cursor}
        or coalesce(payment_intent_id, '') ilike $${cursor}
        or coalesce(out_trade_no, '') ilike $${cursor}
        or coalesce(session_ref, '') ilike $${cursor}
        or coalesce(reference_no, '') ilike $${cursor}
        or coalesce(result_message, '') ilike $${cursor}
      )`);
      values.push(`%${q}%`);
      cursor += 1;
    }

    const whereClause = filters.length ? `where ${filters.join(' and ')}` : '';
    const baseSql = `
      with flow_rows as (
        select
          cse.id::text as id,
          'card_swipe'::text as flow_type,
          'card'::text as entry_mode,
          coalesce(nullif(cse.swipe_action, ''), 'swipe') as action_code,
          coalesce(nullif(cse.result_category, ''), 'unknown') as raw_status,
          case
            when cse.result_category = 'accepted' then 'success'
            when cse.result_category = 'pending_device_ack' then 'pending'
            when cse.result_category = 'duplicate_ignored' then 'ignored'
            else 'failed'
          end as result_bucket,
          cse.imei,
          d.device_name as device_name,
          cse.card_token as card_token,
          su.display_name as user_name,
          swipe_order.order_id,
          swipe_order.order_no,
          swipe_session.session_id,
          swipe_session.session_ref,
          null::text as payment_intent_id,
          null::text as out_trade_no,
          null::text as pay_link,
          coalesce(swipe_order.amount, 0)::float8 as amount,
          coalesce(swipe_order.locked_amount, 0)::float8 as locked_amount,
          swipe_order.payment_status,
          cse.result_code,
          coalesce(cse.result_message, nullif(cse.response_snapshot_json->>'message', ''), nullif(cse.response_snapshot_json->>'error_message', '')) as result_message,
          cse.awaiting_device_ack,
          cse.swipe_event_id as reference_no,
          cse.request_snapshot_json as request_snapshot,
          cse.response_snapshot_json as response_snapshot,
          coalesce(nullif(cse.response_snapshot_json->'ops_handling'->>'status', ''), 'unhandled') as ops_status,
          cse.swipe_at as occurred_at,
          cse.created_at,
          cse.updated_at
        from card_swipe_event cse
        left join sys_user su on su.id = cse.user_id
        left join device d on d.imei = cse.imei
        left join lateral (
          select
            io.id::text as order_id,
            io.order_no,
            io.session_id::text as session_id,
            io.amount,
            io.locked_amount,
            io.payment_status
          from irrigation_order io
          where io.id::text = nullif(cse.response_snapshot_json->>'order_id', '')
             or io.session_id::text = nullif(cse.response_snapshot_json->>'session_id', '')
          order by io.created_at desc
          limit 1
        ) swipe_order on true
        left join lateral (
          select
            rs.id::text as session_id,
            rs.session_ref
          from runtime_session rs
          where rs.id::text = coalesce(swipe_order.session_id, nullif(cse.response_snapshot_json->>'session_id', ''))
          limit 1
        ) swipe_session on true

        union all

        select
          pi.id::text as id,
          'scan_order'::text as flow_type,
          coalesce(nullif(pi.payment_mode, ''), 'wechat') as entry_mode,
          'scan_checkout'::text as action_code,
          pi.status as raw_status,
          case
            when pi.status = 'paid' then 'success'
            when pi.status = 'refunded' then 'refunded'
            when pi.status in ('created', 'pending') then 'pending'
            else 'failed'
          end as result_bucket,
          pi.imei,
          coalesce(d.device_name, nullif(pi.checkout_snapshot_json->>'device_name', '')) as device_name,
          nullif(pi.checkout_snapshot_json->>'card_token', '') as card_token,
          su.display_name as user_name,
          pay_order.order_id,
          pay_order.order_no,
          pay_session.session_id,
          pay_session.session_ref,
          pi.id::text as payment_intent_id,
          pi.out_trade_no,
          pi.pay_link,
          coalesce(pi.amount, 0)::float8 as amount,
          coalesce(pay_order.locked_amount, 0)::float8 as locked_amount,
          coalesce(pay_order.payment_status, pi.status) as payment_status,
          pi.status as result_code,
          coalesce(
            nullif(pi.provider_payload_json->>'message', ''),
            nullif(pi.provider_payload_json->>'err_msg', ''),
            nullif(pi.provider_payload_json->>'return_msg', ''),
            nullif(pi.provider_payload_json->>'reason', '')
          ) as result_message,
          false as awaiting_device_ack,
          pi.out_trade_no as reference_no,
          pi.checkout_snapshot_json as request_snapshot,
          jsonb_build_object(
            'provider_payload', coalesce(pi.provider_payload_json, '{}'::jsonb),
            'payment_account_snapshot', coalesce(pi.payment_account_snapshot_json, '{}'::jsonb),
            'paid_at', pi.paid_at,
            'refunded_at', pi.refunded_at,
            'expired_at', pi.expired_at
          ) as response_snapshot,
          coalesce(nullif(pi.provider_payload_json->'ops_handling'->>'status', ''), 'unhandled') as ops_status,
          coalesce(pi.paid_at, pi.refunded_at, pi.expired_at, pi.created_at) as occurred_at,
          pi.created_at,
          pi.updated_at
        from payment_intent pi
        left join sys_user su on su.id = pi.user_id
        left join device d on d.imei = pi.imei
        left join lateral (
          select
            io.id::text as order_id,
            io.order_no,
            io.session_id::text as session_id,
            io.locked_amount,
            io.payment_status
          from irrigation_order io
          where io.id = pi.order_id
             or io.source_payment_intent_id = pi.id
          order by case when io.id = pi.order_id then 0 else 1 end, io.created_at desc
          limit 1
        ) pay_order on true
        left join lateral (
          select
            rs.id::text as session_id,
            rs.session_ref
          from runtime_session rs
          where rs.id::text = coalesce(pi.session_id::text, pay_order.session_id)
          limit 1
        ) pay_session on true
        where coalesce(pi.checkout_snapshot_json->>'created_from', '') = 'farmer_scan'
      ),
      enriched_rows as (
        select
          flow_rows.*,
          greatest(
            0,
            floor(extract(epoch from (now() - coalesce(flow_rows.occurred_at, flow_rows.created_at))) / 60)
          )::int as age_minutes,
          case
            when flow_rows.ops_status in ('resolved', 'ignored') then 'none'
            when flow_rows.result_bucket = 'failed'
              and extract(epoch from (now() - coalesce(flow_rows.occurred_at, flow_rows.created_at))) / 60 >= 120 then 'critical'
            when flow_rows.result_bucket = 'failed'
              and extract(epoch from (now() - coalesce(flow_rows.occurred_at, flow_rows.created_at))) / 60 >= 30 then 'warning'
            when flow_rows.result_bucket = 'pending'
              and extract(epoch from (now() - coalesce(flow_rows.occurred_at, flow_rows.created_at))) / 60 >= 30 then 'critical'
            when flow_rows.result_bucket = 'pending'
              and extract(epoch from (now() - coalesce(flow_rows.occurred_at, flow_rows.created_at))) / 60 >= 10 then 'warning'
            else 'none'
          end as sla_level
        from flow_rows
      )
    `;

    const listSql = `
      ${baseSql}
      select *
      from enriched_rows
      ${whereClause}
      order by
        case sla_level
          when 'critical' then 0
          when 'warning' then 1
          else 2
        end,
        case ops_status
          when 'unhandled' then 0
          when 'manual_review' then 1
          when 'resolved' then 2
          when 'ignored' then 3
          else 4
        end,
        created_at desc,
        id desc
      limit $${cursor++}
      offset $${cursor++}
    `;
    const countSql = `
      ${baseSql}
      select count(*)::int as total
      from enriched_rows
      ${whereClause}
    `;

    const listValues = [...values, pageSize, (page - 1) * pageSize];
    const [rowsResult, countResult] = await Promise.all([
      this.db.query(listSql, listValues),
      this.db.query<{ total: number }>(countSql, values)
    ]);

    return {
      items: rowsResult.rows.map((item) => this.mapPaymentFlowRow(item as PaymentFlowRow)),
      total: countResult.rows[0]?.total ?? 0,
      page,
      page_size: pageSize
    };
  }
}
