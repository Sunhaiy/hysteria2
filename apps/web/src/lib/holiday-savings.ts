import type { HolidayView } from "./holiday";

/** Maximize gift credit plus same-term price reduction using one recharge tier only. */
export function bestHolidayBundle(data: HolidayView | null) {
  const campaign = data?.campaign;
  if (!data || !campaign?.live) return null;
  const tiers = campaign.config.tiers.filter(
    (t) => t.amountCents > 0 && !data.claimedTierIds.includes(t.id),
  );
  const budget = campaign.giftBudgetCents - campaign.reservedGiftCents;
  let best: {
    tier: (typeof tiers)[number];
    offer: HolidayView["offers"][number];
    paid: number;
    gift: number;
    saving: number;
    remaining: number;
  } | null = null;
  for (const tier of tiers) {
    const paid = tier.amountCents;
    const gift = tier.giftCents;
    if (gift > budget) continue;
    for (const offer of data.offers) {
      if (
        offer.priceCents > paid + gift ||
        offer.priceCents > offer.originalPriceCents
      )
        continue;
      const saving = gift + offer.originalPriceCents - offer.priceCents;
      if (
        !best ||
        saving > best.saving ||
        (saving === best.saving && paid < best.paid)
      )
        best = {
          tier,
          offer,
          paid,
          gift,
          saving,
          remaining: paid + gift - offer.priceCents,
        };
    }
  }
  return best;
}
