const DAY_MS = 24 * 60 * 60 * 1000;
const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;

export interface PortalAlert {
  id: 'traffic_80' | 'traffic_95' | 'traffic_100' | 'subscription_expiry';
  kind: 'traffic' | 'expiry';
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  actionHref: '/portal/plans';
}

interface PortalAlertOverview {
  remainingBytes: number;
  subscription: {
    includedTrafficBytes: number;
    bonusTrafficBytes: number;
    endsAt: string;
  };
  packs: Array<{
    totalBytes: number;
    status: 'active' | 'exhausted' | 'expired';
  }>;
}

export function buildPortalAlerts(
  overview: PortalAlertOverview,
  now = new Date(),
): PortalAlert[] {
  const alerts: PortalAlert[] = [];
  const packQuota = overview.packs
    .filter((pack) => pack.status !== 'expired')
    .reduce((total, pack) => total + pack.totalBytes, 0);
  const totalQuota =
    overview.subscription.includedTrafficBytes +
    overview.subscription.bonusTrafficBytes +
    packQuota;

  if (totalQuota > 0 && totalQuota < UNLIMITED_TRAFFIC) {
    const usedPercent = Math.min(
      100,
      Math.max(0, ((totalQuota - overview.remainingBytes) / totalQuota) * 100),
    );
    if (overview.remainingBytes <= 0 || usedPercent >= 100) {
      alerts.push({
        id: 'traffic_100',
        kind: 'traffic',
        severity: 'critical',
        title: '套餐流量已用尽',
        message: '当前连接将受到限制，请购买流量包或续费套餐。',
        actionHref: '/portal/plans',
      });
    } else if (usedPercent >= 95) {
      alerts.push({
        id: 'traffic_95',
        kind: 'traffic',
        severity: 'critical',
        title: '套餐流量已使用 95%',
        message: '剩余流量很少，建议立即补充流量。',
        actionHref: '/portal/plans',
      });
    } else if (usedPercent >= 80) {
      alerts.push({
        id: 'traffic_80',
        kind: 'traffic',
        severity: 'warning',
        title: '套餐流量已使用 80%',
        message: '流量即将不足，可提前购买流量包。',
        actionHref: '/portal/plans',
      });
    }
  }

  const expiryMs =
    new Date(overview.subscription.endsAt).getTime() - now.getTime();
  if (expiryMs > 0 && expiryMs <= 3 * DAY_MS) {
    const days = Math.max(1, Math.ceil(expiryMs / DAY_MS));
    alerts.push({
      id: 'subscription_expiry',
      kind: 'expiry',
      severity: expiryMs <= DAY_MS ? 'critical' : 'warning',
      title: '套餐即将到期',
      message: `当前套餐将在 ${days} 天内到期，请及时续费。`,
      actionHref: '/portal/plans',
    });
  }

  return alerts;
}
