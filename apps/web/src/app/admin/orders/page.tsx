"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
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
  if (order.trafficBytes) return formatBytes(order.trafficBytes);
  if (order.durationDays) return `${order.durationDays} 天`;
  return "-";
}

export default function AdminOrdersPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<ManualOrderRecord[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actingOrderId, setActingOrderId] = useState<string | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const selectedPlan = plans.find((p) => p.id === form.planId) ?? null;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextOrders, nextUsers, nextPlans] = await Promise.all([
        apiRequest<ManualOrderRecord[]>("/api/admin/orders", { token }),
        apiRequest<AdminUser[]>("/api/admin/users", { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
      ]);
      setOrders(nextOrders);
      setUsers(nextUsers.filter((u) => u.role === "member"));
      setPlans(nextPlans.filter((p) => p.active));
    } catch {
      // keep stale
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  function openCreate() {
    setForm(emptyForm);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setDrawerError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setDrawerError(null);
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
      closeDrawer();
      await load();
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "订单创建失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOrderAction(orderId: string, status: "applied" | "void") {
    if (!token) return;
    setActingOrderId(orderId);
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
      setFeedback(cause instanceof ApiError ? cause.message : "订单处理失败。");
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
          <span className="badge info">
            {loading ? "加载中..." : `${orders.length} 笔订单`}
          </span>
          {pendingCount > 0 ? (
            <span className="badge warn">{pendingCount} 笔待处理</span>
          ) : null}
        </>
      }
      toolbarActions={
        <>
          <button className="action-button" type="button" onClick={openCreate}>
            创建订单
          </button>
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
        </>
      }
    >
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      <Panel
        title="订单工作台"
        copy="待支付订单会停留在 pending，确认到账后再应用到订阅；applied 表示权益已经入账。"
      >
        {loading && orders.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}
        {orders.length > 0 ? (
          <DataTable
            headers={["用户", "套餐 / 权益", "类型", "状态", "金额", "处理时间", "操作"]}
            rows={orders.map((order) => [
              <div key={order.id} className="split">
                <strong>{order.userDisplayName}</strong>
                <span className="muted">{order.userEmail}</span>
              </div>,
              renderRights(order),
              humanizeOrderKind(order.kind),
              <span key={`${order.id}-st`} className={`badge ${statusTone(order.status)}`}>
                {order.status}
              </span>,
              formatMoney(order.amountCents),
              order.processedAt
                ? formatDateTime(order.processedAt)
                : formatDateTime(order.createdAt),
              order.status === "pending" ? (
                <div className="table-actions" key={`${order.id}-act`}>
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
                <span className="fine-print" key={`${order.id}-note`}>
                  {order.note ?? "已处理"}
                </span>
              ),
            ])}
          />
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">🧾</div>
            <div className="empty-state-title">还没有订单</div>
            <button className="action-button" type="button" onClick={openCreate}>
              创建第一笔订单
            </button>
          </div>
        ) : null}
      </Panel>

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title="创建订单"
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="order-form"
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
            <button className="ghost-button" type="button" onClick={closeDrawer}>
              取消
            </button>
          </div>
        }
      >
        {drawerError ? <div className="feedback error">{drawerError}</div> : null}

        <form id="order-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span className="fine-print">会员</span>
            <select
              className="control"
              value={form.userId}
              onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
            >
              <option value="">请选择会员</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} / {u.email}
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
                onChange={(e) => {
                  const nextKind = e.target.value as typeof form.kind;
                  setForm((f) => ({ ...f, kind: nextKind, planId: nextKind === "renewal" ? f.planId : "" }));
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
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as typeof f.status }))
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
                onChange={(e) => {
                  const nextPlan = plans.find((p) => p.id === e.target.value) ?? null;
                  setForm((f) => ({
                    ...f,
                    planId: e.target.value,
                    amountCents: nextPlan ? nextPlan.priceCents : f.amountCents,
                    durationDays: nextPlan ? nextPlan.durationDays : f.durationDays,
                  }));
                }}
              >
                <option value="">选择套餐或只录入续期天数</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} / {formatMoney(p.priceCents)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="two-col">
            <label className="field">
              <span className="fine-print">金额（元）</span>
              <input
                className="control"
                type="number"
                min="0"
                step="0.01"
                value={form.amountCents / 100}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amountCents: Math.round(Number(e.target.value) * 100) }))
                }
              />
            </label>

            <label className="field">
              <span className="fine-print">续期天数</span>
              <input
                className="control"
                type="number"
                min="0"
                value={form.durationDays}
                disabled={Boolean(selectedPlan) && form.kind === "renewal"}
                onChange={(e) => setForm((f) => ({ ...f, durationDays: Number(e.target.value) }))}
              />
            </label>
          </div>

          {form.kind !== "renewal" ? (
            <label className="field">
              <span className="fine-print">流量（GB）</span>
              <input
                className="control"
                type="number"
                min="0"
                value={Math.round((form.trafficBytes / (1024 * 1024 * 1024)) * 100) / 100}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    trafficBytes: Math.round(Number(e.target.value) * 1024 * 1024 * 1024),
                  }))
                }
              />
            </label>
          ) : null}

          {selectedPlan ? (
            <div className="feedback info">
              到账时同步 {selectedPlan.name} 的流量、带宽、设备数和节点组绑定。
            </div>
          ) : null}

          <label className="field">
            <span className="fine-print">备注（可选）</span>
            <textarea
              className="control textarea"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="可填写付款渠道、客服备注或会员需求"
            />
          </label>
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
