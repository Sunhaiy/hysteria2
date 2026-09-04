import assert from "node:assert/strict";
import test from "node:test";

import { selectHomepagePlans } from "../src/lib/homepage-plans.ts";

const plan = (
  id,
  featured = false,
  offers = [{ active: true, archivedAt: null }],
) => ({ id, featured, offers });

test("homepage plans put featured products first while preserving backend order", () => {
  const result = selectHomepagePlans([
    plan("start"),
    plan("pro", true),
    plan("plus"),
    plan("max", true),
  ]);

  assert.deepEqual(result.map(({ id }) => id), ["pro", "max", "start", "plus"]);
});

test("homepage plans fill open slots, exclude unavailable products, and stop at four", () => {
  const result = selectHomepagePlans([
    plan("go", true),
    plan("hidden", true, [{ active: false, archivedAt: null }]),
    plan("start"),
    plan("pro"),
    plan("plus"),
    plan("max"),
  ]);

  assert.deepEqual(result.map(({ id }) => id), ["go", "start", "pro", "plus"]);
});
