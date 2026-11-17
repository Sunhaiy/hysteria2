// Run only against an isolated local billing_test schema created from schema.prisma.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.BILLING_TEST_DATABASE_URL || '');
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
    url.searchParams.get('schema') === 'billing_test',
  'An isolated local billing_test schema is required',
);
require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '../tsconfig.json'),
});
const { PrismaClient } = require('@prisma/client');
const {
  EntitlementService,
} = require('../src/entitlement/entitlement.service');
const db = new PrismaClient({ datasourceUrl: url.toString() });
const service = new EntitlementService(db);
const fixtures = [];

async function member({ machineRate = 10000, userRate = null } = {}) {
  const suffix = randomUUID();
  const user = await db.user.create({
    data: {
      email: `${suffix}@billing.invalid`,
      displayName: 'Billing integration fixture',
      passwordHash: 'not-a-login',
    },
  });
  const account = await db.accessAccount.create({
    data: {
      userId: user.id,
      trafficMultiplierBasisPoints: 90000,
      trafficMultiplierOverrideBasisPoints: userRate,
    },
  });
  const server = await db.nodeServer.create({
    data: {
      slug: suffix,
      name: 'Billing fixture',
      hostname: `${suffix}.invalid`,
      trafficMultiplierBasisPoints: machineRate,
    },
  });
  const profile = await db.accessProfile.create({
    data: {
      slug: suffix,
      name: 'Billing fixture',
      speedUpMbps: 100,
      speedDownMbps: 100,
      deviceLimit: 10,
    },
  });
  const nodes = [];
  for (const [index, protocol] of ['HYSTERIA2', 'VLESS_REALITY'].entries()) {
    const node = await db.node.create({
      data: {
        serverId: server.id,
        label: `${suffix}-${protocol}`,
        hostname: `${suffix}.invalid`,
        port: 59620 + index,
        protocol,
        trafficApiBaseUrl: 'http://127.0.0.1:1',
        trafficApiSecret: 'unused-fixture',
        speedUpMbps: 100,
        speedDownMbps: 100,
      },
    });
    await db.accessProfileNode.create({
      data: { accessProfileId: profile.id, nodeId: node.id },
    });
    nodes.push(node);
  }
  const fixture = {
    user,
    account,
    server,
    profile,
    nodes,
    products: [],
    plans: [],
  };
  fixtures.push(fixture);
  return fixture;
}

async function grant(
  fixture,
  {
    kind = 'PLAN',
    bytes = 100n,
    cadence = 'ONE_TIME',
    startsAt = new Date(Date.now() - 60_000),
    endsAt = new Date(Date.now() + 86_400_000),
    bucket = true,
    bucketStart = startsAt,
    bucketEnd = endsAt,
  } = {},
) {
  const suffix = randomUUID();
  const product = await db.catalogProduct.create({
    data: {
      slug: suffix,
      name: 'Billing fixture',
      kind,
      quotaCadence: cadence,
      accessProfileId: fixture.profile.id,
    },
  });
  fixture.products.push(product);
  const offer = await db.catalogOffer.create({
    data: {
      productId: product.id,
      slug: suffix,
      name: 'Billing fixture',
      billingPeriod: 'MONTHLY',
      intervalMonths: 1,
      trafficBytes: bytes,
      priceCents: 100,
    },
  });
  const entitlement = await db.entitlementGrant.create({
    data: {
      userId: fixture.user.id,
      accessAccountId: fixture.account.id,
      productId: product.id,
      offerId: offer.id,
      kind,
      startsAt,
      endsAt,
      accessProfileId: fixture.profile.id,
      speedUpMbpsSnapshot: 100,
      speedDownMbpsSnapshot: 100,
      deviceLimitSnapshot: 10,
      trafficMultiplierBasisPointsSnapshot: 90000,
      quotaCadenceSnapshot: cadence,
      resetAnchorAt: cadence === 'MONTHLY_RESET' ? startsAt : null,
      trafficBytesSnapshot: bytes,
    },
  });
  if (bucket)
    await db.quotaBucket.create({
      data: {
        grantId: entitlement.id,
        kind: kind === 'PLAN' ? 'PLAN_CYCLE' : 'TRAFFIC_PACK',
        startsAt: bucketStart,
        endsAt: bucketEnd,
        grantedBytes: bytes,
        trafficMultiplierBasisPointsSnapshot: 90000,
      },
    });
  return entitlement;
}

