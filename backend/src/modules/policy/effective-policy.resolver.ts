import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCodes } from '../../common/errors/error-codes';
import { BillingSubjectPolicyService, type BillingSubjectType } from '../billing/billing-subject-policy.service';
import { EffectivePolicy } from './policy.dto';
import { PolicyRepository } from './policy.repository';

export const FIXED_PRIORITY_CHAIN = [
  'billing_subject_policy',
  'well_runtime_policy',
  'pump_valve_relation',
  'interaction_policy',
  'scenario_template',
  'device_type_default'
] as const;

type PrioritySource = (typeof FIXED_PRIORITY_CHAIN)[number];

type ResolvedFieldMap = {
  billingPackageId?: string;
  powerThresholdKw?: number;
  minRunSeconds?: number;
  maxRunSeconds?: number;
  concurrencyLimit?: number;
  idleTimeoutSeconds?: number;
  stopProtectionMode?: string;
  confirmMode?: string;
};

@Injectable()
export class EffectivePolicyResolver {
  constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly billingSubjectPolicyService: BillingSubjectPolicyService
  ) {}

  async resolveForRuntime(input: {
    wellId: string;
    pumpId: string;
    valveId: string;
    relationId: string;
    targetType: string;
    sceneCode: string;
  }): Promise<EffectivePolicy> {
    const wellPolicy = await this.policyRepository.findEffectivePolicyByWellId(input.wellId);
    const relation = await this.policyRepository.findRelationConfigById(input.relationId);

    if (!relation) {
      throw new AppException(ErrorCodes.RELATION_NOT_CONFIGURED, 'No active relation configuration found');
    }

    const interactionPolicy = await this.policyRepository.findInteractionPolicy(
      relation.tenantId,
      input.targetType,
      input.sceneCode
    );
    const deviceTypeDefault = await this.policyRepository.findDeviceTypeDefaultByWellId(input.wellId);

    const relationDefaults = this.extractRuntimeDefaults(relation.relationConfigJson);
    const interactionDefaults = this.extractRuntimeDefaults(interactionPolicy?.promptJson ?? null);
    const deviceTypeDefaults = this.extractRuntimeDefaults(deviceTypeDefault?.defaultConfigJson ?? null);

    const templateCode = this.firstDefined<string>(
      this.toStringValue(relationDefaults.templateCode),
      this.toStringValue(interactionDefaults.templateCode),
      this.toStringValue(deviceTypeDefaults.templateCode)
    );

    const scenarioTemplate = await this.policyRepository.findScenarioTemplate(relation.tenantId, templateCode ?? null, 'well');
    const scenarioDefaults = this.extractRuntimeDefaults(scenarioTemplate?.templateConfigJson ?? null);
    const targetSubjectType = this.resolveTargetSubjectType(input.targetType);
    const targetSubjectId = this.resolveTargetSubjectId(targetSubjectType, input);
    const targetSubjectPolicy = await this.billingSubjectPolicyService.findActivePolicy(
      relation.tenantId,
      targetSubjectType,
      targetSubjectId
    );
    const wellSubjectPolicy =
      targetSubjectType === 'well'
        ? targetSubjectPolicy
        : await this.billingSubjectPolicyService.findActivePolicy(relation.tenantId, 'well', input.wellId);

    const resolved: ResolvedFieldMap = {};
    const resolvedFrom: EffectivePolicy['resolved_from'] = {};

    this.applyResolvedFields(resolved, resolvedFrom, 'device_type_default', deviceTypeDefaults);
    this.applyResolvedFields(resolved, resolvedFrom, 'scenario_template', scenarioDefaults);
    this.applyResolvedFields(resolved, resolvedFrom, 'interaction_policy', {
      ...interactionDefaults,
      confirmMode: interactionPolicy?.confirmMode ?? interactionDefaults.confirmMode
    });
    this.applyResolvedFields(resolved, resolvedFrom, 'pump_valve_relation', relationDefaults);

    if (wellPolicy) {
      this.applyResolvedFields(resolved, resolvedFrom, 'well_runtime_policy', {
        billingPackageId: wellPolicy.billingPackageId,
        powerThresholdKw: wellPolicy.powerThresholdKw,
        minRunSeconds: wellPolicy.minRunSeconds,
        maxRunSeconds: wellPolicy.maxRunSeconds,
        concurrencyLimit: wellPolicy.concurrencyLimit,
        stopProtectionMode: wellPolicy.stopProtectionMode
      });
    }

    if (wellSubjectPolicy) {
      this.assignField(
        resolved,
        resolvedFrom,
        'billingPackageId',
        wellSubjectPolicy.billingPackageId,
        'billing_package_source',
        'billing_subject_policy'
      );
    }

    if (targetSubjectPolicy && targetSubjectPolicy.subjectId !== wellSubjectPolicy?.subjectId) {
      this.assignField(
        resolved,
        resolvedFrom,
        'billingPackageId',
        targetSubjectPolicy.billingPackageId,
        'billing_package_source',
        'billing_subject_policy'
      );
    }

    if (!resolved.billingPackageId || resolved.maxRunSeconds === undefined || resolved.concurrencyLimit === undefined) {
      throw new AppException(
        ErrorCodes.POLICY_NOT_EFFECTIVE,
        'No effective runtime policy could be resolved from the fixed fallback chain',
        400,
        {
          missingFields: {
            billingPackageId: !resolved.billingPackageId,
            maxRunSeconds: resolved.maxRunSeconds === undefined,
            concurrencyLimit: resolved.concurrencyLimit === undefined
          },
          resolved_from: resolvedFrom
        }
      );
    }

    const billingPackage = await this.policyRepository.findBillingPackageById(resolved.billingPackageId);
    if (!billingPackage) {
      throw new AppException(
        ErrorCodes.POLICY_NOT_EFFECTIVE,
        'Resolved billing package is missing or inactive',
        400,
        {
          billingPackageId: resolved.billingPackageId,
          resolved_from: resolvedFrom
        }
      );
    }

    return {
      priorityChain: [...FIXED_PRIORITY_CHAIN],
      sourceIds: {
        billingSubjectPolicyId: targetSubjectPolicy?.id ?? wellSubjectPolicy?.id,
        policyId: wellPolicy?.id,
        relationId: input.relationId,
        interactionPolicyId: interactionPolicy?.id,
        scenarioTemplateId: scenarioTemplate?.id,
        deviceTypeId: deviceTypeDefault?.id,
        billingPackageId: billingPackage.id
      },
      runtime: {
        wellId: input.wellId,
        pumpId: input.pumpId,
        valveId: input.valveId,
        powerThresholdKw: Number(resolved.powerThresholdKw ?? 0),
        minRunSeconds: Number(resolved.minRunSeconds ?? 0),
        maxRunSeconds: Number(resolved.maxRunSeconds),
        concurrencyLimit: Number(resolved.concurrencyLimit),
        idleTimeoutSeconds: Number(resolved.idleTimeoutSeconds ?? 0),
        stopProtectionMode: String(resolved.stopProtectionMode ?? 'stop_pump_then_close_valve')
      },
      billing: {
        billingPackageId: billingPackage.id,
        billingMode: billingPackage.billingMode,
        unitPrice: Number(billingPackage.unitPrice ?? 0),
        unitType: billingPackage.unitType,
        minChargeAmount: Number(billingPackage.minChargeAmount ?? 0),
        pricingRules: billingPackage.pricingRules ?? {}
      },
      interaction: {
        confirmMode: String(resolved.confirmMode ?? interactionPolicy?.confirmMode ?? 'single_confirm')
      },
      resolved_from: resolvedFrom,
      raw: {
        billingSubjectPolicy: targetSubjectPolicy ?? wellSubjectPolicy ?? null,
        wellRuntimePolicy: wellPolicy,
        relationConfig: relation.relationConfigJson,
        interactionPolicy,
        scenarioTemplate,
        deviceTypeDefault,
        billingPackage
      }
    };
  }

  private applyResolvedFields(
    target: ResolvedFieldMap,
    resolvedFrom: EffectivePolicy['resolved_from'],
    sourceName: PrioritySource,
    values: Record<string, unknown>
  ) {
    this.assignField(target, resolvedFrom, 'billingPackageId', values.billingPackageId, 'billing_package_source', sourceName);
    this.assignField(target, resolvedFrom, 'powerThresholdKw', values.powerThresholdKw, 'power_threshold_kw_source', sourceName);
    this.assignField(target, resolvedFrom, 'minRunSeconds', values.minRunSeconds, 'min_run_seconds_source', sourceName);
    this.assignField(target, resolvedFrom, 'maxRunSeconds', values.maxRunSeconds, 'max_session_minutes_source', sourceName);
    this.assignField(target, resolvedFrom, 'concurrencyLimit', values.concurrencyLimit, 'concurrency_limit_source', sourceName);
    this.assignField(target, resolvedFrom, 'idleTimeoutSeconds', values.idleTimeoutSeconds, 'idle_timeout_seconds_source', sourceName);
    this.assignField(target, resolvedFrom, 'stopProtectionMode', values.stopProtectionMode, 'stop_protection_mode_source', sourceName);
    this.assignField(target, resolvedFrom, 'confirmMode', values.confirmMode, 'confirm_mode_source', sourceName);
  }

  private assignField<K extends keyof ResolvedFieldMap>(
    target: ResolvedFieldMap,
    resolvedFrom: EffectivePolicy['resolved_from'],
    field: K,
    rawValue: unknown,
    sourceField: keyof EffectivePolicy['resolved_from'],
    sourceName: PrioritySource,
    transform?: (value: unknown) => unknown
  ) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return;
    }

    const value = transform ? transform(rawValue) : rawValue;
    if (value === undefined || value === null || value === '') {
      return;
    }

    const normalizedValue = this.normalizeFieldValue(field, value);
    if (normalizedValue === undefined) {
      return;
    }

    target[field] = normalizedValue as ResolvedFieldMap[K];
    resolvedFrom[sourceField] = sourceName;
  }

  private normalizeFieldValue(field: keyof ResolvedFieldMap, value: unknown) {
    if (field === 'billingPackageId' || field === 'stopProtectionMode' || field === 'confirmMode') {
      return this.toStringValue(value);
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  private extractRuntimeDefaults(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const runtimeDefaults = raw.runtimeDefaults;
    if (runtimeDefaults && typeof runtimeDefaults === 'object' && !Array.isArray(runtimeDefaults)) {
      return runtimeDefaults as Record<string, unknown>;
    }

    return raw;
  }

  private toStringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private firstDefined<T>(...values: Array<T | undefined>): T | undefined {
    return values.find((value) => value !== undefined);
  }

  private resolveTargetSubjectType(targetType: string): BillingSubjectType {
    if (targetType === 'pump') return 'pump';
    if (targetType === 'valve') return 'valve';
    return 'well';
  }

  private resolveTargetSubjectId(
    targetSubjectType: BillingSubjectType,
    input: { wellId: string; pumpId: string; valveId: string }
  ) {
    if (targetSubjectType === 'pump') return input.pumpId;
    if (targetSubjectType === 'valve') return input.valveId;
    return input.wellId;
  }
}
