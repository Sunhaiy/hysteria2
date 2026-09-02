"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ConsoleShell } from "@/components/console-shell";
import { EChart } from "@/components/echart";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import { buildSevenDayUsage } from "@/lib/portal-usage";
import type { PortalOverviewResponse, PortalUsageResponse } from "@/lib/types";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 * 1024 * 1024;

export default function PortalPage() {
  const { token } = useAuth();
  const [loadedAt] = useState(() => Date.now());
  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [usage, setUsage] = useState<PortalUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const nextOverview = await apiRequest<PortalOverviewResponse>(
        "/api/portal/subscription",
        { token },
      );
      const nextUsage = await apiRequest<PortalUsageResponse>(
        "/api/portal/usage",
        { token },
      ).catch(() => null);
      setOverview(nextOverview);
      setUsage(nextUsage);
      setEmptyState(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setOverview(null);
        setUsage(null);
        setEmptyState(true);
        return;
      }
      setError(cause instanceof ApiError ? cause.message : "用户中心加载失败。");
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const chartData = useMemo(
    () => buildSevenDayUsage(usage?.recent ?? []),
    [usage],
  );

  const trafficOption = useMemo<EChartsOption>(
    () => ({
      animationDuration: 500,
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => `${Number(value).toFixed(2)} GB`,
      },
      legend: { data: ["上传", "下载"], top: 0, right: 0 },
      grid: { left: 8, right: 12, top: 42, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: chartData.map((item) => item.label),
      },
      yAxis: { type: "value", name: "GB" },
      series: [
        {
          name: "上传",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.08 },
          data: chartData.map((item) =>
            Number((item.txBytes / GB).toFixed(3)),
          ),
        },
        {
          name: "下载",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.06 },
          data: chartData.map((item) =>
            Number((item.rxBytes / GB).toFixed(3)),
          ),
        },
      ],
    }),
    [chartData],
  );

  if (!overview && !emptyState && !error) {
    return (
      <ConsoleShell
        title="用户中心"
        subtitle="你的连接、流量与套餐状态"
        scope="Member"
        navItems={portalNav}
        requireRole="member"
      >
        <PageSkeleton variant="dashboard" />
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title="用户中心"
      subtitle="你的连接、流量与套餐状态"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarActions={
        <button className="toolbar-button" type="button" onClick={() => void load()}>
          <Icon name="refresh" />刷新数据
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}

      {overview
        ? (() => {
            const unlimited = overview.remainingBytes >= UNLIMITED_TRAFFIC;
            const currentPacks = overview.packs.filter(
              (pack) => pack.status === "active",
            );
            const totalQuota =
              overview.subscription.includedTrafficBytes +
              overview.subscription.bonusTrafficBytes +
              currentPacks.reduce((sum, pack) => sum + pack.totalBytes, 0);
            const consumed = Math.max(0, totalQuota - overview.remainingBytes);
            const usedBytes = consumed;
            const remainingPercent = unlimited
              ? 100
              : totalQuota > 0
                ? Math.max(
                    0,
                    Math.min(
                      100,
                      Math.round(
                        (overview.remainingBytes / totalQuota) * 1000,
                      ) / 10,
                    ),
                  )
                : 0;
            const daysRemaining = Math.max(
              0,
              Math.ceil(
                (new Date(overview.subscription.endsAt).getTime() - loadedAt) /
                  DAY_MS,
              ),
            );
            return (
              <div className="portal-analytics">
                {overview.alerts?.length ? (
                  <section className="portal-alerts" aria-label="套餐提醒">
                    {overview.alerts.map((alert) => (
                      <div
                        className={`portal-alert ${alert.severity}`}
                        key={alert.id}
                        role="status"
                      >
                        <Icon name={alert.kind === "traffic" ? "warning" : "schedule"} />
                        <span>
                          <strong>{alert.title}</strong>
                          <small>{alert.message}</small>
                        </span>
                        <Link href={alert.actionHref}>立即处理</Link>
                      </div>
                    ))}
                  </section>
                ) : null}
                <section className="metric-grid portal-primary-metrics">
                  <article className="portal-quota-summary">
                    <div className="portal-quota-heading">
                      <span className="metric-label">剩余总流量</span>
                      <strong>
                        {unlimited
                          ? "无限流量"
                          : formatBytes(overview.remainingBytes)}
                      </strong>
                    </div>
                    <div
                      className="portal-quota-track"
                      role="progressbar"
                      aria-label="剩余总流量比例"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={remainingPercent}
                      aria-valuetext={
                        unlimited
                          ? "无限流量"
                          : `${formatBytes(overview.remainingBytes)} / ${formatBytes(totalQuota)}`
                      }
                    >
                      <span style={{ width: `${remainingPercent}%` }} />
                    </div>
                    <div className="portal-quota-footnote">
                      {unlimited ? (
                        <span>当前套餐 {overview.plan.name} 不限流量</span>
                      ) : (
                        <>
                          <span>总额度 {formatBytes(totalQuota)}</span>
                          <span>已使用 {formatBytes(usedBytes)}</span>
                          <span>剩余 {remainingPercent}%</span>
                        </>
                      )}
                    </div>
                  </article>
                  <article className="metric-card portal-plan-summary">
                    <span className="metric-label">当前套餐</span>
                    <strong className="metric-value">{overview.plan.name}</strong>
                    <span className="metric-footnote">
                      上行 {overview.subscription.speedUpMbpsSnapshot} Mbps · 下行{" "}
                      {overview.subscription.speedDownMbpsSnapshot} Mbps
                    </span>
                  </article>
                  <MetricCard
                    label="套餐到期"
                    value={formatDateTime(overview.subscription.endsAt)}
                    footnote={`剩余 ${daysRemaining.toLocaleString("zh-CN")} 天`}
                  />
                  <MetricCard
                    label="推荐节点"
                    value={overview.nodeLabel ?? "未绑定"}
                    footnote={`${overview.plan.name} · 默认线路`}
                  />
                </section>

                <section className="admin-chart-grid portal-dashboard-main">
                  <Panel
                    title="近 7 日流量趋势"
                    copy="按天汇总上传与下载流量。"
                    action={<Link href="/portal/usage">查看明细 ›</Link>}
                  >
                    <EChart
                      option={trafficOption}
                      height={246}
                      ariaLabel="近七天上传下载流量趋势"
                    />
                  </Panel>
                  <Panel
                    title="流量包与权益"
                    copy={`${currentPacks.length} 个可用流量包`}
                    action={<Link href="/portal/plans">查看全部 ›</Link>}
                    className="portal-pack-summary-panel"
                  >
                    {currentPacks.length ? (
                      <>
                        <div className="portal-pack-total">
                          <span>流量包剩余</span>
                          <strong>
                            {formatBytes(
                              currentPacks.reduce(
                                (sum, pack) => sum + pack.remainingBytes,
                                0,
                              ),
                            )}
                          </strong>
                        </div>
                        <div className="portal-pack-summary-list">
                          {currentPacks.slice(0, 3).map((pack) => (
                            <div className="portal-pack-row" key={pack.id}>
                              <div className="portal-pack-copy">
                                <div className="portal-pack-title">
                                  <strong>{pack.label}</strong>
                                  <span className="badge success">有效</span>
                                </div>
                                <small>
                                  {pack.expiresAt
                                    ? `有效至 ${formatDateTime(pack.expiresAt)}`
                                    : "永久有效"}
                                </small>
                              </div>
                              <b>{formatBytes(pack.remainingBytes)}</b>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="portal-empty-inline">
                        当前没有额外流量包
                      </div>
                    )}
                  </Panel>
                </section>
              </div>
            );
          })()
        : emptyState
          ? (
              <Panel
                title="还没有生效中的套餐"
                copy="当前账号还没有可用订阅，可以选择套餐下单或使用 CDK 立即开通。"
              >
                <div className="toolbar-actions">
                  <Link className="action-button" href="/portal/plans">去选套餐</Link>
                  <Link className="ghost-button" href="/portal/redeem">去兑换中心</Link>
                </div>
              </Panel>
            )
          : null}
    </ConsoleShell>
  );
}
