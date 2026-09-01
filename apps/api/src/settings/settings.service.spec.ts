import { SettingsService } from './settings.service';

describe('SettingsService cache', () => {
  const originalReconciliationEnabled = process.env.EPAY_RECONCILIATION_ENABLED;

  afterEach(() => {
    if (originalReconciliationEnabled === undefined) {
      delete process.env.EPAY_RECONCILIATION_ENABLED;
    } else {
      process.env.EPAY_RECONCILIATION_ENABLED = originalReconciliationEnabled;
    }
  });
  it('caches the full settings map in the shared cache', async () => {
    let cached: string | null = null;
    const prisma = {
      setting: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ key: 'site.name', value: 'Control Plane' }]),
      },
    };
    const cache = {
      get: jest.fn().mockImplementation(() => Promise.resolve(cached)),
      set: jest.fn().mockImplementation((_key: string, value: string) => {
        cached = value;
        return Promise.resolve();
      }),
      del: jest.fn(),
    };
    const cipher = { encrypt: jest.fn((value: string) => value) };
    const first = new SettingsService(
      prisma as never,
      cipher as never,
      cache as never,
    );
    const second = new SettingsService(
      prisma as never,
      cipher as never,
      cache as never,
    );

    await expect(first.get('site.name')).resolves.toBe('Control Plane');
    await expect(second.get('site.name')).resolves.toBe('Control Plane');

    expect(prisma.setting.findMany).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'settings:all:v1',
      JSON.stringify({ 'site.name': 'Control Plane' }),
      300,
    );
  });

  it('invalidates settings and published tutorials after tutorial settings change', async () => {
    const prisma = {
      setting: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    const cache = { del: jest.fn().mockResolvedValue(undefined) };
    const cipher = { encrypt: jest.fn((value: string) => value) };
    const service = new SettingsService(
      prisma as never,
      cipher as never,
      cache as never,
    );

    await service.setMany({ 'tutorial.windows.asset': '{"id":"asset"}' });

    expect(cache.del).toHaveBeenCalledWith('settings:all:v1');
    expect(cache.del).toHaveBeenCalledWith('tutorials:published:v2');
  });

  it('does not present the legacy redemption route as a shop URL', async () => {
    const prisma = {
      setting: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { key: 'portal.cdkButtonUrl', value: '/portal/redeem' },
          ]),
      },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SettingsService(
      prisma as never,
      {} as never,
      cache as never,
    );

    await expect(service.getPortalBranding()).resolves.toMatchObject({
      cdkButtonUrl: '',
      purchaseNotice: {
        enabled: false,
        title: '买前须知',
        content: '',
      },
    });
  });

  it('returns a validated interface font weight with the public site info', async () => {
    const prisma = {
      setting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'site.name', value: 'Control Plane' },
          { key: 'site.fontWeight', value: '550' },
        ]),
      },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SettingsService(
      prisma as never,
      {} as never,
      cache as never,
    );

    await expect(service.getSiteInfo()).resolves.toMatchObject({
      name: 'Control Plane',
      fontWeight: 550,
    });
  });

  it('falls back to the standard font weight for unsupported stored values', async () => {
    const prisma = {
      setting: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ key: 'site.fontWeight', value: '725' }]),
      },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SettingsService(
      prisma as never,
      {} as never,
      cache as never,
    );

    await expect(service.getSiteInfo()).resolves.toMatchObject({
      fontWeight: 400,
    });
  });

  it('returns the configured purchase notice with the portal branding', async () => {
    const prisma = {
      setting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'portal.purchaseNotice.enabled', value: 'true' },
          { key: 'portal.purchaseNotice.title', value: '下单前请确认' },
          {
            key: 'portal.purchaseNotice.content',
            value: '套餐流量按月重置。\n请确认购买周期。',
          },
        ]),
      },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SettingsService(
      prisma as never,
      {} as never,
      cache as never,
    );

    await expect(service.getPortalBranding()).resolves.toMatchObject({
      purchaseNotice: {
        enabled: true,
        title: '下单前请确认',
        content: '套餐流量按月重置。\n请确认购买周期。',
      },
    });
  });

  it('keeps store checkout as the safe default and requires complete 易支付 credentials', async () => {
    process.env.EPAY_RECONCILIATION_ENABLED = 'true';
    const prisma = {
      setting: { findMany: jest.fn().mockResolvedValue([]) },
      epayGatewayTestAttempt: {
        findFirst: jest.fn().mockResolvedValue({ id: 'test_1' }),
      },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const cipher = {
      encrypt: jest.fn((value: string) => value),
      decrypt: jest.fn((value: string) => value),
    };
    const service = new SettingsService(
      prisma as never,
      cipher as never,
      cache as never,
    );

    await expect(service.getEpayConfig()).resolves.toMatchObject({
      checkoutMode: 'store',
      configured: false,
    });
    await expect(
      service.prepareEpaySettingsUpdate({ checkoutMode: 'epay' }),
    ).rejects.toThrow('启用易支付前请完整填写');
    await expect(
      service.prepareEpaySettingsUpdate({
        checkoutMode: 'epay',
        epayGatewayUrl: 'https://pay.example.com',
        epayMerchantId: '1001',
        epayMerchantKey: 'secret',
        epayPaymentType: 'wxpay',
      }),
    ).resolves.toEqual({
      'payment.checkoutMode': 'epay',
      'epay.gatewayUrl': 'https://pay.example.com',
      'epay.merchantId': '1001',
      'epay.merchantKey': 'secret',
      'epay.paymentType': 'wxpay',
    });
  });

  it('blocks enabling 易支付 until the current credentials pass a gateway test', async () => {
    process.env.EPAY_RECONCILIATION_ENABLED = 'true';
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      setting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'epay.gatewayUrl', value: 'https://pay.example.com' },
          { key: 'epay.merchantId', value: '1001' },
          { key: 'epay.merchantKey', value: 'secret' },
          { key: 'epay.paymentType', value: 'alipay' },
        ]),
      },
      epayGatewayTestAttempt: { findFirst },
    };
    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const cipher = {
      encrypt: jest.fn((value: string) => value),
      decrypt: jest.fn((value: string) => value),
    };
    const service = new SettingsService(
      prisma as never,
      cipher as never,
      cache as never,
    );

    await expect(
      service.prepareEpaySettingsUpdate({ checkoutMode: 'epay' }),
    ).rejects.toThrow('请先分别完成支付宝和微信');

    findFirst
      .mockResolvedValueOnce({ id: 'alipay_test' })
      .mockResolvedValueOnce(null);
    await expect(
      service.prepareEpaySettingsUpdate({ checkoutMode: 'epay' }),
    ).rejects.toThrow('请先分别完成支付宝和微信');

    findFirst.mockResolvedValue({ id: 'test_1' });
    await expect(
      service.prepareEpaySettingsUpdate({ checkoutMode: 'epay' }),
    ).resolves.toMatchObject({ 'payment.checkoutMode': 'epay' });
  });

  it('blocks activation until merchant active-query reconciliation is ready', async () => {
    delete process.env.EPAY_RECONCILIATION_ENABLED;
    const prisma = {
      setting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'epay.gatewayUrl', value: 'https://pay.example.com' },
          { key: 'epay.merchantId', value: '1001' },
          { key: 'epay.merchantKey', value: 'secret' },
        ]),
      },
      epayGatewayTestAttempt: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tested' }),
      },
    };
    const service = new SettingsService(
      prisma as never,
      {
        encrypt: jest.fn((value: string) => value),
        decrypt: jest.fn((value: string) => value),
      } as never,
      {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    await expect(
      service.prepareEpaySettingsUpdate({ checkoutMode: 'epay' }),
    ).rejects.toThrow('主动查单尚未配置');
  });

  it('returns an enabled announcement once per login session', async () => {
    const acknowledgements = new Map<string, string>();
    const prisma = {
      setting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'announcement.enabled', value: 'true' },
          { key: 'announcement.title', value: '线路维护' },
          { key: 'announcement.content', value: '今晚 23:00 进行维护。' },
        ]),
      },
    };
    const cache = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(acknowledgements.get(key) ?? null),
        ),
      set: jest.fn().mockImplementation((key: string, value: string) => {
        acknowledgements.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SettingsService(
      prisma as never,
      {} as never,
      cache as never,
    );

    const first = await service.getPendingAnnouncement('session_1');
    expect(first?.title).toBe('线路维护');
    expect(first?.content).toBe('今晚 23:00 进行维护。');
    expect(first?.version).toMatch(/^[a-f0-9]{64}$/);

    await service.acknowledgeAnnouncement('session_1', first!.version);

    await expect(
      service.getPendingAnnouncement('session_1'),
    ).resolves.toBeNull();
    await expect(
      service.getPendingAnnouncement('session_2'),
    ).resolves.toMatchObject({ title: '线路维护' });
    await expect(service.getPublishedAnnouncement()).resolves.toMatchObject({
      title: '线路维护',
      content: '今晚 23:00 进行维护。',
    });
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringContaining('announcement:ack:session_1:'),
      '1',
      12 * 60 * 60,
    );
  });
});
