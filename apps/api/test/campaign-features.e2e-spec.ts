import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { parse } from 'yaml';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  CampaignMailService,
  campaignInput,
} from '../src/campaign-mail/campaign-mail.service';
import {
  SubscriptionNoticesService,
  normalizeNotices,
} from '../src/settings/subscription-notices.service';
import { expiredMemberWhere } from '../src/entitlement/expired-member';
const url = process.env.CAMPAIGN_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'campaign features on isolated PostgreSQL',
  () => {
    let db: PrismaClient,
      service: CampaignMailService,
      notices: SubscriptionNoticesService,
      admin: string,
      profile: string,
      product: string;
    const sendCampaign = jest.fn().mockResolvedValue(undefined),
      isConfigured = jest.fn().mockResolvedValue(true);
    const input = {
      subject: '活动测试',
      body: '这是本地测试，不会发送真实邮件。',
      audience: 'selected',
    };
    const user = () =>
      db.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          displayName: 'fixture',
          passwordHash: 'not-a-login',
          accessAccount: { create: {} },
        },
        include: { accessAccount: true },
      });
    async function grant(
      uid: string,
      active = false,
      kind: 'PLAN' | 'TRAFFIC_PACK' = 'PLAN',
    ) {
      const account = await db.accessAccount.findUniqueOrThrow({
        where: { userId: uid },
      });
      return db.entitlementGrant.create({
        data: {
          userId: uid,
          accessAccountId: account.id,
          productId: product,
          accessProfileId: profile,
          kind,
          startsAt: new Date(Date.now() - 86400000 * 2),
          endsAt: new Date(Date.now() + (active ? 86400000 : -86400000)),
          speedUpMbpsSnapshot: 100,
          speedDownMbpsSnapshot: 100,
          deviceLimitSnapshot: 3,
        },
      });
    }
    beforeAll(async () => {
      const target = new URL(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.pathname !== '/holiday_test' ||
        target.searchParams.get('schema') !== 'release_features_20260929'
      )
        throw Error('isolated test database required');
      db = new PrismaClient({ datasources: { db: { url } } });
      process.env.JWT_SECRET = 'local-campaign-unsubscribe-test-secret';
      service = new CampaignMailService(
        db as PrismaService,
        { sendCampaign, isConfigured } as never,
      );
      notices = new SubscriptionNoticesService(db as PrismaService);
      admin = (
        await db.user.create({
          data: {
            email: `${randomUUID()}@example.test`,
            displayName: 'admin',
            role: 'ADMIN',
            passwordHash: 'no-login',
          },
        })
      ).id;
      profile = (
        await db.accessProfile.create({
          data: {
            name: 'fixture',
            slug: randomUUID(),
            speedUpMbps: 100,
            speedDownMbps: 100,
            deviceLimit: 3,
          },
        })
      ).id;
      product = (
        await db.catalogProduct.create({
          data: {
            name: 'fixture',
            slug: randomUUID(),
            kind: 'PLAN',
            status: 'ACTIVE',
            accessProfileId: profile,
            quotaCadence: 'MONTHLY_RESET',
          },
        })
      ).id;
    });
    beforeEach(async () => {
      await db.campaignMailJob.deleteMany();
      sendCampaign.mockReset().mockResolvedValue(undefined);
      isConfigured.mockReturnValue(Promise.resolve(true));
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    it('previews without sending and freezes recipients, concurrent replay creates one job', async () => {
      const u = await user(),
        key = randomUUID(),
        raw = { ...input, emails: u.email };
      const [a, b] = await Promise.all([
        service.preview(raw, admin, key),
        service.preview(raw, admin, key),
      ]);
      expect(a.id).toBe(b.id);
      expect(a.counts.PENDING).toBe(1);
      expect(sendCampaign).not.toHaveBeenCalled();
      await expect(
        service.preview({ ...raw, body: 'changed' }, admin, key),
      ).rejects.toThrow('预览内容已变化');
    });
    it('requires confirmation and SMTP, rejects another admin and queues once', async () => {
      const u = await user(),
        p = await service.preview(
          { ...input, emails: u.email },
          admin,
          randomUUID(),
        );
      await expect(service.queue(p.id, admin, false)).rejects.toThrow('确认');
      await expect(service.queue(p.id, u.id, true)).rejects.toThrow('管理员');
      isConfigured.mockResolvedValue(false);
      await expect(service.queue(p.id, admin, true)).rejects.toThrow('配置');
      isConfigured.mockResolvedValue(true);
      await Promise.all([
        service.queue(p.id, admin, true),
        service.queue(p.id, admin, true),
      ]);
      await Promise.all([service.processPending(), service.processPending()]);
      await service.processPending();
      expect(sendCampaign).toHaveBeenCalledTimes(1);
      expect((await service.detail(p.id)).counts.SENT).toBe(1);
    });
    it('excludes opt-outs and suspended accounts and rechecks recipients before sending', async () => {
      const [a, b, c] = await Promise.all([user(), user(), user()]);
      await db.campaignMailOptOut.create({ data: { userId: b.id } });
      await db.user.update({
        where: { id: c.id },
        data: { status: 'SUSPENDED' },
      });
      const p = await service.preview(
        { ...input, emails: [a.email, b.email, c.email].join(',') },
        admin,
        randomUUID(),
      );
      expect(p.counts.PENDING).toBe(1);
      await service.queue(p.id, admin, true);
      await db.campaignMailOptOut.create({ data: { userId: a.id } });
      await service.processPending();
      expect(sendCampaign).not.toHaveBeenCalled();
      expect((await service.detail(p.id)).counts.SKIPPED).toBe(1);
    });
    it('cancellation stops pending deliveries', async () => {
      const u = await user(),
        p = await service.preview(
          { ...input, emails: u.email },
          admin,
          randomUUID(),
        );
      await service.queue(p.id, admin, true);
      await service.cancel(p.id, admin);
      await service.processPending();
      expect(sendCampaign).not.toHaveBeenCalled();
      expect((await service.detail(p.id)).status).toBe('CANCELED');
    });
    it('does not resend ambiguous SMTP failures or interrupted deliveries', async () => {
      const u = await user(),
        p = await service.preview(
          { ...input, emails: u.email },
          admin,
          randomUUID(),
        );
      await service.queue(p.id, admin, true);
      sendCampaign.mockRejectedValue(new Error('邮件服务暂时无法连接'));
      await service.processPending();
      await service.processPending();
      expect(sendCampaign).toHaveBeenCalledTimes(1);
      expect((await service.detail(p.id)).counts.UNKNOWN).toBe(1);
      await db.campaignMailDelivery.updateMany({
        where: { jobId: p.id },
        data: {
          status: 'SENDING',
          startedAt: new Date(Date.now() - 11 * 60000),
        },
      });
      await service.processPending();
      expect(sendCampaign).toHaveBeenCalledTimes(1);
      expect((await service.detail(p.id)).counts.UNKNOWN).toBe(1);
    });
    it('supports signed idempotent unsubscribe and rejects tampering', async () => {
      const u = await user(),
        signature = service.unsubscribeUrl(u.id).split('/').at(-1)!;
      await expect(service.unsubscribe(u.id, '0'.repeat(64))).rejects.toThrow(
        '无效',
      );
      await service.unsubscribe(u.id, signature);
      await service.unsubscribe(u.id, signature);
      expect(
        await db.campaignMailOptOut.count({ where: { userId: u.id } }),
      ).toBe(1);
    });
    it('only selects truly expired users, protecting active/quota-exhausted and pack users', async () => {
      const expired = await user(),
        active = await user(),
        pack = await user(),
        fresh = await user(),
        future = await user();
      await grant(expired.id);
      await grant(active.id);
      await grant(active.id, true);
      await grant(pack.id);
      await grant(pack.id, true, 'TRAFFIC_PACK');
      await grant(future.id);
      await db.entitlementGrant.create({
        data: {
          ...(await grant(future.id)),
          id: undefined,
          startsAt: new Date(Date.now() + 86400000),
          endsAt: new Date(Date.now() + 2 * 86400000),
        },
      });
      const found = await db.user.findMany({
        where: {
          AND: [
            expiredMemberWhere(),
            {
              id: { in: [expired.id, active.id, pack.id, fresh.id, future.id] },
            },
          ],
        },
        select: { id: true },
      });
      expect(found.map((x) => x.id).sort()).toEqual(
        [expired.id, future.id].sort(),
      );
      const p = await service.preview(
        { ...input, audience: 'expired' },
        admin,
        randomUUID(),
      );
      expect(p.recipients.some((x) => x.email === active.email)).toBe(false);
    });
    it('keeps notices disabled by default and rejects invalid names', async () => {
      await db.setting.deleteMany({
        where: { key: 'subscription.expiredNotices' },
      });
      expect((await notices.config()).enabled).toBe(false);
      for (const names of [[], Array(11).fill('x'), ['x', 'x'], ['a\nb']])
        expect(() => normalizeNotices({ enabled: true, names })).toThrow();
    });
    it('returns valid inert YAML only for expired unrevoked tokens and stops after renewal', async () => {
      const u = await user();
      await grant(u.id);
      const token = randomUUID();
      await db.accessToken.create({
        data: { userId: u.id, token, label: 'test' },
      });
      await notices.save(
        { enabled: true, names: ['请续费: [a]', '查看活动 #1'] },
        admin,
      );
      const result = await notices.feed(token);
      const parsed = parse(result!.content) as {
        proxies: { name: string; server: string }[];
        rules: string[];
      };
      expect(parsed.proxies).toHaveLength(2);
      expect(parsed.proxies[0].server).toBe('subscription-expired.invalid');
      expect(parsed.rules).toEqual(['MATCH,REJECT']);
      const provider = await notices.feed(token, 'ai');
      expect(
        (parse(provider!.content) as typeof parsed).proxies[0].name,
      ).toContain('AI · [到期提示]');
      await db.accessToken.update({
        where: { token },
        data: { revokedAt: new Date() },
      });
      expect(await notices.feed(token)).toBeNull();
      await db.accessToken.update({
        where: { token },
        data: { revokedAt: null },
      });
      await grant(u.id, true);
      expect(await notices.feed(token)).toBeNull();
      expect(await notices.feed(randomUUID())).toBeNull();
    });
    it('validates header injection and unregistered arbitrary recipients', async () => {
      expect(() =>
        campaignInput({ ...input, subject: 'a\nb', emails: 'a@example.test' }),
      ).toThrow();
      await expect(
        service.preview(
          { ...input, emails: 'outsider@example.test' },
          admin,
          randomUUID(),
        ),
      ).rejects.toThrow('没有符合条件');
    });
  },
);
