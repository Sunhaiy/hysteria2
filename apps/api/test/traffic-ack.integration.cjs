// Uses real services and PostgreSQL; the only remote dependency is a loopback
// Agent fixture with deliberately lost responses.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.TRAFFIC_ACK_TEST_DATABASE_URL || '');
assert(
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.searchParams.get('schema') === 'traffic_ack_test',
  'An isolated local traffic_ack_test schema is required',
);
require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '../tsconfig.json'),
});
const { PrismaClient } = require('@prisma/client');
const { HttpService } = require('@nestjs/axios');
const { UsageSyncService } = require('../src/usage-sync/usage-sync.service');
const {
  ControlPlaneStoreService,
} = require('../src/domain/control-plane.store');
const { NodeControlService } = require('../src/domain/node-control.service');
const {
  SecretCipherService,
} = require('../src/security/secret-cipher.service');
const {
  EntitlementService,
} = require('../src/entitlement/entitlement.service');
const {
  QuotaEnforcementService,
} = require('../src/kick-service/quota-enforcement.service');
const {
  NodeTrafficClientService,
} = require('../src/integrations/node-traffic-client.service');
const {
  NodeAdapterRegistry,
  TestNodeAdapter,
  HysteriaNodeAdapter,
  XrayHttpNodeAdapter,
} = require('../src/integrations/node.adapter');
const db = new PrismaClient({ datasourceUrl: url.toString() });
const createdNodes = [];
const createdUsers = [];
const servers = [];

