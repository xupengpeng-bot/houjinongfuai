export interface BlockingReason {
  code: string;
  message: string;
  reasonCode: string;
  reasonText: string;
  source: string;
  details?: Record<string, unknown>;
}

export interface AvailableAction {
  code: string;
  actionCode: string;
  label: string;
  requiresConfirm: boolean;
  details?: Record<string, unknown>;
}

export interface RuntimeDecisionContract {
  decisionId: string;
  result: 'allow' | 'deny' | 'manual_review';
  blockingReasons: BlockingReason[];
  availableActions: AvailableAction[];
  effectiveRuleSource: {
    policyId?: string;
    relationId?: string;
    priorityChain: string[];
  };
  pricePreview: {
    billingMode: string;
    unitPrice: number;
    unitType: string;
    currency: 'CNY';
    minChargeAmount?: number;
    billingPackageId?: string;
  } | null;
}

export function createBlockingReason(
  code: string,
  message: string,
  source: string,
  details?: Record<string, unknown>
): BlockingReason {
  return {
    code,
    message,
    reasonCode: code,
    reasonText: message,
    source,
    details
  };
}

export function createAvailableAction(
  code: string,
  label: string,
  requiresConfirm: boolean,
  details?: Record<string, unknown>
): AvailableAction {
  return {
    code,
    actionCode: code,
    label,
    requiresConfirm,
    details
  };
}
