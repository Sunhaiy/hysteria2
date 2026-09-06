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
  assert.match(source, /paymentType,\s*purchaseAction:/);
  assert.match(source, /重置本期流量/);
  assert.match(source, /月付价 7 折，仅当前周期有效/);
  assert.match(source, /purchaseAction: checkout\.purchaseAction/);
  assert.match(
    source,
    /window\.open\(storeUrl, "_blank", "noopener,noreferrer"\)/,
  );
  assert.doesNotMatch(source, /window\.location\.assign\(storeUrl\)/);
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

test("member catalog presents the permanent Ultra series as one shared tier row", async () => {
  const [source, styles] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

  assert.match(source, /product\.series === "ultra"/);
  assert.match(source, /groups\.ultra/);
  assert.match(source, /普通线路 Ultra/);
  assert.match(source, /一次购买永久有效，三档共享同一组专属节点/);
  assert.match(source, /当前档位/);
  assert.match(source, /可补差价升级/);
  assert.match(source, /补差价 .* 升级/);
  assert.match(source, /升级需站内支付/);
  assert.match(source, /ultraPurchaseNotice/);
  assert.match(
    styles,
    /\.ultra-shop-section \.catalog-product-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/,
  );
});

test("member catalog uses the standard panel surface and aligned card headings", async () => {
  const [source, styles] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(stylesUrl, "utf8"),
  ]);

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
  assert.match(source, /catalog-standard-tiers/);
  assert.match(source, /轻量入门/);
  assert.match(source, /日常主力/);
  assert.match(source, /大流量/);
  assert.match(source, /近期热门/);
  assert.match(source, /年付月均/);
  assert.match(source, /已购权益按原订单履约/);
  assert.match(source, /calculateTermSavings/);
  assert.match(source, /省下/);
  assert.match(source, /每月额度独立重置/);
  assert.doesNotMatch(source, /支付完成后订单会自动确认/);
  assert.doesNotMatch(source, /点击去购买后将进入所选规格对应的店铺页面/);
  assert.match(
    styles,
    /\.checkout-product-summary\s*\{[\s\S]*?background:\s*var\(--bg-panel\);/,
  );
  assert.match(styles, /\.catalog-standard-tiers\s*\{[\s\S]*?gap:\s*22px;/);
});

test("shared motion keeps closed drawers hidden and status badges readable", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  const reveal = styles.match(/@keyframes content-reveal\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(reveal, /translate:/);
  assert.doesNotMatch(reveal, /transform:/);
  assert.match(
    styles,
    /\.drawer\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    styles,
    /\.drawer\.open\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/,
  );
  assert.match(styles, /\.badge\s*\{[\s\S]*?color:\s*#fff;/);
});
