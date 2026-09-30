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
const automaticGroup = '自动优选';
const residentialGroup = '住宅线路';
const selectorGroup = '节点选择';
const aiSelectorGroup = 'AI 服务';
const allProvider = '素心节点';
const automaticProvider = '素心自动节点';
const residentialProvider = '素心住宅节点';
export type MihomoScope = 'all' | 'ai' | 'automatic' | 'residential';

export function buildMihomoProvider(
  credential: MihomoCredential,
  nodes: MihomoNode[],
  scope: MihomoScope = 'all',
) {
  return stringify(
    { proxies: providerProxies(credential, nodes, scope) },
    { lineWidth: 0 },
  );
}

function providerProxies(
  credential: MihomoCredential,
  nodes: MihomoNode[],
  scope: MihomoScope,
) {
  const originalNames = uniqueProxyNames(nodes);
  const namesByNode = new Map(
    nodes.map((node, index) => [node, originalNames[index]]),
  );
  if (scope === 'automatic') {
    nodes = nodes
      .filter((node) => !isResidential(node))
      .sort((a, b) => Number(isBackup(a)) - Number(isBackup(b)));
  } else if (scope === 'residential') {
    nodes = nodes.filter(isResidential);
  }
  const names = nodes.map((node) => namesByNode.get(node)!);
  // Verge resolves group members across providers by name. Give AI copies
  // distinct identities while preserving the ordinary node display names.
  const used = new Set(names);
  const providerNames = names.map((name) => {
    if (scope !== 'ai') return name;
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
          name:
            scope === 'ai'
              ? '暂无可用 AI 节点'
              : scope === 'residential'
                ? '暂无可用住宅节点'
                : scope === 'automatic'
                  ? '暂无可用普通节点'
                  : '暂无可用节点',
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
        ['automatic', automaticProvider],
        ['residential', residentialProvider],
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
  const automaticNodes = nodes
    .map((node, index) => ({ node, name: names[index] }))
    .filter(({ node }) => !isResidential(node))
    .sort((a, b) => Number(isBackup(a.node)) - Number(isBackup(b.node)))
    .map(({ name }) => name);
  const residentialNames = nodes.flatMap((node, index) =>
    isResidential(node) ? [names[index]] : [],
  );
  const visibleNames = providerUrl ? [] : names;
  const dynamicAll = providerUrl ? { use: [allProvider] } : {};

  const proxyGroups: Array<Record<string, unknown>> = [
    {
      name: selectorGroup,
      type: 'select',
      proxies: [automaticGroup, residentialGroup, ...visibleNames],
      ...dynamicAll,
    },
    {
      name: automaticGroup,
      type: 'fallback',
      url: healthCheckUrl,
      interval: 180,
      lazy: true,
      ...(providerUrl
        ? { use: [automaticProvider] }
        : { proxies: automaticNodes.length ? automaticNodes : ['REJECT'] }),
    },
    {
      name: residentialGroup,
      type: 'select',
      ...(providerUrl
        ? { use: [residentialProvider] }
        : { proxies: residentialNames.length ? residentialNames : ['REJECT'] }),
    },
    {
      name: aiSelectorGroup,
      type: 'select',
      proxies: [selectorGroup, residentialGroup],
    },
  ];

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
      `RULE-SET,youtube,${selectorGroup}`,
      `RULE-SET,netflix,${selectorGroup}`,
      `RULE-SET,spotify,${selectorGroup}`,
      `RULE-SET,telegram,${selectorGroup}`,
      `RULE-SET,overseas,${selectorGroup}`,
      'RULE-SET,cn,DIRECT',
      'RULE-SET,cn-ip,DIRECT,no-resolve',
      `MATCH,${selectorGroup}`,
    ],
  };

  return stringify(profile, { lineWidth: 0 });
}

function isResidential(node: MihomoNode) {
  return (
    /住宅|家宽/.test(node.label) ||
    (node.tags ?? []).some((tag) => /^(residential|home)$/i.test(tag))
  );
}

function isBackup(node: MihomoNode) {
  return /中级|备用/.test(node.label);
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
    const display = nodeDisplayName(node);
    const base = /·\s*(?:Hysteria\s*2|VLESS(?:\s*Reality)?)(?:\s*·|$)/i.test(
      display,
    )
      ? display
      : `${display} · ${protocol}`;
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