function batch(fixture, bytes, id = randomUUID(), claimedAt = new Date()) {
  return {
    id,
    claimedAt: claimedAt.toISOString(),
    traffic: { [fixture.user.id]: { tx: bytes, rx: 0 } },
  };
}

async function cleanup() {
  for (const fixture of fixtures.reverse()) {
    await db.user.delete({ where: { id: fixture.user.id } });
    await db.node.deleteMany({ where: { serverId: fixture.server.id } });
    await db.nodeServer.delete({ where: { id: fixture.server.id } });
    for (const product of fixture.products) {
      await db.catalogOffer.deleteMany({ where: { productId: product.id } });
      await db.catalogProduct.delete({ where: { id: product.id } });
    }
    for (const plan of fixture.plans) {
      await db.planOffer.deleteMany({ where: { planId: plan.id } });
      await db.plan.delete({ where: { id: plan.id } });
    }
    await db.accessProfile.delete({ where: { id: fixture.profile.id } });
  }
}

async function monthlyReset() {
  const f = await member();
  const now = new Date();
  const startsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const currentStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const endsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  await grant(f, {
    cadence: 'MONTHLY_RESET',
    startsAt,
    endsAt,
    bucketEnd: currentStart,
  });
  const currentReceipt = batch(f, 10);
  await service.applyTrafficBatch(f.nodes[0].id, currentReceipt);
  const access = await service.resolveAccess(f.user.id, f.nodes[0].id);
  assert.equal(
    access.remainingBytes,
    90,
    'First traffic after monthly reset must consume the new period even before a new auth/provisioning call',
  );
  await service.applyTrafficBatch(
    f.nodes[0].id,
    batch(f, 20, randomUUID(), new Date(currentStart.getTime() - 1)),
  );
  assert.equal(
    (await service.resolveAccess(f.user.id, f.nodes[0].id)).remainingBytes,
    90,
    'Delayed old-period usage must not consume current quota',
  );
  assert.equal(
    (await service.applyTrafficBatch(f.nodes[0].id, currentReceipt)).replayed,
    true,
  );
  assert.equal(
    (await service.resolveAccess(f.user.id, f.nodes[0].id)).remainingBytes,
    90,
    'Replay after reset must not charge twice',
  );
  const periods = await db.quotaBucket.findMany({
    where: { grant: { userId: f.user.id } },
    orderBy: { startsAt: 'asc' },
  });
  assert.deepEqual(
    periods.map((p) => p.consumedBytes),
    [20n, 10n],
  );
  console.log(
    'PASS monthly-reset traffic creates and consumes the new quota period',
  );
}

async function machineRates() {
  for (const [machineRate, userRate, charged] of [
    [10000, null, 100n],
    [20000, 5000, 200n],
    [10000, 30000, 300n],
    [20000, 15000, 200n],
  ]) {
    const f = await member({ machineRate, userRate });
    const plan = await grant(f, {
      bytes: 80n,
      endsAt: new Date(Date.now() + 2 * 86_400_000),
    });
    const pack = await grant(f, { kind: 'TRAFFIC_PACK', bytes: 10000n });
    const receipt = batch(f, 100);
    for (const node of f.nodes)
      await service.applyTrafficBatch(node.id, receipt);
    let rows = await db.usageRollup.findMany({
      where: { userId: f.user.id },
      include: { allocations: true },
    });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.rawBytes, 100n);
      assert.equal(row.accountedBytes, charged);
      assert.equal(
        row.allocations.reduce((sum, a) => sum + a.accountedBytes, 0n),
        charged,
      );
      assert.equal(row.overageBytes, 0n);
    }
    assert.equal(
      (await db.quotaBucket.findFirstOrThrow({ where: { grantId: plan.id } }))
        .consumedBytes,
      80n,
    );
    assert.equal(
      (await db.quotaBucket.findFirstOrThrow({ where: { grantId: pack.id } }))
        .consumedBytes,
      charged * 2n - 80n,
    );
    await db.nodeServer.update({
      where: { id: f.server.id },
      data: { trafficMultiplierBasisPoints: 80000 },
    });
    await service.applyTrafficBatch(f.nodes[0].id, receipt);
    rows = await db.usageRollup.findMany({ where: { userId: f.user.id } });
    assert.equal(rows.length, 2);
    assert(
      rows.every((row) => row.accountedBytes === charged),
      'A rate change must not rewrite posted usage',
    );
    await service.applyTrafficBatch(f.nodes[0].id, batch(f, 100));
    assert.equal(
      (await service.resolveAccess(f.user.id, f.nodes[0].id)).remainingBytes,
      Number(10080n - charged * 2n - 800n),
    );
  }
  console.log(
    'PASS machine/member max, shared protocol rate, plan-first allocation, replay and immutable historical rates',
  );
}

