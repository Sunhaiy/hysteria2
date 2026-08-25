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
import type { PaginatedResponse } from "@/lib/types";

type Tab = "overview" | "presence" | "traffic" | "alerts";
type NodeSummary = {
  id: string;
  serverName: string;
  label: string;
  protocol: string;
  lifecycleStatus: string;
  healthy?: boolean | null;
  latencyMs?: number | null;
  onlineUsers: number;
  checkedAt?: string | null;
  error?: string | null;
};
type Summary = {
  generatedAt: string;
  freshnessSeconds: number;
  onlineAccounts: number;
  onlineClients: number;
  openAlerts: number;
  criticalAlerts: number;
  nodes: NodeSummary[];
};
type Presence = {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  nodeLabel: string;
  serverName: string;
  protocol: string;
  concurrentClients: number;
  observedAt: string;
};
type TrafficOverview = {
  totals: {
    physicalBytes: number;
    accountedBytes: number;
    allocatedBytes: number;
    overageBytes: number;
    records: number;
  };
  trend: Array<{
    date: string;
    physicalBytes: number;
    accountedBytes: number;
    allocatedBytes: number;
  }>;
  rankings: { users: Ranking[]; products: Ranking[]; nodes: Ranking[] };
};
type Ranking = { id: string; name: string; bytes: number };
type TrafficDetail = {
  id: string;
  bucketStart: string;
  userEmail: string;
  nodeLabel: string;
  physicalBytes: number;
  accountedBytes: number;
  allocatedBytes: number;
  overageBytes: number;
  allocations: Array<{ productName: string; accountedBytes: number }>;
};
type Alert = {
  id: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  nodeLabel?: string | null;
  failureCount: number;
  successCount: number;
  lastSeenAt: string;
  acknowledgedByEmail?: string | null;
};

