import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/app/portal/plans/page.tsx", import.meta.url);
const stylesUrl = new URL("../src/app/globals.scss", import.meta.url);

test("member catalog keeps plan cards and uses exactly one purchase channel", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.doesNotMatch(source, /<ShaderAnimation/);
  assert.doesNotMatch(source, /data-plan-accent=/);
  assert.doesNotMatch(source, /normalizePlanAccent/);
  assert.doesNotMatch(source, /className="field plan-offer-field"/);
  assert.doesNotMatch(source, /selected\[product\.id\]/);
  assert.doesNotMatch(source, /href=\{purchaseStoreUrl\}/);
  assert.match(source, /openCheckout\(product\)/);
  assert.match(source, /className="checkout-offer-options"/);
  assert.match(source, /选择购买周期/);
  assert.match(source, /paymentType === "alipay"/);
  assert.match(source, /paymentType === "wxpay"/);
  assert.match(source, /paymentType,\s*\}/);
  assert.match(source, /window\.location\.assign\(storeUrl\)/);
  assert.match(
    source,
    /branding\.purchaseMode === "cdk"[\s\S]*branding\.cdkButtonUrl/,
  );
  assert.match(source, /branding\.checkoutMode === "store"/);
  assert.match(source, /\/api\/portal\/payments\/epay/);
  assert.doesNotMatch(source, /checkout-store-link/);
  assert.match(source, /formatTrafficLimit/);
  assert.match(source, /formatSpeedLimit/);
  assert.match(source, /className="plan-card-title-row"/);
  assert.match(source, /className="plan-card-labels"/);
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

test("member catalog uses the standard panel surface and aligned card headings", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(
    styles,
    /\.premium-plan-card\s*\{[\s\S]*?background:\s*var\(--surface-overlay\),\s*var\(--bg-panel\);/,
  );
  assert.match(
    styles,
    /\.plan-card-title-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
  );
  assert.match(
    styles,
    /\.plan-card-copy > \.panel-copy\s*\{[\s\S]*?min-height:\s*36px;/,
  );
});