async function linkedMonthlyReset() {
  const f = await member();
  const suffix = randomUUID();
  const now = new Date();
  const startsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const currentStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const endsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const entitlement = await grant(f, {
    cadence: 'MONTHLY_RESET',
    startsAt,
    endsAt,
    bucketEnd: currentStart,
  });
  await db.quotaBucket.updateMany({
    where: { grantId: entitlement.id },
    data: { grantedBytes: 120n, consumedBytes: 80n },
  });
  const plan = await db.plan.create({
    data: {
      slug: suffix,
      name: 'Billing fixture',
      trafficBytes: 100n,
      durationDays: 60,
      speedUpMbps: 100,
      speedDownMbps: 100,
      deviceLimit: 10,
      priceCents: 100,
      accessProfileId: f.profile.id,
    },
  });
  f.plans.push(plan);
  const offer = await db.planOffer.create({
    data: {
      planId: plan.id,
      slug: suffix,
      name: 'Monthly',
      billingPeriod: 'MONTHLY',
      intervalMonths: 1,
      priceCents: 100,
    },
  });
  const subscription = await db.subscription.create({
    data: {
      userId: f.user.id,
      planId: plan.id,
      planOfferId: offer.id,
      nodeId: f.nodes[0].id,
      accessAccountId: f.account.id,
      startsAt,
      endsAt,
      includedTrafficBytes: 100n,
      consumedTrafficBytes: 80n,
      speedUpMbpsSnapshot: 100,
      speedDownMbpsSnapshot: 100,
      deviceLimitSnapshot: 10,
    },
  });
  await db.entitlementGrant.update({
    where: { id: entitlement.id },
    data: { legacySubscriptionId: subscription.id },
  });
  await db.subscriptionCycle.create({
    data: {
      subscriptionId: subscription.id,
      startsAt,
      endsAt: currentStart,
      grantedBytes: 100n,
      adjustmentBytes: 20n,
      consumedBytes: 80n,
    },
  });
  await service.applyTrafficBatch(f.nodes[0].id, batch(f, 10));
  const summary = await service.getAccountSummary(f.user.id);
  assert.equal(
    summary.subscriptions[0].currentCycle.consumedBytes,
    10,
    'The compatibility cycle must reflect the same first reset-period charge',
  );
  assert.equal(summary.subscriptions[0].currentCycle.grantedBytes, 100);
  assert.equal(
    summary.subscriptions[0].currentCycle.adjustmentBytes,
    0,
    'A monthly reset must not carry the previous period bonus',
  );
  assert.equal(
    (await service.resolveAccess(f.user.id, f.nodes[0].id)).remainingBytes,
    90,
  );
  await service.applyTrafficBatch(
    f.nodes[0].id,
    batch(f, 10, randomUUID(), new Date(currentStart.getTime() - 1)),
  );
  assert.equal(
    (
      await db.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      })
    ).consumedTrafficBytes,
    10n,
    'A delayed old-period charge must not overwrite the current-period compatibility summary',
  );
  // Model a legacy cycle missing after earlier traffic/credit was already posted.
  // Rebuilding this projection must preserve the V2 total and prior consumption.
  await db.subscriptionCycle.delete({
    where: { id: summary.subscriptions[0].currentCycle.id },
  });
  const currentBucket = await db.quotaBucket.findUniqueOrThrow({
    where: {
      grantId_startsAt: { grantId: entitlement.id, startsAt: currentStart },
    },
  });
  await db.$transaction((tx) =>
    service.creditQuotaBucket(tx, {
      bucketId: currentBucket.id,
      bytes: 20n,
      at: new Date(),
      reason: 'Credit before compatibility projection exists',
      idempotencyKey: randomUUID(),
    }),
  );
  const extraUsage = batch(f, 5);
  await service.applyTrafficBatch(f.nodes[0].id, extraUsage);
  let projected = (await service.getAccountSummary(f.user.id)).subscriptions[0]
    .currentCycle;
  assert.equal(projected.grantedBytes + projected.adjustmentBytes, 120);
  assert.equal(projected.consumedBytes, 15);
  assert.equal(projected.remainingBytes, 105);
  const nextCredit = {
    bucketId: currentBucket.id,
    bytes: 7n,
    at: new Date(),
    reason: 'Credit after compatibility projection exists',
    idempotencyKey: randomUUID(),
  };
  await db.$transaction((tx) => service.creditQuotaBucket(tx, nextCredit));
  await db.$transaction((tx) => service.creditQuotaBucket(tx, nextCredit));
  await service.applyTrafficBatch(f.nodes[0].id, extraUsage);
  projected = (await service.getAccountSummary(f.user.id)).subscriptions[0]
    .currentCycle;
  assert.equal(projected.grantedBytes + projected.adjustmentBytes, 127);
  assert.equal(projected.consumedBytes, 15);
  assert.equal(projected.remainingBytes, 112);
  assert.equal(
    (await service.resolveAccess(f.user.id, f.nodes[0].id)).remainingBytes,
    112,
  );
  console.log(
    'PASS monthly reset keeps compatibility subscription counters aligned with quota',
  );
}

