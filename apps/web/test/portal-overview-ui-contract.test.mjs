import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("member overview keeps plan, entitlements, and both usage charts above the fold", async () => {
  const [page, styles, sidebar] = await Promise.all([
    source("app/portal/page.tsx"),
    source("app/globals.scss"),
    source("components/sidebar-nav.tsx"),
  ]);

  assert.match(page, /portal-entitlement-row/);
  assert.match(page, /portal-plan-facts/);
  assert.match(page, /portal-pack-summary-panel/);
  assert.ok(
    page.indexOf("portal-entitlement-row") <
      page.indexOf("portal-dashboard-main"),
  );
  assert.match(page, /nodeTrafficOption/);
  assert.match(page, /节点流量分布/);
  assert.match(page, /计费流量/);
  assert.doesNotMatch(page, /<Panel title="流量构成"/);
  assert.doesNotMatch(page, /<Panel title="接入状态"/);
  assert.doesNotMatch(page, /<Panel title="快捷操作"/);
  assert.doesNotMatch(page, /portal-detail-grid/);
  assert.match(
    styles,
    /\.portal-entitlement-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s*minmax\(0,\s*0\.92fr\)/s,
  );
  assert.match(page, /height=\{210\}/);
  const usageRequest = page.indexOf("const usageRequest");
  const overviewReady = page.indexOf("setOverview(nextOverview)");
  const usageAwait = page.indexOf("await usageRequest");
  assert.ok(usageRequest >= 0 && usageRequest < overviewReady);
  assert.ok(overviewReady >= 0 && overviewReady < usageAwait);
  assert.match(sidebar, /prefetch=\{false\}/);
});
