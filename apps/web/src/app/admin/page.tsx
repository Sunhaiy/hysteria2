"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { EChart } from "@/components/echart";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";

type DashboardSummary = {
  generatedAt: string;
  timezone: string;
  freshnessSeconds: number;
  metrics: {
    todayPhysicalBytes: number;
    yesterdayPhysicalBytes: number;
    monthPhysicalBytes: number;
    activePlanSubscribers: number;
    onlineUsers: number;
    activeConnections: number;
  };
  trend: Array<{
    date: string;
    txBytes: number;
    rxBytes: number;
    physicalBytes: number;
  }>;
  nodes: Array<{
    id: string;
    label: string;
    serverName: string;
    protocol: string;
    active: boolean;
    healthy: boolean | null;
    physicalBytes: number;
    onlineUsers: number;
    activeConnections: number;
    lastSeenAt: string | null;
  }>;
  subscriptions: {
    active: number;
    expired: number;
    paused: number;
    canceled: number;
  };
  auth: { granted: number; denied: number };
};

const protocolLabel = (protocol: string) =>
  protocol === "vless_reality" ? "VLESS Reality" : "Hysteria2";

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        setSummary(
          await apiRequest<DashboardSummary>("/api/admin/dashboard/summary", {
            token,
            signal,
          }),
        );
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(
          cause instanceof ApiError ? cause.message : "管理台数据加载失败。",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const trafficOption = useMemo<EChartsOption>(
    () => ({
      animationDuration: 500,
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatBytes(Number(value)),
      },
      legend: { data: ["上传", "下载"], top: 0, right: 0 },
      grid: { left: 10, right: 12, top: 42, bottom: 10, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data:
          summary?.trend.map((item) => item.date.slice(5).replace("-", "/")) ??
          [],
      },
      yAxis: {
        type: "value",
        axisLabel: { formatter: (value: number) => formatBytes(value) },
      },
      series: [
        {
          name: "上传",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 },
          data: summary?.trend.map((item) => item.txBytes) ?? [],
        },
        {
          name: "下载",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 },
          data: summary?.trend.map((item) => item.rxBytes) ?? [],
        },
      ],
    }),
    [summary],
  );

  const nodeTrafficOption = useMemo<EChartsOption>(() => {
    const rows = [...(summary?.nodes ?? [])].slice(0, 8).reverse();
    return {
      animationDuration: 500,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => formatBytes(Number(value)),
      },
      grid: { left: 8, right: 18, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        splitNumber: 3,
        axisLabel: {
          hideOverlap: true,
          formatter: (value: number) => formatBytes(value),
        },
      },
      yAxis: {
        type: "category",
        data: rows.map((item) => item.label),
        axisLabel: { width: 132, overflow: "truncate" },
      },
      series: [
        {
          name: "本月流量",
          type: "bar",
          barMaxWidth: 20,
          itemStyle: { borderRadius: [0, 5, 5, 0] },
          data: rows.map((item) => item.physicalBytes),
        },
      ],
    };
  }, [summary]);

  const statusOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "item" },
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["54%", "76%"],
          center: ["50%", "44%"],
          label: { show: false },
          data: [
            { name: "活跃", value: summary?.subscriptions.active ?? 0 },
            { name: "过期", value: summary?.subscriptions.expired ?? 0 },
            { name: "暂停", value: summary?.subscriptions.paused ?? 0 },
            { name: "取消", value: summary?.subscriptions.canceled ?? 0 },
          ],
        },
      ],
    }),
    [summary],
  );

  const authOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "item" },
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["54%", "76%"],
          center: ["50%", "44%"],
          label: { show: false },
          data: [
            { name: "通过", value: summary?.auth.granted ?? 0 },
            { name: "拒绝", value: summary?.auth.denied ?? 0 },
          ],
        },
      ],
    }),
    [summary],
  );

  const activeNodes = summary?.nodes.filter((node) => node.active).length ?? 0;
  const healthyNodes =
    summary?.nodes.filter((node) => node.active && node.healthy).length ?? 0;

  if (loading && !summary && !error) {
    return (
      <ConsoleShell
        title="管理台总览"
        subtitle="订阅、在线与节点运行状态"
        scope="Operations"
        navItems={adminNav}
        requireRole="admin"
      >
        <PageSkeleton variant="dashboard" />
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title="管理台总览"
      subtitle="订阅、在线与节点运行状态"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge success">
          {healthyNodes}/{activeNodes} 个启用节点健康
        </span>
      }
      toolbarActions={
        <button
          className="toolbar-button"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          <Icon name="refresh" />
          刷新数据
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}

      <section className="metric-grid admin-primary-metrics">
        <MetricCard
          label="今日流量"
          value={formatBytes(summary?.metrics.todayPhysicalBytes ?? 0)}
          footnote="北京时间 · 双向物理流量"
        />
        <MetricCard
          label="昨日流量"
          value={formatBytes(summary?.metrics.yesterdayPhysicalBytes ?? 0)}
          footnote="完整自然日"
        />
        <MetricCard
          label="本月流量"
          value={formatBytes(summary?.metrics.monthPhysicalBytes ?? 0)}
          footnote="本月累计双向流量"
        />
        <MetricCard
          label="当前订阅用户"
          value={String(summary?.metrics.activePlanSubscribers ?? 0)}
          footnote="有效套餐用户去重"
        />
        <MetricCard
          label="在线用户"
          value={String(summary?.metrics.onlineUsers ?? 0)}
          footnote={`${summary?.metrics.activeConnections ?? 0} 条活跃连接`}
        />
      </section>

      <section className="admin-chart-grid">
        <Panel title="近 14 天流量趋势" copy="按北京时间汇总上传与下载流量。">
          <EChart
            option={trafficOption}
            height={320}
            ariaLabel="近十四天流量趋势"
          />
        </Panel>
        <Panel title="本月节点流量排行" copy="按双向物理流量从高到低排列。">
          <EChart
            option={nodeTrafficOption}
            height={320}
            ariaLabel="节点流量排行"
          />
        </Panel>
      </section>

      <section className="admin-overview-row">
        <Panel title="订阅状态" copy="当前订阅状态分布">
          <EChart option={statusOption} height={240} ariaLabel="订阅状态分布" />
        </Panel>
        <Panel title="鉴权结果" copy="最近 24 小时">
          <EChart option={authOption} height={240} ariaLabel="鉴权结果分布" />
        </Panel>
        <Panel title="快捷操作" copy="常用管理入口">
          <div className="admin-quick-actions">
            <Link href="/admin/customers">
              <Icon name="group" />
              <span>
                <strong>客户管理</strong>
                <small>查看权益与在线状态</small>
              </span>
              <b>›</b>
            </Link>
            <Link href="/admin/operations">
              <Icon name="monitoring" />
              <span>
                <strong>运营监控</strong>
                <small>实时在线、流量和告警</small>
              </span>
              <b>›</b>
            </Link>
            <Link href="/admin/nodes">
              <Icon name="hub" />
              <span>
                <strong>节点管理</strong>
                <small>启停与运行状态</small>
              </span>
              <b>›</b>
            </Link>
            <Link href="/admin/finance">
              <Icon name="payments" />
              <span>
                <strong>财务中心</strong>
                <small>收入、退款与年度回本</small>
              </span>
              <b>›</b>
            </Link>
          </div>
        </Panel>
      </section>

      <Panel title="节点运行概览" copy="在线数据超过 45 秒会视为过期。">
        <DataTable
          loading={loading}
          error={error}
          onRetry={() => void load()}
          emptyText="暂无节点"
          headers={[
            "服务器",
            "节点",
            "协议",
            "状态",
            "本月流量",
            "在线用户",
            "活跃连接",
            "最近流量",
          ]}
          rows={(summary?.nodes ?? []).map((node) => [
            node.serverName,
            <strong key={`${node.id}-label`}>{node.label}</strong>,
            protocolLabel(node.protocol),
            <span
              key={`${node.id}-status`}
              className={`badge ${!node.active ? "neutral" : node.healthy ? "success" : "danger"}`}
            >
              {!node.active ? "已停用" : node.healthy ? "健康" : "异常"}
            </span>,
            formatBytes(node.physicalBytes),
            String(node.onlineUsers),
            String(node.activeConnections),
            node.lastSeenAt ? formatDateTime(node.lastSeenAt) : "暂无记录",
          ])}
        />
      </Panel>

      {summary ? (
        <div className="fine-print admin-dashboard-footnote">
          更新于 {formatDateTime(summary.generatedAt)} · 在线数据新鲜度 {summary.freshnessSeconds} 秒
        </div>
      ) : null}
    </ConsoleShell>
  );
}
