import assert from "node:assert/strict";
import test from "node:test";
import { sortCatalogProductsByPrice } from "../src/lib/catalog-sort.ts";

const product = (name, priceCents, overrides = {}) => ({
  name,
  offers: [
    {
      priceCents,
      active: true,
      isDefault: true,
      archivedAt: null,
    },
  ],
  ...overrides,
});

test("catalog products are ordered by their default active offer price", () => {
  const products = [
    product("Spark", 4900),
    product("Max", 1600),
    product("Pro", 2100),
    product("Plus", 2990),
    product("Go", 200),
  ];

  assert.deepEqual(
    sortCatalogProductsByPrice(products).map((item) => item.name),
    ["Go", "Max", "Pro", "Plus", "Spark"],
  );
  assert.deepEqual(
    products.map((item) => item.name),
    ["Spark", "Max", "Pro", "Plus", "Go"],
  );
});

test("unavailable products stay last and equal prices keep backend order", () => {
  const products = [
    product("First", 1600),
    product("Unavailable", 100, {
      offers: [
        {
          priceCents: 100,
          active: false,
          isDefault: true,
          archivedAt: null,
        },
      ],
    }),
    product("Second", 1600),
  ];

  assert.deepEqual(
    sortCatalogProductsByPrice(products).map((item) => item.name),
    ["First", "Second", "Unavailable"],
  );
});
