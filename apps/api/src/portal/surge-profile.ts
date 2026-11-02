import type { MihomoNode } from './mihomo-profile';
import { isBackup, isResidential } from './mihomo-profile';
import { nodeDisplayName } from './node-display-name';

const groups = ['节点选择', '普通线路', '住宅线路', 'AI 服务'] as const;

// One profile works on both iOS and Mac. Salamander is Mac-only in Surge.
export function isSurgeCompatible(node: MihomoNode) {
  return node.protocol === 'HYSTERIA2' && !node.obfsPassword;
}

function value(text: string) {
  // Credentials and connection fields must round-trip exactly. Do not silently
  // sanitize them or allow a stored value to inject another INI directive.
  if (!text || /[\s\p{Cc},"\\#;]/u.test(text)) {
    throw new Error('Invalid Surge connection parameter');
  }
  return text;
}

function proxyNames(nodes: MihomoNode[]) {
  const used = new Set<string>([...groups, 'DIRECT', 'REJECT']);
  return nodes.map((node) => {
    const base =
      nodeDisplayName(node)
        .replace(/[\r\n\u2028\u2029]/g, ' ')
        .replace(/\p{Cc}/gu, '')
        .replace(/[,=;#"\\]/g, ' ')
        .replace(/\/\//g, '／／')
        .trim() || 'Hysteria2';
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base} ${suffix++}`;
    used.add(name);
    return name;
  });
}

function proxyLine(name: string, token: string, node: MihomoNode) {
  if (!Number.isInteger(node.port) || node.port < 1 || node.port > 65535) {
    throw new Error('Invalid Surge node port');
  }
  const fields = [
    `${name} = hysteria2`,
    value(node.hostname),
    String(node.port),
    `password=${value(token)}`,
    `sni=${value(node.sni ?? node.hostname)}`,
  ];
  if (node.pinSHA256) {
    const fingerprint = node.pinSHA256.replace(/:/g, '');
    if (!/^[a-f0-9]{64}$/i.test(fingerprint)) {
      throw new Error('Invalid Surge certificate fingerprint');
    }
    fields.push(`server-cert-fingerprint-sha256=${fingerprint}`);
  } else {
    fields.push(`skip-cert-verify=${node.allowInsecureTls}`);
  }
  if (node.portHoppingEnabled && node.portHoppingStart && node.portHoppingEnd) {
    const start = node.portHoppingStart;
    const end = node.portHoppingEnd;
    const interval = node.portHoppingIntervalSeconds ?? 30;
    if (
      ![start, end, interval].every(Number.isInteger) ||
      start < 1 ||
      end > 65535 ||
      end < start ||
      interval < 1
    ) {
      throw new Error('Invalid Surge port hopping range');
    }
    fields.push(
      `port-hopping=${start}-${end}`,
      `port-hopping-interval=${interval}`,
    );
  }
  return fields.join(', ');
}

export function buildSurgeProfile(
  credential: { token: string },
  availableNodes: MihomoNode[],
  subscriptionUrl: string,
) {
  const url = new URL(subscriptionUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    /\s/.test(subscriptionUrl)
  ) {
    throw new Error('Invalid Surge subscription URL');
  }
  const nodes = availableNodes.filter(isSurgeCompatible);
  if (!nodes.length) throw new Error('No Surge-compatible nodes');
  const names = proxyNames(nodes);
  const ordinary = nodes
    .map((node, index) => ({ node, name: names[index] }))
    .filter(({ node }) => !isResidential(node))
    .sort((a, b) => Number(isBackup(a.node)) - Number(isBackup(b.node)))
    .map(({ name }) => name);
  const residential = nodes.flatMap((node, index) =>
    isResidential(node) ? [names[index]] : [],
  );
  const select = (name: string, members: string[]) =>
    `${name} = select, ${(members.length ? members : ['REJECT']).join(', ')}`;
  return [
    `#!MANAGED-CONFIG ${url.toString()} interval=43200 strict=false`,
    '# Surge iOS 5.8.0+ / Mac 5.4.0+ · Hysteria2',
    '# Keep this URL private. Updates run when the Surge app is open.',
    '',
    '[General]',
    'loglevel = notify',
    '',
    '[Proxy]',
    ...nodes.map((node, index) =>
      proxyLine(names[index], credential.token, node),
    ),
    '',
    '[Proxy Group]',
    select(groups[0], [groups[1], groups[2], ...names]),
    select(groups[1], ordinary),
    select(groups[2], residential),
    select(groups[3], [groups[0], groups[2]]),
    '',
    '[Rule]',
    'DOMAIN,localhost,DIRECT',
    'DOMAIN-SUFFIX,local,DIRECT',
    ...[
      '127.0.0.0/8',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '169.254.0.0/16',
    ].map((cidr) => `IP-CIDR,${cidr},DIRECT`),
    ...['::1/128', 'fc00::/7', 'fe80::/10'].map(
      (cidr) => `IP-CIDR6,${cidr},DIRECT`,
    ),
    ...[
      'chatgpt.com',
      'openai.com',
      'oaistatic.com',
      'oaiusercontent.com',
      'sora.com',
      'anthropic.com',
      'claude.ai',
      'claude.com',
      'gemini.google.com',
      'aistudio.google.com',
      'ai.google.dev',
      'generativelanguage.googleapis.com',
    ].map((domain) => `DOMAIN-SUFFIX,${domain},${groups[3]}`),
    'GEOIP,CN,DIRECT',
    `FINAL,${groups[0]}`,
    '',
  ].join('\n');
}
