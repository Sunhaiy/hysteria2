"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { PortalUsageResponse } from "@/lib/types";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
const PAGE_SIZE = 8;

export default function PortalUsagePage() {
  const { token } = useAuth();
  const [usage, setUsage] = useState<PortalUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const nextUsage = await apiRequest<PortalUsageResponse>("/api/portal/usage", {
        token,
      });
      setUsage(nextUsage);
      setPage(1);
      setEmptyState(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setUsage(null);
        setEmptyState(true);
        return;
      }
      setError(cause instanceof ApiError ? cause.message : "流量记录加载失败。");
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const totalRecords = usage?.recent.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const pageRecords =
    usage?.recent.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? [];

  return (
    <ConsoleShell
      title="流量使用"
      subtitle="查看基础流量、流量包剩余量和最近同步进来的用量"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      dataViewport
      toolbarMeta={usage ? <span className="badge info">{totalRecords} 条计费记录</span> : null}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}

      {!usage && !emptyState && !error ? (
        <PageSkeleton variant="dashboard" />
      ) : null}

      {usage ? (
        <div className="page-stack admin-data-page portal-usage-page">
          <section className="metric-grid admin-data-metrics">
            <MetricCard label="已用流量" value={formatBytes(usage.consumedBytes)} footnote="基础套餐已消耗部分" />
            <MetricCard label="基础剩余" value={usage.baseRemainingBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(usage.baseRemainingBytes)} footnote="先从基础额度扣减" />
            <MetricCard label="流量包剩余" value={formatBytes(usage.packRemainingBytes)} footnote="额外叠加权益" />
            <MetricCard label="总剩余" value={usage.totalRemainingBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(usage.totalRemainingBytes)} footnote="鉴权时按这个值决定是否允许接入" />
          </section>

          <Panel
            className="admin-data-panel"
            title="近 7 日节点计费流量"
            copy="按北京时间聚合，页面仅展示最终从额度中扣除的计费流量。"
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
                page,
                pageSize: PAGE_SIZE,
                total: totalRecords,
                totalPages,
                onPageChange: setPage,
              }}
            />
          </Panel>
        </div>
      ) : emptyState ? (
        <Panel title="还没有可统计的流量" copy="当前账号还没有生效中的套餐，所以暂时没有流量记录。先去兑换中心开通套餐，系统才会开始统计接入和用量。">
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
