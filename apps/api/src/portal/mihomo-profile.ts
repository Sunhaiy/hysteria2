import { stringify } from 'yaml';

export type MihomoNode = {
  label: string;
  protocol: 'HYSTERIA2' | 'VLESS_REALITY';
  hostname: string;
  port: number;
  portHoppingEnabled?: boolean;
  portHoppingStart?: number | null;
  portHoppingEnd?: number | null;
  portHoppingIntervalSeconds?: number;
  sni: string | null;
  obfsPassword: string | null;
  pinSHA256: string | null;
  allowInsecureTls: boolean;
  realityPublicKey: string | null;
  realityShortId: string | null;
  realityFingerprint: string | null;
  vlessFlow: string | null;
};

type MihomoCredential = {
  token: string;
  vlessUuid: string;
};

const healthCheckUrl = 'https://www.gstatic.com/generate_204';
const failoverGroup = '自动故障转移';
const latencyGroup = '延迟优选';
const selectorGroup = '节点选择';

export function buildMihomoProfile(
  credential: MihomoCredential,
  nodes: MihomoNode[],
) {
  const names = uniqueProxyNames(nodes);
  const proxies = nodes.map((node, index) =>
    node.protocol === 'VLESS_REALITY'
      ? buildVlessProxy(names[index], credential, node)
      : buildHysteriaProxy(names[index], credential, node),
  );

  const profile = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    ipv6: true,
    'unified-delay': true,
    'tcp-concurrent': true,
    profile: {
      'store-selected': true,
      'store-fake-ip': true,
    },
    proxies,
    'proxy-groups': [
      {
        name: failoverGroup,
        type: 'fallback',
        url: healthCheckUrl,
        interval: 180,
        lazy: true,
        proxies: names,
      },
      {
        name: latencyGroup,
        type: 'url-test',
        url: healthCheckUrl,
        interval: 300,
        tolerance: 80,
        lazy: true,
        proxies: names,
      },
      {
        name: selectorGroup,
        type: 'select',
        proxies: [failoverGroup, latencyGroup, ...names],
      },
    ],
    rules: [`MATCH,${selectorGroup}`],
  };

  return stringify(profile, { lineWidth: 0 });
}

function buildHysteriaProxy(
  name: string,
  credential: MihomoCredential,
  node: MihomoNode,
) {
  const hoppingRange =
    node.portHoppingEnabled && node.portHoppingStart && node.portHoppingEnd
      ? `${node.portHoppingStart}-${node.portHoppingEnd}`
      : undefined;
  return withoutUndefined({
    name,
    type: 'hysteria2',
    server: node.hostname,
    port: node.port,
    ports: hoppingRange,
    'hop-interval': hoppingRange
      ? (node.portHoppingIntervalSeconds ?? 30)
      : undefined,
    password: credential.token,
    sni: node.sni ?? node.hostname,
    'skip-cert-verify': node.allowInsecureTls,
    'client-fingerprint': 'chrome',
    obfs: node.obfsPassword ? 'salamander' : undefined,
    'obfs-password': node.obfsPassword ?? undefined,
    'ca-sha256': node.pinSHA256 ?? undefined,
  });
}

function buildVlessProxy(
  name: string,
  credential: MihomoCredential,
  node: MihomoNode,
) {
  if (!node.sni || !node.realityPublicKey || !node.realityShortId) {
    throw new Error(`VLESS REALITY node ${node.label} is incomplete`);
  }

  return {
    name,
    type: 'vless',
    server: node.hostname,
    port: node.port,
    uuid: credential.vlessUuid,
    network: 'tcp',
    tls: true,
    udp: true,
    flow: node.vlessFlow ?? 'xtls-rprx-vision',
    servername: node.sni,
    'client-fingerprint': node.realityFingerprint ?? 'chrome',
    'reality-opts': {
      'public-key': node.realityPublicKey,
      'short-id': node.realityShortId,
    },
  };
}

function uniqueProxyNames(nodes: MihomoNode[]) {
  const used = new Set<string>();
  return nodes.map((node) => {
    const protocol =
      node.protocol === 'VLESS_REALITY' ? 'VLESS Reality' : 'Hysteria 2';
    const base = `${node.label} · ${protocol}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base} ${suffix++}`;
    used.add(name);
    return name;
  });
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}
