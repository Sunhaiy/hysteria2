import { buildSurgeProfile } from './surge-profile';
import type { MihomoNode } from './mihomo-profile';

const node: MihomoNode = {
  label: '[XI01][2x][顶级] 美国 · Hysteria2',
  icon: '🇺🇸',
  protocol: 'HYSTERIA2',
  hostname: '203.0.113.10',
  port: 443,
  sni: 'example.test',
  obfsPassword: null,
  pinSHA256: null,
  allowInsecureTls: false,
  realityPublicKey: null,
  realityShortId: null,
  realityFingerprint: null,
  vlessFlow: null,
};
const url = 'https://example.test/api/subscribe/test-token/surge?profile=2';
const build = (nodes = [node]) =>
  buildSurgeProfile({ token: 'test-token' }, nodes, url);

describe('Surge profile', () => {
  it('renders a managed INI profile with original credentials and no incompatible protocols', () => {
    const config = build([
      node,
      { ...node, protocol: 'VLESS_REALITY', label: 'unsupported-vless' },
      { ...node, obfsPassword: 'secret', label: 'mac-only-obfs' },
    ]);
    expect(config.split('\n')[0]).toBe(
      `#!MANAGED-CONFIG ${url} interval=43200 strict=false`,
    );
    expect(config).toContain(
      `${node.icon} ${node.label} = hysteria2, 203.0.113.10, 443, password=test-token, sni=example.test, skip-cert-verify=false`,
    );
    expect(config).not.toMatch(
      /unsupported-vless|mac-only-obfs|url-test|fallback|dns-server|MITM/,
    );
    expect(config).toContain('FINAL,节点选择');
    expect(config).toContain('IP-CIDR,192.168.0.0/16,DIRECT\n');
  });

  it('keeps residential out of the default ordinary group and orders backups last', () => {
    const config = build([
      { ...node, label: '中级备用' },
      { ...node, label: '住宅', tags: ['residential'] },
      node,
    ]);
    expect(config).toContain(
      `普通线路 = select, 🇺🇸 ${node.label}, 🇺🇸 中级备用\n`,
    );
    expect(config).toContain('住宅线路 = select, 🇺🇸 住宅\n');
    expect(build([{ ...node, tags: ['home'] }])).toContain(
      '普通线路 = select, REJECT\n',
    );
    expect(build()).toContain('住宅线路 = select, REJECT\n');
  });

  it('preserves port hopping, SNI and pinning without weakening certificate validation', () => {
    const config = build([
      {
        ...node,
        allowInsecureTls: true,
        pinSHA256: Array(32).fill('AB').join(':'),
        portHoppingEnabled: true,
        portHoppingStart: 20000,
        portHoppingEnd: 29999,
        portHoppingIntervalSeconds: 45,
      },
    ]);
    expect(config).toContain(
      `server-cert-fingerprint-sha256=${'AB'.repeat(32)}`,
    );
    expect(config).not.toContain('skip-cert-verify=true');
    expect(config).toContain(
      'port-hopping=20000-29999, port-hopping-interval=45',
    );
    expect(build([{ ...node, allowInsecureTls: true }])).toContain(
      'skip-cert-verify=true',
    );
  });

  it('deduplicates sanitized labels and keeps every group reference resolvable', () => {
    const config = build([
      { ...node, label: 'A, B = C\n[Rule]\nFINAL,DIRECT # bad' },
      { ...node, label: 'A, B = C\n[Rule]\nFINAL,DIRECT # bad' },
      { ...node, icon: null, label: 'DIRECT' },
      { ...node, icon: null, label: '节点选择' },
    ]);
    expect(config.match(/^\[Rule\]$/gm)).toHaveLength(1);
    const names = config
      .split('[Proxy]\n')[1]
      .split('\n[Proxy Group]')[0]
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' = ')[0]);
    expect(new Set(names).size).toBe(4);
    expect(names).toContain('DIRECT 2');
    expect(names).toContain('节点选择 2');
    const known = new Set([
      ...names,
      '节点选择',
      '普通线路',
      '住宅线路',
      'AI 服务',
      'REJECT',
    ]);
    for (const line of config
      .split('[Proxy Group]\n')[1]
      .split('\n[Rule]')[0]
      .split('\n')
      .filter(Boolean)) {
      for (const member of line.split(' = select, ')[1].split(', '))
        expect(known.has(member)).toBe(true);
    }
  });

  it.each(['bad\n[Rule]', 'bad, password=other', 'bad\u0000token'])(
    'rejects unsafe connection data without echoing credentials: %p',
    (hostname) => {
      expect(() => build([{ ...node, hostname }])).toThrow(
        'Invalid Surge connection parameter',
      );
    },
  );

  it('rejects invalid pinning, ports and empty compatible lists', () => {
    expect(() => build([{ ...node, pinSHA256: 'not-a-pin' }])).toThrow(
      'fingerprint',
    );
    expect(() => build([{ ...node, port: 65536 }])).toThrow('port');
    expect(() =>
      build([
        {
          ...node,
          portHoppingEnabled: true,
          portHoppingStart: 500,
          portHoppingEnd: 100,
        },
      ]),
    ).toThrow('port hopping');
    expect(() => build([{ ...node, protocol: 'VLESS_REALITY' }])).toThrow(
      'No Surge-compatible nodes',
    );
  });
});
