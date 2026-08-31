const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  discountedPrice,
  plans,
  trafficPacks,
} = require('./catalog-preview-pricing');

describe('catalog preview pricing', () => {
  it('keeps Go as a one-time low-cost acquisition offer', () => {
    const go = plans.find((plan) => plan.slug === 'go');

    assert.ok(go);
    assert.equal(go.purchaseLimitPerUser, 1);
    assert.equal(go.purchaseLimitKey, 'trial-go');
    assert.equal(go.referralEligible, false);
    assert.deepEqual(go.offers, [
      { period: 'MONTHLY', months: 1, name: '月付', priceCents: 290 },
    ]);
  });

  it('applies a 5% quarterly and 10% yearly discount to every recurring plan', () => {
    for (const plan of plans.filter((item) => item.slug !== 'go')) {
      const [monthly, quarterly, yearly] = plan.offers;

      assert.equal(
        quarterly.priceCents,
        discountedPrice(monthly.priceCents, 3, 95),
      );
      assert.equal(
        yearly.priceCents,
        discountedPrice(monthly.priceCents, 12, 90),
      );
      assert.ok(quarterly.priceCents / 3 < monthly.priceCents);
      assert.ok(yearly.priceCents / 12 < quarterly.priceCents / 3);
    }
  });

  it('keeps plan prices increasing with each traffic tier', () => {
    const monthlyPrices = plans.map((plan) => plan.offers[0].priceCents);

    assert.deepEqual(monthlyPrices, [290, 990, 1290, 2100, 4590, 7200]);

    for (let index = 1; index < monthlyPrices.length; index += 1) {
      assert.ok(monthlyPrices[index] > monthlyPrices[index - 1]);
    }
  });

  it('keeps traffic packs at or above CNY 0.60 per GiB', () => {
    let previousUnitPrice = Number.POSITIVE_INFINITY;

    for (const pack of trafficPacks) {
      const unitPriceCents = pack.priceCents / pack.trafficGb;

      assert.ok(unitPriceCents >= 60);
      assert.ok(unitPriceCents <= previousUnitPrice);
      previousUnitPrice = unitPriceCents;
    }
  });
});
