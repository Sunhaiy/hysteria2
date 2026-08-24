import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/app/portal/plans/page.tsx", import.meta.url);

test("member catalog keeps the established plan cards and shop entry", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /<ShaderAnimation/);
  assert.match(source, /data-plan-accent=/);
  assert.match(source, /前往店铺购买 CDK/);
  assert.match(source, /formatTrafficLimit/);
  assert.match(source, /formatSpeedLimit/);
  assert.match(source, /当前套餐/);
  assert.match(source, /续费套餐/);
});
