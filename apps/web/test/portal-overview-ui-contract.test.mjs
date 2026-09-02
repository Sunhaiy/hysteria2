import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("member overview keeps plan and traffic packs above the fold", async () => {
  const [page, styles] = await Promise.all([
    source("app/portal/page.tsx"),
    source("app/globals.scss"),
  ]);

  assert.match(page, /portal-plan-summary/);
  assert.match(page, /portal-pack-summary-panel/);
  assert.ok(
    page.indexOf("portal-plan-summary") < page.indexOf("portal-dashboard-main"),
  );
  assert.doesNotMatch(page, /<Panel title="流量构成"/);
  assert.doesNotMatch(page, /<Panel title="接入状态"/);
  assert.doesNotMatch(page, /<Panel title="快捷操作"/);
  assert.doesNotMatch(page, /portal-detail-grid/);
  assert.match(
    styles,
    /\.portal-dashboard-main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.45fr\)\s*minmax\(300px,\s*0\.85fr\)/s,
  );
  assert.match(page, /height=\{246\}/);
});
