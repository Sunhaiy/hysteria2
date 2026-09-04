import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("admin payment settings enforce one checkout channel at a time", async () => {
  const settings = await source("app/admin/settings/page.tsx");

  assert.match(settings, /paymentView === "store"/);
  assert.match(settings, /paymentView === "epay"/);
  assert.match(settings, /checkoutMode === "epay" \? "易支付" : "店铺链接"/);
  assert.match(settings, /aria-label="购买渠道"/);
  assert.match(settings, /epayGatewayUrl/);
  assert.match(settings, /epayMerchantKeySet/);
  assert.match(settings, /异步通知地址/);
  assert.match(settings, /\/api\/admin\/payments\/epay\/tests/);
  assert.match(settings, /双渠道测试/);
  assert.match(settings, /aria-label="易支付测试渠道"/);
  assert.match(settings, /选择支付宝测试/);
  assert.match(settings, /选择微信支付测试/);
  assert.doesNotMatch(
    settings,
    /<CustomSelect[\s\S]*?value=\{epayPaymentType\}/,
  );
  assert.match(settings, /支付宝和微信均通过/);
  assert.match(settings, /测试.*¥0\.01/);
  assert.match(settings, /仅保存配置/);
  assert.match(settings, /启用易支付/);
  assert.match(settings, /不创建订单、不计收入、不发放套餐或流量/);
  assert.match(settings, /test\.gateway\.method === "GET"/);
  assert.match(settings, /window\.open\("about:blank", targetName\)/);
  assert.match(settings, /form\.target = targetName/);
  assert.match(
    settings,
    /paymentWindow\.location\.replace\(target\.toString\(\)\)/,
  );
  assert.match(
    settings,
    /async function startEpayTest[\s\S]*?finally \{[\s\S]*?setTestingEpay\(false\)/,
  );
  assert.match(settings, /AbortSignal\.timeout\(20_000\)/);
  assert.doesNotMatch(
    settings,
    /window\.location\.assign\(target\.toString\(\)\)/,
  );
});

test("toast actions remain stable when used by data-loading effects", async () => {
  const toastHook = await source("components/toast.tsx");

  assert.match(toastHook, /useCallback/);
  assert.match(
    toastHook,
    /const showToast = useCallback\([\s\S]*?setToast\(\{ msg, kind \}\);[\s\S]*?\[\],[\s\S]*?\);/,
  );
});

test("member catalog uses store links or 易支付 without wallet checkout", async () => {
  const plans = await source("app/portal/plans/page.tsx");

  assert.match(plans, /branding\.checkoutMode === "store"/);
  assert.match(plans, /\/api\/portal\/payments\/epay/);
  assert.match(plans, /form\.submit\(\)/);
  assert.match(plans, /form\.target = targetName/);
  assert.match(plans, /window\.open\("about:blank", targetName\)/);
  assert.match(plans, /payment\.gateway\.method === "GET"/);
  assert.match(
    plans,
    /paymentWindow\.location\.replace\(target\.toString\(\)\)/,
  );
  assert.match(plans, /pendingPaymentId/);
  assert.match(plans, /paymentType/);
  assert.match(plans, /"alipay"/);
  assert.match(plans, /"wxpay"/);
  assert.match(
    plans,
    /catch \(cause\) \{[\s\S]*?paymentWindow\.close\(\)[\s\S]*?支付通道暂时无法打开，请稍后重试。/,
  );
  assert.match(
    plans,
    /window\.open\(storeUrl, "_blank", "noopener,noreferrer"\)/,
  );
  assert.doesNotMatch(plans, /window\.location\.assign\(storeUrl\)/);
  assert.doesNotMatch(plans, /href=\{purchaseStoreUrl\}/);
  assert.doesNotMatch(plans, /\/api\/portal\/commerce\/checkout/);
  assert.doesNotMatch(plans, /钱包余额/);
});

test("admin order center unifies revenue, order filters, and payment exceptions", async () => {
  const orders = await source("app/admin/orders/page.tsx");
  const navigation = await source("lib/copy.ts");

  assert.match(navigation, /href: "\/admin\/orders"/);
  assert.match(navigation, /label: "订单中心"/);
  assert.match(orders, /今日实际收入/);
  assert.match(orders, /本月实际收入/);
  assert.match(orders, /\/api\/admin\/orders\/summary/);
  assert.match(orders, /\/api\/admin\/orders\/payment-attempts/);
  assert.match(orders, /订单号、交易号、邮箱或用户名/);
  assert.match(orders, /支付异常/);
  assert.match(orders, /paymentType/);
  assert.match(orders, /productKind/);
});
