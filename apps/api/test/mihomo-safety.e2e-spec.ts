import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  buildMihomoProfile,
  buildMihomoProvider,
  type MihomoNode,
} from '../src/portal/mihomo-profile';

const core = process.env.MIHOMO_TEST_BINARY;
const hy2 = process.env.HYSTERIA_TEST_BINARY;
// Every connection in this test stays on loopback. No credentials or live nodes.
(core && hy2 ? describe : describe.skip).each(['inline', 'provider'] as const)(
  'Real Mihomo subscription safety (%s)',
  (mode) => {
    const children: ChildProcess[] = [];
    const logs: string[] = [];
    let providerNodes: MihomoNode[] = [];
    const credential = {
      token: 'fixture',
      vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
    };
    const http = createServer((req, res) => {
      if (req.url?.startsWith('/nodes')) {
        res.setHeader('Content-Type', 'text/yaml');
        res.end(buildMihomoProvider(credential, providerNodes, 'automatic'));
        return;
      }
      res.writeHead(204);
      res.end();
    });
    let directory = '';
    let controller = '';
    let target = '';
    let generated: Record<string, unknown>;
    let goodName: string;
    let badName: string;
    let profilePath: string;

    async function port() {
      const s = createTcpServer();
      await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
      const n = (s.address() as AddressInfo).port;
      await new Promise<void>((r) => s.close(() => r()));
      return n;
    }
    function start(binary: string, args: string[]) {
      const child = spawn(binary, args, { windowsHide: true });
      const index = children.push(child) - 1;
      logs[index] = '';
      child.stdout?.on('data', (data: Buffer) => {
        logs[index] += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        logs[index] += data.toString();
      });
      return child;
    }
    async function eventually(check: () => Promise<boolean>) {
      for (let n = 0; n < 60; n++) {
        if (children.some((c) => c.exitCode !== null))
          throw new Error(logs.join('\n'));
        try {
          if (await check()) return;
        } catch {
          /* Startup or scheduler. */
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Core did not become ready: ${logs.join('\n')}`);
    }
    async function api(route: string, method = 'GET', body?: unknown) {
      return fetch(controller + route, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
      });
    }
    async function delay(name: string) {
      if (mode === 'provider' && [goodName, badName].includes(name)) {
        const route = `/proxies/${encodeURIComponent('普通线路')}`;
        expect((await api(route, 'PUT', { name })).status).toBe(204);
        name = '普通线路';
      }
      return api(
        `/proxies/${encodeURIComponent(name)}/delay?timeout=1500&url=${encodeURIComponent(target)}`,
      );
    }
    async function selected(name: string) {
      return (await (
        await api(`/proxies/${encodeURIComponent(name)}`)
      ).json()) as { now: string };
    }

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'mihomo-safety-'));
      const key = join(directory, 'key.pem'),
        cert = join(directory, 'cert.pem');
      execFileSync(
        process.env.OPENSSL_TEST_BINARY ?? 'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          key,
          '-out',
          cert,
          '-days',
          '2',
          '-subj',
          '/CN=localhost',
          '-addext',
          'subjectAltName=DNS:localhost',
        ],
        { windowsHide: true, stdio: 'pipe' },
      );
      const fingerprint = new X509Certificate(
        await readFile(cert),
      ).fingerprint256.replaceAll(':', '');
      const udp = createSocket('udp4');
      await new Promise<void>((r) => udp.bind(0, '127.0.0.1', r));
      const udpPort = udp.address().port;
      await new Promise<void>((r) => udp.close(r));
      const serverConfig = join(directory, 'server.yaml');
      await writeFile(
        serverConfig,
        stringify({
          listen: `127.0.0.1:${udpPort}`,
          tls: { cert, key },
          auth: { type: 'password', password: 'fixture' },
        }),
      );
      start(hy2!, ['server', '-c', serverConfig]);
      await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
      target = `http://127.0.0.1:${(http.address() as AddressInfo).port}/`;
      const node: MihomoNode = {
        label: 'Good pin',
        protocol: 'HYSTERIA2',
        hostname: '127.0.0.1',
        port: udpPort,
        sni: 'localhost',
        obfsPassword: null,
        pinSHA256: fingerprint,
        allowInsecureTls: true,
        realityPublicKey: null,
        realityShortId: null,
        realityFingerprint: null,
        vlessFlow: null,
      };
      providerNodes = [
        { ...node, label: 'Bad pin', pinSHA256: '00'.repeat(32) },
        node,
      ];
      generated = parse(
        buildMihomoProfile(
          credential,
          providerNodes,
          mode === 'provider' ? `${target}nodes` : undefined,
        ),
      ) as Record<string, unknown>;
      const proxies = (
        parse(buildMihomoProvider(credential, providerNodes)) as {
          proxies: { name: string }[];
        }
      ).proxies;
      [badName, goodName] = proxies.map((p) => p.name);
      // A legacy profile with a deliberately wrong, ignored field demonstrates
      // that success of the bad-pin request would catch the original bug.
      (generated.proxies as { name: string }[]).push({
        ...proxies[1],
        name: 'legacy ignored pin',
        fingerprint: undefined,
        'ca-sha256': '00'.repeat(32),
      } as { name: string });
      for (const group of generated['proxy-groups'] as Record<
        string,
        unknown
      >[]) {
        if (group.type === 'select') continue;
        group.url = target;
        group.interval = 1; // Same health-check scheduler, accelerated locally.
      }
      const controlPort = await port();
      controller = `http://127.0.0.1:${controlPort}`;
      generated['external-controller'] = `127.0.0.1:${controlPort}`;
      generated['mixed-port'] = await port();
      generated['bind-address'] = '127.0.0.1';
      generated['rule-providers'] = {};
      generated.rules = ['MATCH,节点选择'];
      generated.tun = { enable: false };
      generated.dns = { enable: false };
      profilePath = join(directory, 'client.yaml');
      await writeFile(profilePath, stringify(generated));
      start(core!, ['-d', directory, '-f', profilePath]);
      await eventually(async () => (await api('/version')).ok);
    }, 20000);

    afterAll(async () => {
      for (const child of children.reverse()) {
        if (child.exitCode === null)
          await new Promise<void>((r) => {
            child.once('exit', () => r());
            child.kill();
          });
      }
      http.closeAllConnections();
      if (http.listening) await new Promise<void>((r) => http.close(() => r()));
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it('accepts the correct HY2 pin and rejects a wrong pin even with skip-cert-verify', async () => {
      expect((await delay(goodName)).status).toBe(200);
      expect((await delay('legacy ignored pin')).status).toBe(200);
      expect((await delay(badName)).status).toBe(503);
    }, 10000);

    it.each(['自动优选', '故障转移'])(
      'chooses a reachable ordinary node when selecting %s',
      async (group) => {
        expect(
          (
            await api(`/proxies/${encodeURIComponent('节点选择')}`, 'PUT', {
              name: group,
            })
          ).status,
        ).toBe(204);
        await eventually(async () => {
          await delay(group);
          return (await selected(group)).now === goodName;
        });
        expect((await delay('节点选择')).status).toBe(200);
      },
      15000,
    );

    it('retains manual selection across a profile reload', async () => {
      const route = `/proxies/${encodeURIComponent('节点选择')}`;
      expect((await api(route, 'PUT', { name: goodName })).status).toBe(204);
      expect(
        (await api('/configs?force=true', 'PUT', { path: profilePath })).status,
      ).toBe(204);
      expect((await selected('节点选择')).now).toBe(goodName);
      expect((await delay('节点选择')).status).toBe(200);
    });
  },
);
