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

export default function AdminUsagePage() {
  const { token } = useAuth();
  const [usage, setUsage] = useState<UsageRollupRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

      <Panel title="最近流量桶" copy="来源于 /traffic 清零同步后的落库记录。">
        <DataTable
          headers={["用户", "节点", "上传", "下载", "来源", "时间"]}
          rows={usage.map((item) => [
            item.userEmail,
            item.nodeLabel,
            formatBytes(item.txBytes),
            formatBytes(item.rxBytes),
            item.source,
            formatDateTime(item.bucketStart),
          ])}
        />
      </Panel>
      {loading ? <div className="fine-print">正在刷新日志...</div> : null}
    </ConsoleShell>
  );
}
