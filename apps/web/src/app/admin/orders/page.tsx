"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { AdminUser, ManualOrderRecord } from "@/lib/types";
import { humanizeOrderKind, statusTone } from "@/lib/ui";

const emptyForm = {
  userId: "",
  kind: "renewal" as "renewal" | "traffic_pack" | "manual_credit",
  amountCents: 1800,
  durationDays: 30,
  trafficBytes: 0,
  note: "",
};

export default function AdminOrdersPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<ManualOrderRecord[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextOrders, nextUsers] = await Promise.all([
        apiRequest<ManualOrderRecord[]>("/api/admin/orders", { token }),
        apiRequest<AdminUser[]>("/api/admin/users", { token }),
      ]);
      setOrders(nextOrders);
      setUsers(nextUsers.filter((user) => user.role === "member"));
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
      setFeedback("人工订单已入账。");
      setForm(emptyForm);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "人工入账失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConsoleShell
      title="人工订单"
      subtitle="为现有订阅做续期、流量包和人工入账"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">{loading ? "加载中..." : `${orders.length} 条订单`}</span>}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      <section className="workspace-grid">
        <Panel title="人工订单记录" copy="每次入账都会保留金额、操作者和处理时间。">
          <DataTable
            headers={["用户", "类型", "状态", "金额", "附加权益", "处理时间"]}
            rows={orders.map((order) => [
              <div key={order.id} className="split">
                <strong>{order.userDisplayName}</strong>
                <span className="muted">{order.userEmail}</span>
              </div>,
              humanizeOrderKind(order.kind),
              <span key={`${order.id}-status`} className={`badge ${statusTone(order.status)}`}>
                {order.status}
              </span>,
              formatMoney(order.amountCents),
              order.trafficBytes
                ? formatBytes(order.trafficBytes)
                : order.durationDays
                  ? `${order.durationDays} 天`
                  : "无",
              order.processedAt ? formatDateTime(order.processedAt) : "待处理",
            ])}
          />
        </Panel>

        <Panel title="新建人工订单" copy="续期会延长结束时间，流量包会创建新的 traffic pack。">
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span className="fine-print">用户</span>
              <select
                className="control"
                value={form.userId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, userId: event.target.value }))
                }
              >
                <option value="">请选择用户</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} / {user.email}
                  </option>
                ))}
              </select>
            </label>
            <div className="two-col">
              <label className="field">
                <span className="fine-print">类型</span>
                <select
                  className="control"
                  value={form.kind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      kind: event.target.value as typeof current.kind,
                    }))
                  }
                >
                  <option value="renewal">renewal</option>
                  <option value="traffic_pack">traffic_pack</option>
                  <option value="manual_credit">manual_credit</option>
                </select>
              </label>
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
            </div>
            <div className="two-col">
              <label className="field">
                <span className="fine-print">续期天数</span>
                <input
                  className="control"
                  type="number"
                  value={form.durationDays}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      durationDays: Number(event.target.value),
                    }))
                  }
                />
              </label>
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
            </div>
            <label className="field">
              <span className="fine-print">备注</span>
              <textarea
                className="control textarea"
                value={form.note}
                onChange={(event) =>
                  setForm((current) => ({ ...current, note: event.target.value }))
                }
              />
            </label>
            <button className="action-button" type="submit" disabled={submitting}>
              {submitting ? "提交中..." : "人工入账"}
            </button>
          </form>
        </Panel>
      </section>
    </ConsoleShell>
  );
}
