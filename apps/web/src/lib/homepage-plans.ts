export type HomepagePlanOffer = {
  active?: boolean;
  archivedAt?: string | null;
};

export type HomepagePlan = {
  id: string;
  homepageVisible: boolean;
  offers: HomepagePlanOffer[];
};

function hasPurchasableOffer(product: HomepagePlan) {
  return product.offers.some(
    (offer) => offer.active !== false && !offer.archivedAt,
  );
}

export function selectHomepagePlans<T extends HomepagePlan>(
  products: T[],
  limit = 4,
) {
  if (limit <= 0) return [];

  return products
    .filter(
      (product) => product.homepageVisible && hasPurchasableOffer(product),
    )
    .slice(0, limit);
}
