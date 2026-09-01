"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { ManualOrderRecord } from "@/lib/types";
import { humanizeOrderKind, statusTone } from "@/lib/ui";

function describeOrderRights(order: ManualOrderRecord) {
  if (order.planName) {
    return `${order.planName}${order.durationDays ? ` / ${order.durationDays} 天` : ""}`;
  }
  if (order.trafficBytes) {
    return formatBytes(order.trafficBytes);
  }
  if (order.durationDays) {
    return `${order.durationDays} 天`;
  }
  return "-";
}

export default function PortalOrdersPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<ManualOrderRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [paymentResult, setPaymentResult] = useState<
    "success" | "pending" | "failed" | null
  >(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }

    setError(null);
    try {
      const nextOrders = await apiRequest<ManualOrderRecord[]>(
        "/api/portal/orders",
        {
          token,
        },
      );
      setOrders(nextOrders);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "订单记录加载失败。",
      );
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const result = new URLSearchParams(window.location.search).get("payment");
      if (result === "success" || result === "pending" || result === "failed") {
        setPaymentResult(result);
      }
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const pendingOrders = orders.filter((order) => order.status === "pending");

  return (
    <ConsoleShell
      title="订单记录"
      subtitle="查看套餐申请、CDK 兑换、流量包和人工入账的完整处理轨迹"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={
        <>
          <span className="badge info">{orders.length} 条记录</span>
          <span className="badge warn">{pendingOrders.length} 条待处理</span>
        </>
      }
      toolbarActions={
        <button
          className="toolbar-button"
          type="button"
          onClick={() => void load()}
        >
          刷新
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {paymentResult === "success" ? (
        <div className="feedback success">支付成功，权益已经自动到账。</div>
      ) : paymentResult === "pending" ? (
        <div className="feedback info">支付结果确认中，请稍后刷新订单。</div>
      ) : paymentResult === "failed" ? (
        <div className="feedback error">
          暂未确认支付结果。如已扣款，请勿重复支付并联系工单支持。
        </div>
      ) : null}

      {!loaded && !error ? (
        <PageSkeleton variant="table" />
      ) : null}

      {loaded && pendingOrders.length ? (
        <div className="feedback warn">
          你当前有 {pendingOrders.length}{" "}
          笔待处理订单。后台确认到账后，套餐或流量会自动写入账号。
        </div>
      ) : null}

      {loaded ? (
        <Panel
          title="历史订单"
          copy="pending 表示等待人工确认，applied 表示权益已经到账。"
        >
          <DataTable
            headers={[
              "类型",
              "套餐 / 权益",
              "状态",
              "金额",
              "处理时间",
              "备注",
            ]}
            rows={orders.map((order) => [
              humanizeOrderKind(order.kind),
              describeOrderRights(order),
              <span
                key={order.id}
                className={`badge ${statusTone(order.status)}`}
              >
                {order.status}
              </span>,
              formatMoney(order.amountCents),
              order.processedAt
                ? formatDateTime(order.processedAt)
                : "等待处理",
              order.note ?? "-",
            ])}
          />
        </Panel>
      ) : null}

      <Panel
        title="还想开通新套餐？"
        copy="你可以直接在前台选择套餐提交申请，也可以继续使用 CDK 兑换。"
      >
        <div className="toolbar-actions">
          <Link className="action-button" href="/portal/plans">
            去选套餐
          </Link>
          <Link className="ghost-button" href="/portal/redeem">
            去兑换中心
          </Link>
        </div>
      </Panel>
    </ConsoleShell>
  );
}
