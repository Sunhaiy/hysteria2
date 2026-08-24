import { SubscriptionFeedController } from './subscription-feed.controller';

describe('SubscriptionFeedController', () => {
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
        'X-Subscription-Node-Count': '4',
      }),
    );
  });
});
