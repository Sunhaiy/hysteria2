"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { CardGridSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import {
  formatMoney,
  formatSpeedLimit,
  formatTrafficLimit,
} from "@/lib/format";
import { sortCatalogProductsByPrice } from "@/lib/catalog-sort";
import type { PortalOverviewResponse } from "@/lib/types";

type Offer = {
  id: string;
  name: string;
  billingPeriod: "monthly" | "quarterly" | "yearly" | "one_time" | "legacy";
  intervalMonths: number | null;
  legacyDurationDays: number | null;
  trafficBytes: number;
  priceCents: number;
  storeUrl?: string | null;
  currency: string;
  active: boolean;
  isDefault: boolean;
  archivedAt?: string | null;
};
type Product = {
  id: string;
  kind: "plan" | "traffic_pack";
  series: "standard" | "ultra";
  quotaCadence: "monthly_reset" | "one_time";
  status: string;
  name: string;
  description?: string | null;
  storeUrl?: string | null;
  featured: boolean;
  purchaseLimitPerUser?: number | null;
  requiresActivePlan: boolean;
  purchaseEligibility?: {
    eligible: boolean;
    used: number;
    remaining: number | null;
    reason?: string | null;
    purchaseMode?: "initial" | "upgrade";
    payablePriceCents?: number;
    currentProductId?: string | null;
    currentProductName?: string | null;
    resetAnchorAt?: string | null;
  };
  trafficReset: "monthly" | "never";
  access: {
    profileName?: string | null;
    speedUpMbps: number;
    speedDownMbps: number;
    deviceLimit: number;
    servers: Array<{
      id: string;
      name: string;
      region?: string | null;
      nodes: Array<{ id: string; label: string; serviceable: boolean }>;
    }>;
  };
  offers: Offer[];
};
type Catalog = { products: Product[] };
type Quote = {
  productName: string;
  basePriceCents: number;
  discountCents: number;
  discountLabel?: string | null;
  finalPriceCents: number;
  balanceCents: number;
  sufficient: boolean;
  purchaseMode: "initial" | "upgrade";
  upgradeFromProductId?: string | null;
  upgradeFromProductName?: string | null;
  resetAnchorAt?: string | null;
};
type Branding = {
  purchaseMode: "balance" | "cdk";
  buyButtonText: string;
  cdkButtonText: string;
  cdkButtonUrl: string;
  purchaseNotice: {
    enabled: boolean;
    title: string;
    content: string;
  };
  ultraPurchaseNotice: {
    enabled: boolean;
    title: string;
    content: string;
  };
  checkoutMode: "store" | "epay";
  epayConfigured: boolean;
};
type EpayPayment = {
  id: string;
  status: "pending" | "settled" | "expired" | "failed";
  amountCents: number;
  productName: string;
  expiresAt: string;
  orderId: string | null;
  gateway?: {
    url: string;
    method: "GET" | "POST";
    fields: Record<string, string>;
  };
};

const periodName = {
  monthly: "月付",
  quarterly: "季付",
  yearly: "年付",
  one_time: "一次性",
  legacy: "固定期",
} as const;
const defaultBranding: Branding = {
  purchaseMode: "balance",
  buyButtonText: "购买",
  cdkButtonText: "CDK 充值",
  cdkButtonUrl: "",
  purchaseNotice: {
    enabled: false,
    title: "买前须知",
    content: "",
  },
  ultraPurchaseNotice: {
    enabled: true,
    title: "Ultra 购买须知",
    content:
      "一次购买，永久有效，每个账号仅可持有一个 Ultra 档位。额度按购买日每月重置，未使用部分不结转。",
  },
  checkoutMode: "store",
  epayConfigured: false,
};

function durationName(offer: Offer) {
  if (offer.billingPeriod === "one_time") return "永久有效";
  return offer.billingPeriod === "legacy"
    ? `${offer.legacyDurationDays ?? "-"} 天`
    : `${offer.intervalMonths ?? "-"} 个月`;
}

