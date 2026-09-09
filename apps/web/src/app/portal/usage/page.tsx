"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { Icon } from "@/components/icon";
import { PageSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type {
  PortalNodeStatusResponse,
  PortalUsageResponse,
} from "@/lib/types";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
const MIN_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 20;

export default function PortalUsagePage() {
  const { token } = useAuth();
  const [usage, setUsage] = useState<PortalUsageResponse | null>(null);
  const [nodeStatus, setNodeStatus] = useState<PortalNodeStatusResponse | null>(
    null,
  );
  const [nodeStatusError, setNodeStatusError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MIN_PAGE_SIZE);
  const tableViewportRef = useRef<HTMLDivElement>(null);

  const loadNodeStatus = useCallback(async () => {
    if (!token) return;
    try {
      const status = await apiRequest<PortalNodeStatusResponse>(
        "/api/portal/node-status",
        { token },
      );
      setNodeStatus(status);
      setNodeStatusError(false);
    } catch {
      setNodeStatusError(true);
    }
  }, [token]);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const nextUsage = await apiRequest<PortalUsageResponse>(
        "/api/portal/usage",
        {
          token,
        },
      );
      setUsage(nextUsage);
      setPage(1);
      setEmptyState(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setUsage(null);
        setEmptyState(true);
        return;
      }
      setError(
        cause instanceof ApiError ? cause.message : "流量记录加载失败。",
      );
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
      void loadNodeStatus();
    }, 0);
    const intervalId = window.setInterval(() => {
      void loadNodeStatus();
    }, 60_000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [load, loadNodeStatus]);

  const totalRecords = usage?.recent.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
  const visiblePage = Math.min(page, totalPages);
  const pageRecords =
    usage?.recent.slice((visiblePage - 1) * pageSize, visiblePage * pageSize) ??
    [];

  useEffect(() => {
    const viewport = tableViewportRef.current;
    if (!viewport || !usage) return;

    const updatePageSize = () => {
      const tableHeader = viewport.querySelector("thead");
      const firstRow = viewport.querySelector("tbody tr");
      const headerHeight = tableHeader?.getBoundingClientRect().height ?? 39;
      const rowHeight = firstRow?.getBoundingClientRect().height ?? 41;
      const availableHeight = viewport.getBoundingClientRect().height;
      const rowsWithoutPagination = Math.floor(
        (availableHeight - headerHeight) / rowHeight,
      );
      const paginationHeight = totalRecords > rowsWithoutPagination ? 53 : 0;
      const nextPageSize = Math.max(
        MIN_PAGE_SIZE,
        Math.min(
          MAX_PAGE_SIZE,
          Math.floor(
            (availableHeight - headerHeight - paginationHeight) / rowHeight,
          ),
        ),
      );
      setPageSize((current) =>
        current === nextPageSize ? current : nextPageSize,
      );
    };

    updatePageSize();
    const observer = new ResizeObserver(updatePageSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [totalRecords, usage]);

  return (
    <ConsoleShell
      title="流量使用"
      subtitle="查看基础流量、流量包剩余量和最近同步进来的用量"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      dataViewport
      toolbarMeta={
        usage ? (
          <span className="badge info">{totalRecords} 条计费记录</span>
        ) : null
      }
      toolbarActions={
        <button
          className="toolbar-button"
          type="button"
          onClick={() => {
            void load();
            void loadNodeStatus();
          }}
        >
          刷新
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}

      {!usage && !emptyState && !error ? (
        <PageSkeleton variant="dashboard" />
      ) : null}

      {usage ? (
        <div className="page-stack admin-data-page portal-usage-page">
          <section className="metric-grid admin-data-metrics">
            <MetricCard
              label="已用流量"
              value={formatBytes(usage.consumedBytes)}
              footnote="基础套餐已消耗部分"
            />
            <MetricCard
              label="基础剩余"
              value={
                usage.baseRemainingBytes >= UNLIMITED_TRAFFIC
                  ? "无限流量"
                  : formatBytes(usage.baseRemainingBytes)
              }
              footnote="先从基础额度扣减"
            />
            <MetricCard
              label="流量包剩余"
              value={formatBytes(usage.packRemainingBytes)}
              footnote="额外叠加权益"
            />
            <MetricCard
              label="总剩余"
              value={
                usage.totalRemainingBytes >= UNLIMITED_TRAFFIC
                  ? "无限流量"
                  : formatBytes(usage.totalRemainingBytes)
              }
              footnote="鉴权时按这个值决定是否允许接入"
            />
          </section>

          <div className="portal-usage-detail-layout">
            <Panel
              className="admin-data-panel portal-usage-history-panel"
              title="近 7 日节点计费流量"
              copy="按北京时间聚合，仅展示最终从额度中扣除的计费流量。"
            >
              <div
                className="portal-usage-table-viewport"
                ref={tableViewportRef}
              >
                <DataTable
                  headers={["节点", "计费流量", "时间"]}
                  rows={pageRecords.map((item) => [
                    item.nodeLabel,
                    formatBytes(item.accountedBytes),
                    formatDateTime(item.bucketStart),
                  ])}
                  minimumColumnWidth={180}
                  pagination={{
                    page: visiblePage,
                    pageSize,
                    total: totalRecords,
                    totalPages,
                    onPageChange: setPage,
                  }}
                />
              </div>
            </Panel>

            <Panel
              className="admin-data-panel portal-node-status-panel"
              title="节点状态"
              copy="仅显示当前账号可用节点"
              action={
                nodeStatus ? (
                  <span
                    className={`badge ${
                      nodeStatus.diagnosis.kind === "local_network_likely"
                        ? "success"
                        : nodeStatus.diagnosis.kind === "service_issue"
                          ? "danger"
                          : "warn"
                    }`}
                  >
                    {nodeStatus.diagnosis.kind === "local_network_likely"
                      ? "正常"
                      : nodeStatus.diagnosis.kind === "service_issue"
                        ? "异常"
                        : "待确认"}
                  </span>
                ) : null
              }
            >
              {nodeStatus ? (
                <>
                  <div
                    className={`portal-node-diagnosis ${nodeStatus.diagnosis.kind}`}
                    role="status"
                  >
                    <Icon
                      name={
                        nodeStatus.diagnosis.kind === "local_network_likely"
                          ? "check"
                          : "warning"
                      }
                    />
                    <div>
                      <strong>{nodeStatus.diagnosis.title}</strong>
                      <p>{nodeStatus.diagnosis.message}</p>
                    </div>
                  </div>

                  <div className="portal-node-status-list">
                    {nodeStatus.nodes.map((node) => (
                      <div className="portal-node-status-row" key={node.id}>
                        <div className="portal-node-status-heading">
                          <strong>{node.label}</strong>
                          <span
                            className={`badge ${
                              node.status === "healthy"
                                ? "success"
                                : node.status === "unhealthy"
                                  ? "danger"
                                  : "warn"
                            }`}
                          >
                            {node.status === "healthy"
                              ? "服务正常"
                              : node.status === "unhealthy"
                                ? "服务异常"
                                : "状态过期"}
                          </span>
                        </div>
                        <div className="portal-node-status-meta">
                          <span>
                            {node.checkedAt
                              ? `检测 ${formatDateTime(node.checkedAt)}`
                              : "暂无检测记录"}
                          </span>
                          {node.latencyMs !== null ? (
                            <span>服务检测 {node.latencyMs} ms</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="portal-node-status-loading" role="status">
                  {nodeStatusError
                    ? "节点状态暂时无法获取，请稍后刷新。"
                    : "正在读取节点状态..."}
                </div>
              )}
            </Panel>
          </div>
        </div>
      ) : emptyState ? (
        <Panel
          title="还没有可统计的流量"
          copy="当前账号还没有生效中的套餐，所以暂时没有流量记录。先去兑换中心开通套餐，系统才会开始统计接入和用量。"
        >
          <div className="toolbar-actions">
            <Link className="action-button" href="/portal/redeem">
              去兑换中心
            </Link>
          </div>
        </Panel>
      ) : null}
    </ConsoleShell>
  );
}
