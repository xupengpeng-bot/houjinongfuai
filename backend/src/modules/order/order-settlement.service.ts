import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { DatabaseService } from '../../common/db/database.service';
import { FarmerFundService } from '../farmer-fund/farmer-fund.service';
import { deriveFormalOrderLifecycleStage } from './order-lifecycle';

type SessionOrderContext = {
  orderId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  pumpId: string | null;
  sessionRef: string | null;
  sessionStatus: string;
  startedAt: string | null;
  endedAt: string | null;
  orderStatus: string;
  settlementStatus: string;
  fundingMode: string | null;
  paymentMode: string | null;
  paymentStatus: string | null;
  prepaidAmount: number;
  lockedAmount: number;
  refundedAmount: number;
  sourcePaymentIntentId: string | null;
  pricingProgressAt: string | null;
  pricingSnapshot: Record<string, unknown>;
  pricingDetail: Record<string, unknown>;
  checkoutSnapshot: Record<string, unknown>;
  wellDeviceId: string | null;
  wellImei: string | null;
  pumpDeviceId: string | null;
  pumpImei: string | null;
  pumpRatedPowerKw: number | null;
  valveDeviceId: string | null;
  valveImei: string | null;
};

type MetricReading = {
  value: number | null;
  collectedAt: string | null;
  source: 'shadow' | 'channel' | 'none';
};

type PumpElectricalSnapshot = {
  currentA: number | null;
  voltageV: number | null;
  powerKw: number | null;
  collectedAt: string | null;
  source: 'shadow' | 'channel' | 'none';
  ratedPowerKw: number | null;
  concurrentSessionCount: number;
};

type PumpHealthSnapshot = {
  status: 'unknown' | 'healthy' | 'warning' | 'critical';
  scope: 'pump_dedicated' | 'pump_shared';
  dataQuality: 'none' | 'partial' | 'full';
  reasons: string[];
  notes: string[];
  currentA: number | null;
  voltageV: number | null;
  powerKw: number | null;
  ratedPowerKw: number | null;
  loadRate: number | null;
  concurrentSessionCount: number;
  collectedAt: string | null;
};

type PumpHealthPolicy = {
  nominalVoltageV: number | null;
  minVoltageV: number | null;
  maxVoltageV: number | null;
  warningLoadRate: number | null;
  criticalLoadRate: number | null;
  noLoadLoadRate: number | null;
  noLoadPowerKw: number | null;
  noLoadMinCurrentA: number | null;
  maxCurrentA: number | null;
};

type RuntimeMetricSnapshot = {
  runtimeSec: number;
  waterTotalM3: number | null;
  energyKwh: number | null;
  pumpElectrical: PumpElectricalSnapshot;
  pumpHealth: PumpHealthSnapshot;
};

