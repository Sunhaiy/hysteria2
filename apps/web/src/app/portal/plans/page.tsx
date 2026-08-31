"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import {
  formatMoney,
  formatSpeedLimit,
  formatTrafficLimit,
} from "@/lib/format";
import { normalizePlanAccent } from "@/lib/plan-accents";
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
  status: string;
  name: string;
  description?: string | null;
  storeUrl?: string | null;
  accent?: string | null;
  featured: boolean;
  purchaseLimitPerUser?: number | null;
  requiresActivePlan: boolean;
  purchaseEligibility?: {
    eligible: boolean;
    used: number;
    remaining: number | null;
    reason?: string | null;
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
    method: "POST";
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

export default function PortalPlansPage() {
  const { token } = useAuth();
  const [catalog, setCatalog] = useState<Catalog>({ products: [] });
  const [branding, setBranding] = useState<Branding>(defaultBranding);
  const [currentPlanName, setCurrentPlanName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [checkout, setCheckout] = useState<{
    product: Product;
    offer: Offer;
  } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [busy, setBusy] = useState(false);
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
      setSelected((current) => {
        const next = { ...current };
        for (const product of nextCatalog.products)
          next[product.id] ||=
            product.offers.find((offer) => offer.isDefault)?.id ??
            product.offers[0]?.id ??
            "";
        return next;
      });
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
        catalog.products.filter((product) => product.kind === "traffic_pack"),
      ),
    }),
    [catalog.products],
  );
  function submitGateway(payment: EpayPayment) {
    if (!payment.gateway) {
      throw new Error("支付网关信息不可用，请重新创建订单。");
    }
    const target = new URL(payment.gateway.url);
    if (!["http:", "https:"].includes(target.protocol)) {
      throw new Error("支付网关地址无效。");
    }
    const form = document.createElement("form");
    form.method = payment.gateway.method;
    form.action = target.toString();
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
  }

  async function fetchQuote(offer: Offer) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setQuote(
        await apiRequest<Quote>("/api/portal/commerce/quote", {
          method: "POST",
          token,
          body: { offerId: offer.id },
        }),
      );
    } catch (cause) {
      setQuote(null);
      setError(cause instanceof ApiError ? cause.message : "报价失败。");
    } finally {
      setBusy(false);
    }
  }

  function openCheckout(product: Product, offer: Offer) {
    setCheckout({ product, offer });
    setQuote(null);
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
    void fetchQuote(offer);
  }

  async function confirm() {
    if (!token || !checkout) return;
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
          },
        },
      );
      if (payment.status === "settled") {
        setCheckout(null);
        setFeedback("订单已经支付并到账。");
        await load();
        return;
      }
      submitGateway(payment);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "结算失败。");
    } finally {
      setBusy(false);
    }
  }

  const renderProducts = (products: Product[]) => (
    <section className="plan-grid">
      {products.map((product) => {
        const offers = product.offers.filter(
          (offer) => offer.active && !offer.archivedAt,
        );
        const offer =
          offers.find((item) => item.id === selected[product.id]) ?? offers[0];
        const nodes = product.access.servers.flatMap((server) =>
          server.nodes.filter((node) => node.serviceable),
        );
        const accent = normalizePlanAccent(product.accent ?? "green");
        const isCurrent =
          product.kind === "plan" && product.name === currentPlanName;
        const eligible = product.purchaseEligibility?.eligible !== false;
        const unavailableReason = product.purchaseEligibility?.reason;
        const purchaseStoreUrl =
          offer?.storeUrl ||
          product.storeUrl ||
          (branding.purchaseMode === "cdk" ? branding.cdkButtonUrl : "") ||
          null;
        const useStore = branding.checkoutMode === "store";
        return (
          <article
            className={`plan-card premium-plan-card${isCurrent ? " current" : ""}${product.featured ? " featured" : ""}${eligible ? "" : " unavailable"}`}
            data-plan-accent={accent}
            key={product.id}
          >
            <div className="plan-card-head">
              <div className="plan-card-copy">
                <div className="plan-card-labels">
                  {product.featured ? (
                    <span className="badge success">推荐</span>
                  ) : null}
                  {product.purchaseLimitPerUser ? (
                    <span className="badge info">每账号仅限一次</span>
                  ) : null}
                </div>
                <h2 className="panel-title plan-card-title">
                  <span aria-hidden="true" />
                  {product.name}
                </h2>
                <span className="panel-copy">
                  {product.description ||
                    (product.kind === "plan" ? "标准会员套餐" : "独立流量权益")}
                </span>
              </div>
              <div className="plan-price-block">
                <div className="price-line">
                  {offer ? formatMoney(offer.priceCents) : "暂不可售"}
                </div>
                <span className="fine-print">
                  {offer
                    ? product.kind === "traffic_pack"
                      ? "永久有效"
                      : offerPeriodName(offer)
                    : "-"}
                </span>
              </div>
            </div>
            <div className="panel-body">
              <div className="plan-spec-grid">
                <div className="plan-spec-item">
                  <Icon name="bolt" />
                  <span>
                    {product.kind === "plan" ? "上行" : "接入"}
                    <strong>
                      {product.kind === "plan"
                        ? formatSpeedLimit(product.access.speedUpMbps)
                        : "独立可用"}
                    </strong>
                  </span>
                </div>
                <div className="plan-spec-item">
                  <Icon name="monitoring" />
                  <span>
                    {product.kind === "plan" ? "下行" : "有效期"}
                    <strong>
                      {product.kind === "plan"
                        ? formatSpeedLimit(product.access.speedDownMbps)
                        : "永久有效"}
                    </strong>
                  </span>
                </div>
                <div className="plan-spec-item">
                  <Icon name="account_circle" />
                  <span>
                    {product.kind === "plan" ? "设备" : "额度"}
                    <strong>
                      {product.kind === "plan" ? "不限" : "可叠加"}
                    </strong>
                  </span>
                </div>
              </div>
              {offers.length > 1 ? (
                <label className="field">
                  <span className="fine-print">规格</span>
                  <CustomSelect
                    value={offer?.id ?? ""}
                    onChange={(value) =>
                      setSelected((current) => ({
                        ...current,
                        [product.id]: value,
                      }))
                    }
                    options={offers.map((item) => ({
                      value: item.id,
                      label: `${item.name} · ${formatMoney(item.priceCents)}`,
                    }))}
                  />
                </label>
              ) : null}
              {offer ? (
                <div className="plan-benefit-list">
                  <div>
                    <span className="plan-benefit-icon">
                      <Icon name="globe" />
                    </span>
                    <span>可用节点</span>
                    <strong>
                      {nodes.map((node) => node.label).join(" · ") || "未绑定"}
                    </strong>
                  </div>
                  <div>
                    <span className="plan-benefit-icon">
                      <Icon name="network_node" />
                    </span>
                    <span>
                      {product.kind === "plan" ? "周期流量" : "一次性流量"}
                    </span>
                    <strong>{formatTrafficLimit(offer.trafficBytes)}</strong>
                  </div>
                </div>
              ) : null}
              <div className="plan-card-footer">
                {useStore && offer && purchaseStoreUrl && eligible ? (
                  <a
                    className="action-button"
                    href={purchaseStoreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="payments" />
                    {isCurrent ? "前往店铺续费" : branding.buyButtonText}
                  </a>
                ) : (
                  <button
                    className="action-button"
                    type="button"
                    disabled={
                      !offer ||
                      !eligible ||
                      (useStore && !purchaseStoreUrl) ||
                      (!useStore && !branding.epayConfigured)
                    }
                    onClick={() =>
                      offer && eligible && openCheckout(product, offer)
                    }
                  >
                    {!eligible
                      ? product.purchaseLimitPerUser
                        ? "已体验"
                        : "暂不可购买"
                      : useStore && !purchaseStoreUrl
                        ? "未配置店铺链接"
                        : !useStore && !branding.epayConfigured
                          ? "支付暂不可用"
                          : isCurrent
                            ? "立即续费"
                            : "立即购买"}
                  </button>
                )}
                <div className="plan-card-status">
                  {unavailableReason ? (
                    <span className="plan-unavailable-reason">
                      {unavailableReason}
                    </span>
                  ) : isCurrent ? (
                    <span className="badge success">当前套餐</span>
                  ) : product.kind === "traffic_pack" ? (
                    <span className="badge info">永久流量包</span>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );

  const renderPlanGroups = (products: Product[]) => {
    const tierNames = [
      { title: "入门", copy: "轻量体验与日常基础使用" },
      { title: "主流", copy: "覆盖大多数日常与影音需求" },
      { title: "重度", copy: "大流量与高速接入" },
    ];
    const tiers = Array.from(
      { length: Math.ceil(products.length / 2) },
      (_, index) => ({
        ...(tierNames[index] ?? {
          title: `更多 ${index - tierNames.length + 1}`,
          copy: "更多可选套餐",
        }),
        items: products.slice(index * 2, index * 2 + 2),
      }),
    );
    return (
      <div className="catalog-tier-groups">
        {tiers.map((tier) => (
          <section className="catalog-tier-group" key={tier.title}>
            <div className="catalog-tier-heading">
              <span>{tier.title}</span>
              <small>{tier.copy}</small>
            </div>
            {renderProducts(tier.items)}
          </section>
        ))}
      </div>
    );
  };

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
              月付、季付与年付均按月重置套餐额度。
            </span>
          </div>
        </div>
        {loading ? (
          <section className="plan-grid">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                className="skeleton"
                style={{ height: 310, borderRadius: "var(--radius-md)" }}
                key={index}
              />
            ))}
          </section>
        ) : (
          renderPlanGroups(groups.plans)
        )}
        <div className="shop-section-heading">
          <div>
            <h2 className="section-title">订阅流量包</h2>
            <span className="panel-copy">
              一次购买永久有效，无需先购买套餐，可独立接入所选节点。
            </span>
          </div>
          <span className="badge success">永久有效</span>
        </div>
        {!loading ? renderProducts(groups.packs) : null}
        {!loading && !catalog.products.length ? (
          <div className="empty-state">
            <div className="empty-state-title">当前没有可售商品</div>
          </div>
        ) : null}
      </div>
      <Drawer
        open={Boolean(checkout)}
        onClose={() => setCheckout(null)}
        title={checkout ? `结算：${checkout.product.name}` : "结算"}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              disabled={busy || !quote || branding.checkoutMode !== "epay"}
              type="button"
              onClick={() => void confirm()}
            >
              {busy
                ? "处理中..."
                : `前往支付 ${formatMoney(quote?.finalPriceCents ?? 0)}`}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setCheckout(null)}
            >
              取消
            </button>
          </div>
        }
      >
        {checkout ? (
          <div className="form-grid">
            {error ? <div className="feedback error">{error}</div> : null}
            <div className="checkout-facts">
              <div>
                <span>流量规则</span>
                <strong>
                  {checkout.product.kind === "plan"
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
            {checkout.product.kind === "traffic_pack" ? (
              <div className="feedback info">
                该流量包无需有效套餐，购买后即可使用商品绑定的节点，剩余流量永久有效。
              </div>
            ) : null}
            {quote ? (
              <div className="checkout-facts">
                <div>
                  <span>商品原价</span>
                  <strong>{formatMoney(quote.basePriceCents)}</strong>
                </div>
                <div>
                  <span>优惠</span>
                  <strong>-{formatMoney(quote.discountCents)}</strong>
                </div>
                <div>
                  <span>应付</span>
                  <strong>{formatMoney(quote.finalPriceCents)}</strong>
                </div>
              </div>
            ) : null}
            <div className="feedback info">
              点击后将跳转到支付页面。支付完成后，套餐或流量权益会自动到账。
            </div>
          </div>
        ) : null}
      </Drawer>
    </ConsoleShell>
  );
}
