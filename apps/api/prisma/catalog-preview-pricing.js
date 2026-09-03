function discountedPrice(basePriceCents, months, discountPercent) {
  return Math.round((basePriceCents * months * discountPercent) / 100);
}

function recurringOffers(monthlyPriceCents) {
  return [
    {
      period: 'MONTHLY',
      months: 1,
      name: '月付',
      priceCents: monthlyPriceCents,
    },
    {
      period: 'QUARTERLY',
      months: 3,
      name: '季付',
      priceCents: discountedPrice(monthlyPriceCents, 3, 95),
    },
    {
      period: 'YEARLY',
      months: 12,
      name: '年付',
      priceCents: discountedPrice(monthlyPriceCents, 12, 90),
    },
  ];
}

const plans = [
  {
    slug: 'go',
    name: 'Go',
    description: '新人轻量体验，每个账号终身仅限一次',
    trafficGb: 1,
    speed: 50,
    accent: 'teal',
    featured: false,
    referralEligible: false,
    purchaseLimitPerUser: 1,
    purchaseLimitKey: 'trial-go',
    offers: recurringOffers(200),
  },
  {
    slug: 'start',
    name: 'Start',
    description: '适合聊天、网页和轻量日常使用',
    trafficGb: 30,
    speed: 100,
    accent: 'green',
    featured: false,
    referralEligible: true,
    offers: recurringOffers(890),
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: '主流日常与影音需求，性价比首选',
    trafficGb: 80,
    speed: 200,
    accent: 'blue',
    featured: false,
    referralEligible: true,
    offers: recurringOffers(1290),
  },
  {
    slug: 'boost',
    name: 'Boost',
    description: '比 Pro 更充裕，兼顾日常浏览与影音',
    trafficGb: 150,
    speed: 200,
    accent: 'green',
    featured: false,
    referralEligible: true,
    offers: recurringOffers(1690),
  },
  {
    slug: 'plus',
    name: 'Plus',
    description: '适合高频视频、多设备和稳定长时间使用',
    trafficGb: 250,
    speed: 500,
    accent: 'indigo',
    featured: false,
    referralEligible: true,
    offers: recurringOffers(2190),
  },
  {
    slug: 'prime',
    name: 'Prime',
    description: '流量与价格更均衡，适合高频日常使用',
    trafficGb: 350,
    speed: 500,
    accent: 'green',
    featured: true,
    referralEligible: true,
    offers: recurringOffers(3290),
  },
  {
    slug: 'max',
    name: 'Max',
    description: '面向重度影音和大流量工作场景',
    trafficGb: 500,
    speed: 800,
    accent: 'orange',
    featured: false,
    referralEligible: true,
    offers: recurringOffers(4990),
  },
  {
    slug: 'elite',
    name: 'Elite',
    description: '介于 Max 与 Spark 之间的高流量档位',
    trafficGb: 750,
    speed: 800,
    accent: 'green',
    featured: false,
    referralEligible: true,
    offers: recurringOffers(6490),
  },
  {
    slug: 'spark',
    name: 'Spark',
    description: '旗舰大流量档位，提供最高接入速率',
    trafficGb: 1000,
    speed: 1000,
    accent: 'purple',
    featured: false,
    referralEligible: true,
    offers: recurringOffers(7900),
  },
];

const trafficPacks = [
  { slug: '10g', trafficGb: 10, priceCents: 690 },
  { slug: '30g', trafficGb: 30, priceCents: 1950 },
  { slug: '50g', trafficGb: 50, priceCents: 3200 },
  { slug: '100g', trafficGb: 100, priceCents: 6200 },
  { slug: '200g', trafficGb: 200, priceCents: 12200 },
  { slug: '500g', trafficGb: 500, priceCents: 30000 },
];

module.exports = {
  discountedPrice,
  plans,
  recurringOffers,
  trafficPacks,
};
