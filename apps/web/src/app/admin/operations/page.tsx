"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomerLink } from "@/components/customer-link";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
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
type ServerTrafficDay = {
  date: string;
  txBytes: number;
  rxBytes: number;
  physicalBytes: number;
};
type ServerTraffic = {
  month: string;
  today: string;
  range: { from: string; to: string };
  totals: {
    txBytes: number;
    rxBytes: number;
    physicalBytes: number;
    todayPhysicalBytes: number;
  };
  dates: string[];
  servers: Array<{
    id: string;
    name: string;
    txBytes: number;
    rxBytes: number;
    physicalBytes: number;
    days: ServerTrafficDay[];
  }>;
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
function currentShanghaiMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export default function OperationsPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [presence, setPresence] = useState(emptyPage<Presence>);
  const [serverTraffic, setServerTraffic] = useState<ServerTraffic | null>(
    null,
  );
  const [alerts, setAlerts] = useState(emptyPage<Alert>);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [trafficMonth, setTrafficMonth] = useState(currentShanghaiMonth);
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
          setServerTraffic(
            await apiRequest<ServerTraffic>(
              `/api/admin/operations/traffic/servers?month=${trafficMonth}`,
              { token, signal },
            ),
          );
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
    [debouncedSearch, page, tab, token, trafficMonth],
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

  const activePage = tab === "presence" ? presence : alerts;
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
      dataViewport={tab === "presence" || tab === "traffic" || tab === "alerts"}
      toolbarMeta={
        <span className="badge info">
          {tab === "traffic" ? "双向物理流量" : "在线数据 45 秒过期"}
        </span>
      }
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
      <div className="page-stack admin-data-page">
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
            className="admin-data-panel"
            title="实时在线"
            action={
              <input
                className="control admin-table-search"
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
                <CustomerLink
                  id={item.userId}
                  displayName={item.userDisplayName}
                  email={item.userEmail}
                  key={item.id}
                />,
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
            <div className="operations-traffic-toolbar">
              <label className="field">
                <span className="fine-print">统计月份</span>
                <input
                  className="control"
                  type="month"
                  value={trafficMonth}
                  onChange={(event) => setTrafficMonth(event.target.value)}
                />
              </label>
              <span className="fine-print">
                按北京时间自然月统计，历史月份可随时回看
              </span>
            </div>
            <div className="metric-grid admin-data-metrics operations-traffic-metrics">
              <MetricCard
                label="本月真实流量"
                value={formatBytes(serverTraffic?.totals.physicalBytes ?? 0)}
                footnote={`${trafficMonth} · 全部服务器双向合计`}
              />
              <MetricCard
                label="今日真实流量"
                value={formatBytes(
                  serverTraffic?.totals.todayPhysicalBytes ?? 0,
                )}
                footnote={serverTraffic?.today ?? "北京时间今日"}
              />
              <MetricCard
                label="本月上行"
                value={formatBytes(serverTraffic?.totals.txBytes ?? 0)}
                footnote="所有 HY2 与 VLESS 端点"
              />
              <MetricCard
                label="本月下行"
                value={formatBytes(serverTraffic?.totals.rxBytes ?? 0)}
                footnote={`${serverTraffic?.servers.length ?? 0} 台物理服务器`}
              />
            </div>
            <div className="operations-traffic-layout">
              <Panel className="admin-data-panel" title="本月服务器汇总">
                <DataTable
                  loading={loading}
                  emptyText="本月暂无服务器流量"
                  minimumColumnWidth={84}
                  headers={["服务器", "上行", "下行", "双向合计", "今日"]}
                  rows={(serverTraffic?.servers ?? []).map((server) => [
                    <strong key={server.id}>{server.name}</strong>,
                    formatBytes(server.txBytes),
                    formatBytes(server.rxBytes),
                    formatBytes(server.physicalBytes),
                    formatBytes(
                      server.days.find(
                        (day) => day.date === serverTraffic?.today,
                      )?.physicalBytes ?? 0,
                    ),
                  ])}
                />
              </Panel>
              <Panel className="admin-data-panel" title="每日服务器真实流量">
                <DataTable
                  loading={loading}
                  headers={[
                    "日期",
                    ...(serverTraffic?.servers.map((server) => server.name) ??
                      []),
                    "当日合计",
                  ]}
                  rows={(serverTraffic?.dates ?? [])
                    .slice()
                    .reverse()
                    .map((date) => {
                      const values = (serverTraffic?.servers ?? []).map(
                        (server) =>
                          server.days.find((day) => day.date === date)
                            ?.physicalBytes ?? 0,
                      );
                      return [
                        <strong key={date}>{date.replaceAll("-", ".")}</strong>,
                        ...values.map((bytes) => formatBytes(bytes)),
                        formatBytes(
                          values.reduce((sum, bytes) => sum + bytes, 0),
                        ),
                      ];
                    })}
                />
              </Panel>
            </div>
          </>
        ) : null}
        {tab === "alerts" ? (
          <Panel className="admin-data-panel" title="告警">
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
