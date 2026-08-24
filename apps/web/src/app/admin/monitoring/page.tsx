"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";

type Monitoring = {
  checkIntervalSeconds: number; open: number; acknowledged: number; critical: number; activePools: number;
  nodes: Array<{ id: string; label: string; lifecycleStatus: string; healthy?: boolean | null; onlineUsers: number; syncDelaySeconds?: number | null; checkedAt?: string | null }>;
  alerts: Array<{ id: string; kind: string; severity: string; status: string; title: string; message: string; nodeLabel?: string | null; failureCount: number; successCount: number; lastSeenAt: string; acknowledgedByEmail?: string | null }>;
};

export default function MonitoringPage() {
  const { token } = useAuth();
  const [data, setData] = useState<Monitoring | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await apiRequest<Monitoring>("/api/admin/monitoring", { token })); setError(null); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "监控数据加载失败。"); }
  }, [token]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 60000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [load]);

  async function runCheck() {
    if (!token) return;
    setBusy(true);
    try { await apiRequest("/api/admin/monitoring/check", { method: "POST", token }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "检查执行失败。"); }
    finally { setBusy(false); }
  }

  async function acknowledge(id: string) {
    if (!token) return;
    setBusy(true);
    try { await apiRequest(`/api/admin/monitoring/alerts/${id}/acknowledge`, { method: "PATCH", token }); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "告警确认失败。"); }
    finally { setBusy(false); }
  }

  return (
    <ConsoleShell title="监控告警" subtitle="服务状态、同步延迟与告警生命周期" scope="Monitoring" navItems={adminNav} requireRole="admin"
      toolbarMeta={<span className="badge info">每 {data?.checkIntervalSeconds ?? 60} 秒检查</span>}
      toolbarActions={<button className="action-button" disabled={busy} type="button" onClick={() => void runCheck()}><Icon name="refresh" />立即检查</button>}>
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard label="未确认告警" value={String(data?.open ?? 0)} footnote="连续两次失败才开启" />
          <MetricCard label="已确认" value={String(data?.acknowledged ?? 0)} footnote="仍在持续观察" />
          <MetricCard label="严重告警" value={String(data?.critical ?? 0)} footnote="开启与恢复发送邮件" />
          <MetricCard label="活动资源池" value={String(data?.activePools ?? 0)} footnote="可服务节点容量" />
        </div>
        <Panel title="当前告警" copy="OPEN → ACKNOWLEDGED → RESOLVED">
          <DataTable headers={["级别","告警","对象","失败 / 恢复","最后出现","状态","操作"]} rows={(data?.alerts ?? []).filter((alert) => alert.status !== "resolved").map((alert) => [
            <span className={`badge ${alert.severity === "critical" ? "danger" : "warn"}`} key={`${alert.id}-severity`}>{alert.severity === "critical" ? "严重" : "警告"}</span>,
            <span className="list" key={`${alert.id}-title`}><strong>{alert.title}</strong><small>{alert.message}</small></span>,
            alert.nodeLabel ?? "全局",
            `${alert.failureCount} / ${alert.successCount}`,
            formatDateTime(alert.lastSeenAt),
            <span className={`badge ${alert.status === "acknowledged" ? "info" : "danger"}`} key={`${alert.id}-status`}>{alert.status === "acknowledged" ? "已确认" : "待处理"}</span>,
            alert.status === "open" ? <button className="ghost-button compact" disabled={busy} type="button" key={`${alert.id}-ack`} onClick={() => void acknowledge(alert.id)}>确认</button> : <span key={`${alert.id}-owner`}>{alert.acknowledgedByEmail ?? "已确认"}</span>,
          ])} />
        </Panel>
        <Panel title="节点服务状态" copy="本期监控在线、同步、流量和遥测，不采集 CPU、内存与磁盘。">
          <DataTable headers={["节点","生命周期","服务状态","同步延迟","在线人数","检查时间"]} rows={(data?.nodes ?? []).map((node) => [
            node.label,
            node.lifecycleStatus,
            <span className={`badge ${node.healthy === true ? "success" : node.healthy === false ? "danger" : "neutral"}`} key={`${node.id}-health`}>{node.healthy === true ? "在线" : node.healthy === false ? "异常" : "未知"}</span>,
            node.syncDelaySeconds == null ? "-" : `${node.syncDelaySeconds}s`,
            node.onlineUsers,
            node.checkedAt ? formatDateTime(node.checkedAt) : "尚未检查",
          ])} />
        </Panel>
        <Panel title="最近恢复">
          <DataTable headers={["告警","对象","最后出现","状态"]} rows={(data?.alerts ?? []).filter((alert) => alert.status === "resolved").slice(0, 20).map((alert) => [alert.title, alert.nodeLabel ?? "全局", formatDateTime(alert.lastSeenAt), <span className="badge success" key={alert.id}>已恢复</span>])} />
        </Panel>
      </div>
    </ConsoleShell>
  );
}
