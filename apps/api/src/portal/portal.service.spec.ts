import { PortalService } from './portal.service';

describe('PortalService VLESS + REALITY access', () => {
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
    const service = new PortalService(store as never, {} as never);

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
  });
});
