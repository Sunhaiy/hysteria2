const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  discountedPrice,
  plans,
  recurringOffers,
  trafficPacks,
} = require('./catalog-preview-pricing');

describe('catalog preview pricing', () => {
  it('keeps Go as a low-cost, once-per-account acquisition offer', () => {
    const go = plans.find((plan) => plan.slug === 'go');

    assert.ok(go);
    assert.equal(go.purchaseLimitPerUser, 1);
    assert.equal(go.purchaseLimitKey, 'trial-go');
    assert.equal(go.referralEligible, false);
    assert.deepEqual(go.offers, recurringOffers(200));
  });

  it('applies a 5% quarterly and 10% yearly discount to every recurring plan', () => {
    for (const plan of plans) {
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

    assert.deepEqual(
      monthlyPrices,
      [200, 890, 1290, 1690, 2190, 3290, 4990, 6490, 7900],
    );

    for (let index = 1; index < monthlyPrices.length; index += 1) {
      assert.ok(monthlyPrices[index] > monthlyPrices[index - 1]);
    }
  });

  it('covers the approved nine monthly traffic tiers without large gaps', () => {
    assert.deepEqual(
      plans.map((plan) => plan.trafficGb),
      [1, 30, 80, 150, 250, 350, 500, 750, 1000],
    );
    assert.equal(plans.find((plan) => plan.slug === 'pro')?.featured, false);
    assert.equal(plans.find((plan) => plan.slug === 'prime')?.featured, true);
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
