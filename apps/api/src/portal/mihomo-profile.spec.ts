import { parse } from 'yaml';
import {
  buildMihomoProfile,
  buildMihomoProvider,
  type MihomoNode,
} from './mihomo-profile';

type ParsedMihomoProfile = {
  proxies: Array<Record<string, unknown> & { name: string }>;
  'proxy-groups': Array<{
    name: string;
    type: string;
    proxies: string[];
  }>;
  rules: string[];
  'rule-providers': Record<
    string,
    {
      type: string;
      format: string;
      behavior: string;
      interval: number;
      path: string;
      url: string;
      proxy: string;
    }
  >;
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
      region: 'US',
      tags: ['ai-ready'],
    },
    {
      label: 'Japan Secondary',
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
      region: 'JP',
      tags: ['ai-ready'],
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
      'client-fingerprint': 'chrome',
      obfs: 'salamander',
      'obfs-password': 'obfs-secret',
    });
    expect(profile.proxies.every((proxy) => !('fingerprint' in proxy))).toBe(
      true,
    );
  });

  it('uses configured icons in names and keeps all selector references valid', () => {
    const profile = parseProfile(
      buildMihomoProfile(
        credential,
        nodes.map((node) => ({ ...node, icon: '🇺🇸' })),
      ),
    );
    expect(profile.proxies.every((proxy) => proxy.name.startsWith('🇺🇸 '))).toBe(
      true,
    );
    const names = new Set([
      'DIRECT',
      'REJECT',
      ...profile.proxies.map((proxy) => proxy.name),
      ...profile['proxy-groups'].map((group) => group.name),
    ]);
    for (const group of profile['proxy-groups']) {
      expect(group.proxies.every((name) => names.has(name))).toBe(true);
    }
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
    expect(selector.proxies).toContain('DIRECT');
    expect(profile.rules.at(-1)).toBe('MATCH,节点选择');
  });

  it('routes private and Chinese traffic directly while keeping overseas traffic automatic', () => {
    const profile = parseProfile(buildMihomoProfile(credential, nodes));

    expect(profile.rules).toEqual(
      expect.arrayContaining([
        'RULE-SET,private,DIRECT',
        'IP-CIDR,10.0.0.0/8,DIRECT',
        'RULE-SET,cn,DIRECT',
        'RULE-SET,cn-ip,DIRECT,no-resolve',
        'MATCH,节点选择',
      ]),
    );
    expect(profile.rules.indexOf('RULE-SET,cn,DIRECT')).toBeLessThan(
      profile.rules.indexOf('MATCH,节点选择'),
    );
  });

  it.each([
    'IP-CIDR,127.0.0.0/8',
    'IP-CIDR,10.0.0.0/8',
    'IP-CIDR,172.16.0.0/12',
    'IP-CIDR,192.168.0.0/16',
    'IP-CIDR,169.254.0.0/16',
    'IP-CIDR6,::1/128',
    'IP-CIDR6,fc00::/7',
    'IP-CIDR6,fe80::/10',
  ])('resolves private-domain targets before overseas routing: %s', (cidr) => {
    const profile = parseProfile(buildMihomoProfile(credential, nodes));
    const index = profile.rules.indexOf(`${cidr},DIRECT`);
    expect(index).toBeGreaterThan(-1);
    expect(index).toBeLessThan(
      profile.rules.indexOf('DOMAIN-SUFFIX,chatgpt.com,AI 服务'),
    );
    expect(profile.rules).not.toContain(`${cidr},DIRECT,no-resolve`);
    // The client retains its system/company DNS and any split-DNS overrides.
    expect(profile).not.toHaveProperty('dns');
  });

  it('uses upstream MRS providers with persistent daily caching and a bootstrap proxy', () => {
    const profile = parseProfile(buildMihomoProfile(credential, nodes));
    const providers = profile['rule-providers'];
    expect(Object.keys(providers)).toHaveLength(9);
    expect(providers['cn-ip'].behavior).toBe('ipcidr');
    for (const [name, provider] of Object.entries(providers)) {
      expect(provider).toMatchObject({
        type: 'http',
        format: 'mrs',
        interval: 86400,
        proxy: '节点选择',
      });
      expect(provider.url).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/MetaCubeX\/meta-rules-dat\/meta\/geo\//,
      );
      expect(provider.path).toBe(`./rule-providers/suxin-meta-${name}.mrs`);
      expect(
        profile.rules.some((rule) => rule.startsWith(`RULE-SET,${name},`)),
      ).toBe(true);
    }
    // No hidden dependency on the client's default geo database source.
    expect(profile.rules.some((rule) => /^(GEOSITE|GEOIP),/.test(rule))).toBe(
      false,
    );
  });

  it('prioritizes AI and media over regional rules and references only authorized proxies', () => {
    const profile = parseProfile(buildMihomoProfile(credential, nodes));
    const destinations = new Set([
      'DIRECT',
      'REJECT',
      ...profile.proxies.map((proxy) => proxy.name),
      ...profile['proxy-groups'].map((group) => group.name),
    ]);
    for (const rule of profile.rules) {
      const parts = rule.split(',');
      expect(destinations.has(parts[0] === 'MATCH' ? parts[1] : parts[2])).toBe(
        true,
      );
    }
    for (const group of profile['proxy-groups']) {
      for (const proxy of group.proxies)
        expect(destinations.has(proxy)).toBe(true);
    }
    for (const rule of [
      'RULE-SET,ai,AI 服务',
      'RULE-SET,youtube,流媒体',
      'RULE-SET,telegram,Telegram',
      'RULE-SET,overseas,节点选择',
    ]) {
      expect(profile.rules.indexOf(rule)).toBeGreaterThan(-1);
      expect(profile.rules.indexOf(rule)).toBeLessThan(
        profile.rules.indexOf('RULE-SET,cn,DIRECT'),
      );
    }
  });

  it('uses only authorized US nodes for the AI service group', () => {
    const profile = parseProfile(buildMihomoProfile(credential, nodes));
    const usProxy = profile.proxies[0].name;
    const japanProxy = profile.proxies[1].name;
    const aiAutomatic = profile['proxy-groups'].find(
      (group) => group.name === 'AI 自动优选',
    );
    const aiSelector = profile['proxy-groups'].find(
      (group) => group.name === 'AI 服务',
    );

    expect(aiAutomatic?.proxies).toEqual([usProxy]);
    expect(aiAutomatic?.proxies).not.toContain(japanProxy);
    expect(aiSelector?.proxies).toEqual(['AI 自动优选', usProxy]);
    expect(profile.rules).toEqual(
      expect.arrayContaining([
        'DOMAIN-SUFFIX,chatgpt.com,AI 服务',
        'DOMAIN-SUFFIX,openai.com,AI 服务',
        'DOMAIN-SUFFIX,claude.ai,AI 服务',
        'DOMAIN,gemini.google.com,AI 服务',
      ]),
    );
  });

  it('falls back to the normal selector when no authorized US node exists', () => {
    const profile = parseProfile(
      buildMihomoProfile(
        credential,
        nodes.map((node, index) => ({
          ...node,
          label: `Japan ${index + 1}`,
          region: 'JP',
          tags: [],
        })),
      ),
    );
    const aiSelector = profile['proxy-groups'].find(
      (group) => group.name === 'AI 服务',
    );

    expect(
      profile['proxy-groups'].some((group) => group.name === 'AI 自动优选'),
    ).toBe(false);
    expect(aiSelector?.proxies).toEqual(['节点选择']);
  });

  it('only references emitted proxies and acyclic proxy groups', () => {
    const profile = parseProfile(buildMihomoProfile(credential, nodes));
    const proxyNames = new Set(profile.proxies.map((proxy) => proxy.name));
    const groups = new Map(
      profile['proxy-groups'].map((group) => [group.name, group.proxies]),
    );
    const builtIns = new Set(['DIRECT', 'REJECT']);

    for (const proxies of groups.values()) {
      for (const proxy of proxies) {
        expect(
          proxyNames.has(proxy) || groups.has(proxy) || builtIns.has(proxy),
        ).toBe(true);
      }
    }

    const visit = (name: string, path: Set<string>) => {
      expect(path.has(name)).toBe(false);
      const nextPath = new Set(path).add(name);
      for (const target of groups.get(name) ?? []) {
        if (groups.has(target)) visit(target, nextPath);
      }
    };
    for (const name of groups.keys()) visit(name, new Set());
  });

  it('emits Mihomo port hopping only for enabled Hysteria2 nodes', () => {
    const profile = parseProfile(
      buildMihomoProfile(credential, [
        {
          ...nodes[1],
          portHoppingEnabled: true,
          portHoppingStart: 20000,
          portHoppingEnd: 29999,
          portHoppingIntervalSeconds: 30,
        },
        { ...nodes[1], label: 'US Legacy' },
      ]),
    );

    expect(profile.proxies[0]).toMatchObject({
      port: 5401,
      ports: '20000-29999',
      'hop-interval': 30,
    });
    expect(profile.proxies[1]).not.toHaveProperty('ports');
    expect(profile.proxies[1]).not.toHaveProperty('hop-interval');
  });

  it('rejects incomplete VLESS REALITY endpoints', () => {
    expect(() =>
      buildMihomoProfile(credential, [{ ...nodes[0], realityPublicKey: null }]),
    ).toThrow('VLESS REALITY node US Primary is incomplete');
  });

  it('refreshes dynamic providers independently with isolated account cache paths', () => {
    const dynamic = (url: string) =>
      parse(buildMihomoProfile(credential, nodes, url)) as {
        proxies: unknown[];
        'proxy-providers': Record<
          string,
          { interval: number; url: string; path: string; payload: unknown[] }
        >;
        'proxy-groups': { use?: string[]; proxies?: string[] }[];
        rules: string[];
      };
    const first = dynamic('https://example.test/subscribe/first/clash/nodes');
    const second = dynamic('https://example.test/subscribe/second/clash/nodes');
    expect(first.proxies).toEqual([]);
    expect(first.rules).toEqual(
      parseProfile(buildMihomoProfile(credential, nodes)).rules,
    );
    const all = first['proxy-providers']['素心节点'];
    expect(all.interval).toBe(900);
    expect(all.url).toBe(
      'https://example.test/subscribe/first/clash/nodes?scope=all',
    );
    expect(all.path).not.toBe(second['proxy-providers']['素心节点'].path);
    expect(all.payload).toEqual(
      parseProfile(buildMihomoProfile(credential, nodes)).proxies,
    );
    expect(first['proxy-groups'].every((group) => group.use?.length)).toBe(
      true,
    );
  });

  it('preserves transport and names across AI subsets and rejects empty access', () => {
    const all = parseProfile(buildMihomoProvider(credential, nodes)).proxies;
    expect(
      parseProfile(buildMihomoProvider(credential, nodes, 'ai')).proxies,
    ).toEqual([all[0]]);
    const japan = [nodes[1]];
    expect(buildMihomoProvider(credential, japan, 'ai')).toBe(
      buildMihomoProvider(credential, japan),
    );
    expect(parseProfile(buildMihomoProvider(credential, [])).proxies).toEqual([
      { name: '暂无可用节点', type: 'reject' },
    ]);
  });
});
