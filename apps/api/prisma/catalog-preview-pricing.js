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
    offers: recurringOffers(990),
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
    offers: recurringOffers(1290),
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
    offers: recurringOffers(2100),
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
    offers: recurringOffers(4590),
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
    offers: recurringOffers(7200),
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
