export type HomepagePlanOffer = {
  active?: boolean;
  archivedAt?: string | null;
};

export type HomepagePlan = {
  id: string;
  featured: boolean;
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

  const purchasable = products.filter(hasPurchasableOffer);
  const featured = purchasable.filter((product) => product.featured);
  const remaining = purchasable.filter((product) => !product.featured);
  return [...featured, ...remaining].slice(0, limit);
}
