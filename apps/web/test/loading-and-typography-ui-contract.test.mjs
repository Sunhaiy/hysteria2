import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("all route and authentication fallbacks use the full console skeleton", async () => {
  const [loading, shell, skeleton, table] = await Promise.all([
    source("app/loading.tsx"),
    source("components/console-shell.tsx"),
    source("components/skeleton.tsx"),
    source("components/data-table.tsx"),
  ]);

  assert.match(loading, /<ConsoleSkeleton \/>/);
  assert.match(shell, /return <ConsoleSkeleton \/>/);
  assert.match(skeleton, /export function PageSkeleton/);
  assert.match(skeleton, /export function TableSkeleton/);
  assert.match(skeleton, /export function CardGridSkeleton/);
  assert.match(table, /<TableSkeleton columns=\{headers\.length\}/);
});

test("portal data-heavy pages reserve content-shaped space while loading", async () => {
  const [dashboard, access, plans, orders, usage, tutorial, referrals] =
    await Promise.all([
      source("app/portal/page.tsx"),
      source("app/portal/access/page.tsx"),
      source("app/portal/plans/page.tsx"),
      source("app/portal/orders/page.tsx"),
      source("app/portal/usage/page.tsx"),
      source("app/portal/tutorial/page.tsx"),
      source("app/portal/referrals/page.tsx"),
    ]);

  assert.match(dashboard, /<PageSkeleton variant="dashboard" \/>/);
  assert.match(access, /<PageSkeleton variant="detail" \/>/);
  assert.match(plans, /<CardGridSkeleton \/>/);
  assert.match(orders, /<PageSkeleton variant="table" \/>/);
  assert.match(usage, /<PageSkeleton variant="dashboard" \/>/);
  assert.match(tutorial, /<PageSkeleton variant="detail" \/>/);
  assert.match(referrals, /<PageSkeleton variant="dashboard" \/>/);
});

test("admin can set a validated global interface font weight", async () => {
  const [settings, siteProvider, styles] = await Promise.all([
    source("app/admin/settings/page.tsx"),
    source("components/site-provider.tsx"),
    source("app/globals.scss"),
  ]);

  assert.match(settings, /siteFontWeight/);
  assert.match(settings, /type="range"/);
  assert.match(settings, /min=\{350\}/);
  assert.match(settings, /max=\{600\}/);
  assert.match(siteProvider, /--font-weight-body/);
  assert.match(siteProvider, /site-font-weight/);
  assert.match(styles, /font-weight:\s*var\(--font-weight-body\)/);
  assert.match(styles, /"PingFang SC"/);
  assert.match(styles, /"Microsoft YaHei UI"/);
});
