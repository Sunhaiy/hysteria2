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
  region?: string | null;
  tags?: string[];
};

type MihomoCredential = {
  token: string;
  vlessUuid: string;
};

const healthCheckUrl = 'https://www.gstatic.com/generate_204';
const failoverGroup = '自动故障转移';
const latencyGroup = '延迟优选';
const selectorGroup = '节点选择';
const aiAutomaticGroup = 'AI 自动优选';
const aiSelectorGroup = 'AI 服务';

const privateNetworkRules = [
  'GEOSITE,private,DIRECT',
  'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
  'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
  'IP-CIDR6,::1/128,DIRECT,no-resolve',
  'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
  'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
];

const aiRules = [
  'DOMAIN-SUFFIX,chatgpt.com,AI 服务',
  'DOMAIN-SUFFIX,openai.com,AI 服务',
  'DOMAIN-SUFFIX,oaistatic.com,AI 服务',
  'DOMAIN-SUFFIX,oaiusercontent.com,AI 服务',
  'DOMAIN-SUFFIX,sora.com,AI 服务',
  'DOMAIN-SUFFIX,anthropic.com,AI 服务',
  'DOMAIN-SUFFIX,claude.ai,AI 服务',
  'DOMAIN-SUFFIX,claude.com,AI 服务',
  'DOMAIN,gemini.google.com,AI 服务',
  'DOMAIN,aistudio.google.com,AI 服务',
  'DOMAIN,ai.google.dev,AI 服务',
  'DOMAIN,generativelanguage.googleapis.com,AI 服务',
];

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
  const aiProxyNames = nodes.flatMap((node, index) =>
    isAiNode(node) ? [names[index]] : [],
  );

  const proxyGroups: Array<Record<string, unknown>> = [
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
      proxies: [failoverGroup, latencyGroup, ...names, 'DIRECT'],
    },
  ];

  if (aiProxyNames.length) {
    proxyGroups.push({
      name: aiAutomaticGroup,
      type: 'url-test',
      url: healthCheckUrl,
      interval: 300,
      tolerance: 80,
      lazy: true,
      proxies: aiProxyNames,
    });
  }
  proxyGroups.push({
    name: aiSelectorGroup,
    type: 'select',
    proxies: aiProxyNames.length
      ? [aiAutomaticGroup, ...aiProxyNames]
      : [selectorGroup],
  });

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
    'proxy-groups': proxyGroups,
    rules: [
      ...privateNetworkRules,
      ...aiRules,
      'GEOSITE,cn,DIRECT',
      'GEOIP,CN,DIRECT,no-resolve',
      `MATCH,${selectorGroup}`,
    ],
  };

  return stringify(profile, { lineWidth: 0 });
}

function isAiNode(node: MihomoNode) {
  const tags = (node.tags ?? []).map((tag) => tag.trim().toLowerCase());
  if (
    tags.some((tag) =>
      /^(?:(?:region|country|location)[:_-])?(?:us|usa)(?:[-_:].*)?$/.test(tag),
    )
  ) {
    return true;
  }

  const region = node.region?.trim().toLowerCase() ?? '';
  if (
    ['us', 'usa', 'united states', '美国'].includes(region) ||
    region.startsWith('us-')
  ) {
    return true;
  }

  return /美国|美西|美东|洛杉矶|\bus\b/i.test(node.label);
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
