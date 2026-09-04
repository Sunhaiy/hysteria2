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
  assert.doesNotMatch(dashboard, /下次重置/);
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

test("all interface icons use Hugeicons with an admin-controlled stroke width", async () => {
  const [settings, siteProvider, icon, customSelect, styles] =
    await Promise.all([
      source("app/admin/settings/page.tsx"),
      source("components/site-provider.tsx"),
      source("components/icon.tsx"),
      source("components/custom-select.tsx"),
      source("app/globals.scss"),
    ]);

  assert.match(icon, /@hugeicons\/core-free-icons/);
  assert.match(icon, /HugeiconsIcon/);
  assert.match(icon, /@hugeicons\/react/);
  assert.match(settings, /siteIconStrokeWidth/);
  assert.match(settings, /min=\{1\}/);
  assert.match(settings, /max=\{3\}/);
  assert.match(settings, /step=\{0\.1\}/);
  assert.match(siteProvider, /site-icon-stroke-width/);
  assert.match(siteProvider, /--icon-stroke-width/);
  assert.match(styles, /var\(--icon-stroke-width, 1\.5\)/);
  assert.match(icon, /const iconMotions:\s*Record<IconName, IconMotion>/);
  assert.match(icon, /data-icon-name=\{iconName\}/);
  assert.match(icon, /data-icon-cue=\{motion\.cue\}/);
  assert.match(icon, /"data-icon-accent"/);
  assert.match(icon, /"data-icon-secondary"/);
  assert.match(icon, /pathLength:\s*1/);
  assert.match(styles, /--icon-motion-ease:\s*cubic-bezier/);
  assert.match(styles, /@keyframes icon-detail-turn/);
  assert.match(styles, /@keyframes icon-detail-fold/);
  assert.match(styles, /@keyframes icon-detail-scan/);
  assert.match(styles, /@keyframes icon-detail-draw/);
  assert.match(styles, /@keyframes icon-detail-signal/);
  const motions = [
    ...(icon
      .match(/const iconMotions:[\s\S]*?= \{([\s\S]*?)\n\};/)?.[1]
      ?.matchAll(/^  \w+: \{$/gm) ?? []),
  ];
  assert.equal(motions.length, 62);
  assert.match(icon, /Suit01Icon/);
  assert.match(icon, /brand_logo:\s*Suit01Icon/);
  assert.match(icon, /settings:\s*\{\s*cue: "turn",\s*accentPart: 1/);
  assert.match(icon, /mail:\s*\{\s*cue: "fold",\s*accentPart: 0/);
  assert.match(icon, /download:\s*\{\s*cue: "drop",\s*accentPart: 0/);
  assert.match(icon, /upload:\s*\{\s*cue: "lift",\s*accentPart: 1/);
  assert.match(icon, /motion\.distance \* 1\.35/);
  const iconAnimationStyles = styles.match(
    /\.icon-slot \{[\s\S]*?\.sidebar-footer/,
  )?.[0];
  assert.ok(iconAnimationStyles);
  assert.doesNotMatch(iconAnimationStyles, /scale\(/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.icon-slot \.icon-part[\s\S]*?animation:\s*none !important;/,
  );
  assert.match(
    styles,
    /\.nav-link\.active\s*\{[^}]*color:\s*#06110a;[^}]*background:\s*var\(--accent-500\);[^}]*border-color:\s*var\(--accent-500\);/s,
  );
  assert.match(
    styles,
    /\.nav-link:is\(:hover, :focus-visible\)[\s\S]*?\.icon-part:not\(\[data-icon-accent="true"\]\)/,
  );
  assert.match(customSelect, /<Icon name="arrow_down"/);
  assert.doesNotMatch(customSelect, /<svg/);
});

test("the Suit 01 Hugeicon is used as the visible brand mark", async () => {
  const [home, authShell, consoleShell, styles, layout, siteProvider] = await Promise.all([
    source("app/page.tsx"),
    source("components/auth-shell.tsx"),
    source("components/console-shell.tsx"),
    source("app/globals.scss"),
    source("app/layout.tsx"),
    source("components/site-provider.tsx"),
  ]);

  assert.match(home, /ppanel-brand-mark[\s\S]*?<Icon name="brand_logo"/);
  assert.doesNotMatch(home, /src=\{site\.iconUrl\}/);
  assert.match(authShell, /lp-logo[\s\S]*?<Icon name="brand_logo"/);
  assert.doesNotMatch(authShell, /<svg/);
  assert.match(consoleShell, /sidebar-brand-mark[\s\S]*?<Icon name="brand_logo"/);
  const sidebarBrandMark = styles.match(
    /\.sidebar-brand-mark\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(sidebarBrandMark);
  assert.doesNotMatch(sidebarBrandMark, /background|border/);
  assert.match(layout, /brand-icon\.svg/);
  assert.match(siteProvider, /iconUrl:\s*"\/brand-icon\.svg"/);
});

test("authentication text remains monochrome", async () => {
  const styles = await source("app/globals.scss");

  assert.match(
    styles,
    /\.auth2-tab\.active::after\s*\{[^}]*background:\s*var\(--text-primary\)/s,
  );
  assert.match(
    styles,
    /\.auth2-code-btn\s*\{[^}]*color:\s*var\(--text-secondary\)/s,
  );
  assert.match(styles, /\.auth2-link\s*\{[^}]*color:\s*var\(--text-primary\)/s);
});

test("member navigation and tutorial platforms use the selected Hugeicons", async () => {
  const [icon, copy, tutorial] = await Promise.all([
    source("components/icon.tsx"),
    source("lib/copy.ts"),
    source("app/portal/tutorial/page.tsx"),
  ]);

  for (const iconName of [
    "AnonymousIcon",
    "AiDrawingIcon",
    "BubbleTea01Icon",
    "AccessIcon",
    "AiClothesIcon",
    "AiCoEditingIcon",
    "Agreement03Icon",
    "AlignStartVerticalIcon",
  ]) {
    assert.match(icon, new RegExp(iconName));
  }
  for (const semanticName of [
    "portal_overview",
    "portal_plans",
    "portal_access",
    "portal_tutorial",
    "portal_tickets",
    "portal_referrals",
    "portal_usage",
    "portal_orders",
  ]) {
    assert.match(copy, new RegExp(`icon: "${semanticName}"`));
  }
  assert.match(tutorial, /platformIcons/);
  assert.match(tutorial, /<Icon name=\{platformIcons\[item\.platform\]\} \/>/);
  assert.doesNotMatch(tutorial, /\? "W"|\? "M"|\? "A"|: "i"/);
});
