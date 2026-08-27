import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../src/app/portal/referrals/page.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/app/globals.scss", import.meta.url),
  "utf8",
);

test("referral entry keeps copy actions aligned and exposes both rewards", () => {
  assert.match(page, /referral-code-row/);
  assert.match(page, /referral-link-row/);
  assert.match(page, /referral-copy-button/);
  assert.match(page, /<Icon name="content_copy" \/>/);
  assert.match(page, /你获得/);
  assert.match(page, /好友获得/);
  assert.match(
    styles,
    /\.referral-copy-button\s*\{[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(
    styles,
    /\.referral-link-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
  );
});

test("referral page has responsive metrics and a designed empty state", () => {
  assert.match(page, /referral-metric-grid/);
  assert.match(page, /referral-empty-state/);
  assert.match(
    styles,
    /\.referral-metric::before\s*\{[^}]*background:\s*var\(--status-success\);/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 520px\)[\s\S]*\.referral-metric-grid/,
  );
});
