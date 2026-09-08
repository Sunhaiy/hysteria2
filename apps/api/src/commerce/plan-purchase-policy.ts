export type PlanActivationPreference = 'scheduled_switch' | 'immediate_switch';

export type PlanActivationMode =
  | 'initial'
  | 'renewal'
  | 'scheduled_switch'
  | 'immediate_switch';

export interface CurrentPlanPurchaseState {
  productId: string | null;
  productName: string;
  legacyPlanId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface PlanPurchasePolicy {
  mode: PlanActivationMode;
  effectiveAt: Date;
  currentPlan: CurrentPlanPurchaseState | null;
  forfeitedDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function standardPlanPurchaseKey(userId: string) {
  return `standard-plan:${userId}`;
}

export function decidePlanPurchasePolicy(input: {
  now: Date;
  targetProductId: string;
  targetLegacyPlanId: string;
  currentPlan: CurrentPlanPurchaseState | null;
  preference?: PlanActivationPreference;
  forceImmediate?: boolean;
}): PlanPurchasePolicy {
  const current = input.currentPlan;
  if (!current) {
    return {
      mode: 'initial',
      effectiveAt: input.now,
      currentPlan: null,
      forfeitedDays: 0,
    };
  }

  const samePlan = current.productId
    ? current.productId === input.targetProductId
    : current.legacyPlanId === input.targetLegacyPlanId;
  if (samePlan) {
    return {
      mode: 'renewal',
      effectiveAt: current.endsAt,
      currentPlan: current,
      forfeitedDays: 0,
    };
  }

  const immediate =
    input.forceImmediate || input.preference === 'immediate_switch';
  return {
    mode: immediate ? 'immediate_switch' : 'scheduled_switch',
    effectiveAt: immediate ? input.now : current.endsAt,
    currentPlan: current,
    forfeitedDays: immediate
      ? Math.max(
          0,
          Math.ceil((current.endsAt.getTime() - input.now.getTime()) / DAY_MS),
        )
      : 0,
  };
}
