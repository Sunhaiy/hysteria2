"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";
import type { AuthEventRecord, SessionRecord } from "@/lib/types";

export default function AdminSessionsPage() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [authEvents, setAuthEvents] = useState<AuthEventRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
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
      title="会话控制"
      subtitle="观察当前在线并发与最近的鉴权拒绝原因"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">{sessions.length} 条在线快照</span>}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <section className="workspace-grid">
        <Panel title="当前在线快照" copy="按用户和节点去重后的最近并发结果。">
          <DataTable
            headers={["用户", "节点", "并发客户端", "捕获时间"]}
            rows={sessions.map((session) => [
              session.userEmail,
              session.nodeLabel,
              String(session.concurrentClients),
              formatDateTime(session.capturedAt),
            ])}
          />
        </Panel>

        <Panel title="鉴权事件" copy="关注被拒绝原因，快速排查超流量、过期和越权节点。">
          <DataTable
            headers={["结果", "用户", "节点", "原因", "时间"]}
            rows={authEvents.map((event) => [
              <span key={event.id} className={`badge ${event.granted ? "success" : "danger"}`}>
                {event.granted ? "PASS" : "BLOCK"}
              </span>,
              event.userEmail ?? event.submittedTokenPreview ?? "unknown",
              event.nodeLabel ?? "-",
              event.reason,
              formatDateTime(event.createdAt),
            ])}
          />
        </Panel>
      </section>
    </ConsoleShell>
  );
}
