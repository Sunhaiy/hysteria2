"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Drawer } from "@/components/drawer";
import { useAuth } from "@/components/auth-provider";
import { Toast, useToast } from "@/components/toast";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatMoney } from "@/lib/format";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
import type {
  ManualOrderRecord,
  PlanRecord,
  PortalOverviewResponse,
  PurchaseQuote,
  WalletResponse,
} from "@/lib/types";

export default function PortalPlansPage() {
  const { token } = useAuth();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [orders, setOrders] = useState<ManualOrderRecord[]>([]);
  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [balanceCents, setBalanceCents] = useState(0);
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
      showToast("购买成功，套餐已生效");
      await load();
    } catch (cause) {
      setCheckoutError(cause instanceof ApiError ? cause.message : "购买失败。");
    } finally {
      setPurchasing(false);
    }
  }

  return (
    <ConsoleShell
      title="套餐选择"
      subtitle="像商品页一样浏览套餐，提交待支付订单，后台确认后自动开通到你的会员账号"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={
        <>
          <span className="badge info">余额 {formatMoney(balanceCents)}</span>
          {overview ? (
            <span className="badge success">当前套餐：{overview.subscription.planName}</span>
          ) : pendingRenewal ? (
            <span className="badge warn">有待处理申请</span>
          ) : (
            <span className="badge info">{loading ? "加载中..." : `${plans.length} 个套餐`}</span>
          )}
        </>
      }
      toolbarActions={
        <div className="toolbar-actions">
          <Link className="toolbar-button" href="/portal/redeem">
            去兑换中心
          </Link>
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
        </div>
      }
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

          return (
            <article className="plan-card" key={plan.id}>
              <div className="plan-card-head">
                <div className="split">
                  <span className={`scope-chip ${plan.accent}`}>{plan.accent}</span>
                  <h2 className="panel-title">{plan.name}</h2>
                  <span className="panel-copy">{plan.description ?? "标准会员套餐"}</span>
                </div>
                <div className="split align-end">
                  <div className="price-line">{formatMoney(plan.priceCents)}</div>
                  <span className="fine-print">{plan.durationDays} 天 / {plan.trafficBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(plan.trafficBytes)}</span>
                </div>
              </div>

              <div className="panel-body">
                <div className="tri-grid">
                  <div className="split">
                    <span className="muted">上行</span>
                    <strong>{plan.speedUpMbps === 0 ? "不限速" : `${plan.speedUpMbps} Mbps`}</strong>
                  </div>
                  <div className="split">
                    <span className="muted">下行</span>
                    <strong>{plan.speedDownMbps === 0 ? "不限速" : `${plan.speedDownMbps} Mbps`}</strong>
                  </div>
                  <div className="split">
                    <span className="muted">设备数</span>
                    <strong>{plan.deviceLimit} 台</strong>
                  </div>
                </div>

                <div className="feature-list">
                  <div className="list-row">
                    <span className="muted">节点</span>
                    <strong>{plan.boundNodes.join(" / ") || "未绑定"}</strong>
                  </div>
                  <div className="list-row">
                    <span className="muted">周期流量</span>
                    <strong>{plan.trafficBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(plan.trafficBytes)}</strong>
                  </div>
                </div>

                <div className="toolbar-actions">
                  <button
                    className="action-button"
                    type="button"
                    onClick={() => openCheckout(plan)}
                  >
                    购买
                  </button>
                  <Link className="ghost-button" href="/portal/redeem">
                    cdk充值
                  </Link>
                  {isCurrent ? <span className="badge success">当前使用中</span> : null}
                  {!isCurrent && isPending ? <span className="badge warn">待处理</span> : null}
                </div>
              </div>
            </article>
          );
        })}
      </section>
      ) : null}

      <Toast toast={toast} />

      <Drawer
        open={Boolean(checkoutPlan)}
        onClose={() => setCheckoutPlan(null)}
        title={checkoutPlan ? `用余额购买 · ${checkoutPlan.name}` : "用余额购买"}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="button"
              disabled={purchasing || quoting || !quote || !quote.sufficient}
              onClick={() => void confirmPurchase()}
            >
              {purchasing
                ? "购买中..."
                : quote && !quote.sufficient
                  ? "余额不足"
                  : "确认购买"}
            </button>
            <button className="ghost-button" type="button" onClick={() => setCheckoutPlan(null)}>
              取消
            </button>
          </div>
        }
      >
        {checkoutError ? <div className="feedback error">{checkoutError}</div> : null}

        <div className="feedback info">
          购买后立即生效：速度 / 流量 / 到期日按新套餐从今天重算，当前套餐剩余将作废（流量包不受影响）。
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
