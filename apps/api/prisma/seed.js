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

const anchor = new Date(process.env.SEED_ANCHOR || new Date().toISOString());
const plusDays = (days) =>
  new Date(anchor.getTime() + days * 24 * 60 * 60 * 1000);
const minusDays = (days) =>
  new Date(anchor.getTime() - days * 24 * 60 * 60 * 1000);
const gb = 1024 * 1024 * 1024;

async function main() {
  await prisma.$transaction([
    prisma.monitorAlertEvent.deleteMany(),
    prisma.monitorAlert.deleteMany(),
    prisma.nodeServiceCheck.deleteMany(),
    prisma.refund.deleteMany(),
    prisma.walletLedgerEntry.deleteMany(),
    prisma.paymentRecord.deleteMany(),
    prisma.usageAllocation.deleteMany(),
    prisma.quotaBucket.deleteMany(),
    prisma.entitlementGrant.deleteMany(),
    prisma.nodeCost.deleteMany(),
    prisma.accessProfilePool.deleteMany(),
    prisma.nodePoolMember.deleteMany(),
    prisma.nodePool.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.destinationVisitRollup.deleteMany(),
    prisma.destinationImportBatch.deleteMany(),
    prisma.quotaAdjustment.deleteMany(),
    prisma.authEvent.deleteMany(),
    prisma.onlineSnapshot.deleteMany(),
    prisma.usageRollup.deleteMany(),
    prisma.usageImportBatch.deleteMany(),
    prisma.trafficPack.deleteMany(),
    prisma.subscriptionCycle.deleteMany(),
    prisma.redemptionUse.deleteMany(),
    prisma.walletTransaction.deleteMany(),
    prisma.manualOrder.deleteMany(),
    prisma.catalogOffer.deleteMany(),
    prisma.catalogProduct.deleteMany(),
    prisma.redemptionCode.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.planBinding.deleteMany(),
    prisma.accessToken.deleteMany(),
    prisma.adminPermissionGrant.deleteMany(),
    prisma.accessAccount.deleteMany(),
    prisma.accessProfileNode.deleteMany(),
    prisma.planOffer.deleteMany(),
    prisma.trafficPackProduct.deleteMany(),
    prisma.plan.deleteMany(),
    prisma.accessProfile.deleteMany(),
    prisma.node.deleteMany(),
    prisma.nodeServer.deleteMany(),
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
        balanceCents: 12000,
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

  await prisma.adminPermissionGrant.createMany({
    data: [
      {
        id: 'perm_admin_destination',
        userId: 'usr_admin',
        permission: 'DESTINATION_AUDIT_READ',
      },
      {
        id: 'perm_admin_permissions',
        userId: 'usr_admin',
        permission: 'ADMIN_PERMISSIONS_MANAGE',
      },
    ],
  });

  await prisma.accessAccount.createMany({
    data: [
      { id: 'account_lin', userId: 'usr_lin' },
      { id: 'account_zhou', userId: 'usr_zhou' },
    ],
  });

  await prisma.trafficPackProduct.create({
    data: {
      id: 'traffic_50g',
      slug: 'traffic-50g',
      name: '50 GB Booster',
      description: 'Standalone one-time traffic quota with independent access',
      active: true,
      trafficBytes: BigInt(50 * gb),
      validityDays: 30,
      priceCents: 900,
      accent: 'teal',
      createdAt: minusDays(60),
      updatedAt: minusDays(1),
    },
  });

  await prisma.nodeServer.createMany({
    data: [
      {
        id: 'server_hk_01',
        slug: 'hk-01',
        name: 'Hong Kong 01',
        hostname: 'hk-01.example.net',
        region: 'HK',
        provider: 'Example Cloud',
      },
      {
        id: 'server_sg_01',
        slug: 'sg-01',
        name: 'Singapore 01',
        hostname: 'sg-01.example.net',
        region: 'SG',
        provider: 'Example Cloud',
      },
    ],
  });

  await prisma.node.createMany({
    data: [
      {
        id: 'node_hk_core',
        serverId: 'server_hk_01',
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
        lifecycleStatus: 'ACTIVE',
        region: 'HK',
        provider: 'Example Cloud',
        tags: ['core', 'hysteria2'],
        capacityUsers: 800,
        speedUpMbps: 20,
        speedDownMbps: 120,
        createdAt: minusDays(90),
        updatedAt: minusDays(1),
      },
      {
        id: 'node_sg_core',
        serverId: 'server_sg_01',
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
        lifecycleStatus: 'ACTIVE',
        region: 'SG',
        provider: 'Example Cloud',
        tags: ['core', 'hysteria2'],
        capacityUsers: 600,
        speedUpMbps: 20,
        speedDownMbps: 120,
        createdAt: minusDays(90),
        updatedAt: minusDays(1),
      },
      {
        id: 'node_hk_pro',
        serverId: 'server_hk_01',
        label: 'HK-02 Pro :5443',
        hostname: 'hk-01.example.net',
        port: 5443,
        obfsPassword: 'salty-pro',
        sni: 'pro-edge.example.net',
        pinSHA256: 'BB:66:77:88:99:00',
        allowInsecureTls: false,
        trafficApiBaseUrl: 'mock://hk-pro',
        trafficApiSecret: 'stats-pro',
        active: true,
        lifecycleStatus: 'DRAINING',
        region: 'HK',
        provider: 'Premium Transit',
        tags: ['pro', 'hysteria2'],
        capacityUsers: 400,
        speedUpMbps: 40,
        speedDownMbps: 240,
        createdAt: minusDays(90),
        updatedAt: minusDays(1),
      },
      {
        id: 'node_hk_reality',
        serverId: 'server_hk_01',
        protocol: 'VLESS_REALITY',
        label: 'HK-01 Reality :8443',
        hostname: 'hk-01.example.net',
        port: 8443,
        sni: 'www.microsoft.com',
        realityPublicKey: 'DEMO_PUBLIC_KEY_HK',
        realityShortId: 'a1b2c3d4',
        realityFingerprint: 'chrome',
        realitySpiderX: '/',
        vlessFlow: 'xtls-rprx-vision',
        trafficApiBaseUrl: 'mock://hk-reality',
        trafficApiSecret: 'stats-hk-reality',
        active: true,
        lifecycleStatus: 'ACTIVE',
        region: 'HK',
        provider: 'Example Cloud',
        tags: ['core', 'pro', 'vless-reality'],
        capacityUsers: 800,
        speedUpMbps: 40,
        speedDownMbps: 240,
        createdAt: minusDays(90),
        updatedAt: minusDays(1),
      },
      {
        id: 'node_sg_reality',
        serverId: 'server_sg_01',
        protocol: 'VLESS_REALITY',
        label: 'SG-01 Reality :8443',
        hostname: 'sg-01.example.net',
        port: 8443,
        sni: 'www.cloudflare.com',
        realityPublicKey: 'DEMO_PUBLIC_KEY_SG',
        realityShortId: 'b1c2d3e4',
        realityFingerprint: 'chrome',
        realitySpiderX: '/',
        vlessFlow: 'xtls-rprx-vision',
        trafficApiBaseUrl: 'mock://sg-reality',
        trafficApiSecret: 'stats-sg-reality',
        active: true,
        lifecycleStatus: 'ACTIVE',
        region: 'SG',
        provider: 'Example Cloud',
        tags: ['core', 'vless-reality'],
        capacityUsers: 600,
        speedUpMbps: 20,
        speedDownMbps: 120,
        createdAt: minusDays(90),
        updatedAt: minusDays(1),
      },
    ],
  });

  await prisma.accessProfile.createMany({
    data: [
      {
        id: 'profile_core',
        slug: 'core-200',
        name: 'Core 访问策略',
        description: 'Core 套餐与流量包共用策略',
        active: true,
        speedUpMbps: 20,
        speedDownMbps: 120,
        deviceLimit: 3,
      },
      {
        id: 'profile_pro',
        slug: 'pro-500',
        name: 'Pro 访问策略',
        description: 'Pro 套餐访问策略',
        active: true,
        speedUpMbps: 40,
        speedDownMbps: 240,
        deviceLimit: 5,
      },
    ],
  });

  await prisma.accessProfileNode.createMany({
    data: [
      {
        id: 'profile_node_core_hk',
        accessProfileId: 'profile_core',
        nodeId: 'node_hk_core',
        priority: 0,
      },
      {
        id: 'profile_node_core_sg',
        accessProfileId: 'profile_core',
        nodeId: 'node_sg_core',
        priority: 1,
      },
      {
        id: 'profile_node_pro_hk',
        accessProfileId: 'profile_pro',
        nodeId: 'node_hk_pro',
        priority: 0,
      },
      {
        id: 'profile_node_core_hk_reality',
        accessProfileId: 'profile_core',
        nodeId: 'node_hk_reality',
        priority: 2,
      },
      {
        id: 'profile_node_core_sg_reality',
        accessProfileId: 'profile_core',
        nodeId: 'node_sg_reality',
        priority: 3,
      },
      {
        id: 'profile_node_pro_hk_reality',
        accessProfileId: 'profile_pro',
        nodeId: 'node_hk_reality',
        priority: 1,
      },
    ],
  });

  await prisma.$transaction([
    prisma.plan.update({
      where: { id: 'plan_core' },
      data: { accessProfileId: 'profile_core' },
    }),
    prisma.plan.update({
      where: { id: 'plan_pro' },
      data: { accessProfileId: 'profile_pro' },
    }),
    prisma.trafficPackProduct.update({
      where: { id: 'traffic_50g' },
      data: { accessProfileId: 'profile_core' },
    }),
  ]);

  await prisma.planOffer.createMany({
    data: [
      {
        id: 'offer_core_monthly',
        planId: 'plan_core',
        slug: 'core-200-monthly',
        name: '月付',
        active: true,
        isDefault: true,
        billingPeriod: 'MONTHLY',
        intervalMonths: 1,
        priceCents: 1800,
      },
      {
        id: 'offer_core_quarterly',
        planId: 'plan_core',
        slug: 'core-200-quarterly',
        name: '季付',
        active: true,
        billingPeriod: 'QUARTERLY',
        intervalMonths: 3,
        priceCents: 5000,
      },
      {
        id: 'offer_core_yearly',
        planId: 'plan_core',
        slug: 'core-200-yearly',
        name: '年付',
        active: true,
        billingPeriod: 'YEARLY',
        intervalMonths: 12,
        priceCents: 18000,
      },
      {
        id: 'offer_pro_monthly',
        planId: 'plan_pro',
        slug: 'pro-500-monthly',
        name: '月付',
        active: true,
        isDefault: true,
        billingPeriod: 'MONTHLY',
        intervalMonths: 1,
        priceCents: 3200,
      },
      {
        id: 'offer_pro_quarterly',
        planId: 'plan_pro',
        slug: 'pro-500-quarterly',
        name: '季付',
        active: true,
        billingPeriod: 'QUARTERLY',
        intervalMonths: 3,
        priceCents: 8900,
      },
      {
        id: 'offer_pro_yearly',
        planId: 'plan_pro',
        slug: 'pro-500-yearly',
        name: '年付',
        active: true,
        billingPeriod: 'YEARLY',
        intervalMonths: 12,
        priceCents: 32000,
      },
    ],
  });

  await prisma.catalogProduct.createMany({
    data: [
      {
        id: 'catalog_core',
        legacyPlanId: 'plan_core',
        slug: 'plan-core-200',
        kind: 'PLAN',
        status: 'ACTIVE',
        name: 'Core 200',
        description: '每月重置 200GB，适合日常稳定接入',
        quotaCadence: 'MONTHLY_RESET',
        accessProfileId: 'profile_core',
        speedUpMbps: 20,
        speedDownMbps: 120,
        accent: 'green',
        sortOrder: 10,
      },
      {
        id: 'catalog_pro',
        legacyPlanId: 'plan_pro',
        slug: 'plan-pro-500',
        kind: 'PLAN',
        status: 'ACTIVE',
        name: 'Pro 500',
        description: '每月重置 500GB，更高速率和更多设备',
        quotaCadence: 'MONTHLY_RESET',
        accessProfileId: 'profile_pro',
        speedUpMbps: 40,
        speedDownMbps: 240,
        accent: 'teal',
        sortOrder: 20,
      },
      {
        id: 'catalog_pack_50g',
        legacyTrafficPackProductId: 'traffic_50g',
        slug: 'pack-flex',
        kind: 'TRAFFIC_PACK',
        status: 'ACTIVE',
        name: '灵活流量包',
        description: '无需套餐即可独立接入，流量一次性发放',
        quotaCadence: 'ONE_TIME',
        accessProfileId: 'profile_core',
        speedUpMbps: 20,
        speedDownMbps: 120,
        accent: 'teal',
        sortOrder: 30,
      },
    ],
  });

  await prisma.catalogOffer.createMany({
    data: [
      {
        id: 'catalog_offer_core_monthly',
        productId: 'catalog_core',
        legacyPlanOfferId: 'offer_core_monthly',
        slug: 'core-monthly',
        name: '月付',
        billingPeriod: 'MONTHLY',
        intervalMonths: 1,
        trafficBytes: BigInt(200 * gb),
        priceCents: 1800,
        isDefault: true,
      },
      {
        id: 'catalog_offer_core_quarterly',
        productId: 'catalog_core',
        legacyPlanOfferId: 'offer_core_quarterly',
        slug: 'core-quarterly',
        name: '季付',
        billingPeriod: 'QUARTERLY',
        intervalMonths: 3,
        trafficBytes: BigInt(200 * gb),
        priceCents: 5000,
      },
      {
        id: 'catalog_offer_core_yearly',
        productId: 'catalog_core',
        legacyPlanOfferId: 'offer_core_yearly',
        slug: 'core-yearly',
        name: '年付',
        billingPeriod: 'YEARLY',
        intervalMonths: 12,
        trafficBytes: BigInt(200 * gb),
        priceCents: 18000,
      },
      {
        id: 'catalog_offer_pro_monthly',
        productId: 'catalog_pro',
        legacyPlanOfferId: 'offer_pro_monthly',
        slug: 'pro-monthly',
        name: '月付',
        billingPeriod: 'MONTHLY',
        intervalMonths: 1,
        trafficBytes: BigInt(500 * gb),
        priceCents: 3200,
        isDefault: true,
      },
      {
        id: 'catalog_offer_pro_quarterly',
        productId: 'catalog_pro',
        legacyPlanOfferId: 'offer_pro_quarterly',
        slug: 'pro-quarterly',
        name: '季付',
        billingPeriod: 'QUARTERLY',
        intervalMonths: 3,
        trafficBytes: BigInt(500 * gb),
        priceCents: 8900,
      },
      {
        id: 'catalog_offer_pro_yearly',
        productId: 'catalog_pro',
        legacyPlanOfferId: 'offer_pro_yearly',
        slug: 'pro-yearly',
        name: '年付',
        billingPeriod: 'YEARLY',
        intervalMonths: 12,
        trafficBytes: BigInt(500 * gb),
        priceCents: 32000,
      },
      {
        id: 'catalog_offer_pack_quarterly',
        productId: 'catalog_pack_50g',
        slug: 'pack-flex-quarterly',
        name: '季度流量包',
        billingPeriod: 'QUARTERLY',
        intervalMonths: 3,
        trafficBytes: BigInt(50 * gb),
        priceCents: 900,
        isDefault: true,
      },
      {
        id: 'catalog_offer_pack_yearly',
        productId: 'catalog_pack_50g',
        slug: 'pack-flex-yearly',
        name: '年度流量包',
        billingPeriod: 'YEARLY',
        intervalMonths: 12,
        trafficBytes: BigInt(200 * gb),
        priceCents: 3000,
      },
    ],
  });

  await prisma.nodePool.createMany({
    data: [
      {
        id: 'pool_core',
        slug: 'core-global',
        name: 'Core 全球资源池',
        description: 'Core 商品的默认可服务节点',
        region: 'APAC',
      },
      {
        id: 'pool_pro',
        slug: 'pro-premium',
        name: 'Pro 精品资源池',
        description: 'Pro 商品的高优先级节点',
        region: 'APAC',
      },
    ],
  });

  await prisma.nodePoolMember.createMany({
    data: [
      { id: 'pool_core_hk', poolId: 'pool_core', nodeId: 'node_hk_core', priority: 0 },
      { id: 'pool_core_sg', poolId: 'pool_core', nodeId: 'node_sg_core', priority: 10 },
      { id: 'pool_core_hk_reality', poolId: 'pool_core', nodeId: 'node_hk_reality', priority: 20 },
      { id: 'pool_core_sg_reality', poolId: 'pool_core', nodeId: 'node_sg_reality', priority: 30 },
      { id: 'pool_pro_hk', poolId: 'pool_pro', nodeId: 'node_hk_pro', priority: 0 },
      { id: 'pool_pro_hk_reality', poolId: 'pool_pro', nodeId: 'node_hk_reality', priority: 10 },
    ],
  });

  await prisma.accessProfilePool.createMany({
    data: [
      { id: 'profile_pool_core', accessProfileId: 'profile_core', poolId: 'pool_core', priority: 0 },
      { id: 'profile_pool_pro', accessProfileId: 'profile_pro', poolId: 'pool_pro', priority: 0 },
    ],
  });

  await prisma.planBinding.createMany({
    data: [
      {
        id: 'bind_core',
        planId: 'plan_core',
        nodeId: 'node_hk_core',
        priority: 0,
        createdAt: minusDays(100),
      },
      {
        id: 'bind_pro',
        planId: 'plan_pro',
        nodeId: 'node_hk_pro',
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
        accessAccountId: 'account_lin',
        planOfferId: 'offer_core_monthly',
        nodeId: 'node_hk_core',
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
        accessAccountId: 'account_zhou',
        planOfferId: 'offer_pro_monthly',
        nodeId: 'node_hk_pro',
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

  await prisma.subscriptionCycle.createMany({
    data: [
      {
        id: 'cycle_lin',
        subscriptionId: 'sub_lin',
        startsAt: minusDays(10),
        endsAt: plusDays(20),
        grantedBytes: BigInt(215 * gb),
        consumedBytes: BigInt(86 * gb),
      },
      {
        id: 'cycle_zhou',
        subscriptionId: 'sub_zhou',
        startsAt: minusDays(18),
        endsAt: plusDays(12),
        grantedBytes: BigInt(500 * gb),
        consumedBytes: BigInt(15 * gb),
      },
    ],
  });

  await prisma.trafficPack.createMany({
    data: [
      {
        id: 'pack_lin',
        userId: 'usr_lin',
        subscriptionId: 'sub_lin',
        accessAccountId: 'account_lin',
        trafficPackProductId: 'traffic_50g',
        accessProfileId: 'profile_core',
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

  await prisma.entitlementGrant.createMany({
    data: [
      {
        id: 'grant_lin_plan',
        userId: 'usr_lin',
        accessAccountId: 'account_lin',
        productId: 'catalog_core',
        offerId: 'catalog_offer_core_monthly',
        legacySubscriptionId: 'sub_lin',
        kind: 'PLAN',
        status: 'ACTIVE',
        startsAt: minusDays(10),
        endsAt: plusDays(20),
        accessProfileId: 'profile_core',
        speedUpMbpsSnapshot: 20,
        speedDownMbpsSnapshot: 120,
        deviceLimitSnapshot: 3,
      },
      {
        id: 'grant_zhou_plan',
        userId: 'usr_zhou',
        accessAccountId: 'account_zhou',
        productId: 'catalog_pro',
        offerId: 'catalog_offer_pro_monthly',
        legacySubscriptionId: 'sub_zhou',
        kind: 'PLAN',
        status: 'EXPIRED',
        startsAt: minusDays(18),
        endsAt: plusDays(12),
        accessProfileId: 'profile_pro',
        speedUpMbpsSnapshot: 40,
        speedDownMbpsSnapshot: 240,
        deviceLimitSnapshot: 5,
      },
      {
        id: 'grant_lin_pack',
        userId: 'usr_lin',
        accessAccountId: 'account_lin',
        productId: 'catalog_pack_50g',
        offerId: 'catalog_offer_pack_quarterly',
        legacyTrafficPackId: 'pack_lin',
        kind: 'TRAFFIC_PACK',
        status: 'ACTIVE',
        startsAt: minusDays(7),
        endsAt: plusDays(15),
        accessProfileId: 'profile_core',
        speedUpMbpsSnapshot: 20,
        speedDownMbpsSnapshot: 120,
        deviceLimitSnapshot: 3,
      },
    ],
  });

  await prisma.quotaBucket.createMany({
    data: [
      {
        id: 'bucket_lin_plan',
        grantId: 'grant_lin_plan',
        kind: 'PLAN_CYCLE',
        startsAt: minusDays(10),
        endsAt: plusDays(20),
        grantedBytes: BigInt(215 * gb),
        consumedBytes: BigInt(86 * gb),
      },
      {
        id: 'bucket_zhou_plan',
        grantId: 'grant_zhou_plan',
        kind: 'PLAN_CYCLE',
        startsAt: minusDays(18),
        endsAt: plusDays(12),
        grantedBytes: BigInt(500 * gb),
        consumedBytes: BigInt(15 * gb),
      },
      {
        id: 'bucket_lin_pack',
        grantId: 'grant_lin_pack',
        kind: 'TRAFFIC_PACK',
        startsAt: minusDays(7),
        endsAt: plusDays(15),
        grantedBytes: BigInt(50 * gb),
        consumedBytes: BigInt(16 * gb),
      },
    ],
  });

  await prisma.manualOrder.createMany({
    data: [
      {
        id: 'ord_lin_boost',
        userId: 'usr_lin',
        processedById: 'usr_admin',
        trafficPackProductId: 'traffic_50g',
        catalogOfferId: 'catalog_offer_pack_quarterly',
        status: 'APPLIED',
        kind: 'TRAFFIC_PACK',
        source: 'WALLET',
        amountCents: 900,
        basePriceCents: 900,
        productSlugSnapshot: 'pack-flex-quarterly',
        productNameSnapshot: '灵活流量包 / 季度流量包',
        validityDays: 90,
        trafficBytes: BigInt(50 * gb),
        entitlementExpiresAt: plusDays(15),
        billingPeriodSnapshot: 'QUARTERLY',
        intervalMonthsSnapshot: 3,
        accessProfileIdSnapshot: 'profile_core',
        note: 'Manual booster top-up',
        createdAt: minusDays(7),
        processedAt: minusDays(7),
      },
    ],
  });

  await prisma.walletTransaction.createMany({
    data: [
      {
        id: 'wallet_lin_topup',
        userId: 'usr_lin',
        amountCents: 12900,
        kind: 'TOPUP',
        note: '人工充值',
        createdAt: minusDays(12),
      },
      {
        id: 'wallet_lin_purchase',
        userId: 'usr_lin',
        amountCents: -900,
        kind: 'PURCHASE',
        note: '购买季度流量包',
        createdAt: minusDays(7),
      },
    ],
  });

  await prisma.paymentRecord.create({
    data: {
      id: 'payment_lin_boost',
      orderId: 'ord_lin_boost',
      userId: 'usr_lin',
      source: 'WALLET',
      status: 'SETTLED',
      amountCents: 900,
      paidAt: minusDays(7),
      reconciledAt: minusDays(7),
      createdAt: minusDays(7),
    },
  });

  await prisma.walletLedgerEntry.createMany({
    data: [
      {
        id: 'ledger_lin_topup',
        legacyTransactionId: 'wallet_lin_topup',
        userId: 'usr_lin',
        actorId: 'usr_admin',
        amountCents: 12900,
        beforeBalanceCents: 0,
        afterBalanceCents: 12900,
        kind: 'TOPUP',
        idempotencyKey: 'seed-topup-lin',
        note: '人工充值',
        createdAt: minusDays(12),
      },
      {
        id: 'ledger_lin_purchase',
        legacyTransactionId: 'wallet_lin_purchase',
        userId: 'usr_lin',
        orderId: 'ord_lin_boost',
        amountCents: -900,
        beforeBalanceCents: 12900,
        afterBalanceCents: 12000,
        kind: 'PURCHASE',
        idempotencyKey: 'seed-purchase-pack-lin',
        note: '购买季度流量包',
        createdAt: minusDays(7),
      },
    ],
  });

  await prisma.refund.create({
    data: {
      id: 'refund_lin_pending',
      orderId: 'ord_lin_boost',
      processedById: 'usr_admin',
      method: 'WALLET',
      status: 'PENDING',
      amountCents: 200,
      reason: '演示待审核部分退款',
      createdAt: minusDays(1),
    },
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
        trafficPackProductId: 'traffic_50g',
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
        subscriptionCycleId: 'cycle_lin',
        nodeId: 'node_hk_core',
        bucketStart: minusDays(1),
        txBytes: BigInt(12 * gb),
        rxBytes: BigInt(24 * gb),
        source: 'seed',
        createdAt: minusDays(1),
      },
    ],
  });

  await prisma.usageAllocation.create({
    data: {
      id: 'allocation_seed_lin',
      usageRollupId: 'usage_seed_lin',
      quotaBucketId: 'bucket_lin_plan',
      accountedBytes: BigInt(36 * gb),
      createdAt: minusDays(1),
    },
  });

  await prisma.nodeCost.createMany({
    data: [
      {
        id: 'cost_hk_core',
        nodeId: 'node_hk_core',
        amountCents: 36000,
        effectiveFrom: minusDays(30),
        effectiveTo: plusDays(335),
        providerReference: 'EXAMPLE-HK-CORE-2026',
        note: '年度节点合同，按有效日期每日摊销',
      },
      {
        id: 'cost_sg_core',
        nodeId: 'node_sg_core',
        amountCents: 3000,
        effectiveFrom: minusDays(15),
        effectiveTo: plusDays(15),
        providerReference: 'EXAMPLE-SG-MONTHLY',
      },
    ],
  });

  await prisma.nodeServiceCheck.createMany({
    data: [
      {
        id: 'check_hk_core',
        nodeId: 'node_hk_core',
        healthy: true,
        latencyMs: 42,
        onlineUsers: 1,
        syncDelaySeconds: 18,
        checkedAt: anchor,
      },
      {
        id: 'check_hk_pro',
        nodeId: 'node_hk_pro',
        healthy: false,
        onlineUsers: 0,
        syncDelaySeconds: 180,
        error: '节点同步超时',
        checkedAt: anchor,
      },
    ],
  });

  await prisma.monitorAlert.create({
    data: {
      id: 'alert_hk_pro_sync',
      fingerprint: 'node-sync-timeout:node_hk_pro',
      kind: 'NODE_SYNC_TIMEOUT',
      severity: 'CRITICAL',
      status: 'OPEN',
      title: 'HK-02 Pro 同步超时',
      message: '节点已经连续两次超过 120 秒未完成同步。',
      nodeId: 'node_hk_pro',
      failureCount: 2,
      firstSeenAt: minusDays(1),
      lastSeenAt: anchor,
      metadata: { thresholdSeconds: 120, checkIntervalSeconds: 60 },
      events: {
        create: {
          id: 'alert_event_hk_pro_open',
          status: 'OPEN',
          message: '连续两次检测失败，告警开启。',
          createdAt: anchor,
        },
      },
    },
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
