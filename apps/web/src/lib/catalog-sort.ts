type CatalogOfferPrice = {
  priceCents: number;
  active: boolean;
  isDefault: boolean;
  archivedAt?: string | null;
};

type CatalogProductPrice = {
  offers: CatalogOfferPrice[];
};

function defaultOfferPrice(product: CatalogProductPrice) {
  const offers = product.offers.filter(
    (offer) => offer.active && !offer.archivedAt,
  );
  const defaultOffer = offers.find((offer) => offer.isDefault) ?? offers[0];
  return defaultOffer?.priceCents ?? Number.POSITIVE_INFINITY;
}

export function sortCatalogProductsByPrice<T extends CatalogProductPrice>(
  products: readonly T[],
) {
  return products
    .map((product, index) => ({
      product,
      index,
      price: defaultOfferPrice(product),
    }))
    .sort((left, right) => left.price - right.price || left.index - right.index)
    .map(({ product }) => product);
}
