"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { PortalUsageResponse } from "@/lib/types";

export default function PortalUsagePage() {
  const { token } = useAuth();
  const [usage, setUsage] = useState<PortalUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "流量记录加载失败。");
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
      title="流量使用"
      subtitle="查看基础流量、流量包剩余量和最近同步进来的用量"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={usage ? <span className="badge info">{usage.recent.length} 条最近记录</span> : null}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}

      {usage ? (
        <>
          <section className="metric-grid">
            <MetricCard label="已用流量" value={formatBytes(usage.consumedBytes)} footnote="基础套餐已消耗部分" />
            <MetricCard label="基础剩余" value={formatBytes(usage.baseRemainingBytes)} footnote="先从基础额度扣减" />
            <MetricCard label="流量包剩余" value={formatBytes(usage.packRemainingBytes)} footnote="额外叠加权益" />
            <MetricCard label="总剩余" value={formatBytes(usage.totalRemainingBytes)} footnote="鉴权时按这个值决定是否允许接入" />
          </section>

          <Panel title="最近同步记录" copy="以下为最近写入数据库的流量桶，不在前端本地计算。">
            <DataTable
              headers={["节点", "上传", "下载", "来源", "时间"]}
              rows={usage.recent.map((item) => [
                item.nodeLabel,
                formatBytes(item.txBytes),
                formatBytes(item.rxBytes),
                item.source,
                formatDateTime(item.bucketStart),
              ])}
            />
          </Panel>
        </>
      ) : null}
    </ConsoleShell>
  );
}
