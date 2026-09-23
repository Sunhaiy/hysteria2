import { spawn, type ChildProcess } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { createServer, request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo, createServer as createTcpServer } from 'node:net';
import { parse, stringify } from 'yaml';
import { buildMihomoProfile } from '../src/portal/mihomo-profile';

// Runs a separate core on ephemeral loopback ports; never changes the user's client.
const core = process.env.MIHOMO_TEST_BINARY;
const coreDescribe = core ? describe : describe.skip;

coreDescribe('Mihomo private-domain routing with a real DNS response', () => {
  let child: ChildProcess;
  let directory: string;
  let proxyPort: number;
  let httpPort: number;
  let logs = '';
  const dns = createSocket('udp4');
  const http = createServer((_req, res) => res.end('intranet reached'));

  beforeAll(async () => {
    dns.on('message', (query, remote) => {
      let end = 12;
      const labels: string[] = [];
      while (query[end]) {
        const length = query[end++];
        labels.push(query.subarray(end, end + length).toString());
        end += length;
      }
      end++;
      const isA = query.readUInt16BE(end) === 1;
      const header = Buffer.from(query.subarray(0, 12));
      header.writeUInt16BE(0x8180, 2);
      header.writeUInt16BE(isA ? 1 : 0, 6);
      header.writeUInt16BE(0, 8);
      header.writeUInt16BE(0, 10);
      const address =
        labels.join('.') === 'office.example.test'
          ? [127, 0, 0, 1]
          : [198, 51, 100, 42];
      const answer = isA
        ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, ...address])
        : Buffer.alloc(0);
      dns.send(
        Buffer.concat([header, query.subarray(12, end + 4), answer]),
        remote.port,
        remote.address,
      );
    });
    await new Promise<void>((resolve) => dns.bind(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    httpPort = (http.address() as AddressInfo).port;
    const reserve = createTcpServer();
    await new Promise<void>((resolve) =>
      reserve.listen(0, '127.0.0.1', resolve),
    );
    proxyPort = (reserve.address() as AddressInfo).port;
    await new Promise<void>((resolve) => reserve.close(() => resolve()));
    const generated = parse(
      buildMihomoProfile({ token: 'unused', vlessUuid: 'unused' }, []),
    ) as { rules: string[] };
    directory = await mkdtemp(join(tmpdir(), 'mihomo-private-routing-'));
    await writeFile(
      join(directory, 'config.yaml'),
      stringify({
        'mixed-port': proxyPort,
        'bind-address': '127.0.0.1',
        'allow-lan': false,
        mode: 'rule',
        'log-level': 'debug',
        ipv6: false,
        dns: {
          enable: true,
          ipv6: false,
          'enhanced-mode': 'redir-host',
          nameserver: [`udp://127.0.0.1:${dns.address().port}`],
        },
        // Isolate the emitted private IP rules from external rule downloads.
        // REJECT makes any accidentally proxied request fail deterministically.
        rules: [
          ...generated.rules.filter((rule) => /^IP-CIDR6?,/.test(rule)),
          'MATCH,REJECT',
        ],
      }),
    );
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
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        if (logs.includes('Mixed(http+socks) proxy listening')) {
          clearInterval(timer);
          clearTimeout(timeout);
          resolve();
        } else if (child.exitCode !== null) {
          clearInterval(timer);
          clearTimeout(timeout);
          reject(new Error(logs));
        }
      }, 50);
      child.once('error', (error) => {
        clearInterval(timer);
        clearTimeout(timeout);
        reject(error);
      });
      const timeout = setTimeout(() => {
        clearInterval(timer);
        reject(new Error(logs || 'Core startup timed out'));
      }, 8000);
    });
  }, 15000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      });
    }
    http.closeAllConnections();
    if (http.listening)
      await new Promise<void>((resolve) => http.close(() => resolve()));
    dns.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function fetchThroughProxy(host: string) {
    return new Promise<string>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: proxyPort,
          path: `http://${host}:${httpPort}/`,
          headers: { Host: `${host}:${httpPort}` },
        },
        (res) => {
          let body = '';
          res.on('data', (data: Buffer) => {
            body += data.toString();
          });
          res.on('end', () =>
            res.statusCode === 200
              ? resolve(body)
              : reject(new Error(`HTTP ${res.statusCode}`)),
          );
        },
      );
      req.setTimeout(3000, () =>
        req.destroy(new Error('Proxy request timed out')),
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('reaches an internal domain whose DNS result is private', async () => {
    await expect(fetchThroughProxy('office.example.test')).resolves.toBe(
      'intranet reached',
    );
  });
  it('still reaches literal private IPs directly', async () => {
    await expect(fetchThroughProxy('127.0.0.1')).resolves.toBe(
      'intranet reached',
    );
  });
  it('does not bypass proxy policy for a public DNS result', async () => {
    await expect(fetchThroughProxy('public.example.test')).rejects.toThrow();
  });
});
