import { SettingsService } from './settings.service';

describe('SettingsService cache', () => {
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
    });
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
