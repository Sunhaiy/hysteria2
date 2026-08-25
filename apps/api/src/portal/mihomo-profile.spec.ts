import { parse } from 'yaml';
import { buildMihomoProfile, type MihomoNode } from './mihomo-profile';

type ParsedMihomoProfile = {
  proxies: Array<Record<string, unknown> & { name: string }>;
  'proxy-groups': Array<{
    name: string;
    type: string;
    proxies: string[];
  }>;
  rules: string[];
};

function parseProfile(source: string) {
  const parsed: unknown = parse(source);
  return parsed as ParsedMihomoProfile;
}

describe('buildMihomoProfile', () => {
  const credential = {
    token: 'test-subscription-token',
    vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
  };
  const nodes: MihomoNode[] = [
    {
      label: 'US Primary',
      protocol: 'VLESS_REALITY',
      hostname: '198.51.100.10',
      port: 59630,
      sni: 'www.cloudflare.com',
      obfsPassword: null,
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: 'public-key',
      realityShortId: '68a2221454f5abdf',
      realityFingerprint: 'chrome',
      vlessFlow: 'xtls-rprx-vision',
    },
    {
      label: 'US Secondary',
      protocol: 'HYSTERIA2',
      hostname: '203.0.113.20',
      port: 5401,
      sni: 'example.com',
      obfsPassword: 'obfs-secret',
      pinSHA256: null,
      allowInsecureTls: false,
      realityPublicKey: null,
      realityShortId: null,
      realityFingerprint: null,
      vlessFlow: null,
    },
  ];

  it('emits Mihomo-compatible Hysteria 2 and VLESS REALITY proxies', () => {
    const profile = parseProfile(buildMihomoProfile(credential, nodes));

    expect(profile.proxies).toHaveLength(2);
    expect(profile.proxies[0]).toMatchObject({
      type: 'vless',
      server: '198.51.100.10',
      port: 59630,
      uuid: credential.vlessUuid,
      flow: 'xtls-rprx-vision',
      servername: 'www.cloudflare.com',
      'client-fingerprint': 'chrome',
      'reality-opts': {
        'public-key': 'public-key',
        'short-id': '68a2221454f5abdf',
      },
    });
    expect(profile.proxies[1]).toMatchObject({
      type: 'hysteria2',
      password: credential.token,
      obfs: 'salamander',
      'obfs-password': 'obfs-secret',
    });
  });

  it('uses ordered automatic failover as the default selector', () => {
    const profile = parseProfile(buildMihomoProfile(credential, nodes));
    const failover = profile['proxy-groups'][0];
    const selector = profile['proxy-groups'][2];

    expect(failover.type).toBe('fallback');
    expect(failover.proxies).toEqual(
      profile.proxies.map((proxy) => proxy.name),
    );
    expect(selector.proxies[0]).toBe('自动故障转移');
    expect(profile.rules).toEqual(['MATCH,节点选择']);
  });

  it('rejects incomplete VLESS REALITY endpoints', () => {
    expect(() =>
      buildMihomoProfile(credential, [{ ...nodes[0], realityPublicKey: null }]),
    ).toThrow('VLESS REALITY node US Primary is incomplete');
  });
});
