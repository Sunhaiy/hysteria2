import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("admin payment settings enforce one checkout channel at a time", async () => {
  const settings = await source("app/admin/settings/page.tsx");

  assert.match(settings, /checkoutMode === "store"/);
  assert.match(settings, /checkoutMode === "epay"/);
  assert.match(settings, /aria-label="购买渠道"/);
  assert.match(settings, /epayGatewayUrl/);
  assert.match(settings, /epayMerchantKeySet/);
  assert.match(settings, /异步通知地址/);
  assert.match(settings, /保存并切换渠道/);
});

test("member catalog uses store links or 易支付 without wallet checkout", async () => {
  const plans = await source("app/portal/plans/page.tsx");

  assert.match(plans, /branding\.checkoutMode === "store"/);
  assert.match(plans, /\/api\/portal\/payments\/epay/);
  assert.match(plans, /form\.submit\(\)/);
  assert.match(plans, /paymentType/);
  assert.match(plans, /"alipay"/);
  assert.match(plans, /"wxpay"/);
  assert.match(
    plans,
    /window\.open\(storeUrl, "_blank", "noopener,noreferrer"\)/,
  );
  assert.doesNotMatch(plans, /window\.location\.assign\(storeUrl\)/);
  assert.doesNotMatch(plans, /href=\{purchaseStoreUrl\}/);
  assert.doesNotMatch(plans, /\/api\/portal\/commerce\/checkout/);
  assert.doesNotMatch(plans, /钱包余额/);
});