@Injectable()
export class OrderSettlementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly farmerFundService: FarmerFundService
  ) {}

  private asObject(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private asNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private asInteger(value: unknown) {
    const parsed = this.asNumber(value);
    return parsed === null ? null : Math.trunc(parsed);
  }

  private roundMoney(value: number) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private roundMetric(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  private normalizeBillingMode(value: unknown) {
    const normalized = this.asString(value).toLowerCase();
    if (normalized === 'time' || normalized === 'duration') return 'time';
    if (normalized === 'water' || normalized === 'volume') return 'water';
    if (normalized === 'energy' || normalized === 'electric') return 'electric';
    if (normalized === 'water_energy' || normalized === 'water_electric') return 'water_electric';
    if (normalized === 'flat') return 'flat';
    if (normalized === 'free') return 'free';
    return 'time';
  }

  private getPauseSummary(pricingDetail: Record<string, unknown>) {
    return this.asObject(pricingDetail.pause_summary);
  }

  private getPauseCurrentSegment(pauseSummary: Record<string, unknown>) {
    return this.asObject(pauseSummary.current_segment);
  }

  private computeClockDurationSeconds(
    context: Pick<SessionOrderContext, 'startedAt' | 'endedAt' | 'pricingDetail'>,
    effectiveAt?: string | null
  ) {
    if (!context.startedAt) {
      return 0;
    }

    const endAt = effectiveAt ? new Date(effectiveAt) : context.endedAt ? new Date(context.endedAt) : new Date();
    const startedAt = new Date(context.startedAt);
    const rawDurationSec = Math.max(0, Math.floor((endAt.getTime() - startedAt.getTime()) / 1000));

    const pauseSummary = this.getPauseSummary(context.pricingDetail);
    const currentSegment = this.getPauseCurrentSegment(pauseSummary);
    const totalPausedSec = Math.max(0, this.asInteger(pauseSummary.total_paused_duration_sec) ?? 0);
    const openPauseAt =
      this.asString(currentSegment.pause_confirmed_at) ||
      this.asString(currentSegment.pause_requested_at) ||
      null;
    const resumeConfirmedAt = this.asString(currentSegment.resume_confirmed_at) || null;
    const openPauseSec =
      openPauseAt && !resumeConfirmedAt
        ? Math.max(0, Math.floor((endAt.getTime() - new Date(openPauseAt).getTime()) / 1000))
        : 0;

    return Math.max(0, rawDurationSec - totalPausedSec - openPauseSec);
  }

  private calculateTimeUnits(durationSec: number, unitType: unknown, pricingRules: Record<string, unknown>) {
    const explicitUnit = this.asString(pricingRules.time_unit ?? pricingRules.timeUnit);
    const normalizedUnit = explicitUnit || this.asString(unitType).toLowerCase();
    if (normalizedUnit === 'hour' || normalizedUnit === 'hours') {
      return durationSec / 3600;
    }
    if (normalizedUnit === 'second' || normalizedUnit === 'seconds' || normalizedUnit === 'sec') {
      return durationSec;
    }
    return durationSec / 60;
  }

  private pickMetricReading(
    preferredIds: Array<string | null>,
    shadows: Map<string, { commonStatus: Record<string, unknown>; collectedAt: string | null }>,
    channels: Map<string, Map<string, { valueNum: number | null; collectedAt: string | null }>>,
    shadowKeys: string[],
    channelKeys: string[],
    converter?: (value: number) => number
  ): MetricReading {
    for (const deviceId of preferredIds) {
      if (!deviceId) continue;
      const shadow = shadows.get(deviceId);
      for (const key of shadowKeys) {
        const value = this.asNumber(shadow?.commonStatus?.[key]);
        if (value !== null) {
          return {
            value: converter ? converter(value) : value,
            collectedAt: shadow?.collectedAt ?? null,
            source: 'shadow'
          };
        }
      }

      const channelMap = channels.get(deviceId);
      if (!channelMap) continue;
      for (const key of channelKeys) {
        const metric = channelMap.get(key);
        const value = metric?.valueNum ?? null;
        if (value !== null) {
          return {
            value: converter ? converter(value) : value,
            collectedAt: metric?.collectedAt ?? null,
            source: 'channel'
          };
        }
      }
    }
    return {
      value: null,
      collectedAt: null,
      source: 'none'
    };
  }

  private getSeverityRank(status: unknown) {
    const normalized = this.asString(status).toLowerCase();
    if (normalized === 'critical') return 3;
    if (normalized === 'warning') return 2;
    if (normalized === 'healthy') return 1;
    return 0;
  }

  private inferVoltageBand(voltageV: number | null) {
    if (voltageV === null) return null;
    if (voltageV >= 300) {
      return { nominal: 380, low: 320, high: 430 };
    }
    return { nominal: 220, low: 190, high: 250 };
  }

  private evaluatePumpHealth(input: PumpElectricalSnapshot): PumpHealthSnapshot {
    const availableMetricCount = [input.currentA, input.voltageV, input.powerKw].filter(
      (value) => value !== null
    ).length;
    const dataQuality: PumpHealthSnapshot['dataQuality'] =
      availableMetricCount === 0 ? 'none' : availableMetricCount === 3 ? 'full' : 'partial';
    const scope: PumpHealthSnapshot['scope'] = input.concurrentSessionCount > 1 ? 'pump_shared' : 'pump_dedicated';
    const reasons: string[] = [];
    const notes: string[] = [];
    let severity = 0;

    const loadRate =
      input.ratedPowerKw !== null && input.ratedPowerKw > 0 && input.powerKw !== null
        ? this.roundMetric(input.powerKw / input.ratedPowerKw, 4)
        : null;

    if (scope === 'pump_shared') {
      notes.push(`当前水泵同时服务 ${input.concurrentSessionCount} 个订单，电参按整泵口径统计。`);
      notes.push('共享水泵场景下订单只按时长计费，不做电量或功率分摊。');
    }

    if (dataQuality === 'none') {
      reasons.push('暂无电流、电压、功率上报，暂时无法判断健康度。');
      return {
        status: 'unknown',
        scope,
        dataQuality,
        reasons,
        notes,
        currentA: input.currentA,
        voltageV: input.voltageV,
        powerKw: input.powerKw,
        ratedPowerKw: input.ratedPowerKw,
        loadRate,
        concurrentSessionCount: input.concurrentSessionCount,
        collectedAt: input.collectedAt
      };
    }

    if (dataQuality !== 'full') {
      notes.push('当前只收到部分电参，健康判断为基础判断。');
    }

    const voltageBand = this.inferVoltageBand(input.voltageV);
    if (voltageBand && input.voltageV !== null) {
      if (input.voltageV < voltageBand.low) {
        severity = Math.max(severity, 3);
        reasons.push(`电压偏低（${this.roundMetric(input.voltageV)}V）。`);
      } else if (input.voltageV > voltageBand.high) {
        severity = Math.max(severity, 3);
        reasons.push(`电压偏高（${this.roundMetric(input.voltageV)}V）。`);
      }
    }

    if (loadRate !== null) {
      if (loadRate >= 1.15) {
        severity = Math.max(severity, 3);
        reasons.push(`功率超过额定功率的 ${(loadRate * 100).toFixed(0)}%。`);
      } else if (loadRate >= 1.0) {
        severity = Math.max(severity, 2);
        reasons.push(`功率已接近额定功率上限（负载率 ${(loadRate * 100).toFixed(0)}%）。`);
      } else if (loadRate <= 0.08 && (input.currentA ?? 0) >= 1) {
        severity = Math.max(severity, 2);
        reasons.push('有电流但功率明显偏低，疑似空转或轻载异常。');
      }
    } else if (input.powerKw !== null && input.powerKw <= 0.05 && (input.currentA ?? 0) >= 1) {
      severity = Math.max(severity, 2);
      reasons.push('有电流但功率接近 0，疑似采集异常或空转。');
    }

    if (reasons.length === 0) {
      notes.push('当前泵电参处于可接受范围。');
    }

    return {
      status: severity >= 3 ? 'critical' : severity >= 2 ? 'warning' : 'healthy',
      scope,
      dataQuality,
      reasons,
      notes,
      currentA: input.currentA,
      voltageV: input.voltageV,
      powerKw: input.powerKw,
      ratedPowerKw: input.ratedPowerKw,
      loadRate,
      concurrentSessionCount: input.concurrentSessionCount,
      collectedAt: input.collectedAt
    };
  }

  private normalizePumpHealthPolicy(value: unknown): PumpHealthPolicy {
    const source = this.asObject(value);
    return {
      nominalVoltageV:
        this.asNumber(source.nominal_voltage_v ?? source.nominalVoltageV ?? source.nominal_voltage ?? source.nominalVoltage),
      minVoltageV: this.asNumber(source.min_voltage_v ?? source.minVoltageV ?? source.min_voltage ?? source.minVoltage),
      maxVoltageV: this.asNumber(source.max_voltage_v ?? source.maxVoltageV ?? source.max_voltage ?? source.maxVoltage),
      warningLoadRate:
        this.asNumber(source.warning_load_rate ?? source.warningLoadRate ?? source.overload_warning_rate ?? source.overloadWarningRate),
      criticalLoadRate:
        this.asNumber(source.critical_load_rate ?? source.criticalLoadRate ?? source.overload_load_rate ?? source.overloadLoadRate),
      noLoadLoadRate:
        this.asNumber(source.no_load_load_rate ?? source.noLoadLoadRate ?? source.no_load_rate ?? source.noLoadRate),
      noLoadPowerKw: this.asNumber(source.no_load_power_kw ?? source.noLoadPowerKw ?? source.no_load_power ?? source.noLoadPower),
      noLoadMinCurrentA:
        this.asNumber(source.no_load_min_current_a ?? source.noLoadMinCurrentA ?? source.no_load_min_current ?? source.noLoadMinCurrent),
      maxCurrentA: this.asNumber(source.max_current_a ?? source.maxCurrentA ?? source.max_current ?? source.maxCurrent)
    };
  }

  private mergePumpHealthPolicy(...sources: unknown[]): PumpHealthPolicy {
    const merged: PumpHealthPolicy = {
      nominalVoltageV: null,
      minVoltageV: null,
      maxVoltageV: null,
      warningLoadRate: null,
      criticalLoadRate: null,
      noLoadLoadRate: null,
      noLoadPowerKw: null,
      noLoadMinCurrentA: null,
      maxCurrentA: null
    };

    for (const source of sources) {
      const normalized = this.normalizePumpHealthPolicy(source);
      for (const [key, value] of Object.entries(normalized) as Array<[keyof PumpHealthPolicy, number | null]>) {
        if (value !== null) {
          merged[key] = value;
        }
      }
    }

    return merged;
  }

  private extractPumpHealthPolicy(raw: unknown): PumpHealthPolicy {
    const source = this.asObject(raw);
    const runtimeDefaults = this.asObject(source.runtimeDefaults);
    const promptJson = this.asObject(source.promptJson);
    const defaultConfigJson = this.asObject(source.defaultConfigJson);
    const templateConfigJson = this.asObject(source.templateConfigJson);

    return this.mergePumpHealthPolicy(
      source.pump_health_policy,
      source.pumpHealthPolicy,
      runtimeDefaults.pump_health_policy,
      runtimeDefaults.pumpHealthPolicy,
      promptJson.pump_health_policy,
      promptJson.pumpHealthPolicy,
      defaultConfigJson.pump_health_policy,
      defaultConfigJson.pumpHealthPolicy,
      templateConfigJson.pump_health_policy,
      templateConfigJson.pumpHealthPolicy
    );
  }

  private resolvePumpHealthPolicy(pricingSnapshot: Record<string, unknown>) {
    const pricingRules = this.asObject(pricingSnapshot.pricingRules);
    const effectiveRuleSnapshot = this.asObject(pricingSnapshot.effectiveRuleSnapshot);
    const raw = this.asObject(effectiveRuleSnapshot.raw);

    return this.mergePumpHealthPolicy(
      {
        warningLoadRate: 1.0,
        criticalLoadRate: 1.15,
        noLoadLoadRate: 0.08,
        noLoadPowerKw: 0.05,
        noLoadMinCurrentA: 1
      },
      this.extractPumpHealthPolicy(raw.deviceTypeDefault),
      this.extractPumpHealthPolicy(raw.scenarioTemplate),
      this.extractPumpHealthPolicy(raw.interactionPolicy),
      this.extractPumpHealthPolicy(raw.relationConfig),
      this.extractPumpHealthPolicy(raw.wellRuntimePolicy),
      this.extractPumpHealthPolicy(pricingRules)
    );
  }

  private hasPumpHealthPolicy(policy: PumpHealthPolicy) {
    return Object.values(policy).some((value) => value !== null);
  }

  private mergeUniqueText(items: string[], extra: string) {
    if (!extra || items.includes(extra)) return items;
    return [...items, extra];
  }

  private applyPumpHealthPolicy(
    base: PumpHealthSnapshot,
    input: PumpElectricalSnapshot,
    pricingSnapshot: Record<string, unknown>
  ): PumpHealthSnapshot {
    const policy = this.resolvePumpHealthPolicy(pricingSnapshot);
    if (!this.hasPumpHealthPolicy(policy)) {
      return base;
    }

    let severity = this.getSeverityRank(base.status);
    let reasons = [...base.reasons];
    let notes = [...base.notes];
    const loadRate =
      input.ratedPowerKw !== null && input.ratedPowerKw > 0 && input.powerKw !== null
        ? this.roundMetric(input.powerKw / input.ratedPowerKw, 4)
        : base.loadRate ?? null;

    const inferredBand = this.inferVoltageBand(input.voltageV);
    const lowVoltage = policy.minVoltageV ?? inferredBand?.low ?? null;
    const highVoltage = policy.maxVoltageV ?? inferredBand?.high ?? null;

    if (input.voltageV !== null && lowVoltage !== null && input.voltageV < lowVoltage) {
      severity = Math.max(severity, 3);
      reasons = this.mergeUniqueText(reasons, `voltage below policy threshold: ${this.roundMetric(input.voltageV)}V`);
    }
    if (input.voltageV !== null && highVoltage !== null && input.voltageV > highVoltage) {
      severity = Math.max(severity, 3);
      reasons = this.mergeUniqueText(reasons, `voltage above policy threshold: ${this.roundMetric(input.voltageV)}V`);
    }
    if (input.currentA !== null && policy.maxCurrentA !== null && input.currentA > policy.maxCurrentA) {
      severity = Math.max(severity, 3);
      reasons = this.mergeUniqueText(reasons, `current above policy threshold: ${this.roundMetric(input.currentA)}A`);
    }
    if (loadRate !== null && policy.criticalLoadRate !== null && loadRate >= policy.criticalLoadRate) {
      severity = Math.max(severity, 3);
      reasons = this.mergeUniqueText(reasons, `load above policy threshold: ${(loadRate * 100).toFixed(0)}%`);
    } else if (loadRate !== null && policy.warningLoadRate !== null && loadRate >= policy.warningLoadRate) {
      severity = Math.max(severity, 2);
      reasons = this.mergeUniqueText(reasons, `load near policy threshold: ${(loadRate * 100).toFixed(0)}%`);
    }
    if (
      loadRate !== null &&
      policy.noLoadLoadRate !== null &&
      loadRate <= policy.noLoadLoadRate &&
      (input.currentA ?? 0) >= (policy.noLoadMinCurrentA ?? 1)
    ) {
      severity = Math.max(severity, 2);
      reasons = this.mergeUniqueText(reasons, 'power appears too low for the current draw');
    } else if (
      input.powerKw !== null &&
      policy.noLoadPowerKw !== null &&
      input.powerKw <= policy.noLoadPowerKw &&
      (input.currentA ?? 0) >= (policy.noLoadMinCurrentA ?? 1)
    ) {
      severity = Math.max(severity, 2);
      reasons = this.mergeUniqueText(reasons, 'power is near zero while current is present');
    }

    notes = this.mergeUniqueText(notes, 'pump health policy overrides applied');

    return {
      ...base,
      status: severity >= 3 ? 'critical' : severity >= 2 ? 'warning' : severity >= 1 ? 'healthy' : base.status,
      reasons,
      notes,
      loadRate
    };
  }

  private shouldAppendPumpSample(previousTs: unknown, nextTs: unknown) {
    const previous = this.asString(previousTs);
    const next = this.asString(nextTs);
    if (!next) return false;
    if (!previous) return true;
    const previousTime = new Date(previous).getTime();
    const nextTime = new Date(next).getTime();
    if (Number.isNaN(previousTime) || Number.isNaN(nextTime)) return true;
    return Math.abs(nextTime - previousTime) >= 30_000;
  }

  private buildMetricSeries(previousValue: unknown, nextValue: number | null, append: boolean) {
    const previous = this.asObject(previousValue);
    const previousCount = Math.max(0, this.asInteger(previous.count) ?? 0);
    const previousAvg = this.asNumber(previous.avg);
    const previousMin = this.asNumber(previous.min);
    const previousMax = this.asNumber(previous.max);
    const previousLast = this.asNumber(previous.last);

    if (nextValue === null) {
      return {
        count: previousCount,
        min: previousMin,
        max: previousMax,
        avg: previousAvg,
        last: previousLast
      };
    }

    if (!append) {
      return {
        count: previousCount,
        min: previousMin,
        max: previousMax,
        avg: previousAvg,
        last: this.roundMetric(nextValue)
      };
    }

    const count = previousCount + 1;
    const avg = previousAvg === null || previousCount === 0 ? nextValue : (previousAvg * previousCount + nextValue) / count;
    return {
      count,
      min: this.roundMetric(previousMin === null ? nextValue : Math.min(previousMin, nextValue)),
      max: this.roundMetric(previousMax === null ? nextValue : Math.max(previousMax, nextValue)),
      avg: this.roundMetric(avg),
      last: this.roundMetric(nextValue)
    };
  }

  private buildPumpHealthState(previousValue: unknown, health: PumpHealthSnapshot, electrical: PumpElectricalSnapshot) {
    const previous = this.asObject(previousValue);
    const previousSamples = this.asObject(previous.samples);
    const previousSampleCount = Math.max(0, this.asInteger(previousSamples.count) ?? 0);
    const sampleAt = this.asString(health.collectedAt) || new Date().toISOString();
    const hasElectricalMetrics = [electrical.currentA, electrical.voltageV, electrical.powerKw].some(
      (value) => value !== null
    );
    const append = hasElectricalMetrics && this.shouldAppendPumpSample(previousSamples.last_sample_at, sampleAt);
    const previousWorstStatus = this.asString(previousSamples.worst_status) || 'unknown';
    const worstStatus =
      this.getSeverityRank(health.status) >= this.getSeverityRank(previousWorstStatus) ? health.status : previousWorstStatus;

    return {
      summary: health,
      samples: {
        count: append ? previousSampleCount + 1 : previousSampleCount,
        first_sample_at:
          append && previousSampleCount === 0
            ? sampleAt
            : this.asString(previousSamples.first_sample_at) || (append ? sampleAt : null),
        last_sample_at: hasElectricalMetrics ? sampleAt : this.asString(previousSamples.last_sample_at) || null,
        worst_status: worstStatus,
        warning_count:
          Math.max(0, this.asInteger(previousSamples.warning_count) ?? 0) + (append && health.status === 'warning' ? 1 : 0),
        critical_count:
          Math.max(0, this.asInteger(previousSamples.critical_count) ?? 0) + (append && health.status === 'critical' ? 1 : 0),
        current_a: this.buildMetricSeries(previousSamples.current_a, electrical.currentA, append),
        voltage_v: this.buildMetricSeries(previousSamples.voltage_v, electrical.voltageV, append),
        power_kw: this.buildMetricSeries(previousSamples.power_kw, electrical.powerKw, append)
      }
    };
  }

  private async loadSessionOrderContext(sessionId: string, client: PoolClient): Promise<SessionOrderContext | null> {
    const result = await this.db.query<SessionOrderContext>(
      `
      select
        io.id as "orderId",
        io.tenant_id as "tenantId",
        io.user_id as "userId",
        io.session_id as "sessionId",
        rs.pump_id::text as "pumpId",
        rs.session_ref as "sessionRef",
        rs.status as "sessionStatus",
        rs.started_at as "startedAt",
        rs.ended_at as "endedAt",
        io.status as "orderStatus",
        io.settlement_status as "settlementStatus",
        io.funding_mode as "fundingMode",
        io.payment_mode as "paymentMode",
        io.payment_status as "paymentStatus",
        io.prepaid_amount as "prepaidAmount",
        io.locked_amount as "lockedAmount",
        io.refunded_amount as "refundedAmount",
        io.source_payment_intent_id as "sourcePaymentIntentId",
        io.pricing_progress_at as "pricingProgressAt",
        io.pricing_snapshot_json as "pricingSnapshot",
        io.pricing_detail_json as "pricingDetail",
        io.checkout_snapshot_json as "checkoutSnapshot",
        wd.id::text as "wellDeviceId",
        wd.imei as "wellImei",
        pd.id::text as "pumpDeviceId",
        pd.imei as "pumpImei",
        p.rated_power_kw as "pumpRatedPowerKw",
        vd.id::text as "valveDeviceId",
        vd.imei as "valveImei"
      from irrigation_order io
      join runtime_session rs on rs.id = io.session_id
      join well w on w.id = rs.well_id
      join pump p on p.id = rs.pump_id
      join valve v on v.id = rs.valve_id
      join device wd on wd.id = w.device_id
      join device pd on pd.id = p.device_id
      join device vd on vd.id = v.device_id
      where io.session_id = $1::uuid
      limit 1
      `,
      [sessionId],
      client
    );
    return result.rows[0] ?? null;
  }

  private async loadMetricSnapshot(context: SessionOrderContext, client: PoolClient): Promise<RuntimeMetricSnapshot> {
    const preferredIds = [context.wellDeviceId, context.pumpDeviceId, context.valveDeviceId].filter(
      (value): value is string => Boolean(value)
    );
    const shadowsResult = await this.db.query<{
      deviceId: string;
      commonStatus: Record<string, unknown>;
      collectedAt: string | null;
    }>(
      `
      select
        device_id::text as "deviceId",
        common_status_json as "commonStatus",
        last_server_rx_ts as "collectedAt"
      from device_runtime_shadow
      where tenant_id = $1 and device_id = any($2::uuid[])
      `,
      [context.tenantId, preferredIds],
      client
    );

    const channelsResult = await this.db.query<{
      deviceId: string;
      metricCode: string;
      valueNum: number | null;
      collectedAt: string | null;
    }>(
      `
      select
        device_id::text as "deviceId",
        metric_code as "metricCode",
        value_num as "valueNum",
        coalesce(collected_at, server_rx_ts, updated_at) as "collectedAt"
      from device_channel_latest
      where tenant_id = $1
        and device_id = any($2::uuid[])
        and metric_code = any($3::text[])
      `,
      [
        context.tenantId,
        preferredIds,
        [
          'total_m3',
          'cumulative_flow',
          'water_total_m3',
          'energy_kwh',
          'energy_wh',
          'runtime_sec',
          'cumulative_runtime_sec',
          'power_kw',
          'current_a',
          'voltage_v'
        ]
      ],
      client
    );

    const activePumpSessionsResult =
      context.pumpId === null
        ? { rows: [{ count: 1 }] }
        : await this.db.query<{ count: number }>(
            `
            select count(*)::int as count
            from runtime_session
            where tenant_id = $1
              and pump_id = $2::uuid
              and status in ('pending_start', 'running', 'billing', 'pausing', 'paused', 'resuming', 'stopping')
            `,
            [context.tenantId, context.pumpId],
            client
          );

    const shadowMap = new Map<string, { commonStatus: Record<string, unknown>; collectedAt: string | null }>();
    for (const row of shadowsResult.rows) {
      shadowMap.set(row.deviceId, {
        commonStatus: this.asObject(row.commonStatus),
        collectedAt: row.collectedAt ?? null
      });
    }

    const channelMap = new Map<string, Map<string, { valueNum: number | null; collectedAt: string | null }>>();
    for (const row of channelsResult.rows) {
      if (!channelMap.has(row.deviceId)) {
        channelMap.set(row.deviceId, new Map<string, { valueNum: number | null; collectedAt: string | null }>());
      }
      channelMap.get(row.deviceId)!.set(row.metricCode, {
        valueNum: row.valueNum ?? null,
        collectedAt: row.collectedAt ?? null
      });
    }

    const runtimeReading =
      this.pickMetricReading(
        [context.wellDeviceId, context.pumpDeviceId, context.valveDeviceId],
        shadowMap,
        channelMap,
        ['cumulative_runtime_sec'],
        ['cumulative_runtime_sec', 'runtime_sec']
      );

    const durationFromClock = this.computeClockDurationSeconds(context);

    const waterReading = this.pickMetricReading(
      [context.wellDeviceId, context.pumpDeviceId, context.valveDeviceId],
      shadowMap,
      channelMap,
      ['cumulative_flow'],
      ['total_m3', 'cumulative_flow', 'water_total_m3']
    );

    const energyReading = this.pickMetricReading(
      [context.pumpDeviceId, context.wellDeviceId, context.valveDeviceId],
      shadowMap,
      channelMap,
      ['cumulative_energy_wh'],
      ['energy_kwh', 'energy_wh'],
      (value) => (value > 1000 ? value / 1000 : value)
    );

    const powerReading = this.pickMetricReading(
      [context.pumpDeviceId, context.wellDeviceId],
      shadowMap,
      channelMap,
      ['power_kw', 'pump_power_kw'],
      ['power_kw']
    );

    const currentReading = this.pickMetricReading(
      [context.pumpDeviceId, context.wellDeviceId],
      shadowMap,
      channelMap,
      ['current_a', 'pump_current_a'],
      ['current_a']
    );

    const voltageReading = this.pickMetricReading(
      [context.pumpDeviceId, context.wellDeviceId],
      shadowMap,
      channelMap,
      ['voltage_v', 'pump_voltage_v'],
      ['voltage_v']
    );

    const concurrentSessionCount = Math.max(1, activePumpSessionsResult.rows[0]?.count ?? 1);
    const powerSource =
      powerReading.source !== 'none'
        ? powerReading.source
        : currentReading.source !== 'none'
          ? currentReading.source
          : voltageReading.source;
    const pumpCollectedAt =
      powerReading.collectedAt ?? currentReading.collectedAt ?? voltageReading.collectedAt ?? runtimeReading.collectedAt ?? null;
    const pumpElectrical: PumpElectricalSnapshot = {
      currentA: currentReading.value,
      voltageV: voltageReading.value,
      powerKw: powerReading.value,
      collectedAt: pumpCollectedAt,
      source: powerSource,
      ratedPowerKw: context.pumpRatedPowerKw,
      concurrentSessionCount
    };
    const basePumpHealth = this.evaluatePumpHealth(pumpElectrical);

    return {
      runtimeSec: Math.max(durationFromClock, Math.floor(runtimeReading.value ?? 0)),
      waterTotalM3: waterReading.value,
      energyKwh: energyReading.value,
      pumpElectrical,
      pumpHealth: this.applyPumpHealthPolicy(basePumpHealth, pumpElectrical, context.pricingSnapshot)
    };
  }

  private calculateAmount(
    pricingSnapshot: Record<string, unknown>,
    usage: { durationSec: number; waterVolumeM3: number; energyKwh: number }
  ) {
    const pricingRules = this.asObject(pricingSnapshot.pricingRules);
    const mode = this.normalizeBillingMode(pricingSnapshot.mode);
    const unitPrice = Number(this.asNumber(pricingSnapshot.unitPrice) ?? 0);
    const minChargeAmount = Number(this.asNumber(pricingSnapshot.minChargeAmount) ?? 0);
    let rawAmount = 0;

    if (mode === 'flat') {
      rawAmount = unitPrice;
    } else if (mode === 'free') {
      rawAmount = 0;
    } else if (mode === 'water') {
      rawAmount = usage.waterVolumeM3 * unitPrice;
    } else if (mode === 'electric') {
      rawAmount = usage.energyKwh * unitPrice;
    } else if (mode === 'water_electric') {
      const waterUnitPrice = Number(this.asNumber(pricingRules.water_unit_price ?? pricingRules.waterUnitPrice) ?? unitPrice);
      const energyUnitPrice = Number(this.asNumber(pricingRules.energy_unit_price ?? pricingRules.energyUnitPrice) ?? 0);
      rawAmount = usage.waterVolumeM3 * waterUnitPrice + usage.energyKwh * energyUnitPrice;
    } else {
      rawAmount = this.calculateTimeUnits(usage.durationSec, pricingSnapshot.unitType, pricingRules) * unitPrice;
    }

    if (mode === 'free') {
      return { amount: 0, rawAmount: 0 };
    }

    const normalizedRaw = this.roundMoney(rawAmount);
    if (normalizedRaw <= 0) {
      return { amount: 0, rawAmount: normalizedRaw };
    }

    return {
      amount: this.roundMoney(Math.max(minChargeAmount, normalizedRaw)),
      rawAmount: normalizedRaw
    };
  }

  async createPaymentIntent(input: {
    tenantId: string;
    userId: string;
    targetDeviceId: string | null;
    imei: string;
    paymentAccountId?: string | null;
    paymentAccountSnapshot?: Record<string, unknown>;
    paymentChannel: string;
    paymentMode: string;
    amount: number;
    payLink: string | null;
    checkoutSnapshot?: Record<string, unknown>;
    providerPayload?: Record<string, unknown>;
    expiresAt?: string | null;
  }) {
    const id = randomUUID();
    const callbackToken = randomUUID().replace(/-/g, '');
    const outTradeNo = `WX${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await this.db.query(
      `
      insert into payment_intent (
        id, tenant_id, user_id, target_device_id, imei, payment_channel, payment_mode, status,
        payment_account_id, out_trade_no, callback_token, amount, pay_link,
        checkout_snapshot_json, payment_account_snapshot_json, provider_payload_json, expired_at
      )
      values (
        $1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, 'created',
        $8::uuid, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::timestamptz
      )
      `,
      [
        id,
        input.tenantId,
        input.userId,
        input.targetDeviceId,
        input.imei,
        input.paymentChannel,
        input.paymentMode,
        input.paymentAccountId ?? null,
        outTradeNo,
        callbackToken,
        this.roundMoney(input.amount),
        input.payLink,
        JSON.stringify(input.checkoutSnapshot ?? {}),
        JSON.stringify(input.paymentAccountSnapshot ?? {}),
        JSON.stringify(input.providerPayload ?? {}),
        input.expiresAt ?? null
      ]
    );
    return {
      id,
      outTradeNo,
      callbackToken,
      amount: this.roundMoney(input.amount),
      payLink: input.payLink,
      expiresAt: input.expiresAt ?? null,
    };
  }

  async getPaymentIntentById(id: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      userId: string;
      targetDeviceId: string | null;
      sessionId: string | null;
      orderId: string | null;
      imei: string;
      paymentAccountId: string | null;
      paymentChannel: string;
      paymentMode: string;
      status: string;
      outTradeNo: string;
      callbackToken: string;
      amount: number;
      refundedAmount: number;
      payLink: string | null;
      checkoutSnapshot: Record<string, unknown>;
      paymentAccountSnapshot: Record<string, unknown>;
      providerPayload: Record<string, unknown>;
      createdAt: string;
      paidAt: string | null;
      refundedAt: string | null;
      expiredAt: string | null;
    }>(
      `
      select
        id,
        tenant_id as "tenantId",
        user_id as "userId",
        target_device_id::text as "targetDeviceId",
        session_id::text as "sessionId",
        order_id::text as "orderId",
        imei,
        payment_account_id::text as "paymentAccountId",
        payment_channel as "paymentChannel",
        payment_mode as "paymentMode",
        status,
        out_trade_no as "outTradeNo",
        callback_token as "callbackToken",
        amount,
        refunded_amount as "refundedAmount",
        pay_link as "payLink",
        checkout_snapshot_json as "checkoutSnapshot",
        payment_account_snapshot_json as "paymentAccountSnapshot",
        provider_payload_json as "providerPayload",
        created_at as "createdAt",
        paid_at as "paidAt",
        refunded_at as "refundedAt",
        expired_at as "expiredAt"
      from payment_intent
      where id = $1::uuid
      limit 1
      `,
      [id],
      client
    );
    return result.rows[0] ?? null;
  }

  async getPaymentIntentByOutTradeNo(outTradeNo: string, client?: PoolClient) {
    const result = await this.db.query<{
      id: string;
      tenantId: string;
      userId: string;
      targetDeviceId: string | null;
      sessionId: string | null;
      orderId: string | null;
      imei: string;
      paymentAccountId: string | null;
      paymentChannel: string;
      paymentMode: string;
      status: string;
      outTradeNo: string;
      callbackToken: string;
      amount: number;
      refundedAmount: number;
      payLink: string | null;
      checkoutSnapshot: Record<string, unknown>;
      paymentAccountSnapshot: Record<string, unknown>;
      providerPayload: Record<string, unknown>;
      createdAt: string;
      paidAt: string | null;
      refundedAt: string | null;
      expiredAt: string | null;
    }>(
      `
      select
        id,
        tenant_id as "tenantId",
        user_id as "userId",
        target_device_id::text as "targetDeviceId",
        session_id::text as "sessionId",
        order_id::text as "orderId",
        imei,
        payment_account_id::text as "paymentAccountId",
        payment_channel as "paymentChannel",
        payment_mode as "paymentMode",
        status,
        out_trade_no as "outTradeNo",
        callback_token as "callbackToken",
        amount,
        refunded_amount as "refundedAmount",
        pay_link as "payLink",
        checkout_snapshot_json as "checkoutSnapshot",
        payment_account_snapshot_json as "paymentAccountSnapshot",
        provider_payload_json as "providerPayload",
        created_at as "createdAt",
        paid_at as "paidAt",
        refunded_at as "refundedAt",
        expired_at as "expiredAt"
      from payment_intent
      where out_trade_no = $1
      order by created_at desc
      limit 1
      `,
      [outTradeNo],
      client
    );
    return result.rows[0] ?? null;
  }

  async markPaymentIntentPaid(
    client: PoolClient,
    input: { id: string; sessionId?: string | null; orderId?: string | null; providerPayload?: Record<string, unknown> }
  ) {
    await this.db.query(
      `
      update payment_intent
      set status = 'paid',
          session_id = coalesce($2::uuid, session_id),
          order_id = coalesce($3::uuid, order_id),
          provider_payload_json = coalesce(provider_payload_json, '{}'::jsonb) || $4::jsonb,
          paid_at = coalesce(paid_at, now()),
          updated_at = now()
      where id = $1::uuid
      `,
      [input.id, input.sessionId ?? null, input.orderId ?? null, JSON.stringify(input.providerPayload ?? {})],
      client
    );
  }

  async markPaymentIntentRefunded(
    client: PoolClient,
    input: { id: string; refundedAmount: number; providerPayload?: Record<string, unknown> }
  ) {
    await this.db.query(
      `
      update payment_intent
      set status = case when $2::numeric > 0 then 'refunded' else status end,
          refunded_amount = $2,
          provider_payload_json = coalesce(provider_payload_json, '{}'::jsonb) || $3::jsonb,
          refunded_at = case when $2::numeric > 0 then coalesce(refunded_at, now()) else refunded_at end,
          updated_at = now()
      where id = $1::uuid
      `,
      [input.id, this.roundMoney(input.refundedAmount), JSON.stringify(input.providerPayload ?? {})],
      client
    );
  }

  async attachCheckoutContextToOrder(
    client: PoolClient,
    input: {
      orderId: string;
      targetDeviceId?: string | null;
      targetImei?: string | null;
      targetDeviceRole?: string | null;
      paymentMode?: string | null;
      paymentStatus?: string | null;
      prepaidAmount?: number | null;
      lockedAmount?: number | null;
      sourcePaymentIntentId?: string | null;
      checkoutSnapshot?: Record<string, unknown>;
    }
  ) {
    await this.db.query(
      `
      update irrigation_order
      set target_device_id = coalesce($2::uuid, target_device_id),
          target_imei = coalesce($3, target_imei),
          target_device_role = coalesce($4, target_device_role),
          payment_mode = coalesce($5, payment_mode),
          payment_status = coalesce($6, payment_status),
          prepaid_amount = coalesce($7, prepaid_amount),
          locked_amount = coalesce($8, locked_amount),
          source_payment_intent_id = coalesce($9::uuid, source_payment_intent_id),
          checkout_snapshot_json = coalesce(checkout_snapshot_json, '{}'::jsonb) || $10::jsonb,
          updated_at = now()
      where id = $1::uuid
      `,
      [
        input.orderId,
        input.targetDeviceId ?? null,
        input.targetImei ?? null,
        input.targetDeviceRole ?? null,
        input.paymentMode ?? null,
        input.paymentStatus ?? null,
        input.prepaidAmount ?? null,
        input.lockedAmount ?? null,
        input.sourcePaymentIntentId ?? null,
        JSON.stringify(input.checkoutSnapshot ?? {})
      ],
      client
    );
  }

  async captureStartSnapshot(sessionId: string, client: PoolClient) {
    const context = await this.loadSessionOrderContext(sessionId, client);
    if (!context) {
      return null;
    }

    const currentMetrics = await this.loadMetricSnapshot(context, client);
    const pricingDetail = {
      ...context.pricingDetail,
      metric_snapshot: {
        baseline: currentMetrics,
        current: currentMetrics
      },
      usage: {
        duration_seconds: 0,
        water_volume_m3: 0,
        energy_kwh: 0,
      },
      current_amount: 0,
      credit_limit_amount: this.roundMoney(Math.max(context.prepaidAmount, context.lockedAmount)),
      pump_health: this.buildPumpHealthState(context.pricingDetail.pump_health, currentMetrics.pumpHealth, currentMetrics.pumpElectrical),
      last_progress_at: new Date().toISOString()
    };

    await this.db.query(
      `
      update irrigation_order
      set pricing_detail_json = $2::jsonb,
          pricing_progress_at = now(),
          updated_at = now()
      where id = $1::uuid
      `,
      [context.orderId, JSON.stringify(pricingDetail)],
      client
    );

    return {
      orderId: context.orderId,
      metrics: currentMetrics
    };
  }

  async freezeProgressAtStopRequest(
    sessionId: string,
    client: PoolClient,
    options?: {
      frozenAt?: string | null;
      reasonCode?: string | null;
      reasonText?: string | null;
      source?: string | null;
    }
  ) {
    const context = await this.loadSessionOrderContext(sessionId, client);
    if (!context) {
      return null;
    }

    const existingStopRequest = this.asObject(context.pricingDetail.stop_request_snapshot);
    const existingRequestedAt = this.asString(context.pricingDetail.stop_requested_at ?? existingStopRequest.requested_at);
    if (existingRequestedAt) {
      return {
        orderId: context.orderId,
        sessionId: context.sessionId,
        amount: this.roundMoney(
          Number(this.asNumber(existingStopRequest.amount ?? context.pricingDetail.current_amount ?? 0) ?? 0)
        ),
        usage: {
          durationSec: Math.max(
            0,
            this.asInteger(existingStopRequest.usage_duration_sec ?? this.asObject(existingStopRequest.usage).durationSec) ??
              this.asInteger(this.asObject(existingStopRequest.usage).duration_seconds) ??
              this.asInteger(this.asObject(context.pricingDetail.usage).duration_seconds) ??
              0
          ),
          waterVolumeM3: this.roundMetric(
            Number(
              this.asNumber(existingStopRequest.usage_water_volume_m3 ?? this.asObject(existingStopRequest.usage).waterVolumeM3) ??
                this.asNumber(this.asObject(existingStopRequest.usage).water_volume_m3) ??
                this.asNumber(this.asObject(context.pricingDetail.usage).water_volume_m3) ??
                0
            ),
            3
          ),
          energyKwh: this.roundMetric(
            Number(
              this.asNumber(existingStopRequest.usage_energy_kwh ?? this.asObject(existingStopRequest.usage).energyKwh) ??
                this.asNumber(this.asObject(existingStopRequest.usage).energy_kwh) ??
                this.asNumber(this.asObject(context.pricingDetail.usage).energy_kwh) ??
                0
            ),
            3
          )
        },
        pricingDetail: context.pricingDetail,
        creditLimitAmount: this.roundMoney(
          Number(
            this.asNumber(existingStopRequest.credit_limit_amount ?? context.pricingDetail.credit_limit_amount) ??
              Math.max(context.prepaidAmount, context.lockedAmount)
          )
        ),
        creditLimitReached:
          Boolean(existingStopRequest.credit_limit_reached) || Boolean(context.pricingDetail.credit_limit_reached),
        context
      };
    }

    const frozenAt = this.asString(options?.frozenAt) || new Date().toISOString();
    const progress = await this.syncProgressBySessionId(sessionId, {
      force: true,
      client,
      settledAt: frozenAt
    });
    if (!progress || 'skipped' in progress) {
      return null;
    }

    const progressPricingDetail = this.asObject(progress.pricingDetail);
    const frozenPricingDetail = {
      ...progressPricingDetail,
      lifecycle_stage: 'stopping',
      stop_requested_at: frozenAt,
      stop_amount_frozen: true,
      stop_amount_frozen_reason: 'awaiting_device_stop_confirmation',
      stop_request_snapshot: {
        requested_at: frozenAt,
        source: options?.source ?? null,
        reason_code: options?.reasonCode ?? null,
        reason_text: options?.reasonText ?? null,
        amount: progress.amount,
        raw_amount: Number(this.asNumber(progressPricingDetail.subtotal) ?? progress.amount),
        credit_limit_amount: progress.creditLimitAmount,
        credit_limit_reached: progress.creditLimitReached,
        usage_duration_sec: progress.usage.durationSec,
        usage_water_volume_m3: progress.usage.waterVolumeM3,
        usage_energy_kwh: progress.usage.energyKwh,
        usage: {
          duration_seconds: progress.usage.durationSec,
          water_volume_m3: progress.usage.waterVolumeM3,
          energy_kwh: progress.usage.energyKwh
        },
        metric_snapshot: this.asObject(progressPricingDetail.metric_snapshot),
        pump_health: progressPricingDetail.pump_health ?? null
      },
      last_progress_at: frozenAt
    };

    await this.db.query(
      `
      update irrigation_order
      set pricing_detail_json = $2::jsonb,
          pricing_progress_at = now(),
          updated_at = now()
      where id = $1::uuid
      `,
      [context.orderId, JSON.stringify(frozenPricingDetail)],
      client
    );

    return {
      ...progress,
      pricingDetail: frozenPricingDetail
    };
  }

  async markStopPendingReview(
    sessionId: string,
    client: PoolClient,
    options?: {
      reviewAt?: string | null;
      reasonCode?: string | null;
      reasonText?: string | null;
      source?: string | null;
      commandId?: string | null;
      commandToken?: string | null;
      commandCode?: string | null;
    }
  ) {
    const frozen = await this.freezeProgressAtStopRequest(sessionId, client, {
      frozenAt: options?.reviewAt ?? null,
      reasonCode: options?.reasonCode ?? null,
      reasonText: options?.reasonText ?? null,
      source: options?.source ?? null
    });
    if (!frozen || !frozen.context) {
      return null;
    }

    const reviewAt = this.asString(options?.reviewAt) || new Date().toISOString();
    const stopRequestSnapshot = this.asObject(frozen.pricingDetail.stop_request_snapshot);
    const nextPricingDetail = {
      ...frozen.pricingDetail,
      lifecycle_stage: 'stop_pending_review',
      stop_pending_review: true,
      stop_pending_review_at: reviewAt,
      stop_amount_frozen: true,
      stop_amount_frozen_reason: 'awaiting_manual_stop_review',
      stop_pending_review_snapshot: {
        reviewed_at: reviewAt,
        source: options?.source ?? null,
        reason_code: options?.reasonCode ?? null,
        reason_text: options?.reasonText ?? null,
        command_id: options?.commandId ?? null,
        command_token: options?.commandToken ?? null,
        command_code: options?.commandCode ?? null,
        amount: frozen.amount,
        usage: {
          duration_seconds: frozen.usage.durationSec,
          water_volume_m3: frozen.usage.waterVolumeM3,
          energy_kwh: frozen.usage.energyKwh
        },
        stop_request_snapshot: stopRequestSnapshot
      },
      last_progress_at: reviewAt
    };

    await this.db.query(
      `
      update irrigation_order
      set pricing_detail_json = $2::jsonb,
          pricing_progress_at = now(),
          updated_at = now()
      where id = $1::uuid
      `,
      [frozen.context.orderId, JSON.stringify(nextPricingDetail)],
      client
    );

    return {
      ...frozen,
      pricingDetail: nextPricingDetail
    };
  }

  async freezeProgressAtPauseRequest(
    sessionId: string,
    client: PoolClient,
    options?: {
      frozenAt?: string | null;
      reasonCode?: string | null;
      reasonText?: string | null;
      source?: string | null;
    }
  ) {
    const context = await this.loadSessionOrderContext(sessionId, client);
    if (!context) {
      return null;
    }

    const existingPauseSummary = this.getPauseSummary(context.pricingDetail);
    const existingCurrentSegment = this.getPauseCurrentSegment(existingPauseSummary);
    if (this.asString(existingCurrentSegment.pause_requested_at)) {
      return {
        orderId: context.orderId,
        sessionId: context.sessionId,
        amount: this.roundMoney(
          Number(this.asNumber(existingCurrentSegment.amount ?? context.pricingDetail.current_amount ?? 0) ?? 0)
        ),
        usage: {
          durationSec: Math.max(
            0,
            this.asInteger(
              existingCurrentSegment.usage_duration_sec ?? this.asObject(existingCurrentSegment.usage).duration_seconds
            ) ?? 0
          ),
          waterVolumeM3: this.roundMetric(
            Number(
              this.asNumber(
                existingCurrentSegment.usage_water_volume_m3 ?? this.asObject(existingCurrentSegment.usage).water_volume_m3
              ) ?? 0
            ),
            3
          ),
          energyKwh: this.roundMetric(
            Number(
              this.asNumber(
                existingCurrentSegment.usage_energy_kwh ?? this.asObject(existingCurrentSegment.usage).energy_kwh
              ) ?? 0
            ),
            3
          )
        },
        pricingDetail: context.pricingDetail,
        creditLimitAmount: this.roundMoney(
          Number(
            this.asNumber(existingCurrentSegment.credit_limit_amount ?? context.pricingDetail.credit_limit_amount) ??
              Math.max(context.prepaidAmount, context.lockedAmount)
          )
        ),
        creditLimitReached:
          Boolean(existingCurrentSegment.credit_limit_reached) || Boolean(context.pricingDetail.credit_limit_reached),
        context
      };
    }

    const frozenAt = this.asString(options?.frozenAt) || new Date().toISOString();
    const progress = await this.syncProgressBySessionId(sessionId, {
      force: true,
      client,
      settledAt: frozenAt
    });
    if (!progress || 'skipped' in progress) {
      return null;
    }

    const progressPricingDetail = this.asObject(progress.pricingDetail);
    const nextPauseSummary = {
      ...existingPauseSummary,
      state: 'pausing',
      pause_count: Math.max(0, this.asInteger(existingPauseSummary.pause_count) ?? 0) + 1,
      total_paused_duration_sec: Math.max(0, this.asInteger(existingPauseSummary.total_paused_duration_sec) ?? 0),
      pause_amount_frozen: true,
      last_transition_at: frozenAt,
      current_segment: {
        pause_requested_at: frozenAt,
        pause_confirmed_at: null,
        resume_requested_at: null,
        resume_confirmed_at: null,
        source: options?.source ?? null,
        reason_code: options?.reasonCode ?? null,
        reason_text: options?.reasonText ?? null,
        amount: progress.amount,
        raw_amount: Number(this.asNumber(progressPricingDetail.subtotal) ?? progress.amount),
        credit_limit_amount: progress.creditLimitAmount,
        credit_limit_reached: progress.creditLimitReached,
        usage_duration_sec: progress.usage.durationSec,
        usage_water_volume_m3: progress.usage.waterVolumeM3,
        usage_energy_kwh: progress.usage.energyKwh,
        usage: {
          duration_seconds: progress.usage.durationSec,
          water_volume_m3: progress.usage.waterVolumeM3,
          energy_kwh: progress.usage.energyKwh
        },
        metric_snapshot: this.asObject(progressPricingDetail.metric_snapshot),
        pump_health: progressPricingDetail.pump_health ?? null
      }
    };

    const frozenPricingDetail = {
      ...progressPricingDetail,
      lifecycle_stage: 'running',
      pause_summary: nextPauseSummary,
      pause_requested_at: frozenAt,
      pause_amount_frozen: true,
      pause_amount_frozen_reason: 'awaiting_device_pause_confirmation',
      last_progress_at: frozenAt
    };

    await this.db.query(
      `
      update irrigation_order
      set pricing_detail_json = $2::jsonb,
          pricing_progress_at = now(),
          updated_at = now()
      where id = $1::uuid
      `,
      [context.orderId, JSON.stringify(frozenPricingDetail)],
      client
    );

    return {
      ...progress,
      pricingDetail: frozenPricingDetail
    };
  }

  async markPauseConfirmed(
    sessionId: string,
    client: PoolClient,
    options?: {
      pausedAt?: string | null;
      reasonCode?: string | null;
      reasonText?: string | null;
      source?: string | null;
    }
  ) {
    const context = await this.loadSessionOrderContext(sessionId, client);
    if (!context) {
      return null;
    }

    const pricingDetail = this.asObject(context.pricingDetail);
    const pauseSummary = this.getPauseSummary(pricingDetail);
    const currentSegment = this.getPauseCurrentSegment(pauseSummary);
    if (!this.asString(currentSegment.pause_requested_at)) {
      return null;
    }

    const pausedAt = this.asString(options?.pausedAt) || new Date().toISOString();
    const nextPauseSummary = {
      ...pauseSummary,
      state: 'paused',
      pause_amount_frozen: true,
      last_transition_at: pausedAt,
      last_reason_code: options?.reasonCode ?? pauseSummary.last_reason_code ?? null,
      last_reason_text: options?.reasonText ?? pauseSummary.last_reason_text ?? null,
      last_source: options?.source ?? pauseSummary.last_source ?? null,
      current_segment: {
        ...currentSegment,
        pause_confirmed_at: this.asString(currentSegment.pause_confirmed_at) || pausedAt
      }
    };

    const nextPricingDetail = {
      ...pricingDetail,
      lifecycle_stage: 'paused',
      pause_summary: nextPauseSummary,
      pause_requested_at: this.asString(currentSegment.pause_requested_at),
      pause_confirmed_at: this.asString(currentSegment.pause_confirmed_at) || pausedAt,
      pause_amount_frozen: true,
      pause_amount_frozen_reason: 'device_pause_confirmed',
      last_progress_at: pausedAt
    };

    await this.db.query(
      `
      update irrigation_order
      set pricing_detail_json = $2::jsonb,
          pricing_progress_at = now(),
          updated_at = now()
      where id = $1::uuid
      `,
      [context.orderId, JSON.stringify(nextPricingDetail)],
      client
    );

    return {
      orderId: context.orderId,
      sessionId: context.sessionId,
      pricingDetail: nextPricingDetail
    };
  }

  async markResumeRequested(
    sessionId: string,
    client: PoolClient,
    options?: {
      resumeRequestedAt?: string | null;
      reasonCode?: string | null;
      reasonText?: string | null;
      source?: string | null;
    }
  ) {
    const context = await this.loadSessionOrderContext(sessionId, client);
    if (!context) {
      return null;
    }

    const pricingDetail = this.asObject(context.pricingDetail);
    const pauseSummary = this.getPauseSummary(pricingDetail);
    const currentSegment = this.getPauseCurrentSegment(pauseSummary);
    if (!this.asString(currentSegment.pause_requested_at)) {
      return null;
    }

    const resumeRequestedAt = this.asString(options?.resumeRequestedAt) || new Date().toISOString();
    const nextPauseSummary = {
      ...pauseSummary,
      state: 'resuming',
      pause_amount_frozen: true,
      last_transition_at: resumeRequestedAt,
      last_reason_code: options?.reasonCode ?? pauseSummary.last_reason_code ?? null,
      last_reason_text: options?.reasonText ?? pauseSummary.last_reason_text ?? null,
      last_source: options?.source ?? pauseSummary.last_source ?? null,
      current_segment: {
        ...currentSegment,
        resume_requested_at: resumeRequestedAt
      }
    };

    const nextPricingDetail = {
      ...pricingDetail,
      lifecycle_stage: 'paused',
      pause_summary: nextPauseSummary,
      pause_amount_frozen: true,
      pause_amount_frozen_reason: 'awaiting_device_resume_confirmation',
      last_progress_at: resumeRequestedAt
    };

    await this.db.query(
      `
      update irrigation_order
      set pricing_detail_json = $2::jsonb,
          pricing_progress_at = now(),
          updated_at = now()
      where id = $1::uuid
      `,
      [context.orderId, JSON.stringify(nextPricingDetail)],
      client
    );

    return {
      orderId: context.orderId,
      sessionId: context.sessionId,
      pricingDetail: nextPricingDetail
    };
  }

  async cancelPauseOrResumeRequest(
    sessionId: string,
    client: PoolClient,
    options: {
      mode: 'pause' | 'resume';
      restoreStatus: 'running' | 'paused';
      failedAt?: string | null;
      reasonCode?: string | null;
      reasonText?: string | null;
      source?: string | null;
    }
  ) {
    const context = await this.loadSessionOrderContext(sessionId, client);
    if (!context) {
      return null;
    }

    const pricingDetail = this.asObject(context.pricingDetail);
    const pauseSummary = this.getPauseSummary(pricingDetail);
    const currentSegment = this.getPauseCurrentSegment(pauseSummary);
    const failedAt = this.asString(options.failedAt) || new Date().toISOString();

    let nextPauseSummary: Record<string, unknown>;
    if (options.mode === 'pause') {
      nextPauseSummary = {
        ...pauseSummary,
        state: options.restoreStatus,
        pause_amount_frozen: false,
        last_transition_at: failedAt,
        last_failure_code: options.reasonCode ?? null,
        last_failure_text: options.reasonText ?? null,
        last_failure_source: options.source ?? null,
        current_segment: null
      };
    } else {
      nextPauseSummary = {
        ...pauseSummary,
        state: options.restoreStatus,
        pause_amount_frozen: true,
        last_transition_at: failedAt,
        last_failure_code: options.reasonCode ?? null,
        last_failure_text: options.reasonText ?? null,
        last_failure_source: options.source ?? null,
        current_segment: {
          ...currentSegment,
          resume_requested_at: null
        }
      };
    }

    const nextPricingDetail = {
      ...pricingDetail,
      lifecycle_stage: options.mode === 'resume' ? 'paused' : 'running',
      pause_summary: nextPauseSummary,
      pause_amount_frozen: options.mode === 'resume',
      pause_amount_frozen_reason: options.mode === 'resume' ? 'resume_request_rejected' : null,
      last_progress_at: failedAt
    };

    await this.db.query(
      `
      update irrigation_order
      set pricing_detail_json = $2::jsonb,
          pricing_progress_at = now(),
          updated_at = now()
      where id = $1::uuid
      `,
      [context.orderId, JSON.stringify(nextPricingDetail)],
      client
    );

    return {
      orderId: context.orderId,
      sessionId: context.sessionId,
      pricingDetail: nextPricingDetail
    };
  }

  async markResumedFromPause(
    sessionId: string,
    client: PoolClient,
    options?: {
      resumedAt?: string | null;
      reasonCode?: string | null;
      reasonText?: string | null;
      source?: string | null;
    }
  ) {
    const context = await this.loadSessionOrderContext(sessionId, client);
    if (!context) {
      return null;
    }

    const pricingDetail = this.asObject(context.pricingDetail);
    const pauseSummary = this.getPauseSummary(pricingDetail);
    const currentSegment = this.getPauseCurrentSegment(pauseSummary);
    if (!this.asString(currentSegment.pause_requested_at)) {
      return null;
    }

    const resumedAt = this.asString(options?.resumedAt) || new Date().toISOString();
    const pauseStartAt =
      this.asString(currentSegment.pause_confirmed_at) ||
      this.asString(currentSegment.pause_requested_at) ||
      resumedAt;
    const pausedDurationSec = Math.max(0, Math.floor((new Date(resumedAt).getTime() - new Date(pauseStartAt).getTime()) / 1000));
    const totalPausedDurationSec =
      Math.max(0, this.asInteger(pauseSummary.total_paused_duration_sec) ?? 0) + pausedDurationSec;
    const completedSegment = {
      ...currentSegment,
      resume_confirmed_at: resumedAt,
      paused_duration_sec: pausedDurationSec
    };
    const nextPauseSummary = {
      ...pauseSummary,
      state: 'running',
      pause_amount_frozen: false,
      total_paused_duration_sec: totalPausedDurationSec,
      last_transition_at: resumedAt,
      last_reason_code: options?.reasonCode ?? pauseSummary.last_reason_code ?? null,
      last_reason_text: options?.reasonText ?? pauseSummary.last_reason_text ?? null,
      last_source: options?.source ?? pauseSummary.last_source ?? null,
      last_resumed_at: resumedAt,
      last_completed_segment: completedSegment,
      current_segment: null
    };

    const nextPricingDetail = {
      ...pricingDetail,
      lifecycle_stage: 'running',
      pause_summary: nextPauseSummary,
      pause_amount_frozen: false,
      pause_amount_frozen_reason: null,
      last_progress_at: resumedAt
    };

    await this.db.query(
      `
      update irrigation_order
      set pricing_detail_json = $2::jsonb,
          pricing_progress_at = now(),
          updated_at = now()
      where id = $1::uuid
      `,
      [context.orderId, JSON.stringify(nextPricingDetail)],
      client
    );

    return {
      orderId: context.orderId,
      sessionId: context.sessionId,
      pricingDetail: nextPricingDetail
    };
  }

  async syncProgressBySessionId(
    sessionId: string,
    options?: { force?: boolean; client?: PoolClient; settledAt?: string | null }
  ) {
    const execute = async (client: PoolClient) => {
      const context = await this.loadSessionOrderContext(sessionId, client);
      if (!context) {
        return null;
      }

      if (context.orderStatus === 'settled') {
        return {
          orderId: context.orderId,
          skipped: true,
        };
      }

      const stopRequestSnapshot = this.asObject(context.pricingDetail.stop_request_snapshot);
      const stopRequestedAt = this.asString(context.pricingDetail.stop_requested_at ?? stopRequestSnapshot.requested_at);
      if (!options?.settledAt && context.sessionStatus === 'stopping' && stopRequestedAt) {
        const frozenUsage = {
          durationSec: Math.max(
            0,
            this.asInteger(stopRequestSnapshot.usage_duration_sec ?? this.asObject(stopRequestSnapshot.usage).durationSec) ??
              this.asInteger(this.asObject(stopRequestSnapshot.usage).duration_seconds) ??
              this.asInteger(this.asObject(context.pricingDetail.usage).duration_seconds) ??
              0
          ),
          waterVolumeM3: this.roundMetric(
            Number(
              this.asNumber(stopRequestSnapshot.usage_water_volume_m3 ?? this.asObject(stopRequestSnapshot.usage).waterVolumeM3) ??
                this.asNumber(this.asObject(stopRequestSnapshot.usage).water_volume_m3) ??
                this.asNumber(this.asObject(context.pricingDetail.usage).water_volume_m3) ??
                0
            ),
            3
          ),
          energyKwh: this.roundMetric(
            Number(
              this.asNumber(stopRequestSnapshot.usage_energy_kwh ?? this.asObject(stopRequestSnapshot.usage).energyKwh) ??
                this.asNumber(this.asObject(stopRequestSnapshot.usage).energy_kwh) ??
                this.asNumber(this.asObject(context.pricingDetail.usage).energy_kwh) ??
                0
            ),
            3
          )
        };
        const frozenAmount = this.roundMoney(
          Number(this.asNumber(stopRequestSnapshot.amount ?? context.pricingDetail.current_amount) ?? 0)
        );
        const frozenCreditLimitAmount = this.roundMoney(
          Number(
            this.asNumber(stopRequestSnapshot.credit_limit_amount ?? context.pricingDetail.credit_limit_amount) ??
              Math.max(context.prepaidAmount, context.lockedAmount)
          )
        );
        return {
          orderId: context.orderId,
          sessionId: context.sessionId,
          amount: frozenAmount,
          usage: frozenUsage,
          pricingDetail: {
            ...context.pricingDetail,
            lifecycle_stage:
              context.pricingDetail.stop_pending_review === true || context.pricingDetail.stop_pending_review_at
                ? 'stop_pending_review'
                : 'stopping',
            stop_requested_at: stopRequestedAt,
            stop_amount_frozen: true,
            stop_amount_frozen_reason: 'awaiting_device_stop_confirmation',
            stop_request_snapshot: stopRequestSnapshot
          },
          creditLimitAmount: frozenCreditLimitAmount,
          creditLimitReached:
            Boolean(stopRequestSnapshot.credit_limit_reached) || Boolean(context.pricingDetail.credit_limit_reached),
          context
        };
      }

      const pauseSummary = this.getPauseSummary(context.pricingDetail);
      const pauseCurrentSegment = this.getPauseCurrentSegment(pauseSummary);
      const pauseRequestedAt =
        this.asString(pauseCurrentSegment.pause_requested_at) || this.asString(context.pricingDetail.pause_requested_at);
      if (
        !options?.settledAt &&
        ['pausing', 'paused', 'resuming'].includes(context.sessionStatus) &&
        pauseRequestedAt
      ) {
        const frozenUsage = {
          durationSec: Math.max(
            0,
            this.asInteger(
              pauseCurrentSegment.usage_duration_sec ?? this.asObject(pauseCurrentSegment.usage).duration_seconds
            ) ?? 0
          ),
          waterVolumeM3: this.roundMetric(
            Number(
              this.asNumber(
                pauseCurrentSegment.usage_water_volume_m3 ?? this.asObject(pauseCurrentSegment.usage).water_volume_m3
              ) ?? 0
            ),
            3
          ),
          energyKwh: this.roundMetric(
            Number(
              this.asNumber(
                pauseCurrentSegment.usage_energy_kwh ?? this.asObject(pauseCurrentSegment.usage).energy_kwh
              ) ?? 0
            ),
            3
          )
        };
        const frozenAmount = this.roundMoney(
          Number(this.asNumber(pauseCurrentSegment.amount ?? context.pricingDetail.current_amount) ?? 0)
        );
        const frozenCreditLimitAmount = this.roundMoney(
          Number(
            this.asNumber(pauseCurrentSegment.credit_limit_amount ?? context.pricingDetail.credit_limit_amount) ??
              Math.max(context.prepaidAmount, context.lockedAmount)
          )
        );
        return {
          orderId: context.orderId,
          sessionId: context.sessionId,
          amount: frozenAmount,
          usage: frozenUsage,
          pricingDetail: {
            ...context.pricingDetail,
            lifecycle_stage: context.sessionStatus === 'paused' ? 'paused' : 'running',
            pause_summary: pauseSummary,
            pause_requested_at: pauseRequestedAt,
            pause_amount_frozen: true
          },
          creditLimitAmount: frozenCreditLimitAmount,
          creditLimitReached:
            Boolean(pauseCurrentSegment.credit_limit_reached) || Boolean(context.pricingDetail.credit_limit_reached),
          context
        };
      }

      if (!options?.force && context.pricingProgressAt) {
        const ageMs = Date.now() - new Date(context.pricingProgressAt).getTime();
        if (ageMs < 55_000) {
          return {
            orderId: context.orderId,
            skipped: true,
          };
        }
      }

      const baseline = this.asObject(this.asObject(context.pricingDetail.metric_snapshot).baseline);
      const currentMetrics = await this.loadMetricSnapshot(context, client);
      const effectiveBaseline = {
        runtimeSec: Math.max(0, Math.floor(this.asNumber(baseline.runtimeSec) ?? currentMetrics.runtimeSec)),
        waterTotalM3: this.asNumber(baseline.waterTotalM3) ?? currentMetrics.waterTotalM3,
        energyKwh: this.asNumber(baseline.energyKwh) ?? currentMetrics.energyKwh,
      };

      const hasMetricRuntime =
        Number.isFinite(currentMetrics.runtimeSec) &&
        (currentMetrics.runtimeSec > 0 || effectiveBaseline.runtimeSec > 0);
      const usage = {
        durationSec: Math.max(
          0,
          hasMetricRuntime
            ? currentMetrics.runtimeSec - effectiveBaseline.runtimeSec
            : context.startedAt
              ? Math.max(
                  0,
                  this.computeClockDurationSeconds(context, options?.settledAt ?? context.endedAt ?? null)
                )
              : 0
        ),
        waterVolumeM3:
          currentMetrics.waterTotalM3 !== null && effectiveBaseline.waterTotalM3 !== null
            ? Math.max(0, currentMetrics.waterTotalM3 - effectiveBaseline.waterTotalM3)
            : 0,
        energyKwh:
          currentMetrics.energyKwh !== null && effectiveBaseline.energyKwh !== null
            ? Math.max(0, currentMetrics.energyKwh - effectiveBaseline.energyKwh)
            : 0
      };

      const amountResult = this.calculateAmount(context.pricingSnapshot, usage);
      const creditLimitAmount = this.roundMoney(Math.max(context.prepaidAmount, context.lockedAmount));
      const creditLimitReached = creditLimitAmount > 0 && amountResult.amount >= creditLimitAmount;
      const pumpHealthState = this.buildPumpHealthState(
        context.pricingDetail.pump_health,
        currentMetrics.pumpHealth,
        currentMetrics.pumpElectrical
      );
      const nextPricingDetail = {
        ...context.pricingDetail,
        lifecycle_stage: deriveFormalOrderLifecycleStage({
          explicitLifecycle: context.pricingDetail.lifecycle_stage,
          orderStatus: context.orderStatus,
          sessionStatus: context.sessionStatus,
          pricingDetail: context.pricingDetail
        }),
        billing_mode: this.normalizeBillingMode(context.pricingSnapshot.mode),
        unit_price: Number(this.asNumber(context.pricingSnapshot.unitPrice) ?? 0),
        min_charge: Number(this.asNumber(context.pricingSnapshot.minChargeAmount) ?? 0),
        usage: {
          duration_seconds: usage.durationSec,
          water_volume_m3: usage.waterVolumeM3,
          energy_kwh: usage.energyKwh,
        },
        duration_seconds: usage.durationSec,
        subtotal: amountResult.rawAmount,
        final_amount: amountResult.amount,
        current_amount: amountResult.amount,
        credit_limit_amount: creditLimitAmount,
        credit_limit_reached: creditLimitReached,
        metric_snapshot: {
          baseline: effectiveBaseline,
          current: currentMetrics
        },
        pump_health: pumpHealthState,
        last_progress_at: new Date().toISOString()
      };

      await this.db.query(
        `
        update irrigation_order
        set charge_duration_sec = $2,
            charge_volume = $3,
            amount = $4,
            pricing_detail_json = $5::jsonb,
            pricing_progress_at = now(),
            payment_status = case
              when $6 = true and payment_status in ('paid', 'locked')
                then 'credit_limit_reached'
              else payment_status
            end,
            updated_at = now()
        where id = $1::uuid
        `,
        [
          context.orderId,
          usage.durationSec,
          usage.waterVolumeM3,
          amountResult.amount,
          JSON.stringify(nextPricingDetail),
          creditLimitReached
        ],
        client
      );

      return {
        orderId: context.orderId,
        sessionId: context.sessionId,
        amount: amountResult.amount,
        usage,
        pricingDetail: nextPricingDetail,
        creditLimitAmount,
        creditLimitReached,
        context
      };
    };

    if (options?.client) {
      return execute(options.client);
    }

    return this.db.withTransaction(async (client) => execute(client));
  }

  async finalizeOrderAfterStop(
    sessionId: string,
    client: PoolClient,
    options?: {
      settledAt?: string | null;
      gatewayEventType?: string | null;
      gatewayEventCode?: string | null;
      abnormalStop?: boolean;
    }
  ) {
    const progress = await this.syncProgressBySessionId(sessionId, {
      force: true,
      client,
      settledAt: options?.settledAt ?? null
    });
    if (!progress || 'skipped' in progress) {
      return null;
    }

    const context = progress.context;
    const chargeAmount = this.roundMoney(progress.amount);
    let refundedAmount = 0;
    let paymentStatus = context.paymentStatus ?? 'paid';
    let settlementStatus = 'paid';
    let underpaidAmount = 0;

    if (context.fundingMode === 'card_wallet_locked' || (context.paymentMode === 'card' && context.lockedAmount > 0)) {
      const settled = await this.farmerFundService.settleLockedOrder(client, {
        tenantId: context.tenantId,
        userId: context.userId,
        orderId: context.orderId,
        chargeAmount,
        lockedAmount: context.lockedAmount
      });
      refundedAmount = this.roundMoney(settled.unlockedAmount);
      underpaidAmount = this.roundMoney(settled.underpaidAmount);
      paymentStatus = underpaidAmount > 0 ? 'underpaid' : 'paid';
      settlementStatus = underpaidAmount > 0 ? 'partial_paid' : 'paid';
    } else if (context.fundingMode === 'card_wallet') {
      await this.farmerFundService.debitForSettledOrder(client, {
        tenantId: context.tenantId,
        userId: context.userId,
        orderId: context.orderId,
        amount: chargeAmount,
        fundingMode: context.fundingMode
      });
    } else if (context.paymentMode === 'wechat' || context.fundingMode === 'qr_prepay') {
      refundedAmount = this.roundMoney(Math.max(0, context.prepaidAmount - chargeAmount));
      paymentStatus = refundedAmount > 0 ? 'refunded' : 'paid';
      settlementStatus = 'paid';
      if (context.sourcePaymentIntentId) {
        await this.markPaymentIntentRefunded(client, {
          id: context.sourcePaymentIntentId,
          refundedAmount,
          providerPayload: {
            settled_amount: chargeAmount,
            refunded_amount: refundedAmount,
            gateway_event_type: options?.gatewayEventType ?? null
          }
        });
      }
    }

    const finalizedPricingDetail = {
      ...progress.pricingDetail,
      lifecycle_stage: 'settled',
      settled_at: options?.settledAt ?? new Date().toISOString(),
      refunded_amount: refundedAmount,
      underpaid_amount: underpaidAmount,
      stop_reason_code: options?.gatewayEventCode ?? null,
      abnormal_stop: Boolean(options?.abnormalStop),
    };
    const finalizedPricingSnapshot = {
      ...context.pricingSnapshot,
      breakdown: [
        { item: 'duration_seconds', value: progress.usage.durationSec },
        { item: 'water_volume_m3', value: progress.usage.waterVolumeM3 },
        { item: 'energy_kwh', value: progress.usage.energyKwh },
        { item: 'amount', value: chargeAmount },
        { item: 'refunded_amount', value: refundedAmount },
        { item: 'gateway_event_type', value: options?.gatewayEventType ?? null },
        { item: 'gateway_event_code', value: options?.gatewayEventCode ?? null },
        { item: 'abnormal_stop', value: Boolean(options?.abnormalStop) }
      ]
    };

    await this.db.query(
      `
      update irrigation_order
      set status = 'settled',
          settlement_status = $2,
          payment_status = $3,
          refunded_amount = $4,
          charge_duration_sec = $5,
          charge_volume = $6,
          amount = $7,
          pricing_snapshot_json = $8::jsonb,
          pricing_detail_json = $9::jsonb,
          updated_at = now()
      where id = $1::uuid
      `,
      [
        context.orderId,
        settlementStatus,
        paymentStatus,
        refundedAmount,
        progress.usage.durationSec,
        progress.usage.waterVolumeM3,
        chargeAmount,
        JSON.stringify(finalizedPricingSnapshot),
        JSON.stringify(finalizedPricingDetail)
      ],
      client
    );

    if (context.sourcePaymentIntentId) {
      await this.markPaymentIntentPaid(client, {
        id: context.sourcePaymentIntentId,
        sessionId: context.sessionId,
        orderId: context.orderId,
        providerPayload: {
          settlement_status: settlementStatus,
          payment_status: paymentStatus
        }
      });
    }

    return {
      orderId: context.orderId,
      sessionId: context.sessionId,
      amount: chargeAmount,
      refundedAmount,
      settlementStatus,
      paymentStatus,
      underpaidAmount
    };
  }

  async cancelOrderBeforeStart(
    sessionId: string,
    client: PoolClient,
    options?: {
      settledAt?: string | null;
      gatewayEventType?: string | null;
      gatewayEventCode?: string | null;
      failureSource?: string | null;
      failureMessage?: string | null;
    }
  ) {
    const context = await this.loadSessionOrderContext(sessionId, client);
    if (!context) {
      return null;
    }

    if (context.orderStatus === 'settled') {
      return {
        orderId: context.orderId,
        sessionId: context.sessionId,
        amount: 0,
        refundedAmount: this.roundMoney(context.refundedAmount),
        settlementStatus: context.settlementStatus ?? 'cancelled',
        paymentStatus: context.paymentStatus ?? 'refunded',
        underpaidAmount: 0,
      };
    }

    const settledAt = options?.settledAt ?? new Date().toISOString();
    let refundedAmount = 0;
    let paymentStatus = context.paymentStatus ?? 'unpaid';
    let walletUnlockSkipped = false;
    let walletUnlockSnapshot: Record<string, unknown> | null = null;

    if (context.fundingMode === 'card_wallet_locked' || (context.paymentMode === 'card' && context.lockedAmount > 0)) {
      try {
        const unlocked = await this.farmerFundService.settleLockedOrder(client, {
          tenantId: context.tenantId,
          userId: context.userId,
          orderId: context.orderId,
          chargeAmount: 0,
          lockedAmount: context.lockedAmount
        });
        refundedAmount = this.roundMoney(unlocked.unlockedAmount);
        paymentStatus = context.lockedAmount > 0 ? 'refunded' : paymentStatus;
      } catch (error) {
        const code =
          error instanceof AppException
            ? this.asString((error.getResponse() as Record<string, unknown> | undefined)?.code)
            : this.asString(this.asObject(error).code);
        const message = error instanceof Error ? error.message : this.asString(this.asObject(error).message);
        if (code !== ErrorCodes.WALLET_INSUFFICIENT_BALANCE && message !== 'WALLET_INSUFFICIENT_BALANCE') {
          throw error;
        }

        const walletState = await this.farmerFundService.getWalletState(client, context.tenantId, context.userId);
        refundedAmount = this.roundMoney(Math.max(0, context.lockedAmount));
        paymentStatus = context.lockedAmount > 0 ? 'refunded' : paymentStatus;
        walletUnlockSkipped = true;
        walletUnlockSnapshot = {
          balance: this.roundMoney(walletState.balance),
          locked_balance: this.roundMoney(walletState.lockedBalance),
          expected_locked_amount: this.roundMoney(context.lockedAmount),
          reason: 'wallet lock ledger missing, order cancelled without wallet mutation'
        };
      }
    } else if (context.paymentMode === 'wechat' || context.fundingMode === 'qr_prepay') {
      refundedAmount = this.roundMoney(Math.max(0, context.prepaidAmount));
      paymentStatus = refundedAmount > 0 ? 'refunded' : paymentStatus;
      if (context.sourcePaymentIntentId) {
        await this.markPaymentIntentRefunded(client, {
          id: context.sourcePaymentIntentId,
          refundedAmount,
          providerPayload: {
            failure_source: options?.failureSource ?? null,
            failure_message: options?.failureMessage ?? null,
            gateway_event_type: options?.gatewayEventType ?? null,
            gateway_event_code: options?.gatewayEventCode ?? null,
            refunded_amount: refundedAmount
          }
        });
      }
    }

    const finalizedPricingDetail = {
      ...context.pricingDetail,
      settled_at: settledAt,
      refunded_amount: refundedAmount,
      underpaid_amount: 0,
      lifecycle_stage: 'settled',
      start_failure: true,
      start_failure_reason_code: options?.gatewayEventCode ?? null,
      start_failure_source: options?.failureSource ?? null,
      start_failure_message: options?.failureMessage ?? null,
      stop_reason_code: options?.gatewayEventCode ?? null,
      abnormal_stop: false,
      usage: {
        duration_seconds: 0,
        water_volume_m3: 0,
        energy_kwh: 0
      },
      manual_cleanup_wallet_unlock_skipped: walletUnlockSkipped,
      manual_cleanup_wallet_snapshot: walletUnlockSnapshot
    };
    const finalizedPricingSnapshot = {
      ...context.pricingSnapshot,
      breakdown: [
        { item: 'duration_seconds', value: 0 },
        { item: 'water_volume_m3', value: 0 },
        { item: 'energy_kwh', value: 0 },
        { item: 'amount', value: 0 },
        { item: 'refunded_amount', value: refundedAmount },
        { item: 'gateway_event_type', value: options?.gatewayEventType ?? null },
        { item: 'gateway_event_code', value: options?.gatewayEventCode ?? null },
        { item: 'failure_source', value: options?.failureSource ?? null },
        { item: 'failure_message', value: options?.failureMessage ?? null },
        { item: 'manual_cleanup_wallet_unlock_skipped', value: walletUnlockSkipped }
      ]
    };

    await this.db.query(
      `
      update irrigation_order
      set status = 'settled',
          settlement_status = 'cancelled',
          payment_status = $2,
          refunded_amount = $3,
          charge_duration_sec = 0,
          charge_volume = 0,
          amount = 0,
          pricing_snapshot_json = $4::jsonb,
          pricing_detail_json = $5::jsonb,
          updated_at = now()
      where id = $1::uuid
      `,
      [
        context.orderId,
        paymentStatus,
        refundedAmount,
        JSON.stringify(finalizedPricingSnapshot),
        JSON.stringify(finalizedPricingDetail)
      ],
      client
    );

    return {
      orderId: context.orderId,
      sessionId: context.sessionId,
      amount: 0,
      refundedAmount,
      settlementStatus: 'cancelled',
      paymentStatus,
      underpaidAmount: 0
    };
  }
}
