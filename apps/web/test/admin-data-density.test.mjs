import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("dense admin lists use a fixed desktop viewport with an internal table scroller", async () => {
  const [shell, styles, customers, tickets, referrals, orders] =
    await Promise.all([
      source("components/console-shell.tsx"),
      source("app/globals.scss"),
      source("app/admin/customers/page.tsx"),
      source("app/admin/tickets/page.tsx"),
      source("app/admin/referrals/page.tsx"),
      source("app/admin/orders/page.tsx"),
    ]);

  assert.match(shell, /dataViewport\?: boolean/);
  assert.match(shell, /workspace-body\$\{dataViewport \? " data-viewport"/);
  for (const page of [customers, tickets, referrals, orders]) {
    assert.match(page, /dataViewport/);
    assert.match(page, /admin-data-panel/);
  }
  assert.match(
    styles,
    /@media \(min-width: 921px\)[\s\S]*\.workspace-body\.data-viewport\s*\{[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.data-viewport \.admin-data-panel \.table-wrap\s*\{[^}]*overflow:\s*auto;/s,
  );
  assert.match(
    styles,
    /\.data-viewport \.admin-data-panel \.data-table th\s*\{[^}]*position:\s*sticky;/s,
  );
});

test("dense filters remain compact and in one desktop row", async () => {
  const [styles, customers, subscriptions, destinations] = await Promise.all([
    source("app/globals.scss"),
    source("app/admin/customers/page.tsx"),
    source("app/admin/subscriptions/page.tsx"),
    source("app/admin/destinations/page.tsx"),
  ]);

  for (const page of [customers, subscriptions, destinations]) {
    assert.match(page, /admin-compact-filters/);
  }
  assert.match(
    styles,
    /\.data-viewport \.admin-compact-filters\s*\{[^}]*flex-wrap:\s*nowrap;/s,
  );
  assert.match(styles, /min-height:\s*36px/);
});

test("related customer data links directly to the customer detail page", async () => {
  const [component, tickets, referrals, operations, destinations, nodes] =
    await Promise.all([
      source("components/customer-link.tsx"),
      source("app/admin/tickets/page.tsx"),
      source("app/admin/referrals/page.tsx"),
      source("app/admin/operations/page.tsx"),
      source("app/admin/destinations/page.tsx"),
      source("app/admin/nodes/page.tsx"),
    ]);

  assert.match(component, /href=\{`\/admin\/customers\/\$\{id\}`\}/);
  assert.match(tickets, /id=\{ticket\.user\.id\}/);
  assert.match(referrals, /id=\{record\.inviterId\}/);
  assert.match(referrals, /id=\{record\.inviteeId\}/);
  assert.match(operations, /id=\{item\.userId\}/);
  assert.match(destinations, /id=\{visit\.userId\}/);
  assert.match(nodes, /href="\/admin\/operations\?tab=presence"/);
});