const emptyPage = <T,>(): PaginatedResponse<T> => ({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
});
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export default function OperationsPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [presence, setPresence] = useState(emptyPage<Presence>);
  const [trafficOverview, setTrafficOverview] =
    useState<TrafficOverview | null>(null);
  const [trafficDetails, setTrafficDetails] = useState(
    emptyPage<TrafficDetail>,
  );
  const [alerts, setAlerts] = useState(emptyPage<Alert>);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [from, setFrom] = useState(() =>
    isoDate(new Date(Date.now() - 30 * 86400000)),
  );
  const [to, setTo] = useState(() => isoDate(new Date(Date.now() + 86400000)));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("tab");
      if (
        requested === "presence" ||
        requested === "traffic" ||
        requested === "alerts"
      )
        setTab(requested);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        if (tab === "overview") {
          setSummary(
            await apiRequest<Summary>("/api/admin/operations/summary", {
              token,
              signal,
            }),
          );
        } else if (tab === "presence") {
          const query = new URLSearchParams({
            page: String(page),
            pageSize: "20",
          });
          if (debouncedSearch) query.set("q", debouncedSearch);
          setPresence(
            await apiRequest<PaginatedResponse<Presence>>(
              `/api/admin/operations/presence?${query}`,
              { token, signal },
            ),
          );
        } else if (tab === "traffic") {
          const query = new URLSearchParams({
            from,
            to,
            page: String(page),
            pageSize: "20",
          });
          const [nextOverview, nextDetails] = await Promise.all([
            apiRequest<TrafficOverview>(
              `/api/admin/operations/traffic/overview?${query}`,
              { token, signal },
            ),
            apiRequest<PaginatedResponse<TrafficDetail>>(
              `/api/admin/operations/traffic/details?${query}`,
              { token, signal },
            ),
          ]);
          setTrafficOverview(nextOverview);
          setTrafficDetails(nextDetails);
        } else {
          setAlerts(
            await apiRequest<PaginatedResponse<Alert>>(
              `/api/admin/operations/alerts?page=${page}&pageSize=20`,
              { token, signal },
            ),
          );
        }
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof ApiError ? cause.message : "运营数据加载失败。",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [debouncedSearch, from, page, tab, to, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    const interval = window.setInterval(
      () => void load(controller.signal),
      tab === "presence" || tab === "overview" ? 10000 : 60000,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load, reloadKey, tab]);

  function changeTab(next: Tab) {
    setTab(next);
    setPage(1);
    window.history.replaceState(null, "", `/admin/operations?tab=${next}`);
  }

  async function requestCheck() {
    if (!token) return;
    setBusy(true);
    try {
      await apiRequest("/api/admin/operations/checks", {
        method: "POST",
        token,
      });
      setReloadKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "检查请求失败。");
    } finally {
      setBusy(false);
    }
  }

  async function kick(userId: string) {
    if (!token || !window.confirm("确认踢出该账号在所有可用节点上的当前连接？"))
      return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/operations/presence/${userId}/kick`, {
        method: "POST",
        token,
      });
      setReloadKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "踢线失败。");
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/operations/alerts/${id}/acknowledge`, {
        method: "PATCH",
        token,
      });
      setReloadKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "告警确认失败。");
    } finally {
      setBusy(false);
    }
  }

  const trafficChart = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "axis" },
      legend: { data: ["物理流量", "计费流量", "额度扣除"] },
      xAxis: {
        type: "category",
        data: trafficOverview?.trend.map((item) => item.date) ?? [],
      },
      yAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: number) => `${(value / 1024 ** 3).toFixed(0)} GB`,
        },
      },
      series: [
        {
          name: "物理流量",
          type: "line",
          smooth: true,
          data: trafficOverview?.trend.map((item) => item.physicalBytes) ?? [],
        },
        {
          name: "计费流量",
          type: "line",
          smooth: true,
          data: trafficOverview?.trend.map((item) => item.accountedBytes) ?? [],
        },
        {
          name: "额度扣除",
          type: "bar",
          data: trafficOverview?.trend.map((item) => item.allocatedBytes) ?? [],
        },
      ],
    }),
    [trafficOverview],
  );
  const rankingRows = (items: Ranking[]) =>
    items.map((item, index) => [
      String(index + 1),
      item.name,
      formatBytes(item.bytes),
    ]);
  const activePage =
    tab === "presence" ? presence : tab === "traffic" ? trafficDetails : alerts;
  const pagination = {
    page: activePage.page,
    pageSize: activePage.pageSize,
    total: activePage.total,
    totalPages: activePage.totalPages,
    onPageChange: setPage,
  };

  return (
    <ConsoleShell
      title="运营中心"
      subtitle="节点健康、实时在线、流量与告警"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">在线数据 45 秒过期</span>}
      toolbarActions={
        <button
          className="action-button"
          type="button"
          disabled={busy}
          onClick={() => void requestCheck()}
        >
          <Icon name="refresh" />
          立即检查
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="page-stack">
        <div className="segmented-control" aria-label="运营视图">
          {(
            [
              ["overview", "概览"],
              ["presence", "实时在线"],
              ["traffic", "流量"],
              ["alerts", "告警"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? "active" : ""}
              onClick={() => changeTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "overview" ? (
          <>
            <div className="metric-grid">
              <MetricCard
                label="在线账号"
                value={String(summary?.onlineAccounts ?? 0)}
                footnote="当前状态投影"
              />
              <MetricCard
                label="在线连接"
                value={String(summary?.onlineClients ?? 0)}
                footnote="不采集具体 IP"
              />
              <MetricCard
                label="开放告警"
                value={String(summary?.openAlerts ?? 0)}
                footnote="连续两次失败开启"
              />
              <MetricCard
                label="严重告警"
                value={String(summary?.criticalAlerts ?? 0)}
                footnote="连续两次成功恢复"
              />
            </div>
            <Panel title="协议端点状态">
              <DataTable
                loading={loading}
                error={error}
                onRetry={() => setReloadKey((value) => value + 1)}
                emptyText="暂无节点"
                headers={[
                  "服务器",
                  "端点",
                  "协议",
                  "生命周期",
                  "健康",
                  "在线",
                  "检查时间",
                ]}
                rows={(summary?.nodes ?? []).map((node) => [
                  node.serverName,
                  node.label,
                  node.protocol === "vless_reality"
                    ? "VLESS + Reality"
                    : "Hysteria2",
                  node.lifecycleStatus,
                  <span
                    className={`badge ${node.healthy === true ? "success" : node.healthy === false ? "danger" : "neutral"}`}
                    key={node.id}
                    title={node.error ?? undefined}
                  >
                    {node.healthy === true
                      ? `${node.latencyMs ?? 0} ms`
                      : node.healthy === false
                        ? "异常"
                        : "未知"}
                  </span>,
                  node.onlineUsers,
                  node.checkedAt ? formatDateTime(node.checkedAt) : "尚未检查",
                ])}
              />
            </Panel>
          </>
        ) : null}
        {tab === "presence" ? (
          <Panel
            title="实时在线"
            action={
              <input
                className="control"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索账号"
              />
            }
          >
            <DataTable
              loading={loading}
              error={error}
              onRetry={() => setReloadKey((value) => value + 1)}
              pagination={pagination}
              emptyText="当前没有在线连接"
              headers={[
                "账号",
                "服务器",
                "协议端点",
                "连接数",
                "最后在线",
                "操作",
              ]}
              rows={presence.items.map((item) => [
                <span className="list" key={item.id}>
                  <strong>{item.userDisplayName}</strong>
                  <small>{item.userEmail}</small>
                </span>,
                item.serverName,
                `${item.protocol === "vless_reality" ? "VLESS + Reality" : "Hysteria2"} · ${item.nodeLabel}`,
                item.concurrentClients,
                formatDateTime(item.observedAt),
                <button
                  className="ghost-button compact"
                  disabled={busy}
                  type="button"
                  key={`${item.id}-kick`}
                  onClick={() => void kick(item.userId)}
                >
                  踢线
                </button>,
              ])}
            />
          </Panel>
        ) : null}
        {tab === "traffic" ? (
          <>
            <Panel
              title="查询区间"
              action={
                <button
                  className="toolbar-button"
                  type="button"
                  onClick={() =>
                    void apiDownload(
                      `/api/admin/traffic/export?from=${from}&to=${to}`,
                      "traffic-analysis.csv",
                    )
                  }
                >
                  <Icon name="download" />
                  导出
                </button>
              }
            >
              <div className="inline-form">
                <input
                  className="control"
                  aria-label="开始日期"
                  type="date"
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    setPage(1);
                  }}
                />
                <input
                  className="control"
                  aria-label="结束日期"
                  type="date"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </Panel>
            <div className="metric-grid">
              <MetricCard
                label="物理流量"
                value={formatBytes(trafficOverview?.totals.physicalBytes ?? 0)}
                footnote="节点实际上下行"
              />
              <MetricCard
                label="计费流量"
                value={formatBytes(trafficOverview?.totals.accountedBytes ?? 0)}
                footnote="应用用户倍率后"
              />
              <MetricCard
                label="额度扣除"
                value={formatBytes(trafficOverview?.totals.allocatedBytes ?? 0)}
                footnote="按权益桶分摊"
              />
              <MetricCard
                label="超额流量"
                value={formatBytes(trafficOverview?.totals.overageBytes ?? 0)}
                footnote="无额度承接"
              />
            </div>
            <Panel title="时间趋势">
              <EChart
                option={trafficChart}
                height={300}
                ariaLabel="流量时间趋势"
              />
            </Panel>
            <div className="two-col">
              <Panel title="用户排行">
                <DataTable
                  headers={["#", "客户", "计费流量"]}
                  rows={rankingRows(trafficOverview?.rankings.users ?? [])}
                />
              </Panel>
              <Panel title="商品排行">
                <DataTable
                  headers={["#", "商品", "额度扣除"]}
                  rows={rankingRows(trafficOverview?.rankings.products ?? [])}
                />
              </Panel>
              <Panel title="节点排行">
                <DataTable
                  headers={["#", "节点", "物理流量"]}
                  rows={rankingRows(trafficOverview?.rankings.nodes ?? [])}
                />
              </Panel>
            </div>
            <Panel title="计费明细">
              <DataTable
                loading={loading}
                error={error}
                onRetry={() => setReloadKey((value) => value + 1)}
                pagination={pagination}
                emptyText="该区间暂无流量"
                headers={[
                  "时间",
                  "客户",
                  "节点",
                  "物理",
                  "计费",
                  "扣除",
                  "超额",
                  "商品分摊",
                ]}
                rows={trafficDetails.items.map((item) => [
                  formatDateTime(item.bucketStart),
                  item.userEmail,
                  item.nodeLabel,
                  formatBytes(item.physicalBytes),
                  formatBytes(item.accountedBytes),
                  formatBytes(item.allocatedBytes),
                  formatBytes(item.overageBytes),
                  item.allocations
                    .map(
                      (allocation) =>
                        `${allocation.productName} ${formatBytes(allocation.accountedBytes)}`,
                    )
                    .join(" · ") || "-",
                ])}
              />
            </Panel>
          </>
        ) : null}
        {tab === "alerts" ? (
          <Panel title="告警">
            <DataTable
              loading={loading}
              error={error}
              onRetry={() => setReloadKey((value) => value + 1)}
              pagination={pagination}
              emptyText="暂无告警"
              headers={[
                "级别",
                "告警",
                "对象",
                "失败 / 恢复",
                "最后出现",
                "状态",
                "操作",
              ]}
              rows={alerts.items.map((alert) => [
                <span
                  className={`badge ${alert.severity === "critical" ? "danger" : "warn"}`}
                  key={`${alert.id}-severity`}
                >
                  {alert.severity === "critical" ? "严重" : "警告"}
                </span>,
                <span className="list" key={`${alert.id}-title`}>
                  <strong>{alert.title}</strong>
                  <small>{alert.message}</small>
                </span>,
                alert.nodeLabel ?? "全局",
                `${alert.failureCount} / ${alert.successCount}`,
                formatDateTime(alert.lastSeenAt),
                alert.status,
                alert.status === "open" ? (
                  <button
                    className="ghost-button compact"
                    disabled={busy}
                    type="button"
                    key={`${alert.id}-ack`}
                    onClick={() => void acknowledge(alert.id)}
                  >
                    确认
                  </button>
                ) : (
                  (alert.acknowledgedByEmail ?? "-")
                ),
              ])}
            />
          </Panel>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