function offerPeriodName(offer: Offer) {
  return offer.billingPeriod === "legacy"
    ? `每 ${durationName(offer)}`
    : periodName[offer.billingPeriod];
}

function activeOffers(product: Product) {
  return product.offers.filter((offer) => offer.active && !offer.archivedAt);
}

function preferredOffer(product: Product) {
  const offers = activeOffers(product);
  return (
    offers.find((offer) => offer.billingPeriod === "monthly") ??
    offers.find((offer) => offer.isDefault) ??
    offers[0]
  );
}

function yearlyValue(product: Product) {
  const offers = activeOffers(product);
  const monthly = offers.find((offer) => offer.billingPeriod === "monthly");
  const yearly = offers.find((offer) => offer.billingPeriod === "yearly");
  if (!monthly || !yearly || monthly.priceCents <= 0) return null;
  const undiscounted = monthly.priceCents * 12;
  const savingsPercent = Math.round(
    ((undiscounted - yearly.priceCents) / undiscounted) * 100,
  );
  if (savingsPercent <= 0) return null;
  return {
    monthlyEquivalentCents: Math.round(yearly.priceCents / 12),
    savingsPercent,
  };
}

function marketingLabel(product: Product) {
  return product.series === "standard" && product.name === "Pro"
    ? "近期热门"
    : null;
}

