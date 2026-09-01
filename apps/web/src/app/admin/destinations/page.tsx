"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";
import type {
  AdminUser,
  DestinationTelemetryStatus,
  DestinationVisitRecord,
  DestinationVisitResponse,
} from "@/lib/types";

type DestinationFilters = {
  q: string;
  userId: string;
  nodeId: string;
  transport: string;
  from: string;
  to: string;
};

const emptyFilters: DestinationFilters = {
  q: "",
  userId: "",
  nodeId: "",
  transport: "",
  from: "",
  to: "",
};

function buildVisitQuery(filters: DestinationFilters, cursor?: string | null) {
  const params = new URLSearchParams({ limit: "100" });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.nodeId) params.set("nodeId", filters.nodeId);
  if (filters.transport) params.set("transport", filters.transport);
  if (filters.from)
    params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to)
    params.set("to", new Date(`${filters.to}T23:59:59.999`).toISOString());
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export default function AdminDestinationsPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<DestinationTelemetryStatus | null>(null);
  const [visits, setVisits] = useState<DestinationVisitRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [transport, setTransport] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const appliedFilters = useRef<DestinationFilters>(emptyFilters);

  const loadVisits = useCallback(
    async (cursor?: string | null, filters = appliedFilters.current) => {
      if (!token) return;
      const append = Boolean(cursor);
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await apiRequest<DestinationVisitResponse>(
          `/api/admin/destination-visits?${buildVisitQuery(filters, cursor)}`,
          { token },
        );
        setStatus(result.status);
        setVisits((current) =>
          append ? [...current, ...result.items] : result.items,
        );
        setTotal(result.total);
        setNextCursor(result.nextCursor);
      } catch (cause) {
        setError(
          cause instanceof ApiError ? cause.message : "访问记录加载失败。",
        );
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [token],
  );

  const loadPage = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const usersResult = await apiRequest<{ items: AdminUser[] }>(
      "/api/admin/users?limit=200",
      { token },
    ).catch(() => null);
    setUsers(usersResult?.items.filter((user) => user.role === "member") ?? []);
    await loadVisits();
  }, [loadVisits, token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadPage(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadPage]);

  async function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters = { q, userId, nodeId, transport, from, to };
    appliedFilters.current = filters;
    await loadVisits(null, filters);
  }

  if (loading && !status && visits.length === 0 && !error) {
    return (
      <ConsoleShell
        title="访问审计"
        subtitle="查询会员连接的目标域名或 IP，并检查各节点遥测上报状态。"
        scope="Security"
        navItems={adminNav}
        requireRole="admin"
      >
        <PageSkeleton variant="table" />
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title="访问审计"
      subtitle="查询会员连接的目标域名或 IP，并检查各节点遥测上报状态。"
      scope="Security"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className={`badge ${status?.enabled ? "success" : "warn"}`}>
          {status?.enabled ? "遥测完整" : "遥测未就绪"}
        </span>
      }
      toolbarActions={
        <button
          className="toolbar-button"
          type="button"
          onClick={() => void loadPage()}
        >
          <Icon name="refresh" />
          刷新
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}

      <div className="page-stack">
        <Panel
          title="节点遥测状态"
          copy="只有所有活动节点都在两分钟内成功上报时，访问记录查询才会返回数据。"
        >
          {status?.nodes.length ? (
            <DataTable
              headers={["节点", "协议", "代理版本", "最后上报", "状态"]}
              rows={status.nodes.map((node) => [
                node.label,
                node.protocol,
                node.version ?? "-",
                node.lastAt ? formatDateTime(node.lastAt) : "从未上报",
                <span
                  className={`badge ${node.ready ? "success" : node.error ? "danger" : "warn"}`}
                  key={`${node.id}-status`}
                  title={node.error ?? undefined}
                >
                  {node.ready
                    ? "正常"
                    : node.error
                      ? "异常"
                      : node.enabled
                        ? "已过期"
                        : "未启用"}
                </span>,
              ])}
            />
          ) : !loading ? (
            <div className="empty-state">
              <div className="empty-state-title">没有活动节点。</div>
            </div>
          ) : null}
        </Panel>

        <Panel
          title="目的地记录"
          copy={`当前筛选共 ${total} 条分钟级聚合记录，不采集 URL 路径或通信内容。`}
        >
          <form
            className="admin-filter-bar destination-filter-bar"
            onSubmit={submitFilters}
          >
            <label className="field grow-field">
              <span className="fine-print">域名或 IP</span>
              <input
                className="control"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="搜索目标"
              />
            </label>
            <label className="field">
              <span className="fine-print">会员</span>
              <CustomSelect
                value={userId}
                onChange={setUserId}
                options={[
                  { value: "", label: "全部会员" },
                  ...users.map((user) => ({
                    value: user.id,
                    label: user.displayName || user.email,
                  })),
                ]}
              />
            </label>
            <label className="field">
              <span className="fine-print">节点</span>
              <CustomSelect
                value={nodeId}
                onChange={setNodeId}
                options={[
                  { value: "", label: "全部节点" },
                  ...(status?.nodes ?? []).map((node) => ({
                    value: node.id,
                    label: node.label,
                  })),
                ]}
              />
            </label>
            <label className="field">
              <span className="fine-print">传输协议</span>
              <CustomSelect
                value={transport}
                onChange={setTransport}
                options={[
                  { value: "", label: "TCP + UDP" },
                  { value: "tcp", label: "TCP" },
                  { value: "udp", label: "UDP" },
                ]}
              />
            </label>
            <label className="field">
              <span className="fine-print">开始日期</span>
              <input
                className="control"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="fine-print">结束日期</span>
              <input
                className="control"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <button className="action-button" type="submit" disabled={loading}>
              查询
            </button>
          </form>

          {visits.length ? (
            <>
              <DataTable
                headers={["时间", "会员", "目标", "连接", "节点", "协议"]}
                rows={visits.map((visit) => [
                  formatDateTime(visit.bucketStart),
                  <span className="list" key={`${visit.id}-user`}>
                    <strong>{visit.userDisplayName}</strong>
                    <small className="muted">{visit.userEmail}</small>
                  </span>,
                  <span className="mono" key={`${visit.id}-target`}>
                    {visit.target}:{visit.port}
                  </span>,
                  `${visit.connectionCount} 次`,
                  visit.nodeLabel,
                  `${visit.transport.toUpperCase()} · ${visit.targetType === "domain" ? "域名" : "IP"}`,
                ])}
              />
              {nextCursor ? (
                <div className="toolbar-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadVisits(nextCursor)}
                  >
                    {loadingMore ? "加载中..." : "加载更多"}
                  </button>
                </div>
              ) : null}
            </>
          ) : !loading ? (
            <div className="empty-state">
              <div className="empty-state-title">
                {status?.enabled
                  ? "当前筛选没有访问记录。"
                  : "遥测尚未就绪，暂不开放查询。"}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>
    </ConsoleShell>
  );
}
