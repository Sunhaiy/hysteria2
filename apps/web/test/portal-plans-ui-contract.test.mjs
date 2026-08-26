import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/app/portal/plans/page.tsx", import.meta.url);

test("member catalog keeps the established plan cards and shop entry", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /<ShaderAnimation/);
  assert.match(source, /data-plan-accent=/);
  assert.match(source, /className="action-button checkout-store-link"/);
  assert.match(source, /href=\{checkoutStoreUrl\}/);
  assert.match(source, /href=\{purchaseStoreUrl\}/);
  assert.match(
    source,
    /branding\.purchaseMode === "cdk"[\s\S]*branding\.cdkButtonUrl/,
  );
  assert.match(source, /前往店铺购买/);
  assert.match(source, /formatTrafficLimit/);
  assert.match(source, /formatSpeedLimit/);
  assert.match(source, /当前套餐/);
  assert.match(source, /续费套餐/);
  assert.doesNotMatch(source, /api\/portal\/wallet/);
  assert.doesNotMatch(source, /余额 \{formatMoney\(wallet\.balanceCents\)\}/);
  assert.doesNotMatch(source, /使用 CDK 兑换/);
  assert.doesNotMatch(source, /套餐切换立即生效/);
  assert.doesNotMatch(source, /\/portal\/redeem/);
});
