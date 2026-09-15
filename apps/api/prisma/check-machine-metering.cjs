// Run against a local/isolated database; all fixtures roll back on success or failure.
require('dotenv').config({ quiet: true });
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { EntitlementService } = require('../src/entitlement/entitlement.service');
const url = new URL(process.env.DATABASE_URL);
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local or restored database required');
const prisma = new PrismaClient();
const rollback = new Error('ROLLBACK_TEST_FIXTURES');

async function main() {
  for (const [machineRate, userRate, expected] of [[10000, null, 100n], [20000, null, 200n], [10000, 30000, 300n], [20000, 5000, 200n]]) {
    try {
      await prisma.$transaction(async (tx) => {
        const key = `meter-check-${Date.now()}-${machineRate}-${userRate}`;
        const user = await tx.user.create({ data: { email: `${key}@example.invalid`, displayName: key, passwordHash: 'not-a-login' } });
        const account = await tx.accessAccount.create({ data: { userId: user.id, trafficMultiplierBasisPoints: 90000, trafficMultiplierOverrideBasisPoints: userRate } });
        const server = await tx.nodeServer.create({ data: { slug: key, name: key, hostname: `${key}.invalid`, trafficMultiplierBasisPoints: machineRate } });
        const profile = await tx.accessProfile.create({ data: { slug: key, name: key, speedUpMbps: 100, speedDownMbps: 100, deviceLimit: 1000 } });
        const nodes = [];
        for (const [index, protocol] of ['HYSTERIA2', 'VLESS_REALITY'].entries()) {
          const node = await tx.node.create({ data: { serverId: server.id, label: `${key}-${protocol}`, hostname: '127.0.0.1', port: 59000 + index, protocol, trafficApiBaseUrl: 'http://127.0.0.1:1', trafficApiSecret: 'unused', speedUpMbps: 100, speedDownMbps: 100 } });
          await tx.accessProfileNode.create({ data: { accessProfileId: profile.id, nodeId: node.id, priority: index } });
          nodes.push(node);
        }
        const startsAt = new Date(Date.now() - 60000);
        const endsAt = new Date(Date.now() + 86400000);
        const buckets = [];
        for (const [index, kind] of ['PLAN', 'TRAFFIC_PACK'].entries()) {
          const product = await tx.catalogProduct.create({ data: { slug: `${key}-${kind}`, name: key, kind, quotaCadence: 'ONE_TIME', accessProfileId: profile.id } });
          const grant = await tx.entitlementGrant.create({ data: { userId: user.id, accessAccountId: account.id, productId: product.id, kind, startsAt, endsAt, accessProfileId: profile.id, speedUpMbpsSnapshot: 100, speedDownMbpsSnapshot: 100, deviceLimitSnapshot: 1000, trafficMultiplierBasisPointsSnapshot: 90000 } });
          buckets.push(await tx.quotaBucket.create({ data: { grantId: grant.id, kind: index ? 'TRAFFIC_PACK' : 'PLAN_CYCLE', startsAt, endsAt, grantedBytes: index ? 10000n : 80n, trafficMultiplierBasisPointsSnapshot: 90000 } }));
        }
        const service = new EntitlementService({ $transaction: (operation) => operation(tx) });
        const batch = { id: `${key}-batch`, claimedAt: new Date().toISOString(), traffic: { [user.id]: { tx: 40, rx: 60 } } };
        for (const node of nodes) await service.applyUsageBatch(node.id, batch);
        const usage = await tx.usageRollup.findMany({ where: { userId: user.id }, include: { allocations: true } });
        assert.equal(usage.length, 2);
        for (const row of usage) {
          assert.equal(row.rawBytes, 100n);
          assert.equal(row.accountedBytes, expected);
          assert.equal(row.multiplierBasisPoints, Number(expected) * 100);
          assert.equal(row.allocations.reduce((sum, entry) => sum + entry.accountedBytes, 0n), expected);
        }
        const plan = await tx.quotaBucket.findUniqueOrThrow({ where: { id: buckets[0].id } });
        const pack = await tx.quotaBucket.findUniqueOrThrow({ where: { id: buckets[1].id } });
        assert.equal(plan.consumedBytes, 80n);
        assert.equal(pack.consumedBytes, expected * 2n - 80n);
        await tx.nodeServer.update({ where: { id: server.id }, data: { trafficMultiplierBasisPoints: 80000 } });
        assert.equal((await service.applyUsageBatch(nodes[0].id, batch)).replayed, true);
        assert.equal(await tx.usageRollup.count({ where: { userId: user.id } }), 2);
        const physical = await tx.usageImportBatch.aggregate({ where: { nodeId: { in: nodes.map((node) => node.id) } }, _sum: { totalTxBytes: true, totalRxBytes: true } });
        assert.equal(physical._sum.totalTxBytes + physical._sum.totalRxBytes, 200n);
        console.log(`PASS machine=${machineRate / 10000}x user=${userRate == null ? 'default' : userRate / 10000}x physical=100 billed=${expected} each protocol; replay and physical totals verified`);
        throw rollback;
      }, { timeout: 30000 });
    } catch (error) { if (error !== rollback) throw error; }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
