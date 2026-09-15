// Isolated real-core regression: never uses production UUIDs, nodes or ports.
// node ops/xray/check-disconnect.mjs /absolute/path/to/xray
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile);
const binary = resolve(process.argv[2]);
const folder = await mkdtemp(join(tmpdir(), 'xray-disconnect-'));
const sockets = new Set();
const echo = net.createServer(s => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.pipe(s); });
await new Promise(r => echo.listen(0, '127.0.0.1', r));
async function freePort() {
  const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port; await new Promise(r => s.close(r)); return port;
}
const port = await freePort(), api = await freePort();
const a = '33333333-3333-4333-8333-333333333333';
const b = '44444444-4444-4444-8444-444444444444';
const config = {
  stats: {},
  log: { loglevel: 'info' },
  api: { tag: 'api', services: ['HandlerService', 'StatsService'], listen: `127.0.0.1:${api}` },
  inbounds: [{ tag: 'quota-test', listen: '127.0.0.1', port, protocol: 'vless',
    settings: { decryption: 'none', clients: [{ id: a, email: 'quota-a' }, { id: b, email: 'quota-b' }] } }],
  outbounds: [{ protocol: 'freedom', tag: 'direct' }],
};
await writeFile(join(folder, 'config.json'), JSON.stringify(config));
const child = spawn(binary, ['run', '-c', join(folder, 'config.json')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
async function connect(id) {
  const s = net.connect(port, '127.0.0.1'); sockets.add(s);
  s.on('close', () => sockets.delete(s)); s.on('error', () => {});
  await new Promise((res, rej) => { s.once('connect', res); s.once('error', rej); });
  const destination = echo.address().port;
  s.write(Buffer.concat([Buffer.from([0]), Buffer.from(id.replaceAll('-', ''), 'hex'),
    Buffer.from([0, 1, destination >> 8, destination & 255, 1, 127, 0, 0, 1])]));
  let pending = Buffer.alloc(0); const waiters = [];
  s.on('data', data => { pending = Buffer.concat([pending, data]); for (const notify of [...waiters]) notify(); });
  async function read(n) {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => finish(new Error('stream read timed out')), 3000);
      function finish(error, result) { clearTimeout(timer); const i = waiters.indexOf(check); if (i >= 0) waiters.splice(i, 1); s.off('close', closed); error ? rej(error) : res(result); }
      function closed() { finish(new Error('stream closed')); }
      function check() { if (pending.length >= n) { const result = pending.subarray(0, n); pending = pending.subarray(n); finish(null, result); } }
      waiters.push(check); s.once('close', closed); check();
    });
  }
  s.write('hello');
  assert.deepEqual(await read(2), Buffer.from([0, 0]));
  assert.equal((await read(5)).toString(), 'hello');
  return { s, read };
}
try {
  let ready = false, lastApiError = '';
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`core exited: ${logs}`);
    try { await exec(binary, ['api', 'statsquery', `--server=127.0.0.1:${api}`], { windowsHide: true }); ready = true; break; }
    catch (e) { lastApiError = e.message; await new Promise(r => setTimeout(r, 100)); }
  }
  assert(ready, `core API did not start: ${lastApiError}\n${logs}`);
  const first = await connect(a), other = await connect(b);
  const closed = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('existing user A stream survived revocation')), 2000);
    first.s.once('close', () => { clearTimeout(timer); res(); });
  });
  const removal = await exec(binary, ['api', 'rmu', `--server=127.0.0.1:${api}`, '-tag=quota-test', 'quota-a'], { windowsHide: true });
  assert.match(removal.stdout, /Removed 1 user/);
  await closed;
  other.s.write('still-alive'); assert.equal((await other.read(11)).toString(), 'still-alive');
  await assert.rejects(connect(a), /closed|ECONNRESET/);
  // Restore the same credential as a new account generation; an old cleanup
  // callback must not close the restored user's newly established stream.
  await writeFile(join(folder, 'restore.json'), JSON.stringify({ inbounds: [{ ...config.inbounds[0], settings: { clients: [{ id: a, email: 'quota-a' }], decryption: 'none' } }] }));
  const addition = await exec(binary, ['api', 'adu', `--server=127.0.0.1:${api}`, join(folder, 'restore.json')], { windowsHide: true });
  assert.match(addition.stdout, /Added 1 user/, addition.stdout);
  const restored = await connect(a);
  restored.s.write('restored'); assert.equal((await restored.read(8)).toString(), 'restored');
  console.log('PASS: active stream closed; new connection denied; other user uninterrupted; restored user reconnects');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  for (const s of sockets) s.destroy();
  child.kill();
  await new Promise(r => { if (child.exitCode !== null) r(); else child.once('exit', r); });
  await new Promise(r => echo.close(r));
  await rm(folder, { recursive: true });
}

