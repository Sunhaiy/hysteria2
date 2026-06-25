"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatPercent } from "@/lib/format";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
import type { PortalOverviewResponse } from "@/lib/types";

export default function PortalPage() {
  const { token } = useAuth();
  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState(false);

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
      setEmptyState(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setOverview(null);
        setEmptyState(true);
        return;
      }
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
      subtitle="查看当前套餐、剩余流量、在线设备和接入状态，也可以继续下单续期"
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
        ) : emptyState ? (
          <span className="badge warn">尚未开通套餐</span>
        ) : null
      }
      toolbarActions={
        <div className="toolbar-actions">
          <Link className="toolbar-button" href="/portal/plans">
            套餐列表
          </Link>
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
        </div>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}

      {!overview && !emptyState && !error ? (
        <>
          <div className="skeleton-metrics">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton skeleton-metric" />)}
          </div>
          <div className="skeleton-rows" style={{ marginTop: 16 }}>
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}
          </div>
        </>
      ) : null}

      {overview ? (
        <>
          <section className="metric-grid">
            <MetricCard
              label="剩余总流量"
              value={overview.remainingBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(overview.remainingBytes)}
              footnote="含基础套餐和流量包叠加"
            />
            <MetricCard
              label="在线设备"
              value={`${overview.online}/${overview.subscription.deviceLimitSnapshot}`}
              footnote="按并发 Hysteria 客户端数统计"
            />
            <MetricCard
              label="套餐到期"
              value={formatDateTime(overview.subscription.endsAt)}
              footnote="到期后将停止新的鉴权接入"
            />
            <MetricCard
              label="推荐节点"
              value={overview.nodeLabel ?? "-"}
              footnote="来自当前订阅绑定的默认节点"
            />
          </section>

          <section className="workspace-grid">
            <Panel title="流量概览" copy="基础流量先扣减，流量包作为额外层叠加。">
              <div className="usage-grid">
                <div className="split">
                  <span className="muted">总配额</span>
                  <strong>{totalQuota >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(totalQuota)}</strong>
                </div>
                <div className="split">
                  <span className="muted">剩余配额</span>
                  <strong>{overview.remainingBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(overview.remainingBytes)}</strong>
                </div>
                <div className="split">
                  <span className="muted">使用率</span>
                  <strong>{totalQuota >= UNLIMITED_TRAFFIC ? "无限制" : formatPercent(totalQuota - overview.remainingBytes, totalQuota)}</strong>
                </div>
              </div>
              <div className="usage-bar">
                <div
                  className="usage-fill"
                  style={{
                    width: totalQuota >= UNLIMITED_TRAFFIC ? "0%" : formatPercent(totalQuota - overview.remainingBytes, totalQuota),
                  }}
                />
              </div>
            </Panel>

            <Panel title="流量包与权益" copy="叠加包会独立列出，方便你区分基础套餐和增量包。">
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
      ) : emptyState ? (
        <Panel
          title="还没有生效中的套餐"
          copy="当前账号已经可以登录会员中心，但还没有可用订阅。你可以直接选套餐提交人工订单，或者使用 CDK 立即开通。"
        >
          <div className="toolbar-actions">
            <Link className="action-button" href="/portal/plans">
              去选套餐
            </Link>
            <Link className="ghost-button" href="/portal/redeem">
              去兑换中心
            </Link>
            <Link className="ghost-button" href="/portal/orders">
              查看订单记录
            </Link>
          </div>
        </Panel>
      ) : null}
    </ConsoleShell>
  );
}
