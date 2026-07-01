"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { EChart } from "@/components/echart";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { UsageRollupRecord, UsageSummaryResponse } from "@/lib/types";

const PAGE_SIZE = 20;
const GB = 1024 * 1024 * 1024;

export default function AdminUsagePage() {
  const { token } = useAuth();
  const [usage, setUsage] = useState<UsageRollupRecord[]>([]);
  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [nodeFilter, setNodeFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [nextUsage, nextSummary] = await Promise.all([
        apiRequest<UsageRollupRecord[]>("/api/admin/usage", { token }),
        apiRequest<UsageSummaryResponse>("/api/admin/usage/summary", { token }),
      ]);
      setPage(0);
      setUsage(nextUsage);
      setSummary(nextSummary);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "用量日志加载失败。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const filteredUsage = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return usage.filter((item) => {
      if (nodeFilter && item.nodeId !== nodeFilter) return false;
      if (keyword && !item.userEmail.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [nodeFilter, search, usage]);

  const trendOption = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: "axis", valueFormatter: (value) => `${Number(value).toFixed(2)} GB` },
    legend: { data: ["上传", "下载"], top: 0, right: 0 },
    grid: { left: 10, right: 12, top: 42, bottom: 10, containLabel: true },
    xAxis: { type: "category", boundaryGap: false, data: summary?.daily.map((item) => item.date.slice(5).replace("-", "/")) ?? [] },
    yAxis: { type: "value", name: "GB" },
    series: [
      { name: "上传", type: "line", smooth: true, symbol: "none", areaStyle: { opacity: 0.08 }, data: summary?.daily.map((item) => Number((item.txBytes / GB).toFixed(3))) ?? [] },
      { name: "下载", type: "line", smooth: true, symbol: "none", areaStyle: { opacity: 0.08 }, data: summary?.daily.map((item) => Number((item.rxBytes / GB).toFixed(3))) ?? [] },
    ],
  }), [summary]);

  const nodeOption = useMemo<EChartsOption>(() => {
    const rows = [...(summary?.nodes ?? [])].slice(0, 10).reverse();
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value) => `${Number(value).toFixed(2)} GB` },
      grid: { left: 8, right: 18, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value", name: "GB" },
      yAxis: { type: "category", data: rows.map((item) => item.nodeLabel) },
      series: [{ name: "累计总流量", type: "bar", barMaxWidth: 20, itemStyle: { borderRadius: [0, 5, 5, 0] }, data: rows.map((item) => Number((item.totalBytes / GB).toFixed(3))) }],
    };
  }, [summary]);

  const pageCount = Math.max(1, Math.ceil(filteredUsage.length / PAGE_SIZE));
  const pageRows = filteredUsage.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <ConsoleShell
      title="用量日志"
      subtitle="从趋势、节点、用户三个维度查看流量使用情况"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">累计 {formatBytes(summary?.totals.totalBytes ?? 0)}</span>}
      toolbarActions={<button className="toolbar-button" type="button" disabled={loading} onClick={() => void load()}><Icon name="refresh" />刷新数据</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}

      <section className="metric-grid usage-summary-grid">
        <MetricCard label="累计总流量" value={formatBytes(summary?.totals.totalBytes ?? 0)} footnote={`${summary?.totals.recordCount ?? 0} 条流量记录`} />
        <MetricCard label="近 24 小时" value={formatBytes(summary?.totals.last24HoursBytes ?? 0)} footnote="最近一天所有节点合计" />
        <MetricCard label="近 7 天" value={formatBytes(summary?.totals.last7DaysBytes ?? 0)} footnote="最近七天上传与下载合计" />
        <MetricCard label="已统计节点" value={String(summary?.nodes.length ?? 0)} footnote={`${summary?.users.length ?? 0} 位高用量用户已聚合`} />
      </section>

      <section className="admin-chart-grid">
        <Panel title="近 14 天流量趋势" copy="上传、下载按日汇总，便于观察流量变化。">
          <EChart option={trendOption} height={320} ariaLabel="近十四天流量趋势" />
        </Panel>
        <Panel title="节点累计流量" copy="节点自开始记录以来处理的全部流量。">
          <EChart option={nodeOption} height={320} ariaLabel="节点累计流量排行" />
        </Panel>
      </section>

      <section className="workspace-grid usage-detail-grid">
        <Panel title="节点流量明细" copy="上传、下载和累计总量均基于完整历史记录。">
          <DataTable
            headers={["节点", "状态", "累计总流量", "上传", "下载", "记录数", "最近记录"]}
            rows={(summary?.nodes ?? []).map((item) => [
              <strong key={`${item.nodeId}-name`}>{item.nodeLabel}</strong>,
              <span key={`${item.nodeId}-status`} className={`badge ${item.active ? "success" : "warn"}`}>{item.active ? "运行中" : "已停用"}</span>,
              <strong key={`${item.nodeId}-total`}>{formatBytes(item.totalBytes)}</strong>,
              formatBytes(item.txBytes),
              formatBytes(item.rxBytes),
              String(item.recordCount),
              item.lastSeenAt ? formatDateTime(item.lastSeenAt) : "暂无",
            ])}
          />
        </Panel>

        <Panel title="高用量用户" copy="按历史累计总流量排序，显示前十位。">
          <div className="rank-list">
            {(summary?.users ?? []).map((item, index) => (
              <div className="rank-row" key={item.userId}>
                <span>{index + 1}</span>
                <div><strong>{item.userDisplayName}</strong><small>{item.userEmail}</small></div>
                <b>{formatBytes(item.totalBytes)}</b>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel
        title="最近流量记录"
        copy="最多展示最近 200 条入库记录，可按节点或用户邮箱筛选。"
        action={
          <div className="toolbar-actions">
            <button className="ghost-button compact" type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button>
            <span className="fine-print">第 {page + 1} / {pageCount} 页</span>
            <button className="ghost-button compact" type="button" disabled={(page + 1) * PAGE_SIZE >= filteredUsage.length} onClick={() => setPage((value) => value + 1)}>下一页</button>
          </div>
        }
      >
        <div className="usage-filter-row">
          <label className="field"><span className="fine-print">节点</span><CustomSelect value={nodeFilter} onChange={(value) => { setNodeFilter(value); setPage(0); }} options={[{ value: "", label: "全部节点" }, ...(summary?.nodes ?? []).map((item) => ({ value: item.nodeId, label: item.nodeLabel }))]} /></label>
          <label className="field"><span className="fine-print">用户邮箱</span><input className="control" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="输入邮箱筛选" /></label>
          <div className="usage-filter-count"><strong>{filteredUsage.length}</strong><span>条匹配记录</span></div>
        </div>

        {loading && usage.length === 0 ? (
          <div className="skeleton-rows">{Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}</div>
        ) : (
          <DataTable
            headers={["用户", "节点", "上传", "下载", "总流量", "来源", "时间"]}
            rows={pageRows.map((item) => [
              item.userEmail,
              item.nodeLabel,
              formatBytes(item.txBytes),
              formatBytes(item.rxBytes),
              <strong key={`${item.id}-total`}>{formatBytes(item.txBytes + item.rxBytes)}</strong>,
              item.source,
              formatDateTime(item.bucketStart),
            ])}
          />
        )}
      </Panel>
    </ConsoleShell>
  );
}
