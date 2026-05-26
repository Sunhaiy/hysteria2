"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { AdminUser, ManualOrderRecord, PlanRecord } from "@/lib/types";
import { humanizeOrderKind, statusTone } from "@/lib/ui";

const emptyForm = {
  userId: "",
  kind: "renewal" as "renewal" | "traffic_pack" | "manual_credit",
  status: "pending" as "pending" | "applied",
  planId: "",
  amountCents: 1800,
  durationDays: 30,
  trafficBytes: 0,
  note: "",
};

function renderRights(order: ManualOrderRecord) {
  if (order.planName) {
    return (
      <div className="split">
        <strong>{order.planName}</strong>
        <span className="muted">
          {order.durationDays ? `${order.durationDays} 天` : "套餐权益"}
        </span>
      </div>
    );
  }

  if (order.trafficBytes) {
    return formatBytes(order.trafficBytes);
  }

  if (order.durationDays) {
    return `${order.durationDays} 天`;
  }

  return "-";
}

export default function AdminOrdersPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<ManualOrderRecord[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actingOrderId, setActingOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const pendingCount = orders.filter((order) => order.status === "pending").length;
  const selectedPlan = plans.find((plan) => plan.id === form.planId) ?? null;

  const load = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextOrders, nextUsers, nextPlans] = await Promise.all([
        apiRequest<ManualOrderRecord[]>("/api/admin/orders", { token }),
        apiRequest<AdminUser[]>("/api/admin/users", { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
      ]);
      setOrders(nextOrders);
      setUsers(nextUsers.filter((user) => user.role === "member"));
      setPlans(nextPlans.filter((plan) => plan.active));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "订单数据加载失败。");
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setFeedback(null);

    try {
      await apiRequest("/api/admin/orders/manual-credit", {
        method: "POST",
        token,
        body: {
          userId: form.userId,
          kind: form.kind,
          status: form.status,
          planId: form.kind === "renewal" ? form.planId || undefined : undefined,
          amountCents: form.amountCents,
          durationDays:
            form.kind === "renewal" || form.kind === "manual_credit"
              ? form.durationDays || undefined
              : undefined,
          trafficBytes:
            form.kind === "traffic_pack" || form.kind === "manual_credit"
              ? form.trafficBytes || undefined
              : undefined,
          note: form.note || undefined,
        },
      });
      setFeedback(
        form.status === "pending"
          ? "待支付订单已创建，等待后台确认到账。"
          : "订单已立即入账并同步到会员权益。",
      );
      setForm(emptyForm);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "订单创建失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOrderAction(orderId: string, status: "applied" | "void") {
    if (!token) {
      return;
    }

    setActingOrderId(orderId);
    setError(null);
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/orders/${orderId}`, {
        method: "PATCH",
        token,
        body: { status },
      });
      setFeedback(status === "applied" ? "订单已确认到账并生效。" : "订单已作废。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "订单处理失败。");
    } finally {
      setActingOrderId(null);
    }
  }

  return (
    <ConsoleShell
      title="人工订单"
      subtitle="创建待支付订单、确认到账和补录人工权益，统一落到会员套餐与流量账本"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <>
          <span className="badge info">{loading ? "加载中..." : `${orders.length} 笔订单`}</span>
          <span className="badge warn">{pendingCount} 笔待处理</span>
        </>
      }
      toolbarActions={
        <button className="toolbar-button" type="button" onClick={() => void load()}>
          刷新
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      <section className="workspace-grid">
        <Panel
          title="订单工作台"
          copy="待支付订单会停留在 pending，确认到账后再应用到订阅；已经 applied 的订单则表示权益已经入账。"
        >
          <DataTable
            headers={["用户", "套餐 / 权益", "类型", "状态", "金额", "处理时间", "操作"]}
            rows={orders.map((order) => [
              <div key={order.id} className="split">
                <strong>{order.userDisplayName}</strong>
                <span className="muted">{order.userEmail}</span>
              </div>,
              renderRights(order),
              humanizeOrderKind(order.kind),
              <span key={`${order.id}-status`} className={`badge ${statusTone(order.status)}`}>
                {order.status}
              </span>,
              formatMoney(order.amountCents),
              order.processedAt ? formatDateTime(order.processedAt) : formatDateTime(order.createdAt),
              order.status === "pending" ? (
                <div className="table-actions" key={`${order.id}-actions`}>
                  <button
                    className="action-button compact"
                    type="button"
                    disabled={actingOrderId === order.id}
                    onClick={() => void handleOrderAction(order.id, "applied")}
                  >
                    确认到账
                  </button>
                  <button
                    className="ghost-button compact"
                    type="button"
                    disabled={actingOrderId === order.id}
                    onClick={() => void handleOrderAction(order.id, "void")}
                  >
                    作废
                  </button>
                </div>
              ) : (
                <span className="fine-print">{order.note ?? "已处理"}</span>
              ),
            ])}
          />
        </Panel>

        <Panel
          title="创建订单"
          copy="可创建待支付的套餐订单，也可以直接补录已到账的续期、流量包或人工入账。"
        >
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span className="fine-print">会员</span>
              <select
                className="control"
                value={form.userId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, userId: event.target.value }))
                }
              >
                <option value="">请选择会员</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} / {user.email}
                  </option>
                ))}
              </select>
            </label>

            <div className="two-col">
              <label className="field">
                <span className="fine-print">订单类型</span>
                <select
                  className="control"
                  value={form.kind}
                  onChange={(event) => {
                    const nextKind = event.target.value as typeof form.kind;
                    setForm((current) => ({
                      ...current,
                      kind: nextKind,
                      planId: nextKind === "renewal" ? current.planId : "",
                    }));
                  }}
                >
                  <option value="renewal">套餐 / 续期</option>
                  <option value="traffic_pack">流量包</option>
                  <option value="manual_credit">人工入账</option>
                </select>
              </label>

              <label className="field">
                <span className="fine-print">创建方式</span>
                <select
                  className="control"
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as typeof current.status,
                    }))
                  }
                >
                  <option value="pending">待支付订单</option>
                  <option value="applied">立即入账</option>
                </select>
              </label>
            </div>

            {form.kind === "renewal" ? (
              <label className="field">
                <span className="fine-print">套餐</span>
                <select
                  className="control"
                  value={form.planId}
                  onChange={(event) => {
                    const nextPlanId = event.target.value;
                    const nextPlan = plans.find((plan) => plan.id === nextPlanId) ?? null;
                    setForm((current) => ({
                      ...current,
                      planId: nextPlanId,
                      amountCents: nextPlan ? nextPlan.priceCents : current.amountCents,
                      durationDays: nextPlan ? nextPlan.durationDays : current.durationDays,
                    }));
                  }}
                >
                  <option value="">选择套餐或只录入续期天数</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} / {formatMoney(plan.priceCents)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="two-col">
              <label className="field">
                <span className="fine-print">金额（分）</span>
                <input
                  className="control"
                  type="number"
                  value={form.amountCents}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      amountCents: Number(event.target.value),
                    }))
                  }
                />
              </label>

              <label className="field">
                <span className="fine-print">续期天数</span>
                <input
                  className="control"
                  type="number"
                  value={form.durationDays}
                  disabled={Boolean(selectedPlan) && form.kind === "renewal"}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      durationDays: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </div>

            <label className="field">
              <span className="fine-print">流量字节数</span>
              <input
                className="control"
                type="number"
                value={form.trafficBytes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    trafficBytes: Number(event.target.value),
                  }))
                }
              />
            </label>

            {selectedPlan ? (
              <div className="feedback info">
                当前套餐会在到账时同步 {selectedPlan.name} 的流量、带宽、设备数和节点组绑定。
              </div>
            ) : null}

            <label className="field">
              <span className="fine-print">备注</span>
              <textarea
                className="control textarea"
                value={form.note}
                onChange={(event) =>
                  setForm((current) => ({ ...current, note: event.target.value }))
                }
                placeholder="可填写付款渠道、客服备注或会员需求"
              />
            </label>

            <button
              className="action-button"
              type="submit"
              disabled={
                submitting ||
                !form.userId ||
                (form.kind === "renewal" && !form.planId && !form.durationDays)
              }
            >
              {submitting
                ? "提交中..."
                : form.status === "pending"
                  ? "创建待支付订单"
                  : "立即入账"}
            </button>
          </form>
        </Panel>
      </section>
    </ConsoleShell>
  );
}
