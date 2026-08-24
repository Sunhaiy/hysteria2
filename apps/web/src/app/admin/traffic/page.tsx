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
import { formatBytes, formatDateTime } from "@/lib/format";

type Ranking = { id: string; name: string; bytes: number };
type Overview = {
  totals: { physicalBytes: number; accountedBytes: number; allocatedBytes: number; overageBytes: number; records: number };
  trend: Array<{ date: string; physicalBytes: number; accountedBytes: number; allocatedBytes: number }>;
  rankings: { users: Ranking[]; products: Ranking[]; nodes: Ranking[]; pools: Ranking[] };
};
type Detail = { id: string; bucketStart: string; userEmail: string; nodeLabel: string; physicalBytes: number; accountedBytes: number; allocatedBytes: number; overageBytes: number; source: string; allocations: Array<{ productName: string; accountedBytes: number }> };

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export default function TrafficPage() {
  const { token } = useAuth();
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => isoDate(new Date(Date.now() + 86400000)));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [details, setDetails] = useState<Detail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => new URLSearchParams({ from, to, pageSize: "100" }).toString(), [from, to]);
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [nextOverview, nextDetails] = await Promise.all([
        apiRequest<Overview>(`/api/admin/traffic/overview?${query}`, { token }),
        apiRequest<{ items: Detail[] }>(`/api/admin/traffic/details?${query}`, { token }),
      ]);
      setOverview(nextOverview); setDetails(nextDetails.items);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "流量分析加载失败。"); }
    finally { setLoading(false); }
  }, [query, token]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const chart = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: "axis" }, legend: { data: ["物理流量", "计费流量", "额度扣除"] },
    xAxis: { type: "category", data: overview?.trend.map((item) => item.date) ?? [] },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => `${(value / 1024 ** 3).toFixed(0)} GB` } },
    series: [
      { name: "物理流量", type: "line", smooth: true, data: overview?.trend.map((item) => item.physicalBytes) ?? [] },
      { name: "计费流量", type: "line", smooth: true, data: overview?.trend.map((item) => item.accountedBytes) ?? [] },
      { name: "额度扣除", type: "bar", data: overview?.trend.map((item) => item.allocatedBytes) ?? [] },
    ],
  }), [overview]);

  const rankingRows = (items: Ranking[]) => items.map((item, index) => [String(index + 1), item.name, formatBytes(item.bytes)]);

  return (
    <ConsoleShell title="流量分析" subtitle="物理流量、计费流量与额度分摊" scope="Traffic" navItems={adminNav} requireRole="admin"
      toolbarMeta={<span className="badge info">服务端分页 · {overview?.totals.records ?? 0} 条</span>}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void apiDownload(`/api/admin/traffic/export?${query}`, "traffic-analysis.csv")}><Icon name="download" />导出 CSV</button>}>
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="page-stack">
        <Panel title="查询区间">
          <div className="inline-form">
            <input className="control" aria-label="开始日期" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <input className="control" aria-label="结束日期" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            <button className="action-button" type="button" onClick={() => void load()}><Icon name="search" />查询</button>
          </div>
        </Panel>
        <div className="metric-grid">
          <MetricCard label="物理流量" value={formatBytes(overview?.totals.physicalBytes ?? 0)} footnote="节点实际上下行" />
          <MetricCard label="计费流量" value={formatBytes(overview?.totals.accountedBytes ?? 0)} footnote="应用用户倍率后" />
          <MetricCard label="额度扣除" value={formatBytes(overview?.totals.allocatedBytes ?? 0)} footnote="可拆分到多个 bucket" />
          <MetricCard label="超额流量" value={formatBytes(overview?.totals.overageBytes ?? 0)} footnote="无可用额度承接" />
        </div>
        <Panel title="时间趋势"><EChart option={chart} height={320} ariaLabel="流量时间趋势" /></Panel>
        <div className="two-col">
          <Panel title="用户排行"><DataTable headers={["#", "客户", "计费流量"]} rows={rankingRows(overview?.rankings.users ?? [])} /></Panel>
          <Panel title="商品排行"><DataTable headers={["#", "商品", "额度扣除"]} rows={rankingRows(overview?.rankings.products ?? [])} /></Panel>
          <Panel title="节点排行"><DataTable headers={["#", "节点", "物理流量"]} rows={rankingRows(overview?.rankings.nodes ?? [])} /></Panel>
          <Panel title="资源池排行"><DataTable headers={["#", "资源池", "物理流量"]} rows={rankingRows(overview?.rankings.pools ?? [])} /></Panel>
        </div>
        <Panel title="计费明细" copy="一条流量记录可拆分扣除多个最早到期额度。">
          <DataTable headers={["时间","客户","节点","物理","计费","扣除","超额","商品分摊"]} rows={details.map((item) => [formatDateTime(item.bucketStart), item.userEmail, item.nodeLabel, formatBytes(item.physicalBytes), formatBytes(item.accountedBytes), formatBytes(item.allocatedBytes), formatBytes(item.overageBytes), item.allocations.map((allocation) => `${allocation.productName} ${formatBytes(allocation.accountedBytes)}`).join(" · ") || "-"])} />
        </Panel>
        {loading ? <span className="fine-print">正在更新流量分析...</span> : null}
      </div>
    </ConsoleShell>
  );
}
