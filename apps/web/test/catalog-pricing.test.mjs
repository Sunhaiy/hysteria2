import assert from "node:assert/strict";
import test from "node:test";

import { calculateTermSavings } from "../src/lib/catalog-pricing.ts";

const offers = [
  {
    billingPeriod: "monthly",
    intervalMonths: 1,
    priceCents: 890,
  },
  {
    billingPeriod: "quarterly",
    intervalMonths: 3,
    priceCents: 2537,
  },
  {
    billingPeriod: "yearly",
    intervalMonths: 12,
    priceCents: 9612,
  },
];

test("quarterly and yearly offers expose savings against the monthly list price", () => {
  assert.deepEqual(calculateTermSavings(offers, offers[1]), {
    listPriceCents: 2670,
    savingsCents: 133,
    savingsPercent: 5,
    discountLabel: "9.5 折",
  });
  assert.deepEqual(calculateTermSavings(offers, offers[2]), {
    listPriceCents: 10680,
    savingsCents: 1068,
    savingsPercent: 10,
    discountLabel: "9 折",
  });
});

test("monthly and non-discounted offers do not invent a saving", () => {
  assert.equal(calculateTermSavings(offers, offers[0]), null);
  assert.equal(
    calculateTermSavings(
      offers,
      { billingPeriod: "yearly", intervalMonths: 12, priceCents: 10680 },
    ),
    null,
  );
});
