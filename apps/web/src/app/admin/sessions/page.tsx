"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";
import type { AuthEventRecord, SessionRecord } from "@/lib/types";

type EventFilter = "all" | "blocked" | "granted";
type DisplayAuthEvent = AuthEventRecord & { repeatCount: number };

const AUTH_REASON_LABELS: Record<string, string> = {
  ok: "鉴权通过",
  token_not_found: "旧配置令牌已失效",
  node_unavailable: "节点不可用",
  user_not_active: "用户已停用",
  subscription_missing: "没有有效套餐",
  subscription_not_active: "套餐未启用",
  subscription_expired: "套餐已到期",
  node_forbidden: "套餐不包含该节点",
  traffic_exhausted: "流量已用尽",
  device_limit_exceeded: "设备数超过限制",
};

function sourceHost(remoteAddr?: string | null) {
  if (!remoteAddr) return "无来源地址";
  const bracketedIpv6 = remoteAddr.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketedIpv6) return bracketedIpv6[1];
  const firstColon = remoteAddr.indexOf(":");
  const lastColon = remoteAddr.lastIndexOf(":");
  return firstColon === lastColon && lastColon > 0
    ? remoteAddr.slice(0, lastColon)
    : remoteAddr;
}

export default function AdminSessionsPage() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [authEvents, setAuthEvents] = useState<AuthEventRecord[]>([]);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [nextSessions, nextEvents] = await Promise.all([
        apiRequest<SessionRecord[]>("/api/admin/sessions", { token }),
        apiRequest<AuthEventRecord[]>("/api/admin/auth-events", { token }),
      ]);
      setSessions(nextSessions);
      setAuthEvents(nextEvents);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "会话数据加载失败。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const stats = useMemo(() => ({
    users: new Set(sessions.map((session) => session.userId)).size,
    nodes: new Set(sessions.map((session) => session.nodeId)).size,
    clients: sessions.reduce((sum, session) => sum + session.concurrentClients, 0),
    blocked: authEvents.filter((event) => !event.granted).length,
  }), [authEvents, sessions]);

  const visibleEvents = useMemo(() => {
    const grouped = new Map<string, DisplayAuthEvent>();
    for (const event of authEvents) {
      if (eventFilter === "blocked" && event.granted) continue;
      if (eventFilter === "granted" && !event.granted) continue;

      const key = [
        event.granted ? "granted" : "blocked",
        event.reason,
        event.userId ?? event.submittedTokenPreview ?? "unknown",
        event.nodeId ?? "unknown-node",
        sourceHost(event.remoteAddr),
      ].join("|");
      const existing = grouped.get(key);
      if (existing) {
        existing.repeatCount += 1;
      } else {
        grouped.set(key, { ...event, repeatCount: 1 });
      }
    }
    return [...grouped.values()];
  }, [authEvents, eventFilter]);

  return (
    <ConsoleShell
      title="会话控制"
      subtitle="快速查看在线设备、节点分布与鉴权异常"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">{loading ? "同步中..." : `${sessions.length} 条在线快照`}</span>}
      toolbarActions={<button className="toolbar-button" type="button" disabled={loading} onClick={() => void load()}><Icon name="refresh" />刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}

      <section className="metric-grid session-metric-grid">
        <article className="panel metric-card"><span className="metric-label">在线会员</span><strong className="metric-value">{stats.users}</strong><span className="metric-footnote">当前有连接的独立账号</span></article>
        <article className="panel metric-card"><span className="metric-label">连接设备</span><strong className="metric-value">{stats.clients}</strong><span className="metric-footnote">所有节点并发客户端合计</span></article>
        <article className="panel metric-card"><span className="metric-label">活跃节点</span><strong className="metric-value">{stats.nodes}</strong><span className="metric-footnote">当前承载连接的节点</span></article>
        <article className="panel metric-card"><span className="metric-label">鉴权拦截</span><strong className="metric-value">{stats.blocked}</strong><span className="metric-footnote">当前事件列表中的拒绝次数</span></article>
      </section>

      <Panel title="当前在线" copy="按会员和节点聚合，优先查看并发数异常的连接。">
        {sessions.length ? (
          <div className="session-card-grid">
            {sessions.map((session) => (
              <article className="session-card" key={`${session.userId}-${session.nodeId}`}>
                <div className="session-card-icon"><Icon name="account_circle" /></div>
                <div className="session-card-copy">
                  <strong>{session.userEmail}</strong>
                  <span>{session.nodeLabel}</span>
                  <small>采集于 {formatDateTime(session.capturedAt)}</small>
                </div>
                <div className="session-client-count"><strong>{session.concurrentClients}</strong><span>客户端</span></div>
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><div className="empty-state-title">当前没有在线连接</div><span>刷新后仍为空，表示暂时没有会员接入。</span></div>}
      </Panel>

      <Panel
        title="鉴权事件"
        copy="按结果筛选最近鉴权记录，拒绝事件会突出显示原因与来源地址。"
        action={
          <div className="segmented-control" aria-label="鉴权事件筛选">
            {(["all", "blocked", "granted"] as const).map((value) => (
              <button key={value} type="button" className={eventFilter === value ? "active" : ""} onClick={() => setEventFilter(value)}>
                {value === "all" ? "全部" : value === "blocked" ? "已拦截" : "已放行"}
              </button>
            ))}
          </div>
        }
      >
        {visibleEvents.length ? (
          <div className="auth-event-list">
            {visibleEvents.map((event) => (
              <article className={`auth-event-row ${event.granted ? "granted" : "blocked"}`} key={event.id}>
                <span className={`badge ${event.granted ? "success" : "danger"}`}>{event.granted ? "放行" : "拦截"}</span>
                <div className="auth-event-main">
                  <strong>{AUTH_REASON_LABELS[event.reason] ?? event.reason ?? (event.granted ? "鉴权通过" : "鉴权拒绝")}</strong>
                  <span>{event.userEmail ?? event.submittedTokenPreview ?? "未知用户"} · {event.nodeLabel ?? "未知节点"}</span>
                </div>
                <div className="auth-event-meta">
                  <span>{sourceHost(event.remoteAddr)}</span>
                  <small>{event.repeatCount > 1 ? `已合并 ${event.repeatCount} 条 · ` : ""}{formatDateTime(event.createdAt)}</small>
                </div>
              </article>
            ))}
          </div>
        ) : <div className="empty-state"><div className="empty-state-title">该筛选下没有事件</div><span>可以切换筛选条件查看其他记录。</span></div>}
      </Panel>
    </ConsoleShell>
  );
}
