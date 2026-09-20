import type { Prisma } from '@prisma/client';

/** Prefer the immutable checkout decision over the legacy RENEWAL kind. */
export function orderOperation(order: {
  kind: string;
  note?: string | null;
  resetAnchorAtSnapshot?: Date | null;
  processedAt?: Date | null;
  upgradeFromProductIdSnapshot?: string | null;
  epayPaymentAttempt?: { entitlementSnapshot: Prisma.JsonValue } | null;
  groupBuyMember?: { entitlementSnapshot: Prisma.JsonValue } | null;
}) {
  if (order.note === 'PLAN_QUOTA_RESET') return '流量重置';
  if (order.kind === 'TRAFFIC_PACK') return '流量包';
  const snapshot =
    order.epayPaymentAttempt?.entitlementSnapshot ??
    order.groupBuyMember?.entitlementSnapshot;
  const data =
    snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot
      : {};
  const mode = data.planActivationMode ?? data.purchaseMode;
  const labels: Record<string, string> = {
    initial: '新开',
    renewal: '续费',
    scheduled_switch: '到期切换',
    immediate_switch: '立即切换',
    plan_reset: '流量重置',
    upgrade: '升级',
  };
  if (typeof mode === 'string' && labels[mode]) return labels[mode];
  if (order.upgradeFromProductIdSnapshot) return '升级';
  if (order.note?.startsWith('PLAN_ACTIVATION:')) {
    return labels[order.note.slice('PLAN_ACTIVATION:'.length)] ?? '套餐购买';
  }
  if (order.resetAnchorAtSnapshot && order.processedAt) {
    if (
      order.resetAnchorAtSnapshot.getTime() <
      order.processedAt.getTime() - 1000
    )
      return '续费';
  }
  // Historical orders without a decision snapshot cannot reliably distinguish switches.
  return '套餐购买';
}
