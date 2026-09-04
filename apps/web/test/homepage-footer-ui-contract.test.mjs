import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("homepage footer ends flush with the document and centers its copyright", async () => {
  const [page, styles] = await Promise.all([
    source("app/page.tsx"),
    source("app/globals.scss"),
  ]);

  const footerMarkup = page.match(
    /<footer className="ppanel-footer">[\s\S]*?<\/footer>/,
  )?.[0];
  assert.ok(footerMarkup, "homepage footer markup should exist");
  assert.doesNotMatch(footerMarkup, /<div\s*\/>/);

  assert.match(
    styles,
    /\.ppanel-footer-inner\s*\{\s*min-height:\s*0;\s*margin-bottom:\s*0;\s*justify-content:\s*center;\s*padding-block:\s*\d+px;\s*\}/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 639px\)[\s\S]*?\.ppanel-footer-inner\s*\{\s*align-items:\s*center;/s,
  );
});
