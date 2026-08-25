"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { Icon } from "@/components/icon";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";

type AuditRecord = {
  id: string;
  actorEmail?: string | null;
  actorDisplayName?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: {
    path?: string;
    success?: boolean;
    durationMs?: number;
    error?: string | null;
  };
  remoteAddr?: string | null;
  createdAt: string;
};

export default function AdminAuditPage() {
  const { token } = useAuth();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PaginatedResponse<AuditRecord>>({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (debouncedSearch) query.set("q", debouncedSearch);
      const result = await apiRequest<PaginatedResponse<AuditRecord>>(
        `/api/admin/audit-logs?${query}`,
        { token },
      );
      setRecords(result.items);
      setPageInfo(result);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "操作审计加载失败。",
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <ConsoleShell
      title="操作审计"
      subtitle="追踪管理端写操作的操作者、目标、结果和来源地址"
      scope="Security"
      navItems={adminNav}
      requireRole="admin"
      toolbarActions={
        <>
          <input
            className="control"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索操作、目标或操作者"
          />
          <button
            className="toolbar-button"
            type="button"
            onClick={() => void load()}
          >
            <Icon name="refresh" />
            刷新
          </button>
        </>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <Panel
        title="最近操作"
        copy="审计日志不保存请求正文，因此不会收集密码、OAuth/SMTP 密钥或节点控制密钥。"
      >
        {loading && records.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="skeleton skeleton-row" key={index} />
            ))}
          </div>
        ) : null}
        {records.length > 0 ? (
          <DataTable
            loading={loading}
            error={error}
            onRetry={() => void load()}
            pagination={{
              page: pageInfo.page,
              pageSize: pageInfo.pageSize,
              total: pageInfo.total,
              totalPages: pageInfo.totalPages,
              onPageChange: setPage,
            }}
            headers={["时间", "操作者", "操作", "目标", "结果", "来源"]}
            rows={records.map((record) => [
              formatDateTime(record.createdAt),
              record.actorDisplayName ?? record.actorEmail ?? "系统",
              record.metadata?.path ?? record.action,
              `${record.targetType}${record.targetId ? ` · ${record.targetId}` : ""}`,
              <span
                className={`badge ${record.metadata?.success === false ? "warn" : "success"}`}
                key={`${record.id}-result`}
                title={record.metadata?.error ?? undefined}
              >
                {record.metadata?.success === false ? "失败" : "成功"}
              </span>,
              record.remoteAddr ?? "-",
            ])}
          />
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-title">还没有管理操作记录</div>
          </div>
        ) : null}
      </Panel>
    </ConsoleShell>
  );
}
