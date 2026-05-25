"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { ManualOrderRecord } from "@/lib/types";
import { humanizeOrderKind, statusTone } from "@/lib/ui";

export default function PortalOrdersPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<ManualOrderRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const nextOrders = await apiRequest<ManualOrderRecord[]>("/api/portal/orders", {
        token,
      });
      setOrders(nextOrders);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "订单记录加载失败。");
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  return (
    <ConsoleShell
      title="订单记录"
      subtitle="查看历史续期、流量包与人工入账记录"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={<span className="badge info">{orders.length} 条记录</span>}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <Panel title="历史订单" copy="这里展示已经应用到你账户上的人工订单记录。">
        <DataTable
          headers={["类型", "状态", "金额", "附加权益", "处理时间", "备注"]}
          rows={orders.map((order) => [
            humanizeOrderKind(order.kind),
            <span key={order.id} className={`badge ${statusTone(order.status)}`}>
              {order.status}
            </span>,
            formatMoney(order.amountCents),
            order.trafficBytes
              ? formatBytes(order.trafficBytes)
              : order.durationDays
                ? `${order.durationDays} 天`
                : "无",
            order.processedAt ? formatDateTime(order.processedAt) : "待处理",
            order.note ?? "-",
          ])}
        />
      </Panel>
    </ConsoleShell>
  );
}
