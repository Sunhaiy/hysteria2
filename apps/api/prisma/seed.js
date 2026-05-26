const path = require('node:path');
const { hashSync } = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ||
        'postgresql://postgres:postgres@localhost:5432/hysteria2',
    },
  },
});

const anchor = new Date('2026-05-22T23:55:00.000Z');
const plusDays = (days) =>
  new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000);
const minusDays = (days) =>
  new Date(anchor.getTime() - days * 24 * 60 * 60 * 1000);
const gb = 1024 * 1024 * 1024;

async function main() {
  await prisma.$transaction([
    prisma.authEvent.deleteMany(),
    prisma.onlineSnapshot.deleteMany(),
    prisma.usageRollup.deleteMany(),
    prisma.trafficPack.deleteMany(),
    prisma.manualOrder.deleteMany(),
    prisma.redemptionCode.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.planBinding.deleteMany(),
    prisma.node.deleteMany(),
    prisma.nodeGroup.deleteMany(),
    prisma.accessToken.deleteMany(),
    prisma.plan.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  await prisma.user.createMany({
    data: [
      {
        id: 'usr_admin',
        email: 'ops@hysteria.local',
        displayName: 'Operations Admin',
        passwordHash: hashSync('admin123!', 10),
        role: 'ADMIN',
        status: 'ACTIVE',
        notes: 'Primary operator account',
        createdAt: minusDays(120),
        updatedAt: minusDays(1),
      },
      {
        id: 'usr_lin',
        email: 'lin@example.com',
        displayName: 'Lin',
        passwordHash: hashSync('member123!', 10),
        role: 'MEMBER',
        status: 'ACTIVE',
        notes: 'Starter seed account',
        createdAt: minusDays(45),
        updatedAt: minusDays(1),
      },
      {
        id: 'usr_zhou',
        email: 'zhou@example.com',
        displayName: 'Zhou',
        passwordHash: hashSync('member123!', 10),
        role: 'MEMBER',
        status: 'SUSPENDED',
        notes: 'Used to demo enforcement states',
        createdAt: minusDays(30),
        updatedAt: minusDays(2),
      },
    ],
  });

  await prisma.accessToken.createMany({
    data: [
      {
        id: 'tok_lin',
        userId: 'usr_lin',
        label: 'Primary access token',
        token: 'hy2_live_lin_primary',
        createdAt: minusDays(30),
        lastUsedAt: minusDays(1),
      },
      {
        id: 'tok_zhou',
        userId: 'usr_zhou',
        label: 'Suspended account token',
        token: 'hy2_live_zhou_primary',
        createdAt: minusDays(20),
        lastUsedAt: minusDays(3),
      },
    ],
  });

  await prisma.plan.createMany({
    data: [
      {
        id: 'plan_core',
        slug: 'core-200',
        name: 'Core 200',
        description: '200GB quota, 30-day cycle, 3 devices',
        active: true,
        trafficBytes: BigInt(200 * gb),
        durationDays: 30,
        speedUpMbps: 20,
        speedDownMbps: 120,
        deviceLimit: 3,
        priceCents: 1800,
        accent: 'green',
        createdAt: minusDays(100),
        updatedAt: minusDays(1),
      },
      {
        id: 'plan_pro',
        slug: 'pro-500',
        name: 'Pro 500',
        description: '500GB quota, 30-day cycle, 5 devices',
        active: true,
        trafficBytes: BigInt(500 * gb),
        durationDays: 30,
        speedUpMbps: 40,
        speedDownMbps: 240,
        deviceLimit: 5,
        priceCents: 3200,
        accent: 'teal',
        createdAt: minusDays(98),
        updatedAt: minusDays(1),
      },
    ],
  });

  await prisma.nodeGroup.createMany({
    data: [
      {
        id: 'grp_core',
        slug: 'core-tier',
        name: 'Core Tier',
        description: 'Entry tier listeners with fixed 20/120 Mbps ceilings',
        active: true,
        createdAt: minusDays(100),
        updatedAt: minusDays(1),
      },
      {
        id: 'grp_pro',
        slug: 'pro-tier',
        name: 'Pro Tier',
        description: 'Higher-throughput listeners with dedicated ports',
        active: true,
        createdAt: minusDays(100),
        updatedAt: minusDays(1),
      },
    ],
  });

  await prisma.node.createMany({
    data: [
      {
        id: 'node_hk_core',
        nodeGroupId: 'grp_core',
        label: 'HK-01 Core :4431',
        hostname: 'hk-01.example.net',
        port: 4431,
        obfsPassword: 'salty-core',
        sni: 'edge.example.net',
        pinSHA256: 'AA:11:22:33:44:55',
        allowInsecureTls: false,
        trafficApiBaseUrl: 'mock://hk-core',
        trafficApiSecret: 'stats-core',
        active: true,
        speedUpMbps: 20,
        speedDownMbps: 120,
        createdAt: minusDays(90),
        updatedAt: minusDays(1),
      },
      {
        id: 'node_sg_core',
        nodeGroupId: 'grp_core',
        label: 'SG-01 Core :4432',
        hostname: 'sg-01.example.net',
        port: 4432,
        obfsPassword: 'salty-core',
        sni: 'edge.example.net',
        pinSHA256: 'AA:11:22:33:44:56',
        allowInsecureTls: false,
        trafficApiBaseUrl: 'mock://sg-core',
        trafficApiSecret: 'stats-core',
        active: true,
        speedUpMbps: 20,
        speedDownMbps: 120,
        createdAt: minusDays(90),
        updatedAt: minusDays(1),
      },
      {
        id: 'node_hk_pro',
        nodeGroupId: 'grp_pro',
        label: 'HK-02 Pro :5443',
        hostname: 'hk-02.example.net',
        port: 5443,
        obfsPassword: 'salty-pro',
        sni: 'pro-edge.example.net',
        pinSHA256: 'BB:66:77:88:99:00',
        allowInsecureTls: false,
        trafficApiBaseUrl: 'mock://hk-pro',
        trafficApiSecret: 'stats-pro',
        active: true,
        speedUpMbps: 40,
        speedDownMbps: 240,
        createdAt: minusDays(90),
        updatedAt: minusDays(1),
      },
    ],
  });

  await prisma.planBinding.createMany({
    data: [
      {
        id: 'bind_core',
        planId: 'plan_core',
        nodeGroupId: 'grp_core',
        priority: 0,
        createdAt: minusDays(100),
      },
      {
        id: 'bind_pro',
        planId: 'plan_pro',
        nodeGroupId: 'grp_pro',
        priority: 0,
        createdAt: minusDays(100),
      },
    ],
  });

  await prisma.subscription.createMany({
    data: [
      {
        id: 'sub_lin',
        userId: 'usr_lin',
        planId: 'plan_core',
        nodeGroupId: 'grp_core',
        status: 'ACTIVE',
        startsAt: minusDays(10),
        endsAt: plusDays(20),
        includedTrafficBytes: BigInt(200 * gb),
        bonusTrafficBytes: BigInt(15 * gb),
        consumedTrafficBytes: BigInt(86 * gb),
        speedUpMbpsSnapshot: 20,
        speedDownMbpsSnapshot: 120,
        deviceLimitSnapshot: 3,
        createdAt: minusDays(10),
        updatedAt: minusDays(1),
      },
      {
        id: 'sub_zhou',
        userId: 'usr_zhou',
        planId: 'plan_pro',
        nodeGroupId: 'grp_pro',
        status: 'PAUSED',
        startsAt: minusDays(18),
        endsAt: plusDays(12),
        includedTrafficBytes: BigInt(500 * gb),
        bonusTrafficBytes: BigInt(0),
        consumedTrafficBytes: BigInt(15 * gb),
        speedUpMbpsSnapshot: 40,
        speedDownMbpsSnapshot: 240,
        deviceLimitSnapshot: 5,
        createdAt: minusDays(18),
        updatedAt: minusDays(2),
      },
    ],
  });

  await prisma.trafficPack.createMany({
    data: [
      {
        id: 'pack_lin',
        userId: 'usr_lin',
        subscriptionId: 'sub_lin',
        label: 'May booster',
        totalBytes: BigInt(50 * gb),
        remainingBytes: BigInt(34 * gb),
        status: 'ACTIVE',
        expiresAt: plusDays(15),
        createdAt: minusDays(7),
        updatedAt: minusDays(1),
      },
    ],
  });

  await prisma.manualOrder.createMany({
    data: [
      {
        id: 'ord_lin_boost',
        userId: 'usr_lin',
        processedById: 'usr_admin',
        status: 'APPLIED',
        kind: 'TRAFFIC_PACK',
        amountCents: 900,
        trafficBytes: BigInt(50 * gb),
        note: 'Manual booster top-up',
        createdAt: minusDays(7),
        processedAt: minusDays(7),
      },
    ],
  });

  await prisma.redemptionCode.createMany({
    data: [
      {
        id: 'code_core_seed',
        code: 'HY2-CORE-2026-DEMO',
        label: 'Core 200 开通码',
        kind: 'PLAN',
        status: 'ACTIVE',
        planId: 'plan_core',
        amountCents: 1800,
        note: 'Seed plan redemption code',
        createdById: 'usr_admin',
        createdAt: minusDays(3),
        updatedAt: minusDays(1),
      },
      {
        id: 'code_flow_seed',
        code: 'HY2-FLOW-050G-DEMO',
        label: '50GB 流量包兑换码',
        kind: 'TRAFFIC_PACK',
        status: 'ACTIVE',
        trafficBytes: BigInt(50 * gb),
        amountCents: 900,
        note: 'Seed traffic pack redemption code',
        createdById: 'usr_admin',
        createdAt: minusDays(2),
        updatedAt: minusDays(1),
      },
    ],
  });

  await prisma.usageRollup.createMany({
    data: [
      {
        id: 'usage_seed_lin',
        userId: 'usr_lin',
        subscriptionId: 'sub_lin',
        nodeId: 'node_hk_core',
        bucketStart: minusDays(1),
        txBytes: BigInt(12 * gb),
        rxBytes: BigInt(24 * gb),
        source: 'seed',
        createdAt: minusDays(1),
      },
    ],
  });

  await prisma.onlineSnapshot.createMany({
    data: [
      {
        id: 'snap_lin_hk',
        userId: 'usr_lin',
        nodeId: 'node_hk_core',
        concurrentClients: 2,
        capturedAt: anchor,
      },
    ],
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
