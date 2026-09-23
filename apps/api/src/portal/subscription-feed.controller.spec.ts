import { SubscriptionFeedController } from './subscription-feed.controller';
import { webPublicUrl } from '../common/public-url';

describe('SubscriptionFeedController', () => {
  it('validates provider scopes and subscription modes and prevents shared caching', async () => {
    const service = {
      getMihomoProvider: jest.fn().mockResolvedValue('proxies: []'),
      getMihomoSubscription: jest
        .fn()
        .mockResolvedValue({ content: 'inline', title: 'Test', expiresAt: 0 }),
    };
    const controller = new SubscriptionFeedController(service as never);
    const response = { set: jest.fn() };
    await expect(
      controller.getMihomoProvider('token', response as never, 'bad'),
    ).rejects.toThrow('节点分组无效');
    expect(service.getMihomoProvider).not.toHaveBeenCalled();
    await controller.getMihomoProvider('token', response as never, 'ai');
    expect(service.getMihomoProvider).toHaveBeenCalledWith('token', 'ai');
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Cache-Control': 'private, no-store, max-age=0',
      }),
    );
    await expect(
      controller.getMihomoSubscription(
        'token',
        response as never,
        undefined,
        'bad',
      ),
    ).rejects.toThrow('订阅模式无效');
    await controller.getMihomoSubscription(
      'token',
      response as never,
      undefined,
      'inline',
    );
    expect(service.getMihomoSubscription).toHaveBeenCalledWith(
      'token',
      'inline',
    );
  });
  it('brands only versioned import links and exposes the login page', async () => {
    const feed = {
      content: 'proxies: []',
      title: 'Legacy title',
      expiresAt: 0,
      consumedBytes: 0,
      totalBytes: 100,
      nodeCount: 0,
    };
    const controller = new SubscriptionFeedController({
      getMihomoSubscription: jest.fn().mockResolvedValue(feed),
    } as never);
    const response = { set: jest.fn() };
    await controller.getMihomoSubscription('token', response as never, '2');
    expect(response.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent('素心 Network')}`,
        'Profile-Title': `base64:${Buffer.from('素心 Network').toString('base64')}`,
        'Profile-Web-Page-Url': `${webPublicUrl()}/login`,
      }),
    );
    await controller.getMihomoSubscription('token', response as never);
    expect(response.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        'Content-Disposition': 'inline; filename="mihomo.yaml"',
        'Profile-Title': `base64:${Buffer.from('Legacy title').toString('base64')}`,
      }),
    );
  });

  it('serves an unencoded Mihomo profile with subscription metadata', async () => {
    const portalService = {
      getMihomoSubscription: jest.fn().mockResolvedValue({
        content: 'proxies:\n  - name: US Primary\n',
        title: 'Control Plane',
        expiresAt: Date.UTC(2026, 8, 1),
        consumedBytes: 128,
        totalBytes: 1024,
        nodeCount: 4,
      }),
    };
    const response = { set: jest.fn() };
    const controller = new SubscriptionFeedController(portalService as never);

    const content = await controller.getMihomoSubscription(
      'hy2_0123456789abcdef01234567',
      response as never,
    );

    expect(content).toBe('proxies:\n  - name: US Primary\n');
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'text/yaml; charset=utf-8',
        'Content-Disposition': 'inline; filename="mihomo.yaml"',
        'Subscription-Userinfo':
          'upload=0; download=128; total=1024; expire=1788220800',
        'X-Subscription-Node-Count': '4',
      }),
    );
  });
});
