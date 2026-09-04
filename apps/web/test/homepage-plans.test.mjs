import assert from "node:assert/strict";
import test from "node:test";

import { selectHomepagePlans } from "../src/lib/homepage-plans.ts";

const plan = (
  id,
  homepageVisible = false,
  offers = [{ active: true, archivedAt: null }],
) => ({ id, homepageVisible, offers });

test("homepage plans include only the products selected by administrators", () => {
  const result = selectHomepagePlans([
    plan("start"),
    plan("pro", true),
    plan("plus"),
    plan("max", true),
  ]);

  assert.deepEqual(
    result.map(({ id }) => id),
    ["pro", "max"],
  );
});

test("homepage plans exclude unavailable products and stop at four", () => {
  const result = selectHomepagePlans([
    plan("go", true),
    plan("hidden", true, [{ active: false, archivedAt: null }]),
    plan("start", true),
    plan("pro", true),
    plan("plus", true),
    plan("max", true),
  ]);

  assert.deepEqual(
    result.map(({ id }) => id),
    ["go", "start", "pro", "plus"],
  );
});
