"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatPercent } from "@/lib/format";
import type { PortalOverviewResponse } from "@/lib/types";

export default function PortalPage() {
  const { token } = useAuth();
  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const nextOverview = await apiRequest<PortalOverviewResponse>(
        "/api/portal/subscription",
        { token },
      );
      setOverview(nextOverview);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "用户中心加载失败。");
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const totalQuota = overview
    ? overview.subscription.includedTrafficBytes +
      overview.subscription.bonusTrafficBytes +
      overview.packs.reduce((sum, pack) => sum + pack.totalBytes, 0)
    : 0;

  return (
    <ConsoleShell
      title="用户中心"
      subtitle="查看当前套餐、剩余流量、在线设备与推荐接入节点"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={
        overview ? (
          <>
            <span className="badge success">{overview.subscription.planName}</span>
            <span className="badge info">
              {overview.online}/{overview.subscription.deviceLimitSnapshot} devices
            </span>
          </>
        ) : null
      }
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {overview ? (
        <>
          <section className="metric-grid">
            <MetricCard label="剩余总流量" value={formatBytes(overview.remainingBytes)} footnote="含基础套餐和流量包叠加" />
            <MetricCard label="在线设备" value={`${overview.online}/${overview.subscription.deviceLimitSnapshot}`} footnote="按并发 Hysteria 客户端数统计" />
            <MetricCard label="套餐到期" value={formatDateTime(overview.subscription.endsAt)} footnote="到期后将停止新的鉴权接入" />
            <MetricCard label="推荐节点" value={overview.nodeLabel ?? "-"} footnote="来自当前订阅绑定的默认节点" />
          </section>

          <section className="workspace-grid">
            <Panel title="流量概览" copy="基础流量先扣减，流量包作为额外层叠加。">
              <div className="usage-grid">
                <div className="split">
                  <span className="muted">总配额</span>
                  <strong>{formatBytes(totalQuota)}</strong>
                </div>
                <div className="split">
                  <span className="muted">剩余配额</span>
                  <strong>{formatBytes(overview.remainingBytes)}</strong>
                </div>
                <div className="split">
                  <span className="muted">使用率</span>
                  <strong>{formatPercent(totalQuota - overview.remainingBytes, totalQuota)}</strong>
                </div>
              </div>
              <div className="usage-bar">
                <div
                  className="usage-fill"
                  style={{
                    width: formatPercent(totalQuota - overview.remainingBytes, totalQuota),
                  }}
                />
              </div>
            </Panel>

            <Panel title="流量包与权益" copy="可以清楚看到当前叠加包的剩余量和失效时间。">
              <div className="kpi-list">
                {overview.packs.length ? (
                  overview.packs.map((pack) => (
                    <div key={pack.id} className="list-row">
                      <div className="split">
                        <strong>{pack.label}</strong>
                        <span className="muted">{pack.status}</span>
                      </div>
                      <div className="split align-end">
                        <span>{formatBytes(pack.remainingBytes)}</span>
                        <span className="fine-print">
                          {pack.expiresAt ? formatDateTime(pack.expiresAt) : "跟随订阅"}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <span className="fine-print">当前没有额外流量包。</span>
                )}
              </div>
            </Panel>
          </section>
        </>
      ) : null}
    </ConsoleShell>
  );
}
