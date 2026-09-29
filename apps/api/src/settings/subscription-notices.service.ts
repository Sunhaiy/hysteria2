import { BadRequestException, Injectable } from '@nestjs/common';
import { stringify } from 'yaml';
import { PrismaService } from '../prisma/prisma.service';
import { expiredMemberWhere } from '../entitlement/expired-member';

export const NOTICE_SETTING = 'subscription.expiredNotices';
export const DEFAULT_NOTICES = {
  enabled: false,
  names: ['套餐已到期，请前往网站续费', '续费后刷新订阅恢复节点'],
};
export function normalizeNotices(raw: unknown) {
  const value = raw as typeof DEFAULT_NOTICES;
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.names) ||
    value.names.length < 1 ||
    value.names.length > 10 ||
    value.names.some(
      (n) =>
        typeof n !== 'string' ||
        !n.trim() ||
        n.length > 80 ||
        [...n].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    )
  )
    throw new BadRequestException(
      '请设置1–10个到期提示，每个名称最多80字且不能包含换行',
    );
  const names = value.names.map((n) => n.trim());
  if (new Set(names).size !== names.length)
    throw new BadRequestException('提示名称不能重复');
  return { enabled: value.enabled, names };
}
export function noticeProxies(names: string[], scope: 'all' | 'ai' = 'all') {
  return names.map((name) => ({
    name: `${scope === 'ai' ? 'AI · ' : ''}[到期提示] ${name}`,
    type: 'http',
    server: 'subscription-expired.invalid',
    port: 1,
  }));
}
@Injectable()
export class SubscriptionNoticesService {
  constructor(private readonly db: PrismaService) {}
  async config() {
    const row = await this.db.setting.findUnique({
      where: { key: NOTICE_SETTING },
    });
    if (!row) return DEFAULT_NOTICES;
    try {
      return normalizeNotices(JSON.parse(row.value));
    } catch {
      return DEFAULT_NOTICES;
    }
  }
  async save(raw: unknown, actorId: string) {
    const value = normalizeNotices(raw);
    await this.db.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: NOTICE_SETTING },
        create: { key: NOTICE_SETTING, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'SUBSCRIPTION_NOTICES_UPDATED',
          targetType: 'Setting',
          targetId: NOTICE_SETTING,
          metadata: value,
        },
      });
    });
    return value;
  }
  async feed(tokenValue: string, scope?: 'all' | 'ai') {
    if (tokenValue.length < 8 || tokenValue.length > 256) return null;
    const cfg = await this.config();
    if (!cfg.enabled) return null;
    const token = await this.db.accessToken.findUnique({
      where: { token: tokenValue },
    });
    if (!token || token.revokedAt) return null;
    const now = new Date();
    const user = await this.db.user.findFirst({
      where: { AND: [{ id: token.userId }, expiredMemberWhere(now)] },
      select: { id: true },
    });
    if (!user) return null;
    const [grant, subscription] = await Promise.all([
      this.db.entitlementGrant.aggregate({
        where: {
          userId: user.id,
          kind: 'PLAN',
          status: { in: ['ACTIVE', 'EXPIRED'] },
          endsAt: { lte: now },
        },
        _max: { endsAt: true },
      }),
      this.db.subscription.aggregate({
        where: {
          userId: user.id,
          status: { in: ['ACTIVE', 'EXPIRED'] },
          endsAt: { lte: now },
        },
        _max: { endsAt: true },
      }),
    ]);
    const proxies = noticeProxies(cfg.names, scope);
    const document = scope
      ? { proxies }
      : {
          mode: 'rule',
          proxies,
          'proxy-groups': [
            {
              name: '套餐到期提示',
              type: 'select',
              proxies: proxies.map((p) => p.name),
            },
          ],
          rules: ['MATCH,REJECT'],
        };
    return {
      content: stringify(document, { lineWidth: 0 }),
      title: '套餐到期提示',
      expiresAt: Math.max(
        +(grant._max.endsAt ?? 0),
        +(subscription._max.endsAt ?? 0),
      ),
      consumedBytes: 0,
      totalBytes: 0,
      nodeCount: proxies.length,
    };
  }
}