async function fixture({
  loseAck = false,
  oldUnknown = false,
  denyAck = false,
} = {}) {
  const state = {
    pending: null,
    lastAck: null,
    sequence: 0,
    loseAck,
    denyAck,
    acked: [],
    claims: 0,
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/traffic/claim') {
        state.claims++;
        state.pending ??= {
          id: `batch-${++state.sequence}`,
          claimedAt: new Date().toISOString(),
          traffic: {},
        };
        response.end(JSON.stringify(state.pending));
      } else if (request.url === '/traffic/ack') {
        const { id } = JSON.parse(body);
        if (state.denyAck) {
          response.end('{"ok":false}');
          return;
        }
        if (state.lastAck === id) {
          response.end('{"ok":true}');
          return;
        }
        if (!state.pending || state.pending.id !== id) {
          response.statusCode = 409;
          response.end('{"message":"traffic batch is not pending"}');
          return;
        }
        state.pending = null;
        state.lastAck = id;
        state.acked.push(id);
        if (state.loseAck) {
          state.loseAck = false;
          response.destroy();
          return;
        }
        response.end('{"ok":true}');
      } else if (request.url === '/users') {
        response.end('{"added":0,"removed":0,"total":0}');
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const suffix = randomUUID();
  const node = await db.node.create({
    data: {
      label: `ACK fixture ${suffix}`,
      hostname: `${suffix}.invalid`,
      port: 443,
      protocol: 'VLESS_REALITY',
      speedUpMbps: 100,
      speedDownMbps: 100,
      trafficApiSecret: 'fixture-secret',
      trafficApiBaseUrl: `http://127.0.0.1:${server.address().port}`,
    },
  });
  createdNodes.push(node.id);
  if (oldUnknown)
    await db.usageImportBatch.create({
      data: {
        nodeId: node.id,
        externalId: 'historical-unknown',
        claimedAt: new Date(0),
        appliedAt: new Date(0),
        totalTxBytes: 0n,
        totalRxBytes: 0n,
        recordCount: 0,
      },
    });
  const cipher = new SecretCipherService();
  const nodes = new NodeControlService(db, cipher);
  const store = new ControlPlaneStoreService(db, {});
  const client = new NodeTrafficClientService(new HttpService());
  const registry = new NodeAdapterRegistry(
    new TestNodeAdapter(client),
    new HysteriaNodeAdapter(client),
    new XrayHttpNodeAdapter(client),
  );
  const entitlements = new EntitlementService(db);
  const enforcement = new QuotaEnforcementService(
    db,
    nodes,
    entitlements,
    registry,
  );
  const makeWorker = () =>
    new UsageSyncService(store, registry, enforcement, entitlements, nodes);
  return { node, state, makeWorker };
}

async function receiptState(nodeId, externalId) {
  return (
    await db.usageImportBatch.findUniqueOrThrow({
      where: { nodeId_externalId: { nodeId, externalId } },
    })
  ).status;
}

(async () => {
  const f = await fixture({ loseAck: true });
  await assert.rejects(f.makeWorker().syncNode(f.node.id), /socket hang up/);
  assert.equal(await receiptState(f.node.id, 'batch-1'), 'APPLIED');
  await f.makeWorker().syncNode(f.node.id);
  assert.equal(
    await receiptState(f.node.id, 'batch-1'),
    'ACKED',
    'A new worker must reconcile the accepted receipt before collecting another batch',
  );
  assert.equal(await receiptState(f.node.id, 'batch-2'), 'ACKED');
  assert.deepEqual(f.state.acked, ['batch-1', 'batch-2']);
  console.log(
    'PASS lost acknowledgement response recovers after worker restart',
  );

  const old = await fixture({ oldUnknown: true });
  await old.makeWorker().syncNode(old.node.id);
  assert.equal(
    await receiptState(old.node.id, 'historical-unknown'),
    'APPLIED',
    'An unknown old receipt must not be invented as acknowledged',
  );
  assert.equal(
    await receiptState(old.node.id, 'batch-1'),
    'ACKED',
    'Old unverifiable receipts must not halt new accounting',
  );
  console.log(
    'PASS unverifiable history remains visible without blocking current accounting',
  );

  const refused = await fixture({ denyAck: true });
  await assert.rejects(
    refused.makeWorker().syncNode(refused.node.id),
    /acknowledg/i,
  );
  assert.equal(await receiptState(refused.node.id, 'batch-1'), 'APPLIED');
  refused.state.denyAck = false;
  await refused.makeWorker().syncNode(refused.node.id);
  assert.equal(await receiptState(refused.node.id, 'batch-1'), 'ACKED');
  console.log('PASS negative ACK cannot mark an applied receipt complete');

  const disabled = await fixture({ loseAck: true });
  await assert.rejects(disabled.makeWorker().syncNode(disabled.node.id));
  await db.node.update({
    where: { id: disabled.node.id },
    data: { active: false },
  });
  const claimsBeforeRecovery = disabled.state.claims;
  await disabled.makeWorker().reconcileInactiveNodeAcknowledgements();
  assert.equal(await receiptState(disabled.node.id, 'batch-1'), 'ACKED');
  assert.equal(
    disabled.state.claims,
    claimsBeforeRecovery,
    'Disabled recovery must not collect fresh traffic or provision users',
  );
  console.log(
    'PASS disabled node ACK recovery leaves runtime and collection alone',
  );

  const localFailure = await fixture();
  assert(/^[a-z0-9]+$/.test(localFailure.node.id));
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_local_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW."nodeId" = '${localFailure.node.id}' AND NEW.status = 'ACKED' THEN RAISE EXCEPTION 'injected ACK write failure'; END IF;
    RETURN NEW; END $$`);
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_local_ack BEFORE UPDATE ON "UsageImportBatch" FOR EACH ROW EXECUTE FUNCTION fail_local_ack()`,
  );
  try {
    await assert.rejects(
      localFailure.makeWorker().syncNode(localFailure.node.id),
      /injected ACK write failure/,
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER fail_local_ack ON "UsageImportBatch"',
    );
    await db.$executeRawUnsafe('DROP FUNCTION fail_local_ack()');
  }
  assert.equal(await receiptState(localFailure.node.id, 'batch-1'), 'APPLIED');
  await localFailure.makeWorker().syncNode(localFailure.node.id);
  assert.equal(await receiptState(localFailure.node.id, 'batch-1'), 'ACKED');
  console.log(
    'PASS local confirmation failure recovers without importing the old batch again',
  );

  const restricted = await fixture();
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@ack.invalid`,
      displayName: 'ACK fixture',
      passwordHash: 'not-a-login',
      status: 'BANNED',
    },
  });
  createdUsers.push(user.id);
  restricted.state.sequence = 1;
  restricted.state.pending = {
    id: 'batch-1',
    claimedAt: new Date().toISOString(),
    traffic: { [user.id]: { tx: 1, rx: 2 } },
  };
  await db.usageImportBatch.create({
    data: {
      nodeId: restricted.node.id,
      externalId: 'batch-1',
      claimedAt: new Date(),
      totalTxBytes: 1n,
      totalRxBytes: 2n,
      recordCount: 1,
      rollups: {
        create: {
          nodeId: restricted.node.id,
          userId: user.id,
          bucketStart: new Date(),
          txBytes: 1n,
          rxBytes: 2n,
          source: 'test',
        },
      },
    },
  });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION fail_recovery_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected queue failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_recovery_queue BEFORE INSERT ON "NodeAccessRevocation" FOR EACH ROW EXECUTE FUNCTION fail_recovery_queue()',
  );
  try {
    await assert.rejects(
      restricted.makeWorker().syncNode(restricted.node.id),
      /injected queue failure/,
    );
    assert.equal(
      restricted.state.acked.length,
      0,
      'Recovery must queue restricted access before ACK',
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER fail_recovery_queue ON "NodeAccessRevocation"',
    );
    await db.$executeRawUnsafe('DROP FUNCTION fail_recovery_queue()');
  }
  await restricted.makeWorker().syncNode(restricted.node.id);
  assert.equal(await receiptState(restricted.node.id, 'batch-1'), 'ACKED');
  assert(
    (await db.nodeAccessRevocation.count({
      where: { userId: user.id, nodeId: restricted.node.id },
    })) > 0,
  );
  console.log('PASS recovery preserves durable quota enforcement before ACK');
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const server of servers)
      await new Promise((resolve) => server.close(resolve));
    for (const id of createdNodes) await db.node.delete({ where: { id } });
    for (const id of createdUsers) {
      await db.nodeAccessRevocation.deleteMany({ where: { userId: id } });
      await db.user.delete({ where: { id } });
    }
    await db.$disconnect();
  });
