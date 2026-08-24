"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { EChart } from "@/components/echart";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiDownload, apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime, formatMoney } from "@/lib/format";

type Summary = {
  fulfilledNetRevenueCents: number; cdkEntitlementValueCents: number; refundCents: number; amortizedNodeCostCents: number; grossProfitCents: number; walletLiabilityCents: number; appliedOrders: number; pendingOrders: number;
  paymentBreakdown: Array<{ source: string; status: string; amountCents: number; count: number }>;
  nodeCosts: Array<{ nodeId: string; nodeLabel: string; amortizedCents: number }>;
};
type Order = { id: string; userEmail: string; productName?: string | null; status: string; source: string; amountCents: number; paidCents: number; refundedCents: number; createdAt: string };
type Ledger = { id: string; userEmail: string; actorEmail?: string | null; orderId?: string | null; kind: string; amountCents: number; beforeBalanceCents?: number | null; afterBalanceCents?: number | null; note?: string | null; createdAt: string };
type Refund = { id: string; orderId: string; userEmail: string; method: string; status: string; amountCents: number; reason: string; createdAt: string };
type NodeCost = { id: string; nodeLabel: string; amountCents: number; amortizedCents: number; effectiveFrom: string; effectiveTo?: string | null; providerReference?: string | null };
type View = "overview" | "orders" | "ledger" | "refunds" | "costs";

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export default function FinancePage() {
  const { token } = useAuth();
  const [view, setView] = useState<View>("overview");
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => isoDate(new Date(Date.now() + 86400000)));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [costs, setCosts] = useState<NodeCost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ from, to, pageSize: "200" });
    try {
      const [nextSummary, nextOrders, nextLedger, nextRefunds, nextCosts] = await Promise.all([
        apiRequest<Summary>(`/api/admin/finance/summary?${query}`, { token }),
        apiRequest<{ items: Order[] }>(`/api/admin/finance/orders?${query}`, { token }),
        apiRequest<{ items: Ledger[] }>(`/api/admin/finance/ledger?${query}`, { token }),
        apiRequest<Refund[]>(`/api/admin/finance/refunds?${query}`, { token }),
        apiRequest<NodeCost[]>(`/api/admin/finance/node-costs?${query}`, { token }),
      ]);
      setSummary(nextSummary); setOrders(nextOrders.items); setLedger(nextLedger.items); setRefunds(nextRefunds); setCosts(nextCosts);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "财务数据加载失败。");
    } finally { setLoading(false); }
  }, [from, to, token]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const profitOption = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: ["履约收入", "退款", "节点成本", "毛利"] },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => `¥${(value / 100).toFixed(0)}` } },
    series: [{ type: "bar", data: summary ? [summary.fulfilledNetRevenueCents, -summary.refundCents, -summary.amortizedNodeCostCents, summary.grossProfitCents] : [] }],
  }), [summary]);

  const queryString = new URLSearchParams({ from, to }).toString();

  return (
    <ConsoleShell title="财务中心" subtitle="经营收入、钱包负债与节点成本" scope="Finance" navItems={adminNav} requireRole="admin"
      toolbarMeta={<span className="badge info">CNY · Asia/Shanghai</span>}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void apiDownload(`/api/admin/finance/export?kind=${view === "ledger" ? "ledger" : "orders"}&${queryString}`, "finance.csv")}><Icon name="download" />导出</button>}>
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="page-stack">
        <Panel title="查询区间">
          <div className="inline-form">
            <label className="field"><span className="fine-print">开始日期</span><input className="control" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label className="field"><span className="fine-print">结束日期（不含）</span><input className="control" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <button className="action-button" type="button" onClick={() => void load()}><Icon name="search" />查询</button>
          </div>
        </Panel>
        <div className="metric-grid">
          <MetricCard label="已履约净收入" value={formatMoney(summary?.fulfilledNetRevenueCents ?? 0)} footnote={`${summary?.appliedOrders ?? 0} 笔已履约订单`} />
          <MetricCard label="退款" value={formatMoney(summary?.refundCents ?? 0)} footnote="冲减区间净收入" />
          <MetricCard label="摊销节点成本" value={formatMoney(summary?.amortizedNodeCostCents ?? 0)} footnote="按有效日期逐日摊销" />
          <MetricCard label="毛利" value={formatMoney(summary?.grossProfitCents ?? 0)} footnote={`钱包负债 ${formatMoney(summary?.walletLiabilityCents ?? 0)}`} />
        </div>
        <div className="segmented-control" aria-label="财务视图">
          {([['overview','经营概览'],['orders','订单'],['ledger','钱包流水'],['refunds','退款与冲正'],['costs','节点成本']] as Array<[View,string]>).map(([key,label]) => <button type="button" className={view === key ? "active" : ""} key={key} onClick={() => setView(key)}>{label}</button>)}
        </div>
        {view === "overview" ? (
          <div className="two-col">
            <Panel title="毛利构成"><EChart option={profitOption} height={280} ariaLabel="毛利构成图" /></Panel>
            <Panel title="价值分类" copy="CDK 权益价值不计入现金收入。">
              <DataTable headers={["分类", "金额"]} rows={[
                ["现金与钱包履约收入", formatMoney(summary?.fulfilledNetRevenueCents ?? 0)],
                ["CDK 权益价值", formatMoney(summary?.cdkEntitlementValueCents ?? 0)],
                ["钱包余额负债", formatMoney(summary?.walletLiabilityCents ?? 0)],
                ["待处理订单", String(summary?.pendingOrders ?? 0)],
              ]} />
            </Panel>
          </div>
        ) : null}
        {view === "orders" ? <Panel title="订单"><DataTable headers={["时间","客户","商品","来源","成交","退款","状态"]} rows={orders.map((order) => [formatDateTime(order.createdAt), order.userEmail, order.productName ?? order.id, order.source, formatMoney(order.amountCents), formatMoney(order.refundedCents), order.status])} /></Panel> : null}
        {view === "ledger" ? <Panel title="钱包流水"><DataTable headers={["时间","客户","类型","变更","变更前","变更后","操作者"]} rows={ledger.map((entry) => [formatDateTime(entry.createdAt), entry.userEmail, entry.kind, formatMoney(entry.amountCents), entry.beforeBalanceCents == null ? "-" : formatMoney(entry.beforeBalanceCents), entry.afterBalanceCents == null ? "-" : formatMoney(entry.afterBalanceCents), entry.actorEmail ?? "系统"])} /></Panel> : null}
        {view === "refunds" ? <Panel title="退款与冲正"><DataTable headers={["时间","客户","订单","方式","金额","原因","状态"]} rows={refunds.map((refund) => [formatDateTime(refund.createdAt), refund.userEmail, refund.orderId, refund.method, formatMoney(refund.amountCents), refund.reason, refund.status])} /></Panel> : null}
        {view === "costs" ? <Panel title="节点成本"><DataTable headers={["节点","合同金额","区间摊销","有效期","供应商单号"]} rows={costs.map((cost) => [cost.nodeLabel, formatMoney(cost.amountCents), formatMoney(cost.amortizedCents), `${formatDateTime(cost.effectiveFrom)} - ${cost.effectiveTo ? formatDateTime(cost.effectiveTo) : "持续"}`, cost.providerReference ?? "-"])} /></Panel> : null}
        {loading ? <span className="fine-print">正在更新财务数据...</span> : null}
      </div>
    </ConsoleShell>
  );
}
