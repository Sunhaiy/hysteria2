import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("customer account deletion requires two confirmations and releases the email", async () => {
  const [customerDetail, userManagement] = await Promise.all([
    source("app/admin/customers/[id]/page.tsx"),
    source("app/admin/users/page.tsx"),
  ]);

  for (const page of [customerDetail, userManagement]) {
    assert.match(page, /window\.prompt\(/);
    assert.match(page, /window\.confirm\(/);
    assert.match(page, /原邮箱可重新注册/);
    assert.match(page, /method:\s*"DELETE"/);
    assert.match(page, /confirmationEmail/);
    assert.match(page, /<Icon name="trash" \/>/);
    assert.match(page, /删除账户/);
  }
});
