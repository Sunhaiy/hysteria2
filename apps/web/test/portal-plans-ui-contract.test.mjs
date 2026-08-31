import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/app/portal/plans/page.tsx", import.meta.url);

test("member catalog keeps plan cards and uses exactly one purchase channel", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.doesNotMatch(source, /<ShaderAnimation/);
  assert.match(source, /data-plan-accent=/);
  assert.match(source, /href=\{purchaseStoreUrl\}/);
  assert.match(
    source,
    /branding\.purchaseMode === "cdk"[\s\S]*branding\.cdkButtonUrl/,
  );
  assert.match(source, /branding\.checkoutMode === "store"/);
  assert.match(source, /\/api\/portal\/payments\/epay/);
  assert.doesNotMatch(source, /checkout-store-link/);
  assert.match(source, /formatTrafficLimit/);
  assert.match(source, /formatSpeedLimit/);
  assert.match(source, /当前套餐/);
  assert.match(source, /永久有效/);
  assert.match(source, /purchaseNotice/);
  assert.match(source, /立即续费/);
  assert.doesNotMatch(source, /api\/portal\/wallet/);
  assert.doesNotMatch(source, /余额 \{formatMoney\(wallet\.balanceCents\)\}/);
  assert.doesNotMatch(source, /使用 CDK 兑换/);
  assert.doesNotMatch(source, /套餐切换立即生效/);
  assert.doesNotMatch(source, /\/portal\/redeem/);
});
