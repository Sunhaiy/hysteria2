import { NotFoundException } from '@nestjs/common';
import { PortalService } from './portal.service';

describe('PortalService VLESS + REALITY access', () => {
  it('never emits localhost subscription URLs when production public URL configuration is missing', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousPublicUrl = process.env.API_PUBLIC_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.API_PUBLIC_URL;
    const node = {
      id: 'node_vless',
      label: 'HK Reality',
      protocol: 'VLESS_REALITY' as const,
      hostname: '203.0.113.10',
      port: 443,
      sni: 'www.microsoft.com',
      obfsPassword: null,
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: 'reality-public-key',
      realityShortId: '0123456789abcdef',
      realityFingerprint: 'chrome',
      realitySpiderX: '/',
      vlessFlow: 'xtls-rprx-vision',
    };
    const store = {
      getAccessBundle: jest.fn().mockResolvedValue({
        token: {
          token: 'hy2_0123456789abcdef01234567',
          vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
        },
        node,
        nodes: [node],
        subscription: {
          speedUpMbpsSnapshot: 0,
          speedDownMbpsSnapshot: 0,
          endsAt: '2026-09-01T00:00:00.000Z',
        },
        trafficRemaining: 1024,
      }),
    };
    const service = new PortalService(store as never, {} as never, {} as never);

    try {
      await expect(service.getAccess('usr_lin')).rejects.toThrow(
        'API_PUBLIC_URL is required in production',
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousPublicUrl === undefined) delete process.env.API_PUBLIC_URL;
      else process.env.API_PUBLIC_URL = previousPublicUrl;
    }
  });

  it('builds a standard VLESS REALITY URI with the per-user UUID', async () => {
    const node = {
      id: 'node_vless',
      label: 'HK Reality',
      protocol: 'VLESS_REALITY' as const,
      hostname: '203.0.113.10',
      port: 443,
      sni: 'www.microsoft.com',
      obfsPassword: null,
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: 'reality-public-key',
      realityShortId: '0123456789abcdef',
      realityFingerprint: 'chrome',
      realitySpiderX: '/',
      vlessFlow: 'xtls-rprx-vision',
    };
    const store = {
      getAccessBundle: jest.fn().mockResolvedValue({
        token: {
          token: 'hy2_0123456789abcdef01234567',
          vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
        },
        node,
        nodes: [node],
        subscription: {
          speedUpMbpsSnapshot: 0,
          speedDownMbpsSnapshot: 0,
          endsAt: '2026-09-01T00:00:00.000Z',
        },
        trafficRemaining: 1024,
      }),
    };
    const service = new PortalService(store as never, {} as never, {} as never);

    const access = await service.getAccess('usr_lin');
    const uri = new URL(access.uri);

    expect(uri.protocol).toBe('vless:');
    expect(uri.username).toBe('67fbc500-3f3c-4ab9-a076-3e17c56bb3a1');
    expect(uri.searchParams.get('security')).toBe('reality');
    expect(uri.searchParams.get('flow')).toBe('xtls-rprx-vision');
    expect(uri.searchParams.get('pbk')).toBe('reality-public-key');
    expect(uri.searchParams.get('sid')).toBe('0123456789abcdef');
    expect(access.protocol).toBe('vless_reality');
    expect(access.configSnippet).toContain('"security": "reality"');
    expect(access.configSnippet).toContain('"publicKey": "reality-public-key"');
    expect(access.configSnippet).not.toContain('"password"');
    expect(access.subscriptionPath).toBe(
      '/subscribe/hy2_0123456789abcdef01234567',
    );
    expect(access.mihomoSubscriptionPath).toBe(
      '/subscribe/hy2_0123456789abcdef01234567/clash',
    );
  });

  it('adds threshold alerts to the subscription overview', async () => {
    const store = {
      getPortalOverview: jest.fn().mockResolvedValue({
        remainingBytes: 0,
        subscription: {
          includedTrafficBytes: 100,
          bonusTrafficBytes: 0,
          endsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        packs: [],
      }),
    };
    const service = new PortalService(store as never, {} as never, {} as never);

    const overview = await service.getSubscription('usr_lin');

    expect(overview.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'traffic_100' }),
        expect.objectContaining({ id: 'subscription_expiry' }),
      ]),
    );
  });

  it('prefers unified quota over a stale legacy portal total', async () => {
    const store = {
      getPortalOverview: jest
        .fn()
        .mockRejectedValue(
          new NotFoundException('No active access entitlement'),
        ),
      getUsageForUser: jest.fn().mockResolvedValue({
        subscriptionId: null,
        consumedBytes: 0,
        baseRemainingBytes: 0,
        packRemainingBytes: 0,
        totalRemainingBytes: 0,
        recent: [],
      }),
    };
    const entitlements = {
      resolveAccess: jest.fn().mockResolvedValue({
        allowed: true,
        eligibleGrantIds: ['grant_plan'],
        remainingBytes: 100,
        speedUpMbps: 20,
        speedDownMbps: 140,
        deviceLimit: 3,
        nodes: [{ id: 'node_hy2', label: 'US New' }],
      }),
    };
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user_1',
          email: 'user@example.com',
          displayName: 'User',
          role: 'MEMBER',
          status: 'ACTIVE',
          balanceCents: 0,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-26T00:00:00.000Z'),
          onlinePresence: [],
        }),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      entitlementGrant: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'grant_plan',
            kind: 'PLAN',
            productId: 'product_pro',
            product: { name: 'Pro' },
            startsAt: new Date('2026-08-26T00:00:00.000Z'),
            endsAt: new Date('2099-09-01T00:00:00.000Z'),
            createdAt: new Date('2026-08-26T00:00:00.000Z'),
            updatedAt: new Date('2026-08-26T00:00:00.000Z'),
            quotaBuckets: [
              {
                id: 'bucket_plan',
                startsAt: new Date('2026-08-26T00:00:00.000Z'),
                endsAt: new Date('2099-09-01T00:00:00.000Z'),
                grantedBytes: 120n,
                consumedBytes: 20n,
              },
            ],
          },
        ]),
      },
    };
    const service = new PortalService(
      store as never,
      {} as never,
      {} as never,
      entitlements as never,
      prisma as never,
    );

    const overview = await service.getSubscription('user_1');

    expect(overview.remainingBytes).toBe(100);
    expect(overview.subscription.includedTrafficBytes).toBe(120);
    expect(overview.user.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(overview.membership.subscribedDays).toBeGreaterThanOrEqual(8);
    expect(store.getPortalOverview).toHaveBeenCalledWith('user_1', {
      unlinkedOnly: true,
    });

    const usage = await service.getUsage('user_1');
    expect(usage).toMatchObject({
      consumedBytes: 20,
      baseRemainingBytes: 100,
      packRemainingBytes: 0,
      totalRemainingBytes: 100,
    });
  });

  it('merges active V2 entitlements with unlinked legacy quota and access nodes', async () => {
    const v2Node = {
      id: 'node_v2',
      label: 'V2 node',
      protocol: 'HYSTERIA2' as const,
      hostname: '203.0.113.10',
      port: 443,
      sni: 'example.com',
      obfsPassword: null,
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: null,
      realityShortId: null,
      realityFingerprint: null,
      realitySpiderX: null,
      vlessFlow: null,
    };
    const legacyNode = {
      ...v2Node,
      id: 'node_legacy',
      label: 'Legacy node',
      hostname: '203.0.113.11',
    };
    const token = {
      token: 'hy2_mixed_entitlement_token',
      vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
    };
    const store = {
      getPortalOverview: jest.fn().mockResolvedValue({
        user: {
          id: 'user_mixed',
          email: 'mixed@example.com',
          displayName: 'Mixed User',
          role: 'member',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-08-26T00:00:00.000Z',
        },
        subscription: {
          id: 'legacy_pack',
          userId: 'user_mixed',
          planId: 'traffic_pack',
          planName: 'Legacy Pack',
          status: 'active',
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2099-09-01T00:00:00.000Z',
          includedTrafficBytes: 50,
          bonusTrafficBytes: 0,
          consumedTrafficBytes: 0,
          speedUpMbpsSnapshot: 30,
          speedDownMbpsSnapshot: 150,
          deviceLimitSnapshot: 3,
        },
        plan: { id: 'traffic_pack', name: 'Legacy Pack' },
        nodeLabel: legacyNode.label,
        remainingBytes: 50,
        balanceCents: 0,
        online: 0,
        packs: [
          {
            id: 'legacy_pack',
            label: 'Legacy Pack',
            totalBytes: 50,
            remainingBytes: 50,
            status: 'active',
            expiresAt: '2099-09-01T00:00:00.000Z',
          },
        ],
      }),
      getUsageForUser: jest.fn().mockResolvedValue({
        subscriptionId: null,
        consumedBytes: 0,
        baseRemainingBytes: 0,
        packRemainingBytes: 50,
        totalRemainingBytes: 50,
        recent: [],
      }),
      getAccessBundle: jest.fn().mockResolvedValue({
        token,
        node: legacyNode,
        nodes: [legacyNode],
        subscription: {
          speedUpMbpsSnapshot: 30,
          speedDownMbpsSnapshot: 150,
          deviceLimitSnapshot: 3,
          consumedTrafficBytes: 0,
          endsAt: '2099-09-01T00:00:00.000Z',
        },
        trafficRemaining: 50,
      }),
    };
    const entitlements = {
      resolveAccess: jest.fn().mockResolvedValue({
        allowed: true,
        eligibleGrantIds: ['grant_plan'],
        remainingBytes: 100,
        consumedBytes: 20,
        speedUpMbps: 20,
        speedDownMbps: 140,
        deviceLimit: 3,
        nodes: [{ id: v2Node.id, label: v2Node.label }],
        grants: [
          {
            id: 'grant_plan',
            kind: 'plan',
            endsAt: '2099-09-01T00:00:00.000Z',
          },
        ],
      }),
    };
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user_mixed',
          email: 'mixed@example.com',
          displayName: 'Mixed User',
          role: 'MEMBER',
          status: 'ACTIVE',
          balanceCents: 0,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-26T00:00:00.000Z'),
          onlinePresence: [],
        }),
      },
      subscription: { findMany: jest.fn().mockResolvedValue([]) },
      entitlementGrant: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'grant_plan',
            kind: 'PLAN',
            productId: 'product_pro',
            legacySubscriptionId: 'linked_subscription',
            product: { name: 'Pro' },
            startsAt: new Date('2026-08-26T00:00:00.000Z'),
            endsAt: new Date('2099-09-01T00:00:00.000Z'),
            createdAt: new Date('2026-08-26T00:00:00.000Z'),
            updatedAt: new Date('2026-08-26T00:00:00.000Z'),
            quotaBuckets: [
              {
                id: 'bucket_plan',
                startsAt: new Date('2026-08-26T00:00:00.000Z'),
                endsAt: new Date('2099-09-01T00:00:00.000Z'),
                grantedBytes: 120n,
                consumedBytes: 20n,
              },
            ],
          },
        ]),
      },
      accessToken: { findFirst: jest.fn().mockResolvedValue(token) },
      node: { findMany: jest.fn().mockResolvedValue([v2Node]) },
    };
    const service = new PortalService(
      store as never,
      {} as never,
      {} as never,
      entitlements as never,
      prisma as never,
    );

    await expect(service.getSubscription('user_mixed')).resolves.toMatchObject({
      remainingBytes: 150,
      packs: [expect.objectContaining({ id: 'legacy_pack' })],
    });
    await expect(service.getUsage('user_mixed')).resolves.toMatchObject({
      consumedBytes: 20,
      baseRemainingBytes: 100,
      packRemainingBytes: 50,
      totalRemainingBytes: 150,
    });
    await expect(service.getAccess('user_mixed')).resolves.toMatchObject({
      trafficRemaining: 150,
      nodes: [
        expect.objectContaining({ id: 'node_v2' }),
        expect.objectContaining({ id: 'node_legacy' }),
      ],
    });
  });

  it('does not present a plan-dependent pack after the plan expires', async () => {
    const packGrant = {
      id: 'grant_pack',
      kind: 'TRAFFIC_PACK',
      productId: 'product_pack',
      product: { name: 'Legacy add-on', requiresActivePlan: true },
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2027-08-01T00:00:00.000Z'),
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      quotaBuckets: [
        {
          id: 'bucket_pack',
          startsAt: new Date('2026-08-01T00:00:00.000Z'),
          endsAt: new Date('2027-08-01T00:00:00.000Z'),
          grantedBytes: 100n,
          consumedBytes: 0n,
        },
      ],
    };
    const entitlements = {
      resolveAccess: jest.fn().mockResolvedValue({
        allowed: false,
        reason: 'traffic_exhausted',
        nodes: [],
        eligibleGrantIds: [],
      }),
    };
    const prisma = {
      entitlementGrant: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([packGrant]),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'user_1',
          email: 'user@example.com',
          displayName: 'User',
          role: 'MEMBER',
          status: 'ACTIVE',
          balanceCents: 0,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-26T00:00:00.000Z'),
          onlinePresence: [],
        }),
      },
    };
    const service = new PortalService(
      {
        getPortalOverview: jest
          .fn()
          .mockRejectedValue(
            new NotFoundException('No active access entitlement'),
          ),
        getUsageForUser: jest.fn().mockResolvedValue({
          subscriptionId: null,
          consumedBytes: 0,
          baseRemainingBytes: 0,
          packRemainingBytes: 0,
          totalRemainingBytes: 0,
          recent: [],
        }),
      } as never,
      {} as never,
      {} as never,
      entitlements as never,
      prisma as never,
    );

    await expect(service.getSubscription('user_1')).rejects.toThrow(
      'No active access entitlement',
    );
    await expect(service.getUsage('user_1')).resolves.toMatchObject({
      consumedBytes: 0,
      baseRemainingBytes: 0,
      packRemainingBytes: 0,
      totalRemainingBytes: 0,
    });
  });

  it('serves a stored compatibility token through the Mihomo subscription', async () => {
    const token = {
      token: 'hy2_live_lin_primary',
      userId: 'usr_lin',
      revokedAt: null,
      vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
    };
    const node = {
      id: 'node_hy2',
      label: 'HK Core',
      protocol: 'HYSTERIA2' as const,
      hostname: '203.0.113.10',
      port: 443,
      sni: 'example.com',
      obfsPassword: null,
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: null,
      realityShortId: null,
      realityFingerprint: null,
      realitySpiderX: null,
      vlessFlow: null,
    };
    const settings = {
      getSiteInfo: jest.fn().mockResolvedValue({ name: 'Test service' }),
    };
    const entitlements = {
      resolveAccess: jest.fn().mockResolvedValue({
        allowed: true,
        nodes: [{ id: node.id, label: node.label }],
        eligibleGrantIds: ['grant_plan'],
        grants: [{ endsAt: '2026-09-01T00:00:00.000Z' }],
        totalBytes: 1280,
        consumedBytes: 256,
        remainingBytes: 1024,
        speedUpMbps: 20,
        speedDownMbps: 120,
        deviceLimit: 3,
      }),
    };
    const prisma = {
      accessToken: { findUnique: jest.fn().mockResolvedValue(token) },
      entitlementGrant: { count: jest.fn().mockResolvedValue(1) },
      node: { findMany: jest.fn().mockResolvedValue([node]) },
    };
    const service = new PortalService(
      {
        getAccessBundle: jest
          .fn()
          .mockRejectedValue(
            new NotFoundException('No active access entitlement'),
          ),
      } as never,
      settings as never,
      {} as never,
      entitlements as never,
      prisma as never,
    );

    const subscription = await service.getMihomoSubscription(token.token);

    expect(subscription.content).toContain('type: hysteria2');
    expect(subscription.nodeCount).toBe(1);
    expect(subscription.consumedBytes).toBe(256);
    expect(subscription.totalBytes).toBe(1280);
  });

  it('keeps a subscription usable through a permanent pack after its plan expires', async () => {
    const token = {
      token: 'hy2_permanent_pack_token',
      userId: 'usr_pack',
      revokedAt: null,
      vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
    };
    const node = {
      id: 'node_hy2',
      label: 'HK Core',
      protocol: 'HYSTERIA2' as const,
      hostname: '203.0.113.10',
      port: 443,
      sni: 'example.com',
      obfsPassword: null,
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: null,
      realityShortId: null,
      realityFingerprint: null,
      realitySpiderX: null,
      vlessFlow: null,
    };
    const entitlements = {
      resolveAccess: jest.fn().mockResolvedValue({
        allowed: true,
        nodes: [{ id: node.id, label: node.label }],
        eligibleGrantIds: ['grant_plan', 'grant_pack'],
        grants: [
          {
            kind: 'plan',
            endsAt: '2026-09-05T00:00:00.000Z',
          },
          {
            kind: 'traffic_pack',
            endsAt: '9999-12-31T23:59:59.999Z',
          },
        ],
        totalBytes: 1280,
        consumedBytes: 256,
        remainingBytes: 1024,
        speedUpMbps: 20,
        speedDownMbps: 120,
        deviceLimit: 1000,
      }),
    };
    const prisma = {
      accessToken: { findUnique: jest.fn().mockResolvedValue(token) },
      entitlementGrant: { count: jest.fn().mockResolvedValue(2) },
      node: { findMany: jest.fn().mockResolvedValue([node]) },
    };
    const service = new PortalService(
      {
        getAccessBundle: jest
          .fn()
          .mockRejectedValue(
            new NotFoundException('No active access entitlement'),
          ),
      } as never,
      {
        getSiteInfo: jest.fn().mockResolvedValue({ name: 'Test service' }),
      } as never,
      {} as never,
      entitlements as never,
      prisma as never,
    );

    const subscription = await service.getMihomoSubscription(token.token);

    expect(subscription.expiresAt).toBe(
      new Date('9999-12-31T23:59:59.999Z').getTime(),
    );
  });

  it('adds a v2rayN mport and native client hopping config when enabled', async () => {
    const node = {
      id: 'node_hy2_hopping',
      label: 'US Hopping',
      protocol: 'HYSTERIA2' as const,
      hostname: '203.0.113.20',
      port: 59620,
      portHoppingEnabled: true,
      portHoppingStart: 20000,
      portHoppingEnd: 29999,
      portHoppingIntervalSeconds: 30,
      sni: 'www.bing.com',
      obfsPassword: 'obfs-secret',
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: null,
      realityShortId: null,
      realityFingerprint: null,
      realitySpiderX: null,
      vlessFlow: null,
    };
    const store = {
      getAccessBundle: jest.fn().mockResolvedValue({
        token: {
          token: 'hy2_0123456789abcdef01234567',
          vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
        },
        node,
        nodes: [node],
        subscription: {
          speedUpMbpsSnapshot: 0,
          speedDownMbpsSnapshot: 0,
          endsAt: '2026-09-01T00:00:00.000Z',
        },
        trafficRemaining: 1024,
      }),
    };
    const service = new PortalService(store as never, {} as never, {} as never);

    const access = await service.getAccess('usr_lin');
    const uri = new URL(access.uri);

    expect(uri.searchParams.get('mport')).toBe('20000-29999');
    expect(access.configSnippet).toContain(
      'server: 203.0.113.20:59620,20000-29999',
    );
    expect(access.configSnippet).toContain('hopInterval: 30s');
  });
});
