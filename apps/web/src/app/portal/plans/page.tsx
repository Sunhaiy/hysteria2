"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { ShaderAnimation } from "@/components/ui/shader-lines";
import { useAuth } from "@/components/auth-provider";
import { Toast, useToast } from "@/components/toast";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatMoney } from "@/lib/format";
import { normalizePlanAccent, planAccentColor } from "@/lib/plan-accents";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
import type {
  ManualOrderRecord,
  PlanRecord,
  PortalOverviewResponse,
  PortalRedeemResponse,
  PurchaseQuote,
  WalletResponse,
} from "@/lib/types";

export default function PortalPlansPage() {
  const { token } = useAuth();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [orders, setOrders] = useState<ManualOrderRecord[]>([]);
  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [balanceCents, setBalanceCents] = useState(0);
  const [branding, setBranding] = useState({
    purchaseMode: "balance" as "balance" | "cdk",
    buyButtonText: "购买",
    cdkButtonText: "cdk充值",
    cdkButtonUrl: "/portal/redeem",
  });

  // CDK-purchase mode state
  const [cdkPlan, setCdkPlan] = useState<PlanRecord | null>(null);
  const [cdkInput, setCdkInput] = useState("");
  const [cdkRedeeming, setCdkRedeeming] = useState(false);
  const [cdkError, setCdkError] = useState<string | null>(null);
  const [cdkSuccess, setCdkSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  // Self-serve checkout state
  const [checkoutPlan, setCheckoutPlan] = useState<PlanRecord | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [quote, setQuote] = useState<PurchaseQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextPlans, nextOrders] = await Promise.all([
        apiRequest<PlanRecord[]>("/api/portal/plans", { token }),
        apiRequest<ManualOrderRecord[]>("/api/portal/orders", { token }),
      ]);

      let nextOverview: PortalOverviewResponse | null = null;
      try {
        nextOverview = await apiRequest<PortalOverviewResponse>("/api/portal/subscription", {
          token,
        });
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 404) {
          throw cause;
        }
      }

      let wallet: WalletResponse | null = null;
      try {
        wallet = await apiRequest<WalletResponse>("/api/portal/wallet", { token });
      } catch {
        wallet = null;
      }

      try {
        const b = await apiRequest<typeof branding>("/api/portal/branding", { token });
        if (b) setBranding(b);
      } catch {
        // keep defaults
      }

      setPlans(nextPlans);
      setOrders(nextOrders);
      setOverview(nextOverview);
      setBalanceCents(wallet?.balanceCents ?? nextOverview?.balanceCents ?? 0);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "套餐列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const pendingRenewal = orders.find((order) => order.status === "pending" && order.kind === "renewal");

  const refreshQuote = useCallback(
    async (plan: PlanRecord, code: string) => {
      if (!token) return;
      setQuoting(true);
      setCheckoutError(null);
      try {
        const next = await apiRequest<PurchaseQuote>("/api/portal/purchase/quote", {
          method: "POST",
          token,
          body: { planId: plan.id, discountCode: code.trim() || undefined },
        });
        setQuote(next);
      } catch (cause) {
        setQuote(null);
        setCheckoutError(cause instanceof ApiError ? cause.message : "报价失败。");
      } finally {
        setQuoting(false);
      }
    },
    [token],
  );

  function openCheckout(plan: PlanRecord) {
    setCheckoutPlan(plan);
    setDiscountCode("");
    setQuote(null);
    setCheckoutError(null);
    void refreshQuote(plan, "");
  }

  async function confirmPurchase() {
    if (!token || !checkoutPlan) return;
    const renewing = overview?.subscription.planId === checkoutPlan.id;
    setPurchasing(true);
    setCheckoutError(null);
    try {
      await apiRequest<PortalOverviewResponse>("/api/portal/purchase", {
        method: "POST",
        token,
        body: {
          planId: checkoutPlan.id,
          discountCode: discountCode.trim() || undefined,
        },
      });
      setCheckoutPlan(null);
      showToast(renewing ? "续费成功，套餐周期已延长" : "购买成功，套餐已生效");
      await load();
    } catch (cause) {
      setCheckoutError(cause instanceof ApiError ? cause.message : "购买失败。");
    } finally {
      setPurchasing(false);
    }
  }

  function openCdkPurchase(plan: PlanRecord) {
    setCdkPlan(plan);
    setCdkInput("");
    setCdkError(null);
    setCdkSuccess(null);
  }

  async function redeemForPlan() {
    if (!token || !cdkInput.trim()) return;
    setCdkRedeeming(true);
    setCdkError(null);
    try {
      const result = await apiRequest<PortalRedeemResponse>("/api/portal/redeem", {
        method: "POST",
        token,
        body: { code: cdkInput.trim() },
      });
      const planName =
        result.overview?.subscription.planName ??
        result.code.planName ??
        cdkPlan?.name ??
        "套餐";
      setCdkSuccess(`🎉 恭喜！已成功开通「${planName}」`);
      await load();
    } catch (cause) {
      setCdkError(cause instanceof ApiError ? cause.message : "兑换失败，请检查 CDK。");
    } finally {
      setCdkRedeeming(false);
    }
  }

  function handleBuy(plan: PlanRecord) {
    if (branding.purchaseMode === "cdk") {
      openCdkPurchase(plan);
    } else {
      openCheckout(plan);
    }
  }

  const shopIsExternal = branding.cdkButtonUrl.startsWith("http");
  const checkoutIsRenewal = Boolean(
    checkoutPlan && overview?.subscription.planId === checkoutPlan.id,
  );
  const cdkIsRenewal = Boolean(cdkPlan && overview?.subscription.planId === cdkPlan.id);

  return (
    <ConsoleShell
      title="套餐选择"
      subtitle="像商品页一样浏览套餐，提交待支付订单，后台确认后自动开通到你的会员账号"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
    >
      {error ? <div className="feedback error">{error}</div> : null}

      {pendingRenewal ? (
        <div className="feedback warn">
          你已经提交过一笔待处理套餐订单：{pendingRenewal.planName ?? pendingRenewal.note ?? "未命名订单"}。
          后台确认到账前，暂不建议重复提交。
        </div>
      ) : null}

      {loading ? (
        <section className="plan-grid">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 260, borderRadius: "var(--radius-md)" }}
            />
          ))}
        </section>
      ) : null}

      {!loading ? (
      <section className="plan-grid">
        {plans.map((plan) => {
          const isCurrent = overview?.subscription.planId === plan.id;
          const isPending = pendingRenewal?.planId === plan.id;
          const accent = normalizePlanAccent(plan.accent);

          return (
            <article
              className={`plan-card premium-plan-card${isCurrent ? " current" : ""}${isPending ? " pending" : ""}`}
              data-plan-accent={accent}
              key={plan.id}
            >
              <ShaderAnimation color={planAccentColor(accent)} className="plan-card-shader" />
              <div className="plan-card-head">
                <div className="plan-card-copy">
                  <h2 className="panel-title plan-card-title"><span aria-hidden="true" />{plan.name}</h2>
                  <span className="panel-copy">{plan.description ?? "标准会员套餐"}</span>
                </div>
                <div className="plan-price-block">
                  <div className="price-line">{formatMoney(plan.priceCents)}</div>
                  <span className="fine-print">每 {plan.durationDays} 天</span>
                </div>
              </div>

              <div className="panel-body">
                <div className="plan-spec-grid">
                  <div className="plan-spec-item">
                    <Icon name="bolt" />
                    <span>上行<strong>{plan.speedUpMbps === 0 ? "不限速" : `${plan.speedUpMbps} Mbps`}</strong></span>
                  </div>
                  <div className="plan-spec-item">
                    <Icon name="monitoring" />
                    <span>下行<strong>{plan.speedDownMbps === 0 ? "不限速" : `${plan.speedDownMbps} Mbps`}</strong></span>
                  </div>
                  <div className="plan-spec-item">
                    <Icon name="account_circle" />
                    <span>设备<strong>{plan.deviceLimit} 台</strong></span>
                  </div>
                </div>

                <div className="plan-benefit-list">
                  <div>
                    <span className="plan-benefit-icon"><Icon name="globe" /></span>
                    <span>可用节点</span>
                    <strong>{plan.boundNodes.join(" · ") || "未绑定"}</strong>
                  </div>
                  <div>
                    <span className="plan-benefit-icon"><Icon name="network_node" /></span>
                    <span>周期流量</span>
                    <strong>{plan.trafficBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(plan.trafficBytes)}</strong>
                  </div>
                </div>

                <div className="plan-card-footer">
                  <button
                    className="action-button"
                    type="button"
                    onClick={() => handleBuy(plan)}
                  >
                    {isCurrent ? "续费套餐" : branding.buyButtonText}
                  </button>
                  <div className="plan-card-status">
                    {isCurrent ? <span className="badge success">当前套餐</span> : null}
                    {!isCurrent && isPending ? <span className="badge warn">待处理</span> : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </section>
      ) : null}

      <Toast toast={toast} />

      <Drawer
        open={Boolean(cdkPlan)}
        onClose={() => setCdkPlan(null)}
        title={cdkPlan ? `${cdkIsRenewal ? "续费" : "购买"} · ${cdkPlan.name}` : "购买"}
        footer={
          cdkSuccess ? (
            <div className="toolbar-actions">
              <button className="action-button" type="button" onClick={() => setCdkPlan(null)}>
                完成
              </button>
            </div>
          ) : (
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                disabled={cdkRedeeming || !cdkInput.trim()}
                onClick={() => void redeemForPlan()}
              >
                {cdkRedeeming ? "兑换中..." : cdkIsRenewal ? "兑换续费" : "兑换开通"}
              </button>
              <button className="ghost-button" type="button" onClick={() => setCdkPlan(null)}>
                取消
              </button>
            </div>
          )
        }
      >
        {cdkSuccess ? (
          <div className="feedback success" style={{ fontSize: 16, padding: "16px 18px" }}>
            {cdkSuccess}
          </div>
        ) : (
          <>
            {cdkError ? <div className="feedback error">{cdkError}</div> : null}

            <div className="feedback info">
              在店铺购买对应套餐的 CDK，然后把卡密粘贴到下方兑换即可立即开通。
            </div>

            {shopIsExternal ? (
              <a
                className="action-button"
                href={branding.cdkButtonUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", marginBottom: 12 }}
              >
                前往店铺购买 CDK
              </a>
            ) : (
              <Link
                className="action-button"
                href={branding.cdkButtonUrl}
                style={{ display: "inline-flex", marginBottom: 12 }}
              >
                前往店铺购买 CDK
              </Link>
            )}

            <label className="field">
              <span className="fine-print">输入 CDK 卡密</span>
              <input
                className="control mono"
                value={cdkInput}
                onChange={(event) => setCdkInput(event.target.value.toUpperCase())}
                placeholder="HY2-XXXX-XXXX-XXXX"
              />
            </label>
          </>
        )}
      </Drawer>

      <Drawer
        open={Boolean(checkoutPlan)}
        onClose={() => setCheckoutPlan(null)}
        title={
          checkoutPlan
            ? `用余额${checkoutIsRenewal ? "续费" : "购买"} · ${checkoutPlan.name}`
            : "用余额购买"
        }
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="button"
              disabled={purchasing || quoting || !quote || !quote.sufficient}
              onClick={() => void confirmPurchase()}
            >
              {purchasing
                ? checkoutIsRenewal ? "续费中..." : "购买中..."
                : quote && !quote.sufficient
                  ? "余额不足"
                  : checkoutIsRenewal ? "确认续费" : "确认购买"}
            </button>
            <button className="ghost-button" type="button" onClick={() => setCheckoutPlan(null)}>
              取消
            </button>
          </div>
        }
      >
        {checkoutError ? <div className="feedback error">{checkoutError}</div> : null}

        <div className="feedback info">
          {checkoutIsRenewal
            ? "续费会从当前到期日继续延长套餐周期，并叠加本周期流量，不会清空现有剩余。"
            : "切换套餐后立即生效：速度、流量与周期按新套餐重新计算，附加流量包不受影响。"}
        </div>

        <label className="field">
          <span className="fine-print">折扣码（可选）</span>
          <div className="toolbar-actions" style={{ gap: 8 }}>
            <input
              className="control mono"
              style={{ flex: 1 }}
              value={discountCode}
              onChange={(event) => setDiscountCode(event.target.value.toUpperCase())}
              placeholder="HY2-XXXX-XXXX-XXXX"
            />
            <button
              className="toolbar-button"
              type="button"
              disabled={quoting || !checkoutPlan}
              onClick={() => checkoutPlan && void refreshQuote(checkoutPlan, discountCode)}
            >
              {quoting ? "计算中..." : "应用"}
            </button>
          </div>
        </label>

        <div className="kpi-list">
          <div className="list-row">
            <span className="muted">套餐原价</span>
            <strong>{quote ? formatMoney(quote.basePriceCents) : "—"}</strong>
          </div>
          <div className="list-row">
            <span className="muted">折扣减免</span>
            <strong>
              {quote && quote.discountCents > 0
                ? `- ${formatMoney(quote.discountCents)}${quote.discountLabel ? `（${quote.discountLabel}）` : ""}`
                : "—"}
            </strong>
          </div>
          <div className="list-row">
            <span className="muted">应付金额</span>
            <strong>{quote ? formatMoney(quote.finalPriceCents) : "—"}</strong>
          </div>
          <div className="list-row">
            <span className="muted">当前余额</span>
            <strong>{formatMoney(quote ? quote.balanceCents : balanceCents)}</strong>
          </div>
          {quote && !quote.sufficient ? (
            <div className="list-row">
              <span className="muted">余额不足</span>
              <strong>请先到兑换中心使用余额充值码</strong>
            </div>
          ) : null}
        </div>
      </Drawer>
    </ConsoleShell>
  );
}
