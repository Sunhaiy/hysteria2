import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("admin dashboard uses the dedicated projection and five operational metrics", async () => {
  const page = await read("../src/app/admin/page.tsx");

  assert.match(page, /\/api\/admin\/dashboard\/summary/);
  assert.doesNotMatch(page, /\/api\/admin\/users\?/);
  assert.doesNotMatch(page, /\/api\/admin\/subscriptions\?/);
  for (const label of [
    "今日流量",
    "昨日流量",
    "本月流量",
    "当前订阅用户",
    "在线用户",
  ]) {
    assert.match(page, new RegExp(`label="${label}"`));
  }
  assert.doesNotMatch(page, /需要关注的订阅|高用量用户/);
  assert.match(page, /splitNumber:\s*3/);
  assert.match(page, /axisLabel:\s*\{ width:\s*132, overflow:\s*"truncate" \}/);
});

test("customer traffic, orders, and operations expose durable daily statistics", async () => {
  const [customer, orders, operations, financeRedirect, styles] =
    await Promise.all([
      read("../src/app/admin/customers/[id]/page.tsx"),
      read("../src/app/admin/orders/page.tsx"),
      read("../src/app/admin/operations/page.tsx"),
      read("../src/app/admin/finance/page.tsx"),
      read("../src/app/globals.scss"),
    ]);

  assert.match(customer, /\/traffic\/daily\?/);
  assert.match(customer, /"上传",\s*"下载",\s*"物理流量",\s*"计费流量"/);
  assert.match(customer, /实际倍率/);
  assert.match(orders, /\/api\/admin\/finance\/annual-break-even\?year=/);
  assert.match(orders, /\/api\/admin\/finance\/annual-costs\//);
  assert.match(orders, /本月实际收入/);
  assert.match(orders, /不含 CDK 与人工调整/);
  assert.match(
    operations,
    /\/api\/admin\/operations\/traffic\/servers\?month=/,
  );
  assert.match(operations, /每日服务器真实流量/);
  assert.match(financeRedirect, /redirect\("\/admin\/orders"\)/);
  assert.match(
    styles,
    /\.order-annual-cost-form\s*\{[^}]*grid-template-columns:/s,
  );
});

test("member overview fills its top row with a horizontal remaining-quota bar", async () => {
  const [portal, styles] = await Promise.all([
    read("../src/app/portal/page.tsx"),
    read("../src/app/globals.scss"),
  ]);

  assert.match(portal, /className="metric-grid portal-primary-metrics"/);
  assert.match(portal, /className="portal-quota-summary"/);
  assert.match(portal, /className="portal-quota-track"/);
  assert.match(portal, /role="progressbar"/);
  assert.doesNotMatch(portal, /<MetricCard\s+label="剩余总流量"/);
  assert.match(
    styles,
    /\.portal-primary-metrics\s*\{[^}]*grid-template-columns:\s*minmax\(320px,\s*2fr\)\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s,
  );
});