async function fractionalCarry() {
  const f = await member({ machineRate: 21000 });
  await grant(f, { bytes: 1n });
  await grant(f, { kind: 'TRAFFIC_PACK', bytes: 20n });
  for (let i = 0; i < 10; i++)
    await service.applyTrafficBatch(f.nodes[i % 2].id, batch(f, 1));
  assert.equal(
    (await service.resolveAccess(f.user.id, f.nodes[0].id)).allowed,
    false,
  );
  const rows = await db.usageRollup.findMany({
    where: { userId: f.user.id },
    include: { allocations: true },
  });
  assert.equal(
    rows.reduce((sum, row) => sum + row.accountedBytes, 0n),
    21n,
    'Ten bytes at 2.1x consume exactly 21, even across two protocols',
  );
  assert.equal(
    rows
      .flatMap((row) => row.allocations)
      .reduce((sum, a) => sum + a.accountedBytes, 0n),
    21n,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.overageBytes, 0n),
    0n,
  );
  assert.equal(
    (await db.accessAccount.findUniqueOrThrow({ where: { id: f.account.id } }))
      .trafficMultiplierRemainder,
    0,
  );
  await service.applyTrafficBatch(f.nodes[0].id, batch(f, 10));
  const overage = await db.usageRollup.findMany({
    where: { userId: f.user.id, overageBytes: { gt: 0n } },
  });
  assert.equal(overage.length, 1);
  assert.equal(overage[0].accountedBytes, 21n);
  assert.equal(overage[0].overageBytes, 21n);
  console.log(
    'PASS fractional carry across protocols/buckets, exact exhaustion and overage',
  );
}

async function concurrentReplay() {
  const f = await member({ machineRate: 15000 });
  await grant(f, { bytes: 100n });
  const same = batch(f, 10);
  const results = await Promise.all([
    service.applyTrafficBatch(f.nodes[0].id, same),
    service.applyTrafficBatch(f.nodes[0].id, same),
  ]);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(
    (await service.resolveAccess(f.user.id, f.nodes[0].id)).remainingBytes,
    85,
  );
  await Promise.all([
    service.applyTrafficBatch(f.nodes[0].id, batch(f, 10)),
    service.applyTrafficBatch(f.nodes[1].id, batch(f, 10)),
  ]);
  assert.equal(
    (await service.resolveAccess(f.user.id, f.nodes[0].id)).remainingBytes,
    55,
    'Concurrent endpoints must not lose quota updates',
  );
  assert.equal(await db.usageRollup.count({ where: { userId: f.user.id } }), 3);
  console.log(
    'PASS concurrent duplicate receipt and cross-node accounting serialize without double billing',
  );
}

