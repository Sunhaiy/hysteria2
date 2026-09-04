export type TermPricingOffer = {
  billingPeriod: string;
  intervalMonths: number | null;
  priceCents: number;
};

export type TermSavings = {
  listPriceCents: number;
  savingsCents: number;
  savingsPercent: number;
  discountLabel: string;
};

export function calculateTermSavings(
  offers: TermPricingOffer[],
  selected: TermPricingOffer,
): TermSavings | null {
  const months = selected.intervalMonths ?? 0;
  if (selected.billingPeriod === "monthly" || months <= 1) return null;

  const monthly = offers.find(
    (offer) =>
      offer.billingPeriod === "monthly" &&
      offer.priceCents > 0,
  );
  if (!monthly) return null;

  const listPriceCents = monthly.priceCents * months;
  const savingsCents = listPriceCents - selected.priceCents;
  if (savingsCents <= 0) return null;

  const discountFold =
    Math.round((selected.priceCents / listPriceCents) * 100) / 10;
  return {
    listPriceCents,
    savingsCents,
    savingsPercent: Math.round((savingsCents / listPriceCents) * 100),
    discountLabel: `${discountFold.toLocaleString("zh-CN", {
      maximumFractionDigits: 1,
    })} 折`,
  };
}
