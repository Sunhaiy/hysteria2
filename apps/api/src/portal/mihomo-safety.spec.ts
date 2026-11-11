import { parse } from 'yaml';
import {
  buildMihomoProfile,
  buildMihomoProvider,
  type MihomoNode,
} from './mihomo-profile';

const credential = {
  token: 'fixture',
  vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
};
const ordinary: MihomoNode = {
  label: 'ordinary',
  protocol: 'HYSTERIA2',
  hostname: '127.0.0.1',
  port: 9,
  sni: 'test.invalid',
  obfsPassword: null,
  pinSHA256: 'ab'.repeat(32),
  allowInsecureTls: true,
  realityPublicKey: null,
  realityShortId: null,
  realityFingerprint: null,
  vlessFlow: null,
};
type Profile = {
  proxies: Record<string, unknown>[];
  'proxy-groups': {
    name: string;
    type: string;
    proxies?: string[];
    use?: string[];
  }[];
  'proxy-providers'?: Record<string, { payload: Record<string, unknown>[] }>;
};
const profileFor = (nodes: MihomoNode[], url?: string) =>
  parse(buildMihomoProfile(credential, nodes, url)) as Profile;

describe('Mihomo subscription safety', () => {
  it.each([undefined, 'https://example.test/nodes'])(
    'omits inaccessible residential choices (%s)',
    (url) => {
      const profile = profileFor([ordinary], url);
      expect(
        profile['proxy-groups'].some((group) => group.name === '住宅线路'),
      ).toBe(false);
      for (const group of profile['proxy-groups'])
        expect(group.proxies ?? []).not.toContain('住宅线路');
      expect(profile['proxy-providers'] ?? {}).not.toHaveProperty(
        '素心住宅节点',
      );
    },
  );

  it.each([undefined, 'https://example.test/nodes'])(
    'offers optional ordinary automation without changing saved manual choices (%s)',
    (url) => {
      const residential = { ...ordinary, label: '住宅', tags: ['residential'] };
      const profile = profileFor([ordinary, residential], url);
      const groups = profile['proxy-groups'];
      expect(groups.find((g) => g.name === '节点选择')?.proxies?.[0]).toBe(
        '普通线路',
      );
      expect(groups.find((g) => g.name === '普通线路')?.type).toBe('select');
      expect(groups.find((g) => g.name === '住宅线路')?.type).toBe('select');
      const automatic = groups.filter((g) =>
        ['url-test', 'fallback'].includes(g.type),
      );
      expect(automatic.map((g) => g.type)).toEqual(['url-test', 'fallback']);
      for (const group of automatic) {
        expect(group).toMatchObject({
          url: 'https://www.gstatic.com/generate_204',
          interval: 300,
          lazy: true,
        });
        if (url) expect(group.use).toEqual(['素心自动节点']);
        else expect(group.proxies).toEqual([profile.proxies[0].name]);
        expect(groups[0].proxies).toContain(group.name);
      }
      expect(automatic[0]).toMatchObject({ tolerance: 50 });
      expect(groups.find((g) => g.name === 'AI 服务')?.proxies).toEqual([
        '节点选择',
        '住宅线路',
      ]);
    },
  );

  it.each([undefined, 'https://example.test/nodes'])(
    'avoids a dead ordinary default for residential-only access (%s)',
    (url) => {
      const profile = profileFor(
        [{ ...ordinary, label: '住宅', tags: ['residential'] }],
        url,
      );
      expect(profile['proxy-groups'][0].proxies?.[0]).toBe('住宅线路');
      expect(
        profile['proxy-groups'].some((g) =>
          ['url-test', 'fallback'].includes(g.type),
        ),
      ).toBe(false);
      expect(profile['proxy-groups'].some((g) => g.name === '普通线路')).toBe(
        false,
      );
    },
  );

  it('keeps a no-access profile closed without offering empty route choices', () => {
    const profile = profileFor([]);
    expect(profile['proxy-groups'][0].proxies).toEqual(['REJECT']);
    expect(profile['proxy-groups'].map((g) => g.name)).toEqual([
      '节点选择',
      'AI 服务',
    ]);
  });

  it.each([true, false])(
    'emits the HY2 certificate pin independently of ordinary TLS verification (%s)',
    (allowInsecureTls) => {
      for (const source of [
        buildMihomoProfile(credential, [{ ...ordinary, allowInsecureTls }]),
        buildMihomoProvider(credential, [{ ...ordinary, allowInsecureTls }]),
      ]) {
        const profile = parse(source) as Profile;
        expect(profile.proxies[0]).toMatchObject({
          fingerprint: ordinary.pinSHA256,
          'skip-cert-verify': allowInsecureTls,
        });
        expect(profile.proxies[0]).not.toHaveProperty('ca-sha256');
      }
    },
  );
});
