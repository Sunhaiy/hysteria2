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
  assert.match(page, /portal-journey/);
  assert.match(page, /portal-companionship-inline/);
  assert.doesNotMatch(page, /portal-companion-days/);
  assert.match(page, /仅累计有效订阅时间/);
  assert.match(page, /我们会在您使用一周年送上一份神秘礼物/);
  assert.doesNotMatch(page, /<Panel title="流量构成"/);
  assert.doesNotMatch(page, /<Panel title="接入状态"/);
  assert.doesNotMatch(page, /<Panel title="快捷操作"/);
  assert.doesNotMatch(page, /portal-detail-grid/);
  assert.match(
    styles,
    /\.portal-entitlement-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s*minmax\(0,\s*0\.92fr\)/s,
  );
  assert.match(page, /height="clamp\(120px, calc\(100dvh - 628px\), 230px\)"/);
  assert.match(
    styles,
    /\.portal-analytics\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*calc\(100dvh - 106px\);[^}]*flex-direction:\s*column;/s,
  );
  assert.match(
    styles,
    /\.portal-journey\s*\{[^}]*align-items:\s*stretch;[^}]*flex:\s*0 0 clamp\(94px, 12dvh, 120px\);[^}]*max-height:\s*120px;/s,
  );
  assert.match(
    styles,
    /\.tutorial-platform-mark\s*\{[^}]*border:\s*1px solid var\(--border-default\);[^}]*background:\s*var\(--bg-panel-alt\);[^}]*color:\s*var\(--text-primary\);/s,
  );
  assert.match(
    styles,
    /\.tutorial-tab\.active\s*\{[^}]*color:\s*#06110a;[^}]*border-color:\s*var\(--accent-500\);[^}]*background:\s*var\(--accent-500\);/s,
  );
  assert.match(
    styles,
    /\.tutorial-tab\.active \.tutorial-platform-mark\s*\{[^}]*color:\s*#06110a;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 920px\)[\s\S]*?\.portal-journey\s*\{\s*flex:\s*none;/,
  );
  const usageRequest = page.indexOf("const usageRequest");
  const overviewReady = page.indexOf("setOverview(nextOverview)");
  const usageAwait = page.indexOf("await usageRequest");
  assert.ok(usageRequest >= 0 && usageRequest < overviewReady);
  assert.ok(overviewReady >= 0 && overviewReady < usageAwait);
  assert.match(page, /const \[usageError, setUsageError\]/);
  assert.match(page, /流量数据加载失败/);
  assert.doesNotMatch(page, /\.catch\(\(\) => null\)/);
  assert.match(sidebar, /prefetch=\{false\}/);
});

test("feedback and toast states use solid semantic fills", async () => {
  const styles = await source("app/globals.scss");

  for (const [selector, token] of [
    ["feedback\\.error", "status-critical"],
    ["feedback\\.success", "status-success"],
    ["feedback\\.info", "status-info"],
    ["feedback\\.warn", "status-redirect"],
    ["toast-error", "status-critical"],
    ["toast-success", "status-success"],
  ]) {
    assert.match(
      styles,
      new RegExp(
        `\\.${selector}\\s*\\{[^}]*background:\\s*var\\(--${token}\\);`,
        "s",
      ),
    );
  }
});
