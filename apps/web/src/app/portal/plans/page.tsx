"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatMoney } from "@/lib/format";
import type { ManualOrderRecord, PlanRecord, PortalOverviewResponse } from "@/lib/types";

export default function PortalPlansPage() {
  const { token } = useAuth();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [orders, setOrders] = useState<ManualOrderRecord[]>([]);
  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingPlanId, setSubmittingPlanId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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

      setPlans(nextPlans);
      setOrders(nextOrders);
      setOverview(nextOverview);
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

  async function requestPlan(plan: PlanRecord) {
    if (!token) {
      return;
    }

    setSubmittingPlanId(plan.id);
    setError(null);
    setFeedback(null);
    try {
      await apiRequest<ManualOrderRecord>("/api/portal/orders/request", {
        method: "POST",
        token,
        body: {
          planId: plan.id,
          note: note || undefined,
        },
      });
      setFeedback(`已提交 ${plan.name} 的开通申请，等待后台确认到账。`);
      setNote("");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "套餐申请提交失败。");
    } finally {
      setSubmittingPlanId(null);
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
        overview ? (
          <span className="badge success">当前套餐：{overview.subscription.planName}</span>
        ) : pendingRenewal ? (
          <span className="badge warn">有待处理申请</span>
        ) : (
          <span className="badge info">{loading ? "加载中..." : `${plans.length} 个套餐`}</span>
        )
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
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      {pendingRenewal ? (
        <div className="feedback warn">
          你已经提交过一笔待处理套餐订单：{pendingRenewal.planName ?? pendingRenewal.note ?? "未命名订单"}。
          后台确认到账前，暂不建议重复提交。
        </div>
      ) : null}

      <Panel
        title="下单说明"
        copy="这里提交的是待支付订单，不会立刻生效。管理员确认到账后，套餐、带宽、节点组和专属接入信息会同步更新。"
      >
        <div className="form-grid">
          <label className="field">
            <span className="fine-print">订单备注</span>
            <textarea
              className="control textarea"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="可填写付款渠道、备注名或希望客服看到的信息"
            />
          </label>
          <div className="toolbar-actions">
            <Link className="ghost-button" href="/portal/orders">
              查看订单记录
            </Link>
            <Link className="ghost-button" href="/portal/access">
              查看接入信息
            </Link>
          </div>
        </div>
      </Panel>

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
                  <span className="fine-print">{plan.durationDays} 天 / {formatBytes(plan.trafficBytes)}</span>
                </div>
              </div>

              <div className="panel-body">
                <div className="tri-grid">
                  <div className="split">
                    <span className="muted">上行</span>
                    <strong>{plan.speedUpMbps} Mbps</strong>
                  </div>
                  <div className="split">
                    <span className="muted">下行</span>
                    <strong>{plan.speedDownMbps} Mbps</strong>
                  </div>
                  <div className="split">
                    <span className="muted">设备数</span>
                    <strong>{plan.deviceLimit} 台</strong>
                  </div>
                </div>

                <div className="feature-list">
                  <div className="list-row">
                    <span className="muted">节点组</span>
                    <strong>{plan.boundNodeGroups.join(" / ") || "未绑定"}</strong>
                  </div>
                  <div className="list-row">
                    <span className="muted">周期流量</span>
                    <strong>{formatBytes(plan.trafficBytes)}</strong>
                  </div>
                  <div className="list-row">
                    <span className="muted">交付方式</span>
                    <strong>到账后自动生成专属链接</strong>
                  </div>
                </div>

                <div className="toolbar-actions">
                  <button
                    className="action-button"
                    type="button"
                    disabled={Boolean(pendingRenewal) || submittingPlanId === plan.id}
                    onClick={() => void requestPlan(plan)}
                  >
                    {submittingPlanId === plan.id
                      ? "提交中..."
                      : isPending
                        ? "等待确认"
                        : isCurrent
                          ? "继续续期这个套餐"
                          : "提交开通申请"}
                  </button>
                  {isCurrent ? <span className="badge success">当前使用中</span> : null}
                  {!isCurrent && isPending ? <span className="badge warn">待处理</span> : null}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </ConsoleShell>
  );
}
