"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { ShaderAnimation } from "@/components/ui/shader-lines";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import {
  formatMoney,
  formatSpeedLimit,
  formatTrafficLimit,
} from "@/lib/format";
import { normalizePlanAccent, planAccentColor } from "@/lib/plan-accents";
import type { PortalOverviewResponse } from "@/lib/types";

type Offer = {
  id: string;
  name: string;
  billingPeriod: "monthly" | "quarterly" | "yearly" | "legacy";
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
};

const periodName = {
  monthly: "月付",
  quarterly: "季付",
  yearly: "年付",
  legacy: "固定期",
} as const;
const defaultBranding: Branding = {
  purchaseMode: "balance",
  buyButtonText: "购买",
  cdkButtonText: "CDK 充值",
  cdkButtonUrl: "",
};

function durationName(offer: Offer) {
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
  const [discountCode, setDiscountCode] = useState("");
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
      plans: catalog.products.filter((product) => product.kind === "plan"),
      packs: catalog.products.filter(
        (product) => product.kind === "traffic_pack",
      ),
    }),
    [catalog.products],
  );
  const checkoutStoreUrl =
    checkout?.offer.storeUrl ||
    checkout?.product.storeUrl ||
    branding.cdkButtonUrl ||
    null;

  async function fetchQuote(offer: Offer, code = "") {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setQuote(
        await apiRequest<Quote>("/api/portal/commerce/quote", {
          method: "POST",
          token,
          body: { offerId: offer.id, discountCode: code.trim() || undefined },
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
    setDiscountCode("");
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
    void fetchQuote(offer);
  }

  async function confirm() {
    if (!token || !checkout) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/portal/commerce/checkout", {
        method: "POST",
        token,
        headers: { "Idempotency-Key": idempotencyKey },
        body: {
          offerId: checkout.offer.id,
          discountCode: discountCode.trim() || undefined,
        },
      });
      setCheckout(null);
      setFeedback(
        checkout.product.kind === "plan"
          ? "套餐已立即生效。"
          : "流量包已发放，可独立接入节点。",
      );
      await load();
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
        const purchaseStoreUrl =
          offer?.storeUrl ||
          product.storeUrl ||
          (branding.purchaseMode === "cdk" ? branding.cdkButtonUrl : "") ||
          null;
        return (
          <article
            className={`plan-card premium-plan-card${isCurrent ? " current" : ""}`}
            data-plan-accent={accent}
            key={product.id}
          >
            <ShaderAnimation
              color={planAccentColor(accent)}
              className="plan-card-shader"
            />
            <div className="plan-card-head">
              <div className="plan-card-copy">
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
                  {offer ? offerPeriodName(offer) : "-"}
                </span>
              </div>
            </div>
            <div className="panel-body">
              <div className="plan-spec-grid">
                <div className="plan-spec-item">
                  <Icon name="bolt" />
                  <span>
                    上行
                    <strong>
                      {formatSpeedLimit(product.access.speedUpMbps)}
                    </strong>
                  </span>
                </div>
                <div className="plan-spec-item">
                  <Icon name="monitoring" />
                  <span>
                    下行
                    <strong>
                      {formatSpeedLimit(product.access.speedDownMbps)}
                    </strong>
                  </span>
                </div>
                <div className="plan-spec-item">
                  <Icon name="account_circle" />
                  <span>
                    设备<strong>{product.access.deviceLimit} 台</strong>
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
                {offer && purchaseStoreUrl ? (
                  <a
                    className="action-button"
                    href={purchaseStoreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Icon name="payments" />
                    {isCurrent
                      ? "购买续费 CDK"
                      : product.kind === "plan"
                        ? branding.buyButtonText
                        : "购买流量包"}
                  </a>
                ) : (
                  <button
                    className="action-button"
                    type="button"
                    disabled={!offer}
                    onClick={() => offer && openCheckout(product, offer)}
                  >
                    {isCurrent
                      ? "续费套餐"
                      : product.kind === "plan"
                        ? branding.buyButtonText
                        : "购买流量包"}
                  </button>
                )}
                <div className="plan-card-status">
                  {isCurrent ? (
                    <span className="badge success">当前套餐</span>
                  ) : product.kind === "traffic_pack" ? (
                    <span className="badge info">独立接入</span>
                  ) : null}
                </div>
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
          renderProducts(groups.plans)
        )}
        <div className="shop-section-heading">
          <div>
            <h2 className="section-title">独立流量包</h2>
            <span className="panel-copy">
              无需先购买套餐，一次性总量在有效期内按最早到期顺序使用。
            </span>
          </div>
          <span className="badge success">可独立接入</span>
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
              disabled={busy || !quote?.sufficient}
              type="button"
              onClick={() => void confirm()}
            >
              {busy
                ? "处理中..."
                : `支付 ${formatMoney(quote?.finalPriceCents ?? 0)}`}
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
                  {checkout.product.access.deviceLimit} 台
                </strong>
              </div>
            </div>
            {checkout.product.kind === "traffic_pack" ? (
              <div className="feedback info">
                该流量包提供独立节点权限，不要求已有套餐。
              </div>
            ) : null}
            <label className="field">
              <span className="fine-print">优惠码</span>
              <div className="inline-form">
                <input
                  className="control mono"
                  value={discountCode}
                  onChange={(event) => setDiscountCode(event.target.value)}
                />
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void fetchQuote(checkout.offer, discountCode)}
                >
                  应用
                </button>
              </div>
            </label>
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
                  <span>钱包余额</span>
                  <strong>{formatMoney(quote.balanceCents)}</strong>
                </div>
                <div>
                  <span>应付</span>
                  <strong>{formatMoney(quote.finalPriceCents)}</strong>
                </div>
              </div>
            ) : null}
            <div className="checkout-store-actions">
              {checkoutStoreUrl ? (
                <a
                  className="action-button checkout-store-link"
                  href={checkoutStoreUrl}
                  target={
                    checkoutStoreUrl.startsWith("http") ? "_blank" : undefined
                  }
                  rel={
                    checkoutStoreUrl.startsWith("http")
                      ? "noopener noreferrer"
                      : undefined
                  }
                >
                  <Icon name="payments" />
                  前往店铺购买
                </a>
              ) : (
                <button
                  className="action-button checkout-store-link"
                  type="button"
                  disabled
                >
                  <Icon name="payments" />
                  前往店铺购买
                </button>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </ConsoleShell>
  );
}
