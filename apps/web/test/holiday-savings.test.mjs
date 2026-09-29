import assert from "node:assert/strict";
import test from "node:test";
import { bestHolidayBundle } from "../src/lib/holiday-savings.ts";
const data = () => ({
  campaign: {
    live: true,
    giftBudgetCents: 100000,
    reservedGiftCents: 0,
    config: {
      tiers: [
        { id: "50", amountCents: 5000, giftCents: 500 },
        { id: "100", amountCents: 10000, giftCents: 1200 },
        { id: "200", amountCents: 20000, giftCents: 3000 },
      ],
    },
  },
  claimedTierIds: [],
  offers: [
    { offerId: "plus", originalPriceCents: 23652, priceCents: 18922 },
    { offerId: "prime", originalPriceCents: 35532, priceCents: 28426 },
  ],
});
test("chooses one affordable recharge tier without stacking tiers or existing balance", () => {
  const result = bestHolidayBundle(data());
  assert.equal(result.offer.offerId, "plus");
  assert.equal(result.paid, 20000);
  assert.equal(result.tier.id, "200");
  assert.equal(result.saving, 7730);
  assert.equal(result.remaining, 4078);
});
test("excludes claimed tiers and combinations exceeding the remaining gift budget", () => {
  const d = data();
  d.claimedTierIds = ["100"];
  d.campaign.giftBudgetCents = 3000;
  const result = bestHolidayBundle(d);
  assert.equal(result.tier.id, "200");
  assert.equal(result.saving, 7730);
});
test("does not advertise impossible or ended bundles", () => {
  const d = data();
  d.claimedTierIds = ["50", "100", "200"];
  assert.equal(bestHolidayBundle(d), null);
  d.campaign.live = false;
  assert.equal(bestHolidayBundle(d), null);
});
