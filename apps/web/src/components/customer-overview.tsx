"use client";
import { MetricCard } from "./metric-card";
import { formatBytes, formatMoney } from "@/lib/format";
type OverviewData = {
  displayName: string;
  email: string;
  balanceCents: number;
  summary: {
    activeGrantCount: number;
    remainingBytes: number;
    grantedBytes: number;
    consumedBytes: number;
    onlineClients: number;
    online: boolean;
    onlineNodeCount: number;
  };
};
export function CustomerOverview({
  customer,
  identity = false,
}: {
  customer: OverviewData;
  identity?: boolean;
}) {
  if (identity)
    return (
      <header className="customer-masthead">
        <div className="customer-identity">
          <h2>{customer.email}</h2>
        </div>
      </header>
    );
  return (
    <>
      <div className="metric-grid customer-summary-grid">
        <article className="metric-card customer-quota-card">
          <span className="metric-label">当前可用总流量</span>
          <strong className="metric-value">
            {formatBytes(customer.summary.remainingBytes)}
          </strong>
          <div className="bar-track" aria-label="额度使用进度">
            <span
              className="bar-fill bar-fill-success"
              style={{
                width: `${Math.min(
                  100,
                  customer.summary.grantedBytes
                    ? (customer.summary.consumedBytes /
                        customer.summary.grantedBytes) *
                        100
                    : 0,
                )}%`,
              }}
            />
          </div>
          <span className="metric-footnote">
            已用 {formatBytes(customer.summary.consumedBytes)} · 按所用机器计费
          </span>
        </article>
        <MetricCard
          label="账户余额"
          value={formatMoney(customer.balanceCents)}
          footnote="可用于购买套餐与流量"
        />
        <MetricCard
          label="活跃连接"
          value={String(customer.summary.onlineClients)}
          footnote={`${customer.summary.online ? "在线" : "离线"} · ${customer.summary.onlineNodeCount} 个连接节点 · 同一设备可能产生多条连接`}
        />
      </div>
    </>
  );
}
