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

test("customer traffic and finance expose daily detail and annual break-even", async () => {
  const [customer, finance, styles] = await Promise.all([
    read("../src/app/admin/customers/[id]/page.tsx"),
    read("../src/app/admin/finance/page.tsx"),
    read("../src/app/globals.scss"),
  ]);

  assert.match(customer, /\/traffic\/daily\?/);
  assert.match(customer, /"上传",\s*"下载",\s*"物理流量",\s*"计费流量"/);
  assert.match(customer, /实际倍率/);
  assert.match(finance, /\/api\/admin\/finance\/annual-break-even\?year=/);
  assert.match(finance, /\/api\/admin\/finance\/annual-costs\//);
  assert.match(finance, /年度总成本独立计算，不与节点成本重复相加/);
  assert.match(
    styles,
    /\.annual-cost-form > \.action-button\s*\{[^}]*white-space:\s*nowrap;/s,
  );
});
