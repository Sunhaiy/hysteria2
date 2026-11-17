import { HysteriaAuthService } from './hysteria-auth.service';
import { HysteriaAuthTelemetryService } from './hysteria-auth-telemetry.service';

describe('HysteriaAuthService', () => {
  let service: HysteriaAuthService;
  let telemetry: HysteriaAuthTelemetryService;
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
  const telemetryDatabase = {
    $executeRaw: jest.fn(),
    accessToken: { update: store.markTokenUsed },
    authEvent: {
      create: ({ data }: { data: unknown }) =>
        store.recordAuthEvent(data) as unknown,
    },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    store.previewToken.mockReturnValue('hy2_li...mary');
    telemetry = new HysteriaAuthTelemetryService({
      $transaction: (work: (tx: unknown) => Promise<unknown>) =>
        work(telemetryDatabase),
    } as never);
    service = new HysteriaAuthService(
      store as never,
      entitlements as never,
      store as never,
      telemetry,
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
    await telemetry.onModuleDestroy();

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

  it('does not reject access when node probes exceed the legacy device limit', async () => {
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
    store.getCurrentOnlineCount.mockResolvedValue(3);
    store.isRecentReconnect.mockResolvedValue(false);
    entitlements.getNodeAccess.mockResolvedValue({
      allowed: true,
      deviceLimit: 1,
    });

    await expect(
      service.authorize({
        nodeId: 'node_hk_core',
        tokenValue: 'hy2_live_lin_primary',
        remoteAddr: '198.51.100.10:44321',
      }),
    ).resolves.toEqual({ ok: true, id: 'usr_lin' });
    await telemetry.onModuleDestroy();
    expect(store.recordAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ granted: true, reason: 'ok' }),
    );
    expect(store.getCurrentOnlineCount).not.toHaveBeenCalled();
    expect(store.isRecentReconnect).not.toHaveBeenCalled();
  });

  it('preserves an allowed decision when optional auth telemetry fails', async () => {
    store.findAccessToken.mockResolvedValue({ id: 'token', userId: 'user' });
    store.getNodeForControl.mockResolvedValue({
      id: 'node',
      active: true,
      protocol: 'hysteria2',
    });
    store.getSessionIdentity.mockResolvedValue({
      id: 'user',
      status: 'active',
    });
    entitlements.getNodeAccess.mockResolvedValue({ allowed: true });
    store.markTokenUsed.mockRejectedValueOnce(
      new Error('telemetry write failed'),
    );
    store.recordAuthEvent.mockRejectedValueOnce(
      new Error('audit write failed'),
    );
    await expect(
      service.authorize({ nodeId: 'node', tokenValue: 'test' }),
    ).resolves.toEqual({ ok: true, id: 'user' });
    await telemetry.onModuleDestroy();
  });

  it('still fails closed when the entitlement lookup fails', async () => {
    store.findAccessToken.mockResolvedValue({ id: 'token', userId: 'user' });
    store.getNodeForControl.mockResolvedValue({
      id: 'node',
      active: true,
      protocol: 'hysteria2',
    });
    store.getSessionIdentity.mockResolvedValue({
      id: 'user',
      status: 'active',
    });
    entitlements.getNodeAccess.mockRejectedValueOnce(
      new Error('entitlement unavailable'),
    );
    await expect(
      service.authorize({ nodeId: 'node', tokenValue: 'test' }),
    ).rejects.toThrow('entitlement unavailable');
    expect(store.markTokenUsed).not.toHaveBeenCalled();
  });

  it('returns an allowed decision without waiting for optional telemetry', async () => {
    store.findAccessToken.mockResolvedValue({ id: 'token', userId: 'user' });
    store.getNodeForControl.mockResolvedValue({
      id: 'node',
      active: true,
      protocol: 'hysteria2',
    });
    store.getSessionIdentity.mockResolvedValue({
      id: 'user',
      status: 'active',
    });
    entitlements.getNodeAccess.mockResolvedValue({ allowed: true });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.markTokenUsed.mockReturnValueOnce(blocked);
    const result = service.authorize({ nodeId: 'node', tokenValue: 'test' });
    try {
      await expect(
        Promise.race([
          result,
          new Promise((resolve) => setTimeout(() => resolve('blocked'), 25)),
        ]),
      ).resolves.toEqual({ ok: true, id: 'user' });
    } finally {
      release();
      await result;
      await telemetry.onModuleDestroy();
    }
  });

  it('keeps decisions responsive and limits optional writes during a reconnect burst', async () => {
    store.findAccessToken.mockResolvedValue({ id: 'token', userId: 'user' });
    store.getNodeForControl.mockResolvedValue({
      id: 'node',
      active: true,
      protocol: 'hysteria2',
    });
    store.getSessionIdentity.mockResolvedValue({
      id: 'user',
      status: 'active',
    });
    entitlements.getNodeAccess.mockResolvedValue({ allowed: true });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.markTokenUsed.mockReturnValue(blocked);
    try {
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          service.authorize({ nodeId: 'node', tokenValue: 'test' }),
        ),
      );
      expect(results).toEqual(
        Array.from({ length: 50 }, () => ({ ok: true, id: 'user' })),
      );
      // This is the database boundary, not a mocked scheduling collaborator.
      expect(store.markTokenUsed).toHaveBeenCalledTimes(2);
    } finally {
      release();
      await telemetry.onModuleDestroy();
    }
  });

  it.each([
    ['token_not_found', null, { active: true }, { allowed: true }],
    [
      'user_not_active',
      { id: 'token', userId: 'user' },
      { active: true },
      { allowed: true },
    ],
    [
      'node_unavailable',
      { id: 'token', userId: 'user' },
      { active: false },
      { allowed: true },
    ],
    [
      'quota_exhausted',
      { id: 'token', userId: 'user' },
      { active: true },
      { allowed: false, reason: 'quota_exhausted' },
    ],
  ])(
    'returns %s without waiting for optional audit storage',
    async (reason, token, node, access) => {
      store.findAccessToken.mockResolvedValue(token);
      store.getNodeForControl.mockResolvedValue({
        id: 'node',
        protocol: 'hysteria2',
        ...node,
      });
      store.getSessionIdentity.mockResolvedValue({
        id: 'user',
        status: reason === 'user_not_active' ? 'disabled' : 'active',
      });
      entitlements.getNodeAccess.mockResolvedValue(access);
      let release!: () => void;
      store.recordAuthEvent.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      try {
        await expect(
          service.authorize({ nodeId: 'node', tokenValue: 'test' }),
        ).resolves.toEqual({ ok: false, reason });
        expect(store.markTokenUsed).not.toHaveBeenCalled();
      } finally {
        release();
        await telemetry.onModuleDestroy();
      }
    },
  );
});
