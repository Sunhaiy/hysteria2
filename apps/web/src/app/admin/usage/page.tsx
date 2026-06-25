"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { UsageRollupRecord } from "@/lib/types";

const PAGE_SIZE = 20;

export default function AdminUsagePage() {
  const { token } = useAuth();
  const [usage, setUsage] = useState<UsageRollupRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextUsage = await apiRequest<UsageRollupRecord[]>("/api/admin/usage", {
        token,
      });
      setPage(0);
      setUsage(nextUsage);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "用量日志加载失败。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  return (
    <ConsoleShell
      title="用量日志"
      subtitle="查看最近同步入库的流量数据和对应节点"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">{usage.length} 条日志</span>}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}

      <Panel
        title="最近流量桶"
        copy="来源于 /traffic 清零同步后的落库记录。"
        action={
          <div className="toolbar-actions">
            <button
              className="ghost-button compact"
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一页
            </button>
            <span className="fine-print">第 {page + 1} / {Math.max(1, Math.ceil(usage.length / PAGE_SIZE))} 页</span>
            <button
              className="ghost-button compact"
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= usage.length}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        }
      >
        {loading && usage.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}
          </div>
        ) : (
          <DataTable
            headers={["用户", "节点", "上传", "下载", "来源", "时间"]}
            rows={usage.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => [
              item.userEmail,
              item.nodeLabel,
              formatBytes(item.txBytes),
              formatBytes(item.rxBytes),
              item.source,
              formatDateTime(item.bucketStart),
            ])}
          />
        )}
      </Panel>
    </ConsoleShell>
  );
}
