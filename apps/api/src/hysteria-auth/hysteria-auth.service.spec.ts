import { HysteriaAuthService } from './hysteria-auth.service';

describe('HysteriaAuthService', () => {
  let service: HysteriaAuthService;
  const store = {
    findAccessToken: jest.fn(),
    getNodeForControl: jest.fn(),
    getSessionIdentity: jest.fn(),
    getCurrentOnlineCount: jest.fn(),
    isRecentReconnect: jest.fn(),
    markTokenUsed: jest.fn(),
    recordAuthEvent: jest.fn(),
    previewToken: jest.fn(() => 'hy2_li...mary'),
  };
  const entitlements = { getNodeAccess: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HysteriaAuthService(
      store as never,
      entitlements as never,
      store as never,
      { countForUser: store.getCurrentOnlineCount } as never,
    );
  });

  it('delegates Hysteria HTTP auth payloads to the control plane service', async () => {
    store.findAccessToken.mockResolvedValue({
      id: 'token_1',
      userId: 'usr_lin',
    });
    store.getNodeForControl.mockResolvedValue({
      id: 'node_hk_core',
      active: true,
      protocol: 'hysteria2',
    });
    store.getSessionIdentity.mockResolvedValue({
      id: 'usr_lin',
      status: 'active',
    });
    store.getCurrentOnlineCount.mockResolvedValue(0);
    store.isRecentReconnect.mockResolvedValue(false);
    entitlements.getNodeAccess.mockResolvedValue({
      allowed: true,
      deviceLimit: 2,
    });

    const payload = {
      nodeId: 'node_hk_core',
      tokenValue: 'hy2_live_lin_primary',
      remoteAddr: '198.51.100.10:44321',
      requestedTxBps: 5_000_000,
    };
    const result = await service.authorize(payload);

    expect(result).toEqual({
      ok: true,
      id: 'usr_lin',
    });
    expect(entitlements.getNodeAccess).toHaveBeenCalledWith(
      'usr_lin',
      'node_hk_core',
    );
    expect(store.recordAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ granted: true, reason: 'ok' }),
    );
  });
});
