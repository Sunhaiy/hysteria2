import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../src/app/admin/backups/page.tsx", import.meta.url),
  "utf8",
);
const nav = await readFile(
  new URL("../src/lib/copy.ts", import.meta.url),
  "utf8",
);

test("admin backup page exposes full-site export, validated import, and confirmed restore", () => {
  assert.match(nav, /href: "\/admin\/backups"/);
  assert.match(page, /立即备份/);
  assert.match(page, /导入备份/);
  assert.match(page, /输入 RESTORE 确认/);
  assert.match(page, /数据库 \+ 文件/);
  assert.match(page, /最新 \{overview\.retentionCount\} 份/);
  assert.match(page, /badge success backup-status-badge/);
});
