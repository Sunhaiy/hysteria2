import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { parse } from 'node-html-parser';
import type { SeoPublicSource } from './seo-generation-pipeline';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('3fff::', 20, 'ipv6');

export function isPublicSourceAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  // Only native global unicast; reject mapped, translated, scoped and local IPs.
  return (
    family === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !blocked.check(address, 'ipv6')
  );
}

export function publicSourceUrl(raw: string) {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  ) {
    throw new Error('来源只支持公开 HTTP/HTTPS 标准端口网页');
  }
  url.hash = '';
  return url;
}

/** DNS is validated and pinned to the actual socket, including every redirect. */
export async function readSeoSource(raw: string): Promise<SeoPublicSource> {
  const signal = AbortSignal.timeout(15_000);
  let url = publicSourceUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('读取来源超时')),
          { once: true },
        );
      }),
    ]);
    signal.throwIfAborted();
    if (
      !addresses.length ||
      addresses.some((entry) => !isPublicSourceAddress(entry.address))
    ) {
      throw new Error('来源地址不是公开互联网地址');
    }
    const pinned = addresses[0];
    const result = await new Promise<{ location?: string; text?: string }>(
      (resolve, reject) => {
        const request = (
          url.protocol === 'https:' ? httpsRequest : httpRequest
        )(
          url,
          {
            signal,
            agent: false,
            family: pinned.family,
            headers: {
              'User-Agent': 'SuxinSeoSourceReader/1.0',
              Accept: 'text/html,text/plain',
              'Accept-Encoding': 'identity',
            },
            lookup: (_name, _options, callback) =>
              callback(null, pinned.address, pinned.family),
          },
          (response) => {
            const status = response.statusCode ?? 0;
            if (
              [301, 302, 303, 307, 308].includes(status) &&
              response.headers.location
            ) {
              resolve({ location: response.headers.location });
              response.destroy();
              return;
            }
            if (
              status !== 200 ||
              !/^text\/(html|plain)(;|$)/i.test(
                response.headers['content-type'] ?? '',
              ) ||
              (response.headers['content-encoding'] &&
                response.headers['content-encoding'] !== 'identity')
            ) {
              reject(new Error('来源网页不可读取或格式不支持'));
              response.destroy();
              return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 2 * 1024 * 1024) {
                reject(new Error('来源网页超过 2 MB'));
                response.destroy();
                return;
              }
              chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () =>
              resolve({ text: Buffer.concat(chunks).toString('utf8') }),
            );
          },
        );
        request.on('error', reject);
        request.end();
      },
    );
    if (result.location) {
      url = publicSourceUrl(new URL(result.location, url).href);
      continue;
    }
    const document = parse(result.text ?? '');
    const title =
      document.querySelector('title')?.text.trim().slice(0, 200) ||
      url.hostname;
    document
      .querySelectorAll('script,style,noscript,nav,footer,header,form,iframe')
      .forEach((node) => node.remove());
    const content = (
      document.querySelector('main,article') ?? document
    ).textContent
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 16000);
    if (content.length < 80)
      throw new Error('来源网页正文不足，请粘贴资料补充');
    return {
      id: url.href,
      title,
      url: url.href,
      content,
      accessedAt: new Date().toISOString(),
      applicableVersion: null,
    };
  }
  throw new Error('来源重定向次数过多');
}
