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
      getPortalOverview: jest.fn().mockResolvedValue({
        remainingBytes: 250,
        subscription: {
          includedTrafficBytes: 200,
          bonusTrafficBytes: 0,
          endsAt: '2099-09-01T00:00:00.000Z',
        },
        packs: [{ remainingBytes: 50 }],
      }),
      getUsageForUser: jest.fn().mockResolvedValue({
        subscriptionId: 'legacy_subscription',
        consumedBytes: 0,
        baseRemainingBytes: 200,
        packRemainingBytes: 50,
        totalRemainingBytes: 250,
        recent: [],
      }),
    };
    const entitlements = {
      resolveAccess: jest.fn().mockResolvedValue({
        allowed: true,
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
          onlinePresence: [],
        }),
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
            quotaBuckets: [{ grantedBytes: 120n, consumedBytes: 20n }],
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
    expect(store.getPortalOverview).not.toHaveBeenCalled();

    const usage = await service.getUsage('user_1');
    expect(usage).toMatchObject({
      consumedBytes: 20,
      baseRemainingBytes: 100,
      packRemainingBytes: 0,
      totalRemainingBytes: 100,
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
        grants: [{ endsAt: '2026-09-01T00:00:00.000Z' }],
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
      {} as never,
      settings as never,
      {} as never,
      entitlements as never,
      prisma as never,
    );

    const subscription = await service.getMihomoSubscription(token.token);

    expect(subscription.content).toContain('type: hysteria2');
    expect(subscription.nodeCount).toBe(1);
  });
});