async function legacyDelayedReceipt() {
  const f = await member();
  const suffix = randomUUID();
  const now = new Date();
  const startsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const currentStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const endsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const plan = await db.plan.create({
    data: {
      slug: suffix,
      name: 'Legacy billing fixture',
      trafficBytes: 100n,
      durationDays: 60,
      speedUpMbps: 100,
      speedDownMbps: 100,
      deviceLimit: 10,
      priceCents: 100,
      accessProfileId: f.profile.id,
    },
  });
  f.plans.push(plan);
  const offer = await db.planOffer.create({
    data: {
      planId: plan.id,
      slug: suffix,
      name: 'Monthly',
      billingPeriod: 'MONTHLY',
      intervalMonths: 1,
      priceCents: 100,
    },
  });
  const subscription = await db.subscription.create({
    data: {
      userId: f.user.id,
      planId: plan.id,
      planOfferId: offer.id,
      nodeId: f.nodes[0].id,
      accessAccountId: f.account.id,
      startsAt,
      endsAt,
      includedTrafficBytes: 100n,
      consumedTrafficBytes: 5n,
      speedUpMbpsSnapshot: 100,
      speedDownMbpsSnapshot: 100,
      deviceLimitSnapshot: 10,
    },
  });
  await db.subscriptionCycle.createMany({
    data: [
      {
        subscriptionId: subscription.id,
        startsAt,
        endsAt: currentStart,
        grantedBytes: 100n,
        consumedBytes: 80n,
      },
      {
        subscriptionId: subscription.id,
        startsAt: currentStart,
        endsAt,
        grantedBytes: 100n,
        consumedBytes: 5n,
      },
    ],
  });
  await service.applyTrafficBatch(
    f.nodes[0].id,
    batch(f, 10, randomUUID(), new Date(currentStart.getTime() - 1)),
  );
  assert.equal(
    (await service.getAccountSummary(f.user.id)).subscriptions[0].currentCycle
      .consumedBytes,
    5,
  );
  assert.equal(
    (
      await db.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      })
    ).consumedTrafficBytes,
    5n,
  );
  await service.applyTrafficBatch(f.nodes[0].id, batch(f, 10));
  assert.equal(
    (await service.getAccountSummary(f.user.id)).subscriptions[0].currentCycle
      .consumedBytes,
    15,
  );
  assert.equal(
    (
      await db.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
      })
    ).consumedTrafficBytes,
    15n,
  );
  console.log(
    'PASS unmigrated legacy receipts retain original periods without overwriting current counters',
  );
}

async function expiryAndRefill() {
  const expired = await member();
  const end = new Date(Date.now() - 1000);
  await grant(expired, {
    startsAt: new Date(end.getTime() - 60_000),
    endsAt: end,
  });
  await service.applyTrafficBatch(
    expired.nodes[0].id,
    batch(expired, 10, 'before-expiry', new Date(end.getTime() - 1)),
  );
  await service.applyTrafficBatch(
    expired.nodes[0].id,
    batch(expired, 10, 'at-expiry', end),
  );
  const rows = await db.usageRollup.findMany({
    where: { userId: expired.user.id },
    orderBy: { bucketStart: 'asc' },
  });
  assert.deepEqual(
    rows.map((row) => row.overageBytes),
    [0n, 10n],
    'The expiry boundary is exclusive',
  );
  assert.equal(
    (await service.resolveAccess(expired.user.id, expired.nodes[0].id)).allowed,
    false,
  );
  const refill = await member();
  const entitlement = await grant(refill, { bytes: 10n });
  const receipt = batch(refill, 20);
  await service.applyTrafficBatch(refill.nodes[0].id, receipt);
  const quota = await db.quotaBucket.findFirstOrThrow({
    where: { grantId: entitlement.id },
  });
  const credit = {
    bucketId: quota.id,
    bytes: 10n,
    at: new Date(),
    reason: 'Isolated refill test',
    idempotencyKey: randomUUID(),
  };
  await db.$transaction((tx) => service.creditQuotaBucket(tx, credit));
  await db.$transaction((tx) => service.creditQuotaBucket(tx, credit));
  await service.applyTrafficBatch(refill.nodes[0].id, receipt);
  assert.equal(
    (await service.resolveAccess(refill.user.id, refill.nodes[0].id))
      .remainingBytes,
    10,
    'A credited refill is not charged by replaying previously posted overage',
  );
  await service.applyTrafficBatch(refill.nodes[0].id, batch(refill, 5));
  assert.equal(
    (await service.resolveAccess(refill.user.id, refill.nodes[0].id))
      .remainingBytes,
    5,
  );
  console.log(
    'PASS expiry boundary, idempotent refill and replay preserve prior overage without backcharging',
  );
}

async function main() {
  await monthlyReset();
  await linkedMonthlyReset();
  await machineRates();
  await fractionalCarry();
  await concurrentReplay();
  await legacyDelayedReceipt();
  await expiryAndRefill();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } finally {
      await db.$disconnect();
    }
  });
