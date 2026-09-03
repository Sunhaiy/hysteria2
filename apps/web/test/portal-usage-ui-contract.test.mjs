import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = () =>
  readFile(
    new URL("../src/app/portal/usage/page.tsx", import.meta.url),
    "utf8",
  );

test("member usage fills the available desktop table height with billed-only records", async () => {
  const usage = await source();

  assert.doesNotMatch(usage, /const PAGE_SIZE = 8/);
  assert.match(usage, /ResizeObserver/);
  assert.match(usage, /tableViewportRef/);
  assert.match(usage, /pageSize/);
  assert.match(usage, /dataViewport/);
  assert.match(usage, /admin-data-page portal-usage-page/);
  assert.match(usage, /headers=\{\["节点", "计费流量", "时间"\]\}/);
  assert.match(usage, /formatBytes\(item\.accountedBytes\)/);
  assert.match(usage, /pagination=\{\{/);
  assert.doesNotMatch(usage, /formatBytes\(item\.(?:txBytes|rxBytes)\)/);
  assert.doesNotMatch(usage, /item\.source/);
});