function resolveStoreUrl(product: Product, offer: Offer, branding: Branding) {
  const candidate =
    offer.storeUrl ||
    product.storeUrl ||
    (branding.purchaseMode === "cdk" ? branding.cdkButtonUrl : "");
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function PortalPlansPage() {
  const { token } = useAuth();
  const [catalog, setCatalog] = useState<Catalog>({ products: [] });
  const [branding, setBranding] = useState<Branding>(defaultBranding);
  const [currentPlanName, setCurrentPlanName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkout, setCheckout] = useState<{
    product: Product;
    offer: Offer;
  } | null>(null);
  const [paymentType, setPaymentType] = useState<"alipay" | "wxpay">("alipay");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingPaymentId, setPendingPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    setLoading(true);
    try {
      const [nextCatalog, nextBranding, nextOverview] = await Promise.all([
        apiRequest<Catalog>("/api/portal/catalog", { token }),
        apiRequest<Branding>("/api/portal/branding", { token }).catch(
          () => defaultBranding,
        ),
        apiRequest<PortalOverviewResponse>("/api/portal/subscription", {
          token,
        }).catch(() => null),
      ]);
      setCatalog(nextCatalog);
      setBranding(nextBranding);
      setCurrentPlanName(nextOverview?.plan.name ?? null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "商城加载失败。");
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const groups = useMemo(
    () => ({
      plans: sortCatalogProductsByPrice(
        catalog.products.filter((product) => product.kind === "plan"),
      ),
      packs: sortCatalogProductsByPrice(
        catalog.products.filter(
          (product) =>
            product.kind === "traffic_pack" && product.series !== "ultra",
        ),
      ),
      ultra: sortCatalogProductsByPrice(
        catalog.products.filter((product) => product.series === "ultra"),
      ),
    }),
    [catalog.products],
  );
  const standardPlanTiers = useMemo(
    () => [
      {
        key: "light",
        title: "轻量入门",
        description: "从体验到日常使用，按需选择更轻松。",
        products: groups.plans.slice(0, 3),
      },
      {
        key: "balanced",
        title: "日常主力",
        description: "覆盖高频影音、多设备与长期使用。",
        products: groups.plans.slice(3, 6),
      },
      {
        key: "high-traffic",
        title: "大流量",
        description: "为重度影音和大流量工作场景预留空间。",
        products: groups.plans.slice(6),
      },
    ],
    [groups.plans],
  );
  function submitGateway(
    payment: EpayPayment,
    targetName: string,
    paymentWindow: Window,
  ) {
    if (!payment.gateway) {
      throw new Error("支付网关信息不可用，请重新创建订单。");
    }
    const target = new URL(payment.gateway.url);
    if (!["http:", "https:"].includes(target.protocol)) {
      throw new Error("支付网关地址无效。");
    }
    if (payment.gateway.method === "GET") {
      for (const [name, value] of Object.entries(payment.gateway.fields)) {
        target.searchParams.set(name, value);
      }
      paymentWindow.location.replace(target.toString());
      return;
    }
    const form = document.createElement("form");
    form.method = payment.gateway.method;
    form.action = target.toString();
    form.target = targetName;
    form.style.display = "none";
    for (const [name, value] of Object.entries(payment.gateway.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    window.setTimeout(() => form.remove(), 0);
  }

  useEffect(() => {
    if (!token || !pendingPaymentId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const payment = await apiRequest<EpayPayment>(
          `/api/portal/payments/epay/${pendingPaymentId}`,
          { token },
        );
        if (stopped) return;
        if (payment.status === "settled") {
          setPendingPaymentId(null);
          setCheckout(null);
          setQuote(null);
          setFeedback("支付已确认，套餐或流量权益已经到账。");
          await load();
          return;
        }
        if (payment.status === "expired" || payment.status === "failed") {
          setPendingPaymentId(null);
          setError("支付未完成或订单已过期，请重新发起购买。");
          return;
        }
      } catch {
        // A transient polling failure must not interrupt the gateway checkout.
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 2_000);
    };
    timer = window.setTimeout(() => void poll(), 2_000);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [load, pendingPaymentId, token]);

  async function fetchQuote(offer: Offer) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const nextQuote = await apiRequest<Quote>("/api/portal/commerce/quote", {
        method: "POST",
        token,
        body: { offerId: offer.id },
      });
      setQuote(nextQuote);
    } catch (cause) {
      setQuote(null);
      setError(cause instanceof ApiError ? cause.message : "报价失败。");
    } finally {
      setBusy(false);
    }
  }

  function openCheckout(product: Product) {
    const preferred = preferredOffer(product);
    const offer =
      branding.checkoutMode === "store" &&
      preferred &&
      !resolveStoreUrl(product, preferred, branding)
        ? (activeOffers(product).find((item) =>
            Boolean(resolveStoreUrl(product, item, branding)),
          ) ?? preferred)
        : preferred;
    if (!offer) return;
    setCheckout({ product, offer });
    setQuote(null);
    setError(null);
    setPaymentType("alipay");
    setIdempotencyKey(crypto.randomUUID());
    if (branding.checkoutMode === "epay") void fetchQuote(offer);
  }

  function selectCheckoutOffer(offer: Offer) {
    if (!checkout || checkout.offer.id === offer.id) return;
    setCheckout({ product: checkout.product, offer });
    setQuote(null);
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
    if (branding.checkoutMode === "epay") void fetchQuote(offer);
  }

  function closeCheckout() {
    setBusy(false);
    setCheckout(null);
    setQuote(null);
    setError(null);
  }

  async function confirm() {
    if (!checkout) return;
    if (branding.checkoutMode === "store") {
      const storeUrl = resolveStoreUrl(
        checkout.product,
        checkout.offer,
        branding,
      );
      if (!storeUrl) {
        setError("该规格尚未配置有效的店铺链接。");
        return;
      }
      window.open(storeUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!token) return;
    const targetName = `epay-${idempotencyKey.replace(/[^A-Za-z0-9_-]/g, "")}`;
    const paymentWindow = window.open("about:blank", targetName);
    if (!paymentWindow) {
      setError("浏览器阻止了支付窗口，请允许本站打开新窗口后重试。");
      return;
    }
    paymentWindow.opener = null;
    paymentWindow.document.title = "正在前往支付";
    paymentWindow.document.body.textContent = "正在创建支付订单...";
    setBusy(true);
    setError(null);
    try {
      const payment = await apiRequest<EpayPayment>(
        "/api/portal/payments/epay",
        {
          method: "POST",
          token,
          headers: { "Idempotency-Key": idempotencyKey },
          body: {
            offerId: checkout.offer.id,
            paymentType,
          },
        },
      );
      if (payment.status === "settled") {
        paymentWindow.close();
        setCheckout(null);
        setFeedback("订单已经支付并到账。");
        await load();
        return;
      }
      setPendingPaymentId(payment.id);
      submitGateway(payment, targetName, paymentWindow);
    } catch (cause) {
      paymentWindow.close();
      setPendingPaymentId(null);
      setError(cause instanceof ApiError ? cause.message : "结算失败。");
    } finally {
      setBusy(false);
    }
  }

  const renderProducts = (products: Product[]) => (
    <section className="plan-grid catalog-product-grid">
      {products.map((product) => {
        const offer = preferredOffer(product);
        const annualValue = yearlyValue(product);
        const productMarketingLabel = marketingLabel(product);
        const nodes = product.access.servers.flatMap((server) =>
          server.nodes.filter((node) => node.serviceable),
        );
        const isCurrent =
          product.kind === "plan" && product.name === currentPlanName;
        const isUltra = product.series === "ultra";
        const isUltraCurrent =
          isUltra &&
          product.purchaseEligibility?.currentProductId === product.id;
        const isUpgrade =
          isUltra &&
          product.purchaseEligibility?.purchaseMode === "upgrade";
        const eligible = product.purchaseEligibility?.eligible !== false;
        const unavailableReason = product.purchaseEligibility?.reason;
        const useStore = branding.checkoutMode === "store";
        const checkoutEligible = eligible && !(isUpgrade && useStore);
        return (
          <article
            className={`plan-card premium-plan-card${isUltra ? " ultra-plan-card" : ""}${isCurrent || isUltraCurrent ? " current" : ""}${product.featured ? " featured" : ""}${eligible ? "" : " unavailable"}`}
            key={product.id}
          >
            <div className="plan-card-head">
              <div className="plan-card-copy">
                <div className="plan-card-title-row">
                  <h2 className="panel-title plan-card-title">
                    <span aria-hidden="true" />
                    {product.name}
                  </h2>
                  {isCurrent ||
                  isUltraCurrent ||
                  isUpgrade ||
                  product.featured ||
                  productMarketingLabel ||
                  product.purchaseLimitPerUser ? (
                    <div className="plan-card-labels">
                      {isCurrent ? (
                        <span className="badge success">当前套餐</span>
                      ) : null}
                      {isUltraCurrent ? (
                        <span className="badge success">当前档位</span>
                      ) : null}
                      {isUpgrade ? (
                        <span className="badge info">可补差价升级</span>
                      ) : null}
                      {product.featured ? (
                        <span className="badge success">推荐</span>
                      ) : null}
                      {productMarketingLabel ? (
                        <span className="badge info">
                          {productMarketingLabel}
                        </span>
                      ) : null}
                      {product.purchaseLimitPerUser ? (
                        <span className="badge info">每账号仅限一次</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <span className="panel-copy">
                  {product.description ||
                    (product.kind === "plan" ? "标准会员套餐" : "独立流量权益")}
                </span>
              </div>
            </div>
            <div className="panel-body">
              <div className="plan-price-block">
                <div className="price-line">
                  {offer ? formatMoney(offer.priceCents) : "暂不可售"}
                  {offer ? (
                    <span>
                      {isUltra
                        ? " / 永久"
                        : product.kind === "traffic_pack"
                          ? "/ 份"
                          : "起"}
                    </span>
                  ) : null}
                </div>
                <span className="plan-price-caption">
                  {offer
                    ? product.kind === "plan" || isUltra
                      ? `每月 ${formatTrafficLimit(offer.trafficBytes)}`
                      : `${formatTrafficLimit(offer.trafficBytes)} 一次性流量`
                    : "当前规格暂不可售"}
                </span>
                {annualValue ? (
                  <span className="plan-price-saving">
                    年付月均 {formatMoney(annualValue.monthlyEquivalentCents)} ·
                    省 {annualValue.savingsPercent}%
                  </span>
                ) : null}
              </div>
              {offer ? (
                <div className="plan-benefit-list">
                  <div>
                    <Icon name="network_node" />
                    <span>
                      {product.kind === "plan" || isUltra
                        ? "每月可用"
                        : "购买即得"}{" "}
                      <strong>{formatTrafficLimit(offer.trafficBytes)}</strong>
                      {isUltra
                        ? "，购买日重置"
                        : product.kind === "traffic_pack"
                          ? "，永久有效"
                          : " 流量"}
                    </span>
                  </div>
                  <div>
                    <Icon name="bolt" />
                    <span>
                      {product.kind === "plan" || isUltra
                        ? `上行 ${formatSpeedLimit(product.access.speedUpMbps)} · 下行 ${formatSpeedLimit(product.access.speedDownMbps)}`
                        : "无需现有套餐，可直接使用并叠加额度"}
                    </span>
                  </div>
                  <div>
                    <Icon name="globe" />
                    <span
                      title={
                        nodes.map((node) => node.label).join(" · ") || "未绑定"
                      }
                    >
                      {nodes.length > 0
                        ? `${nodes.length} 个可用节点 · ${nodes.map((node) => node.label).join(" · ")}`
                        : "暂未绑定可用节点"}
                    </span>
                  </div>
                </div>
              ) : null}
              {unavailableReason ? (
                <span className="plan-unavailable-reason">
                  {unavailableReason}
                </span>
              ) : null}
              <div className="plan-card-footer">
                <button
                  className="action-button"
                  type="button"
                  disabled={
                    !offer ||
                    !checkoutEligible ||
                    (!useStore && !branding.epayConfigured)
                  }
                  onClick={() => checkoutEligible && openCheckout(product)}
                >
                  {!checkoutEligible
                    ? isUltraCurrent
                      ? "当前档位"
                      : isUpgrade && useStore
                        ? "升级需站内支付"
                      : product.purchaseLimitPerUser
                      ? "已体验"
                      : "暂不可购买"
                    : !useStore && !branding.epayConfigured
                      ? "支付暂不可用"
                      : isUpgrade
                        ? `补差价 ${formatMoney(product.purchaseEligibility?.payablePriceCents ?? 0)} 升级`
                        : isCurrent
                        ? "立即续费"
                        : "立即购买"}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );

  return (
    <ConsoleShell
      title="套餐与流量包"
      subtitle="统一权益商城"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
    >
      {error && !checkout ? (
        <div className="feedback error">{error}</div>
      ) : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      <div className="page-stack">
        {branding.purchaseNotice.enabled &&
        branding.purchaseNotice.content.trim() ? (
          <section className="purchase-notice" aria-label="买前须知">
            <span className="purchase-notice-icon" aria-hidden="true">
              <Icon name="warning" />
            </span>
            <div>
              <strong>{branding.purchaseNotice.title}</strong>
              <p>{branding.purchaseNotice.content}</p>
            </div>
          </section>
        ) : null}
        <div className="shop-section-heading">
          <div>
            <h2 className="section-title">会员套餐</h2>
            <span className="panel-copy">
              9 档流量覆盖不同需求，月付、季付与年付均按月重置额度。
            </span>
          </div>
        </div>
        <div className="catalog-assurances" aria-label="套餐购买保障">
          <span>
            <Icon name="check" /> 季付 95 折
          </span>
          <span>
            <Icon name="check" /> 年付 9 折
          </span>
          <span>
            <Icon name="check" /> 已购权益按原订单履约
          </span>
        </div>
        {loading ? (
          <CardGridSkeleton />
        ) : (
          <div className="catalog-standard-tiers">
            {standardPlanTiers.map((tier) =>
              tier.products.length ? (
                <section className="catalog-plan-tier" key={tier.key}>
                  <div className="catalog-tier-heading">
                    <strong>{tier.title}</strong>
                    <span>{tier.description}</span>
                  </div>
                  {renderProducts(tier.products)}
                </section>
              ) : null,
            )}
          </div>
        )}
        <div className="shop-section-heading">
          <div>
            <h2 className="section-title">订阅流量包</h2>
            <span className="panel-copy">
              一次购买永久有效，无需先购买套餐，可独立接入所选节点。
            </span>
          </div>
        </div>
        {loading ? <CardGridSkeleton compact /> : renderProducts(groups.packs)}
        {loading || groups.ultra.length ? (
          <section className="ultra-shop-section" aria-labelledby="ultra-title">
            {branding.ultraPurchaseNotice.enabled &&
            branding.ultraPurchaseNotice.content.trim() ? (
              <section className="purchase-notice ultra-purchase-notice">
                <span className="purchase-notice-icon" aria-hidden="true">
                  <Icon name="bolt" />
                </span>
                <div>
                  <strong>{branding.ultraPurchaseNotice.title}</strong>
                  <p>{branding.ultraPurchaseNotice.content}</p>
                </div>
              </section>
            ) : null}
            <div className="shop-section-heading">
              <div>
                <h2 className="section-title" id="ultra-title">
                  普通线路 Ultra
                </h2>
                <span className="panel-copy">
                  一次购买永久有效，三档共享同一组专属节点。
                </span>
              </div>
            </div>
            {loading ? (
              <CardGridSkeleton compact />
            ) : (
              renderProducts(groups.ultra)
            )}
          </section>
        ) : null}
        {!loading && !catalog.products.length ? (
          <div className="empty-state">
            <div className="empty-state-title">当前没有可售商品</div>
          </div>
        ) : null}
      </div>
      <Drawer
        open={Boolean(checkout)}
        onClose={closeCheckout}
        title={checkout ? `购买 ${checkout.product.name}` : "购买商品"}
        subtitle="确认规格与商品信息后继续"
        footer={
          <div className="toolbar-actions checkout-footer-actions">
            <button
              className="action-button"
              disabled={
                busy ||
                !checkout ||
                (branding.checkoutMode === "epay" && !quote) ||
                (branding.checkoutMode === "store" &&
                  checkout &&
                  !resolveStoreUrl(checkout.product, checkout.offer, branding))
              }
              type="button"
              onClick={() => void confirm()}
            >
              {busy
                ? "处理中..."
                : branding.checkoutMode === "store"
                  ? `去购买 · ${formatMoney(checkout?.offer.priceCents ?? 0)}`
                  : `前往支付 · ${formatMoney(quote?.finalPriceCents ?? checkout?.offer.priceCents ?? 0)}`}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={closeCheckout}
            >
              取消
            </button>
          </div>
        }
      >
        {checkout ? (
          <div className="checkout-dialog-content">
            {error ? <div className="feedback error">{error}</div> : null}
            <section className="checkout-product-summary">
              <span>
                {checkout.product.series === "ultra"
                  ? "永久 Ultra 套餐"
                  : checkout.product.kind === "plan"
                    ? "会员套餐"
                    : "流量包"}
              </span>
              <strong>{checkout.product.name}</strong>
              <p>
                {checkout.product.description ||
                  (checkout.product.kind === "plan"
                    ? "按月重置流量额度，可使用商品绑定的全部可用节点。"
                    : checkout.product.series === "ultra"
                      ? "一次购买永久有效，每月按原购买日重置专属节点额度。"
                      : "一次购买永久有效，可直接使用商品绑定的节点。")}
              </p>
            </section>
            <section className="checkout-option-section">
              <div className="checkout-section-heading">
                <strong>
                  {checkout.product.kind === "plan"
                    ? "选择购买周期"
                    : "购买规格"}
                </strong>
                <span>选择后价格与权益立即更新</span>
              </div>
              <div className="checkout-offer-options" role="radiogroup">
                {activeOffers(checkout.product).map((offer) => {
                  const selected = checkout.offer.id === offer.id;
                  const available =
                    branding.checkoutMode === "epay" ||
                    Boolean(resolveStoreUrl(checkout.product, offer, branding));
                  return (
                    <button
                      className={`checkout-offer-option${selected ? " selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy || !available}
                      onClick={() => selectCheckoutOffer(offer)}
                      key={offer.id}
                    >
                      <span>
                        {checkout.product.kind === "traffic_pack"
                          ? "永久有效"
                          : offerPeriodName(offer)}
                        {!available ? " · 未配置" : ""}
                      </span>
                      <strong>{formatMoney(offer.priceCents)}</strong>
                    </button>
                  );
                })}
              </div>
            </section>
            {branding.checkoutMode === "epay" ? (
              <section className="checkout-option-section">
                <div className="checkout-section-heading">
                  <strong>选择支付方式</strong>
                  <span>将在新页面完成安全支付</span>
                </div>
                <div className="checkout-payment-options" role="radiogroup">
                  <button
                    className={paymentType === "alipay" ? "selected" : ""}
                    type="button"
                    role="radio"
                    aria-checked={paymentType === "alipay"}
                    onClick={() => setPaymentType("alipay")}
                  >
                    <Icon name="payments" />
                    <span>支付宝</span>
                  </button>
                  <button
                    className={paymentType === "wxpay" ? "selected" : ""}
                    type="button"
                    role="radio"
                    aria-checked={paymentType === "wxpay"}
                    onClick={() => setPaymentType("wxpay")}
                  >
                    <Icon name="payments" />
                    <span>微信支付</span>
                  </button>
                </div>
              </section>
            ) : null}
            {branding.checkoutMode === "store" &&
            !resolveStoreUrl(checkout.product, checkout.offer, branding) ? (
              <div className="feedback warn">
                该周期尚未配置店铺链接，请选择其他可购买周期或联系管理员。
              </div>
            ) : null}
            <div className="checkout-facts">
              <div>
                <span>流量规则</span>
                <strong>
                  {checkout.product.kind === "plan" ||
                  checkout.product.series === "ultra"
                    ? `每月重置 ${formatTrafficLimit(checkout.offer.trafficBytes)}`
                    : `一次性总量 ${formatTrafficLimit(checkout.offer.trafficBytes)}`}
                </strong>
              </div>
              <div>
                <span>有效期</span>
                <strong>{durationName(checkout.offer)}</strong>
              </div>
              <div>
                <span>服务器范围</span>
                <strong>
                  {checkout.product.access.servers
                    .map((server) => server.name)
                    .join(" · ")}
                </strong>
              </div>
              <div>
                <span>速率 / 设备</span>
                <strong>
                  {formatSpeedLimit(checkout.product.access.speedDownMbps)} ·{" "}
                  不限设备
                </strong>
              </div>
            </div>
            {checkout.product.series === "ultra" ? (
              <div className="feedback info">
                Ultra 只在专属节点扣除此额度，与现有普通套餐和流量包分开计费。
              </div>
            ) : checkout.product.kind === "traffic_pack" ? (
              <div className="feedback info">
                该流量包无需有效套餐，购买后即可使用商品绑定的节点，剩余流量永久有效。
              </div>
            ) : null}
            {branding.checkoutMode === "epay" && quote ? (
              <div className="checkout-facts">
                <div>
                  <span>商品原价</span>
                  <strong>{formatMoney(quote.basePriceCents)}</strong>
                </div>
                <div>
                  <span>
                    {quote.purchaseMode === "upgrade" ? "当前档位" : "优惠"}
                  </span>
                  <strong>
                    {quote.purchaseMode === "upgrade"
                      ? quote.upgradeFromProductName ?? "已有 Ultra"
                      : `-${formatMoney(quote.discountCents)}`}
                  </strong>
                </div>
                <div>
                  <span>应付</span>
                  <strong>{formatMoney(quote.finalPriceCents)}</strong>
                </div>
              </div>
            ) : null}
            <div className="feedback info">
              {branding.checkoutMode === "epay"
                ? "支付完成后订单会自动确认，套餐或流量权益正常到账。"
                : "点击去购买后将进入所选规格对应的店铺页面。"}
            </div>
          </div>
        ) : null}
      </Drawer>
    </ConsoleShell>
  );
}
