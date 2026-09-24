import { stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { nodeDisplayName } from './node-display-name';

export type MihomoNode = {
  label: string;
  icon?: string | null;
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
const mediaGroup = '流媒体';
const messagingGroup = 'Telegram';
const allProvider = '素心节点';
const aiProvider = '素心 AI 节点';

export function buildMihomoProvider(
  credential: MihomoCredential,
  nodes: MihomoNode[],
  scope: 'all' | 'ai' = 'all',
) {
  return stringify(
    { proxies: providerProxies(credential, nodes, scope) },
    { lineWidth: 0 },
  );
}

function providerProxies(
  credential: MihomoCredential,
  nodes: MihomoNode[],
  scope: 'all' | 'ai',
) {
  const names = uniqueProxyNames(nodes);
  // Verge resolves group members across providers by name. Give AI copies
  // distinct identities while preserving the ordinary node display names.
  const used = new Set(names);
  const providerNames = names.map((name) => {
    if (scope === 'all') return name;
    const base = `${name} · AI`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base} ${suffix++}`;
    used.add(candidate);
    return candidate;
  });
  const aiOnly = scope === 'ai' && nodes.some(isAiNode);
  const proxies = nodes.flatMap((node, index) => {
    if (aiOnly && !isAiNode(node)) return [];
    return [
      node.protocol === 'VLESS_REALITY'
        ? buildVlessProxy(providerNames[index], credential, node)
        : buildHysteriaProxy(providerNames[index], credential, node),
    ];
  });
  return proxies.length
    ? proxies
    : [
        {
          name: scope === 'ai' ? '暂无可用 AI 节点' : '暂无可用节点',
          type: 'reject',
        },
      ];
}

function buildNodeProviders(
  url: string,
  credential: MihomoCredential,
  nodes: MihomoNode[],
) {
  return Object.fromEntries(
    (
      [
        ['all', allProvider],
        ['ai', aiProvider],
      ] as const
    ).map(([scope, name]) => {
      const source = `${url}?scope=${scope}`;
      const key = createHash('sha256')
        .update(source)
        .digest('hex')
        .slice(0, 24);
      return [
        name,
        {
          type: 'http',
          url: source,
          interval: 900,
          proxy: 'DIRECT',
          path: `./proxy-providers/suxin-${key}.yaml`,
          'health-check': {
            enable: true,
            url: healthCheckUrl,
            interval: 300,
            lazy: true,
          },
          // Bootstrap only: subsequent successful provider downloads replace this list.
          payload: providerProxies(credential, nodes, scope),
        },
      ];
    }),
  );
}

// Upstream's native Mihomo MRS sets; client-side cache and daily refresh.
const ruleSources = {
  private: ['geosite/private', 'domain'],
  cn: ['geosite/cn', 'domain'],
  ai: ['geosite/category-ai-!cn', 'domain'],
  youtube: ['geosite/youtube', 'domain'],
  netflix: ['geosite/netflix', 'domain'],
  spotify: ['geosite/spotify', 'domain'],
  telegram: ['geosite/telegram', 'domain'],
  overseas: ['geosite/geolocation-!cn', 'domain'],
  'cn-ip': ['geoip/cn', 'ipcidr'],
} as const;

function buildRuleProviders() {
  return Object.fromEntries(
    Object.entries(ruleSources).map(([name, [path, behavior]]) => [
      name,
      {
        type: 'http',
        behavior,
        format: 'mrs',
        interval: 86_400,
        path: `./rule-providers/suxin-meta-${name}.mrs`,
        url: `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/${path}.mrs`,
        proxy: selectorGroup,
      },
    ]),
  );
}

// Resolve domain targets before private CIDR matching, including split-DNS intranets.
const privateNetworkRules = [
  'RULE-SET,private,DIRECT',
  'IP-CIDR,127.0.0.0/8,DIRECT',
  'IP-CIDR,10.0.0.0/8,DIRECT',
  'IP-CIDR,172.16.0.0/12,DIRECT',
  'IP-CIDR,192.168.0.0/16,DIRECT',
  'IP-CIDR,169.254.0.0/16,DIRECT',
  'IP-CIDR6,::1/128,DIRECT',
  'IP-CIDR6,fc00::/7,DIRECT',
  'IP-CIDR6,fe80::/10,DIRECT',
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
  providerUrl?: string,
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
  const visibleNames = providerUrl ? [] : names;
  const dynamicAll = providerUrl ? { use: [allProvider] } : {};
  const dynamicAi = providerUrl ? { use: [aiProvider] } : {};

  const proxyGroups: Array<Record<string, unknown>> = [
    {
      name: failoverGroup,
      type: 'fallback',
      url: healthCheckUrl,
      interval: 180,
      lazy: true,
      ...(providerUrl ? dynamicAll : { proxies: names }),
    },
    {
      name: latencyGroup,
      type: 'url-test',
      url: healthCheckUrl,
      interval: 300,
      tolerance: 80,
      lazy: true,
      ...(providerUrl ? dynamicAll : { proxies: names }),
    },
    {
      name: selectorGroup,
      type: 'select',
      proxies: [failoverGroup, latencyGroup, ...visibleNames, 'DIRECT'],
      ...dynamicAll,
    },
  ];

  if (providerUrl || aiProxyNames.length) {
    proxyGroups.push({
      name: aiAutomaticGroup,
      type: 'url-test',
      url: healthCheckUrl,
      interval: 300,
      tolerance: 80,
      lazy: true,
      ...(providerUrl ? dynamicAi : { proxies: aiProxyNames }),
    });
  }
  proxyGroups.push({
    name: aiSelectorGroup,
    type: 'select',
    ...dynamicAi,
    proxies: providerUrl
      ? [aiAutomaticGroup]
      : aiProxyNames.length
        ? [aiAutomaticGroup, ...aiProxyNames]
        : [selectorGroup],
  });
  for (const name of [mediaGroup, messagingGroup]) {
    proxyGroups.push({
      name,
      type: 'select',
      proxies: [selectorGroup, latencyGroup, failoverGroup, ...visibleNames],
      ...dynamicAll,
    });
  }

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
    proxies: providerUrl ? [] : proxies,
    ...(providerUrl
      ? {
          'proxy-providers': buildNodeProviders(providerUrl, credential, nodes),
        }
      : {}),
    'proxy-groups': proxyGroups,
    'rule-providers': buildRuleProviders(),
    rules: [
      ...privateNetworkRules,
      ...aiRules,
      `RULE-SET,ai,${aiSelectorGroup}`,
      `RULE-SET,youtube,${mediaGroup}`,
      `RULE-SET,netflix,${mediaGroup}`,
      `RULE-SET,spotify,${mediaGroup}`,
      `RULE-SET,telegram,${messagingGroup}`,
      `RULE-SET,overseas,${selectorGroup}`,
      'RULE-SET,cn,DIRECT',
      'RULE-SET,cn-ip,DIRECT,no-resolve',
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
    const base = `${nodeDisplayName(node)} · ${protocol}`;
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
