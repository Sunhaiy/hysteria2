// Runs two local Hysteria clients and a local server; no production data.
// node ops/hysteria/check-disconnect.mjs /path/to/hysteria /path/to/openssl
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const exec = promisify(execFile), binary = resolve(process.argv[2]), openssl = resolve(process.argv[3]);
const dir = await mkdtemp(join(tmpdir(), 'hysteria-disconnect-'));
const clients = [], sockets = new Set(), allowed = new Set(['a', 'b']);
let logs = '';
const auth = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const user = JSON.parse(body).auth;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: allowed.has(user), id: user }));
});
const echo = net.createServer(s => { sockets.add(s); s.on('close', () => sockets.delete(s)); s.pipe(s); });
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', r));
await listen(auth); await listen(echo);
async function freePort() { const s = net.createServer(); await listen(s); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
async function start(role, config, name) {
  const path = join(dir, `${name}.json`); await writeFile(path, JSON.stringify(config));
  const p = spawn(binary, [role, '-c', path], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', b => { logs += b; }); p.stdout.on('data', b => { logs += b; }); clients.push(p); return p;
}
async function connect(port) {
  const s = net.connect(port, '127.0.0.1'); sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s));
  await new Promise((res, rej) => { s.once('connect', res); s.once('error', rej); });
  return s;
}
async function exchange(s, message) {
  return new Promise((res, rej) => {
    let data = ''; const timer = setTimeout(() => done(new Error('echo timeout')), 3000);
    const onData = b => { data += b; if (data.length >= message.length) done(null, data); };
    const onClose = () => done(new Error('stream closed'));
    function done(e, text) { clearTimeout(timer); s.off('data', onData); s.off('close', onClose); e ? rej(e) : res(text); }
    s.on('data', onData); s.once('close', onClose); s.write(message);
  });
}
try {
  await exec(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { windowsHide: true });
  const port = await freePort(), stats = await freePort(), aPort = await freePort(), bPort = await freePort();
  await start('server', { listen: `127.0.0.1:${port}`, tls: { cert: join(dir, 'cert.pem'), key: join(dir, 'key.pem') },
    auth: { type: 'http', http: { url: `http://127.0.0.1:${auth.address().port}` } },
    trafficStats: { listen: `127.0.0.1:${stats}`, secret: 'test-stats-secret' } }, 'server');
  for (const [user, local] of [['a', aPort], ['b', bPort]]) {
    await start('client', { server: `127.0.0.1:${port}`, auth: user, tls: { insecure: true },
      tcpForwarding: [{ listen: `127.0.0.1:${local}`, remote: `127.0.0.1:${echo.address().port}` }] }, user);
  }
  let first, other;
  for (let i = 0; i < 50; i++) {
    try { first = await connect(aPort); other = await connect(bPort); break; }
    catch { first?.destroy(); await new Promise(r => setTimeout(r, 100)); }
  }
  assert(first && other, 'clients did not start');
  assert.equal(await exchange(first, 'hello-a'), 'hello-a');
  assert.equal(await exchange(other, 'hello-b'), 'hello-b');
  allowed.delete('a');
  const closed = new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error('old Hysteria stream survived kick')), 2000); first.once('close', () => { clearTimeout(timer); res(); }); });
  const result = await fetch(`http://127.0.0.1:${stats}/kick`, { method: 'POST', headers: { Authorization: 'test-stats-secret', 'Content-Type': 'application/json' }, body: JSON.stringify(['a']) });
  assert(result.ok); await closed;
  assert.equal(await exchange(other, 'unaffected'), 'unaffected');
  const rejected = await connect(aPort);
  await assert.rejects(exchange(rejected, 'denied'), /closed/);
  allowed.add('a');
  const restored = await connect(aPort);
  assert.equal(await exchange(restored, 'restored'), 'restored');
  console.log('PASS: Hysteria old stream closed; reauth denied; other user unaffected; restored user reconnects');
} catch (error) { console.error(logs); throw error; }
finally {
  for (const s of sockets) s.destroy();
  for (const p of clients) { p.kill(); await new Promise(r => { if (p.exitCode !== null) r(); else p.once('exit', r); }); }
  await new Promise(r => auth.close(r)); await new Promise(r => echo.close(r));
  await rm(dir, { recursive: true });
}

