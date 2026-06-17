"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type {
  AdminUser,
  AuthEventRecord,
  NodeRecord,
  PlanRecord,
  SubscriptionRecord,
} from "@/lib/types";
import { statusTone } from "@/lib/ui";

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [authEvents, setAuthEvents] = useState<AuthEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const [nextUsers, nextPlans, nextSubscriptions, nextNodes, nextEvents] =
        await Promise.all([
          apiRequest<AdminUser[]>("/api/admin/users", { token }),
          apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
          apiRequest<SubscriptionRecord[]>("/api/admin/subscriptions", { token }),
          apiRequest<NodeRecord[]>("/api/admin/nodes", { token }),
          apiRequest<AuthEventRecord[]>("/api/admin/auth-events", { token }),
        ]);

      setUsers(nextUsers);
      setPlans(nextPlans);
      setSubscriptions(nextSubscriptions);
      setNodes(nextNodes);
      setAuthEvents(nextEvents);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "管理台数据加载失败。",
      );
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

  const activeSubscriptions = subscriptions.filter((item) => item.status === "active");
  const restrictedUsers = users.filter((item) => item.status !== "active");
  const activeNodes = nodes.filter((item) => item.active);
  const totalConcurrent = nodes.reduce((sum, node) => sum + node.concurrentUsers, 0);

  return (
    <ConsoleShell
      title="管理台总览"
      subtitle="多套餐节点映射、会员订阅、流量与 Hysteria 2 HTTP 鉴权总览"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <>
          <span className="badge success">{activeNodes.length} 个节点在线</span>
          <span className="badge info">{activeSubscriptions.length} 个活跃订阅</span>
          <span className="badge warn">{restrictedUsers.length} 个受限用户</span>
        </>
      }
      toolbarActions={
        <button className="toolbar-button" type="button" onClick={() => void load()}>
          重新加载
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}

      <section className="metric-grid">
        <MetricCard label="活跃订阅" value={String(activeSubscriptions.length)} footnote="按数据库真实状态统计" />
        <MetricCard label="节点并发" value={String(totalConcurrent)} footnote="来自最近一次 online snapshot" />
        <MetricCard label="可售套餐" value={String(plans.filter((plan) => plan.active).length)} footnote="已启用套餐数" />
        <MetricCard label="受限用户" value={String(restrictedUsers.length)} footnote="暂停、封禁或已失效账号" />
      </section>

      <section className="workspace-grid">
        <Panel
          title="重点订阅"
          copy="优先查看即将到期、剩余流量不高和状态异常的订阅。"
          action={<span className="fine-print">{loading ? "加载中..." : `${subscriptions.length} 条记录`}</span>}
        >
          <DataTable
            headers={["用户", "套餐", "节点", "状态", "剩余流量", "到期时间"]}
            rows={subscriptions.slice(0, 8).map((subscription) => [
              <div key={`${subscription.id}-user`} className="split">
                <strong>{subscription.userDisplayName}</strong>
                <span className="muted">{subscription.userEmail}</span>
              </div>,
              subscription.planName,
              subscription.nodeLabel,
              <span key={`${subscription.id}-status`} className={`badge ${statusTone(subscription.status)}`}>
                {subscription.status}
              </span>,
              formatBytes(subscription.trafficRemainingBytes),
              formatDateTime(subscription.endsAt),
            ])}
          />
        </Panel>

        <div className="split">
          <Panel title="节点健康" copy="按节点查看流量 API 与当前并发情况。">
            <div className="kpi-list">
              {nodes.map((node) => (
                <div key={node.id} className="list-row">
                  <div className="split">
                    <strong>{node.label}</strong>
                    <span className="muted">{node.hostname}:{node.port}</span>
                  </div>
                  <div className="split align-end">
                    <span>{node.speedUpMbps} / {node.speedDownMbps} Mbps</span>
                    <span className="fine-print mono">{node.concurrentUsers} 并发</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="最近鉴权事件" copy="用于快速确认用户被拒绝的原因和节点位置。">
            <div className="kpi-list">
              {authEvents.slice(0, 6).map((event) => (
                <div key={event.id} className="list-row">
                  <div className="split">
                    <span className={`badge ${event.granted ? "success" : "danger"}`}>
                      {event.granted ? "PASS" : "BLOCK"}
                    </span>
                    <span className="muted">{event.reason}</span>
                  </div>
                  <div className="split align-end">
                    <span className="mono">{event.userEmail ?? event.submittedTokenPreview ?? "unknown"}</span>
                    <span className="fine-print">{formatDateTime(event.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </ConsoleShell>
  );
}
