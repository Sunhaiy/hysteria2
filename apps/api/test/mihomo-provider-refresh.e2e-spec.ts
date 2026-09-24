import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  buildMihomoProfile,
  buildMihomoProvider,
  type MihomoNode,
} from '../src/portal/mihomo-profile';

const core = process.env.MIHOMO_TEST_BINARY;
(core ? describe : describe.skip)('Real Mihomo provider refresh', () => {
  const credential = {
    token: 'local-test-token',
    vlessUuid: '67fbc500-3f3c-4ab9-a076-3e17c56bb3a1',
  };
  const node: MihomoNode = {
    label: 'US First',
    protocol: 'HYSTERIA2',
    hostname: '127.0.0.1',
    port: 9,
    sni: 'example.test',
    obfsPassword: null,
    pinSHA256: null,
    allowInsecureTls: false,
    realityPublicKey: null,
    realityShortId: null,
    realityFingerprint: null,
    vlessFlow: null,
    region: 'US',
  };
  let nodes = [node];
  let failure = true;
  let requests = 0;
  let child: ChildProcess;
  let directory = '';
  let controller = '';
  let logs = '';
  const http = createServer((req, res) => {
    requests++;
    if (failure) {
      res.writeHead(503);
      res.end('temporary outage');
      return;
    }
    res.setHeader('Content-Type', 'text/yaml');
    res.end(
      buildMihomoProvider(
        credential,
        nodes,
        req.url?.includes('scope=ai') ? 'ai' : 'all',
      ),
    );
  });
  async function freePort() {
    const server = createTcpServer();
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }
  async function eventually(check: () => Promise<boolean> | boolean) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try {
        if (await check()) return;
      } catch {
        /* Wait for startup or refresh. */
      }
      if (child?.exitCode !== null && child?.exitCode !== undefined)
        throw new Error(logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Provider update timed out: ${logs}`);
  }
  async function names(provider = '素心节点') {
    const response = await fetch(
      `${controller}/providers/proxies/${encodeURIComponent(provider)}`,
      { signal: AbortSignal.timeout(1000) },
    );
    const data = (await response.json()) as { proxies: { name: string }[] };
    return data.proxies.map((proxy) => proxy.name);
  }
  beforeAll(async () => {
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as AddressInfo).port;
    const controlPort = await freePort();
    controller = `http://127.0.0.1:${controlPort}`;
    const profile = parse(
      buildMihomoProfile(credential, nodes, `http://127.0.0.1:${port}/nodes`),
    ) as Record<string, unknown> & {
      'proxy-providers': Record<
        string,
        { interval: number; 'health-check': { enable: boolean } }
      >;
    };
    for (const provider of Object.values(profile['proxy-providers'])) {
      expect(provider.interval).toBe(900);
      provider.interval = 1; // Accelerate the same scheduler, not a manual reload.
      provider['health-check'].enable = false;
    }
    profile['mixed-port'] = await freePort();
    profile['external-controller'] = `127.0.0.1:${controlPort}`;
    profile['bind-address'] = '127.0.0.1';
    profile['rule-providers'] = {};
    profile.rules = ['MATCH,REJECT']; // Do not download public rules or contact real nodes.
    directory = await mkdtemp(join(tmpdir(), 'mihomo-provider-refresh-'));
    await writeFile(join(directory, 'config.yaml'), stringify(profile));
    child = spawn(
      core!,
      ['-d', directory, '-f', join(directory, 'config.yaml')],
      { windowsHide: true },
    );
    child.stdout?.on('data', (data: Buffer) => {
      logs += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      logs += data.toString();
    });
    await eventually(async () =>
      (await names()).some((name) => name.includes('US First')),
    );
  }, 20000);
  afterAll(async () => {
    if (child && child.exitCode === null)
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      });
    http.closeAllConnections();
    if (http.listening)
      await new Promise<void>((resolve) => http.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it('bootstraps offline, replaces nodes on timer, retains cache on failure and clears unavailable access without restarting', async () => {
    // Clash Verge resolves provider members by name across every provider.
    // Multiple candidates produce a disabled "ambiguous" tile.
    const allNames = await names();
    const aiNames = await names('素心 AI 节点');
    expect(allNames.filter((name) => aiNames.includes(name))).toEqual([]);
    for (const [groupName, target] of [
      ['节点选择', allNames[0]],
      ['AI 服务', aiNames[0]],
    ]) {
      const selected = await fetch(
        `${controller}/proxies/${encodeURIComponent(groupName)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: target }),
        },
      );
      expect(selected.status).toBe(204);
    }
    const pid = child.pid;
    failure = false;
    nodes = [{ ...node, label: 'US Replacement' }];
    await eventually(async () => {
      const list = await names();
      return (
        list.some((name) => name.includes('Replacement')) &&
        !list.some((name) => name.includes('First'))
      );
    });
    failure = true;
    const before = requests;
    await eventually(() => requests > before);
    expect((await names()).some((name) => name.includes('Replacement'))).toBe(
      true,
    );
    failure = false;
    nodes = [{ ...node, label: 'Japan Only', region: 'JP' }];
    await eventually(async () =>
      (await names('素心 AI 节点')).every((name) =>
        name.includes('Japan Only'),
      ),
    );
    nodes.push({ ...node, label: 'US New' });
    await eventually(async () => {
      const ai = await names('素心 AI 节点');
      const all = await names();
      return all.length === 2 && ai.length === 1 && ai[0].includes('US New');
    });
    const groupResponse = await fetch(
      `${controller}/proxies/${encodeURIComponent('节点选择')}`,
    );
    const group = (await groupResponse.json()) as { all: string[] };
    expect(group.all).toEqual(expect.arrayContaining(await names()));
    expect(group.all.some((name) => name.includes('Replacement'))).toBe(false);
    nodes = [];
    await eventually(async () => (await names()).join(',') === '暂无可用节点');
    const response = await fetch(
      `${controller}/providers/proxies/${encodeURIComponent('素心节点')}`,
    );
    const blocked = (await response.json()) as { proxies: { type: string }[] };
    expect(blocked.proxies[0].type.toLowerCase()).toContain('reject');
    expect(child.pid).toBe(pid);
    expect(child.exitCode).toBeNull();
  }, 40000);
});
