const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const parsed = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
  throw new Error('Catalog preview can only run against a local database');
}
if (process.env.CATALOG_PREVIEW_CONFIRM !== 'local-only') {
  throw new Error('Set CATALOG_PREVIEW_CONFIRM=local-only to stage preview data');
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const gb = 1024n * 1024n * 1024n;
const storeUrl = 'https://pay.ldxp.cn';
const deviceLimit = 1000;

const plans = [
  {
    slug: 'go',
    name: 'Go',
    description: '新人轻量体验，每个账号终身仅限一次',
    trafficGb: 3,
    speed: 50,
    accent: 'teal',
    featured: false,
    referralEligible: false,
    purchaseLimitPerUser: 1,
    purchaseLimitKey: 'trial-go',
    offers: [{ period: 'MONTHLY', months: 1, name: '月付', priceCents: 290 }],
  },
  {
    slug: 'start',
    name: 'Start',
    description: '适合聊天、网页和轻量日常使用',
    trafficGb: 50,
    speed: 100,
    accent: 'green',
    featured: false,
    referralEligible: true,
    offers: [
      { period: 'MONTHLY', months: 1, name: '月付', priceCents: 990 },
      { period: 'QUARTERLY', months: 3, name: '季付', priceCents: 2820 },
      { period: 'YEARLY', months: 12, name: '年付', priceCents: 10690 },
    ],
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: '主流日常与影音需求，性价比首选',
    trafficGb: 120,
    speed: 200,
    accent: 'blue',
    featured: true,
    referralEligible: true,
    offers: [
      { period: 'MONTHLY', months: 1, name: '月付', priceCents: 1690 },
      { period: 'QUARTERLY', months: 3, name: '季付', priceCents: 4820 },
      { period: 'YEARLY', months: 12, name: '年付', priceCents: 18250 },
    ],
  },
  {
    slug: 'plus',
    name: 'Plus',
    description: '适合高频视频、多设备和稳定长时间使用',
    trafficGb: 300,
    speed: 500,
    accent: 'indigo',
    featured: false,
    referralEligible: true,
    offers: [
      { period: 'MONTHLY', months: 1, name: '月付', priceCents: 2990 },
      { period: 'QUARTERLY', months: 3, name: '季付', priceCents: 8520 },
      { period: 'YEARLY', months: 12, name: '年付', priceCents: 32290 },
    ],
  },
  {
    slug: 'max',
    name: 'Max',
    description: '面向重度影音和大流量工作场景',
    trafficGb: 600,
    speed: 800,
    accent: 'orange',
    featured: false,
    referralEligible: true,
    offers: [
      { period: 'MONTHLY', months: 1, name: '月付', priceCents: 4990 },
      { period: 'QUARTERLY', months: 3, name: '季付', priceCents: 14220 },
      { period: 'YEARLY', months: 12, name: '年付', priceCents: 53890 },
    ],
  },
  {
    slug: 'spark',
    name: 'Spark',
    description: '旗舰大流量档位，提供最高接入速率',
    trafficGb: 1024,
    speed: 1000,
    accent: 'purple',
    featured: false,
    referralEligible: true,
    offers: [
      { period: 'MONTHLY', months: 1, name: '月付', priceCents: 6990 },
      { period: 'QUARTERLY', months: 3, name: '季付', priceCents: 19920 },
      { period: 'YEARLY', months: 12, name: '年付', priceCents: 75490 },
    ],
  },
];

const trafficPacks = [
  { slug: '10g', trafficGb: 10, priceCents: 790 },
  { slug: '30g', trafficGb: 30, priceCents: 2190 },
  { slug: '50g', trafficGb: 50, priceCents: 3490 },
  { slug: '100g', trafficGb: 100, priceCents: 6490 },
  { slug: '200g', trafficGb: 200, priceCents: 12490 },
  { slug: '500g', trafficGb: 500, priceCents: 30490 },
];

function ids(kind, slug) {
  const base = `preview_${kind}_${slug}`;
  return {
    product: `catalog_${base}`,
    legacy: `${kind}_${base}`,
    profile: `profile_${base}`,
  };
}

async function upsertProfile(tx, id, name, speed, nodeIds) {
  await tx.accessProfile.upsert({
    where: { id },
    create: {
      id,
      slug: id,
      name: `${name} 可用节点`,
      description: '本地新版目录预览',
      active: true,
      speedUpMbps: speed,
      speedDownMbps: speed,
      deviceLimit,
    },
    update: {
      name: `${name} 可用节点`,
      active: true,
      speedUpMbps: speed,
      speedDownMbps: speed,
      deviceLimit,
    },
  });
  await tx.accessProfileNode.deleteMany({ where: { accessProfileId: id } });
  await tx.accessProfileNode.createMany({
    data: nodeIds.map((nodeId, priority) => ({
      accessProfileId: id,
      nodeId,
      priority,
    })),
  });
}

async function stagePlan(tx, plan, index, nodeIds) {
  const id = ids('plan', plan.slug);
  await upsertProfile(tx, id.profile, plan.name, plan.speed, nodeIds);
  await tx.plan.upsert({
    where: { id: id.legacy },
    create: {
      id: id.legacy,
      slug: `preview-${plan.slug}`,
      name: plan.name,
      description: plan.description,
      trafficBytes: BigInt(plan.trafficGb) * gb,
      durationDays: 30,
      speedUpMbps: plan.speed,
      speedDownMbps: plan.speed,
      deviceLimit,
      priceCents: plan.offers[0].priceCents,
      accent: plan.accent,
      accessProfileId: id.profile,
    },
    update: {
      name: plan.name,
      description: plan.description,
      active: true,
      trafficBytes: BigInt(plan.trafficGb) * gb,
      speedUpMbps: plan.speed,
      speedDownMbps: plan.speed,
      deviceLimit,
      priceCents: plan.offers[0].priceCents,
      accent: plan.accent,
      accessProfileId: id.profile,
    },
  });
  await tx.catalogProduct.upsert({
    where: { id: id.product },
    create: {
      id: id.product,
      legacyPlanId: id.legacy,
      slug: `preview-${plan.slug}-2026`,
      kind: 'PLAN',
      status: 'ACTIVE',
      name: plan.name,
      description: plan.description,
      storeUrl,
      quotaCadence: 'MONTHLY_RESET',
      accessProfileId: id.profile,
      speedUpMbps: plan.speed,
      speedDownMbps: plan.speed,
      accent: plan.accent,
      sortOrder: (index + 1) * 10,
      featured: plan.featured,
      purchaseLimitPerUser: plan.purchaseLimitPerUser ?? null,
      purchaseLimitKey: plan.purchaseLimitKey ?? null,
      requiresActivePlan: false,
      referralEligible: plan.referralEligible,
    },
    update: {
      status: 'ACTIVE',
      name: plan.name,
      description: plan.description,
      storeUrl,
      accessProfileId: id.profile,
      speedUpMbps: plan.speed,
      speedDownMbps: plan.speed,
      accent: plan.accent,
      sortOrder: (index + 1) * 10,
      featured: plan.featured,
      purchaseLimitPerUser: plan.purchaseLimitPerUser ?? null,
      purchaseLimitKey: plan.purchaseLimitKey ?? null,
      requiresActivePlan: false,
      referralEligible: plan.referralEligible,
    },
  });
  for (const offer of plan.offers) {
    const suffix = offer.period.toLowerCase();
    const legacyOfferId = `offer_preview_${plan.slug}_${suffix}`;
    const catalogOfferId = `catalog_offer_preview_${plan.slug}_${suffix}`;
    await tx.planOffer.upsert({
      where: { id: legacyOfferId },
      create: {
        id: legacyOfferId,
        planId: id.legacy,
        slug: `preview-${plan.slug}-${suffix}`,
        name: offer.name,
        billingPeriod: offer.period,
        intervalMonths: offer.months,
        priceCents: offer.priceCents,
        isDefault: offer.period === 'MONTHLY',
      },
      update: {
        active: true,
        archivedAt: null,
        name: offer.name,
        intervalMonths: offer.months,
        priceCents: offer.priceCents,
        isDefault: offer.period === 'MONTHLY',
      },
    });
    await tx.catalogOffer.upsert({
      where: { id: catalogOfferId },
      create: {
        id: catalogOfferId,
        productId: id.product,
        legacyPlanOfferId: legacyOfferId,
        slug: `preview-${plan.slug}-${suffix}-2026`,
        name: offer.name,
        billingPeriod: offer.period,
        intervalMonths: offer.months,
        trafficBytes: BigInt(plan.trafficGb) * gb,
        priceCents: offer.priceCents,
        storeUrl,
        isDefault: offer.period === 'MONTHLY',
      },
      update: {
        active: true,
        archivedAt: null,
        name: offer.name,
        trafficBytes: BigInt(plan.trafficGb) * gb,
        priceCents: offer.priceCents,
        storeUrl,
        isDefault: offer.period === 'MONTHLY',
      },
    });
  }
}

async function stagePack(tx, pack, index, nodeIds) {
  const id = ids('pack', pack.slug);
  const name = `${pack.trafficGb}GB 流量包`;
  await upsertProfile(tx, id.profile, name, 0, nodeIds);
  await tx.trafficPackProduct.upsert({
    where: { id: id.legacy },
    create: {
      id: id.legacy,
      slug: `preview-pack-${pack.slug}`,
      name,
      description: '订阅附加流量，365 天内有效',
      trafficBytes: BigInt(pack.trafficGb) * gb,
      validityDays: 365,
      priceCents: pack.priceCents,
      accent: 'green',
      accessProfileId: id.profile,
    },
    update: {
      name,
      active: true,
      archivedAt: null,
      description: '订阅附加流量，365 天内有效',
      trafficBytes: BigInt(pack.trafficGb) * gb,
      validityDays: 365,
      priceCents: pack.priceCents,
      accessProfileId: id.profile,
    },
  });
  await tx.catalogProduct.upsert({
    where: { id: id.product },
    create: {
      id: id.product,
      legacyTrafficPackProductId: id.legacy,
      slug: `preview-pack-${pack.slug}-2026`,
      kind: 'TRAFFIC_PACK',
      status: 'ACTIVE',
      name,
      description: '订阅附加流量，365 天内有效',
      storeUrl,
      quotaCadence: 'ONE_TIME',
      accessProfileId: id.profile,
      speedUpMbps: 0,
      speedDownMbps: 0,
      accent: index % 2 === 0 ? 'green' : 'teal',
      sortOrder: 100 + (index + 1) * 10,
      featured: pack.trafficGb === 100,
      requiresActivePlan: true,
      referralEligible: false,
    },
    update: {
      status: 'ACTIVE',
      name,
      description: '订阅附加流量，365 天内有效',
      storeUrl,
      accessProfileId: id.profile,
      accent: index % 2 === 0 ? 'green' : 'teal',
      sortOrder: 100 + (index + 1) * 10,
      featured: pack.trafficGb === 100,
      requiresActivePlan: true,
      referralEligible: false,
    },
  });
  await tx.catalogOffer.upsert({
    where: { id: `catalog_offer_preview_pack_${pack.slug}_yearly` },
    create: {
      id: `catalog_offer_preview_pack_${pack.slug}_yearly`,
      productId: id.product,
      slug: `preview-pack-${pack.slug}-yearly-2026`,
      name: '365 天有效',
      billingPeriod: 'YEARLY',
      intervalMonths: 12,
      trafficBytes: BigInt(pack.trafficGb) * gb,
      priceCents: pack.priceCents,
      storeUrl,
      isDefault: true,
    },
    update: {
      active: true,
      archivedAt: null,
      trafficBytes: BigInt(pack.trafficGb) * gb,
      priceCents: pack.priceCents,
      storeUrl,
      isDefault: true,
    },
  });
}

async function main() {
  const nodes = await prisma.node.findMany({
    where: { active: true, lifecycleStatus: 'ACTIVE', retiredAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (nodes.length === 0) throw new Error('No serviceable local nodes found');
  const nodeIds = nodes.map((node) => node.id);
  const previewIds = [
    ...plans.map((plan) => ids('plan', plan.slug).product),
    ...trafficPacks.map((pack) => ids('pack', pack.slug).product),
  ];
  await prisma.$transaction(async (tx) => {
    await tx.catalogProduct.updateMany({
      where: { id: { notIn: previewIds }, systemManaged: false },
      data: { status: 'ARCHIVED' },
    });
    for (const [index, plan] of plans.entries()) {
      await stagePlan(tx, plan, index, nodeIds);
    }
    for (const [index, pack] of trafficPacks.entries()) {
      await stagePack(tx, pack, index, nodeIds);
    }
  });
  console.log(`Staged ${plans.length} plans and ${trafficPacks.length} traffic packs locally.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
