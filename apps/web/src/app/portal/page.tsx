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
import { useSite } from "@/components/site-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import { buildNodeUsage, buildSevenDayUsage } from "@/lib/portal-usage";
import type { PortalOverviewResponse, PortalUsageResponse } from "@/lib/types";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 * 1024 * 1024;

export default function PortalPage() {
  const { token } = useAuth();
  const site = useSite();
  const [loadedAt] = useState(() => Date.now());
  const [overview, setOverview] = useState<PortalOverviewResponse | null>(null);
  const [usage, setUsage] = useState<PortalUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    setUsageError(null);
    setUsageLoading(true);
    try {
      const usageRequest = apiRequest<PortalUsageResponse>(
        "/api/portal/usage",
        { token },
      ).then(
        (data) => ({ data, message: null }),
        (cause: unknown) => ({
          data: null,
          message:
            cause instanceof ApiError
              ? `流量数据加载失败：${cause.message}`
              : "流量数据加载失败，请稍后重试。",
        }),
      );
      const nextOverview = await apiRequest<PortalOverviewResponse>(
        "/api/portal/subscription",
        { token },
      );
      setOverview(nextOverview);
      setEmptyState(false);
      const usageResult = await usageRequest;
      if (usageResult.data) setUsage(usageResult.data);
      setUsageError(usageResult.message);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setOverview(null);
        setUsage(null);
        setEmptyState(true);
        return;
      }
      setError(
        cause instanceof ApiError ? cause.message : "用户中心加载失败。",
      );
    } finally {
      setUsageLoading(false);
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
  const nodeData = useMemo(
    () => buildNodeUsage(usage?.recent ?? []).reverse(),
    [usage],
  );

  const trafficOption = useMemo<EChartsOption>(
    () => ({
      animationDuration: 500,
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => `${Number(value).toFixed(2)} GB`,
      },
      legend: {
        data: ["计费总量", "计费上传", "计费下载"],
        top: 0,
        right: 0,
      },
      grid: { left: 8, right: 12, top: 42, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: chartData.map((item) => item.label),
      },
      yAxis: { type: "value", name: "GB" },
      series: [
        {
          name: "计费总量",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 3 },
          areaStyle: { opacity: 0.1 },
          data: chartData.map((item) =>
            Number((item.accountedBytes / GB).toFixed(3)),
          ),
        },
        {
          name: "计费上传",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.5, type: "dashed" },
          data: chartData.map((item) =>
            Number((item.billedTxBytes / GB).toFixed(3)),
          ),
        },
        {
          name: "计费下载",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 1.5, type: "dashed" },
          data: chartData.map((item) =>
            Number((item.billedRxBytes / GB).toFixed(3)),
          ),
        },
      ],
    }),
    [chartData],
  );

  const nodeTrafficOption = useMemo<EChartsOption>(
    () => ({
      animationDuration: 500,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => `${Number(value).toFixed(2)} GB`,
      },
      grid: { left: 8, right: 18, top: 4, bottom: 8, containLabel: true },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: nodeData.map((item) => item.label),
        axisLabel: { width: 168, overflow: "truncate" },
      },
      series: [
        {
          name: "计费流量",
          type: "bar",
          barMaxWidth: 18,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          data: nodeData.map((item) =>
            Number((item.accountedBytes / GB).toFixed(3)),
          ),
        },
      ],
    }),
    [nodeData],
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
        <button
          className="toolbar-button"
          type="button"
          onClick={() => void load()}
        >
          <Icon name="refresh" />
          刷新数据
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {usageError ? (
        <div className="feedback error" role="alert">
          {usageError}
        </div>
      ) : null}

      {overview ? (
        (() => {
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
                    Math.round((overview.remainingBytes / totalQuota) * 1000) /
                      10,
                  ),
                )
              : 0;
          const usagePercent = unlimited
            ? 0
            : Math.max(0, Math.round((100 - remainingPercent) * 10) / 10);
          const subscriptionStartsAt = new Date(
            overview.subscription.startsAt,
          ).getTime();
          const subscriptionEndsAt = new Date(
            overview.subscription.endsAt,
          ).getTime();
          const daysRemaining = Math.max(
            0,
            Math.ceil((subscriptionEndsAt - loadedAt) / DAY_MS),
          );
          const subscriptionProgress = Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((loadedAt - subscriptionStartsAt) /
                  Math.max(1, subscriptionEndsAt - subscriptionStartsAt)) *
                  1000,
              ) / 10,
            ),
          );
          const isPermanent =
            new Date(overview.subscription.endsAt).getUTCFullYear() >= 9999;
          const resetAt = overview.subscription.currentCycle?.endsAt;
          const fallbackSubscribedDays = Math.max(
            0,
            Math.floor(
              (Math.min(loadedAt, subscriptionEndsAt) - subscriptionStartsAt) /
                DAY_MS,
            ),
          );
          const membership = overview.membership ?? {
            companionshipDays: Math.max(
              1,
              Math.floor(
                (loadedAt -
                  new Date(
                    overview.user.createdAt ?? overview.subscription.startsAt,
                  ).getTime()) /
                  DAY_MS,
              ) + 1,
            ),
            subscribedDays: fallbackSubscribedDays,
            anniversaryTargetDays: 365,
            anniversaryRemainingDays: Math.max(0, 365 - fallbackSubscribedDays),
            anniversaryProgressPercent: Math.min(
              100,
              Math.round((fallbackSubscribedDays / 365) * 1000) / 10,
            ),
            anniversaryEligible: fallbackSubscribedDays >= 365,
          };
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
                      <Icon
                        name={alert.kind === "traffic" ? "warning" : "schedule"}
                      />
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
                  <div className="portal-quota-numbers">
                    <div>
                      <span className="metric-label">已用流量</span>
                      <strong>
                        {unlimited ? "0 B" : formatBytes(usedBytes)}
                      </strong>
                    </div>
                    <div>
                      <span className="metric-label">流量总计</span>
                      <strong>
                        {unlimited ? "无限流量" : formatBytes(totalQuota)}
                      </strong>
                    </div>
                  </div>
                  <div className="portal-quota-progress">
                    <div className="portal-quota-progress-heading">
                      <span>
                        本周期已使用 <strong>{usagePercent}%</strong>
                      </span>
                      {!resetAt ? (
                        <span>
                          套餐到期{" "}
                          {formatDateTime(overview.subscription.endsAt)}
                        </span>
                      ) : null}
                    </div>
                    <div
                      className="portal-quota-track"
                      role="progressbar"
                      aria-label="本周期流量使用比例"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={usagePercent}
                      aria-valuetext={
                        unlimited
                          ? "无限流量"
                          : `已使用 ${formatBytes(usedBytes)}，总计 ${formatBytes(totalQuota)}`
                      }
                    >
                      <span style={{ width: `${usagePercent}%` }} />
                    </div>
                    <span className="portal-quota-remaining">
                      {unlimited
                        ? `${overview.plan.name} 当前不限流量`
                        : `剩余 ${formatBytes(overview.remainingBytes)} · ${remainingPercent}%`}
                    </span>
                  </div>
                </article>
                <MetricCard
                  label="连接状态"
                  value={overview.online > 0 ? "在线" : "离线"}
                  footnote={`${overview.online} 条活跃连接`}
                />
                <article className="portal-membership-summary">
                  <div className="portal-membership-heading">
                    <span className="metric-label">会员套餐</span>
                    <span className="badge success">正常使用中</span>
                  </div>
                  <div className="portal-membership-main">
                    <strong>{overview.plan.name}</strong>
                    <span>
                      {isPermanent
                        ? "永久有效"
                        : `${daysRemaining.toLocaleString("zh-CN")} 天后到期`}
                    </span>
                  </div>
                  <div
                    className="portal-membership-track"
                    role="progressbar"
                    aria-label="当前会员周期进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={isPermanent ? 100 : subscriptionProgress}
                  >
                    <span
                      style={{
                        width: `${isPermanent ? 100 : subscriptionProgress}%`,
                      }}
                    />
                  </div>
                  <div className="portal-membership-footnote">
                    <span>
                      {isPermanent
                        ? "永久会员权益"
                        : `到期 ${formatDateTime(overview.subscription.endsAt)}`}
                    </span>
                    <span>{overview.nodeLabel ?? "节点待分配"}</span>
                  </div>
                </article>
              </section>

              <section className="portal-entitlement-row">
                <Panel
                  title="当前套餐"
                  copy="订阅配置与接入能力"
                  className="portal-current-plan-panel"
                >
                  <div className="portal-plan-facts">
                    <div>
                      <span>套餐名称</span>
                      <strong>{overview.plan.name}</strong>
                    </div>
                    <div>
                      <span>订阅状态</span>
                      <strong>正常使用中</strong>
                    </div>
                    <div>
                      <span>上行速率</span>
                      <strong>
                        {overview.subscription.speedUpMbpsSnapshot} Mbps
                      </strong>
                    </div>
                    <div>
                      <span>下行速率</span>
                      <strong>
                        {overview.subscription.speedDownMbpsSnapshot} Mbps
                      </strong>
                    </div>
                    <div>
                      <span>设备数量</span>
                      <strong>不限设备</strong>
                    </div>
                    <div>
                      <span>账户余额</span>
                      <strong>
                        ¥{((overview.balanceCents ?? 0) / 100).toFixed(2)}
                      </strong>
                    </div>
                  </div>
                </Panel>
                <Panel
                  title="流量与权益"
                  copy={`${currentPacks.length} 个附加流量包`}
                  action={<Link href="/portal/plans">查看全部 ›</Link>}
                  className="portal-pack-summary-panel"
                >
                  {currentPacks.length ? (
                    <div className="portal-pack-summary-list">
                      {currentPacks.slice(0, 2).map((pack) => (
                        <div className="portal-pack-row" key={pack.id}>
                          <div className="portal-pack-copy">
                            <div className="portal-pack-title">
                              <strong>{pack.label}</strong>
                              <span className="badge success">有效</span>
                            </div>
                            <small>
                              {!pack.expiresAt ||
                              new Date(pack.expiresAt).getUTCFullYear() >= 9999
                                ? "永久有效"
                                : `生效至 ${formatDateTime(pack.expiresAt)}`}
                            </small>
                          </div>
                          <b>{formatBytes(pack.remainingBytes)}</b>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="portal-empty-inline">
                      当前没有额外流量包
                    </div>
                  )}
                </Panel>
              </section>

              <section className="admin-chart-grid portal-dashboard-main">
                <Panel
                  title="近 7 日流量趋势"
                  copy="实际流量与倍率后的计费消耗。"
                  action={<Link href="/portal/usage">查看明细 ›</Link>}
                >
                  {usageLoading && !usage ? (
                    <div
                      className="portal-chart-loading skeleton"
                      role="status"
                      aria-label="流量趋势加载中"
                    />
                  ) : (
                    <EChart
                      option={trafficOption}
                      height="clamp(120px, calc(100dvh - 628px), 230px)"
                      ariaLabel="近七天计费流量趋势"
                    />
                  )}
                </Panel>
                <Panel
                  title="节点流量分布"
                  copy="最近 7 天各节点的计费流量。"
                  action={<Link href="/portal/access">管理节点 ›</Link>}
                >
                  {usageLoading && !usage ? (
                    <div
                      className="portal-chart-loading skeleton"
                      role="status"
                      aria-label="节点流量加载中"
                    />
                  ) : nodeData.length ? (
                    <EChart
                      option={nodeTrafficOption}
                      height="clamp(120px, calc(100dvh - 628px), 230px)"
                      ariaLabel="近七天节点计费流量分布"
                    />
                  ) : (
                    <div className="portal-chart-empty compact">
                      近 7 天暂无节点流量
                    </div>
                  )}
                </Panel>
              </section>
              <section
                className="portal-journey"
                aria-label="会员陪伴与周年进度"
              >
                <div className="portal-journey-copy">
                  <span className="metric-label">MEMBER JOURNEY</span>
                  <h2>
                    {site.name} 已经陪伴您
                    <strong className="portal-companionship-inline">
                      {membership.companionshipDays.toLocaleString("zh-CN")} 天
                    </strong>
                  </h2>
                  <p>
                    自 {formatDateTime(overview.user.createdAt)}{" "}
                    注册以来，我们一直在这里。
                  </p>
                </div>
                <div className="portal-anniversary-progress">
                  <div className="portal-anniversary-heading">
                    <div>
                      <strong>一周年约定</strong>
                      <span>仅累计有效订阅时间</span>
                    </div>
                    <b>
                      {membership.subscribedDays.toLocaleString("zh-CN")} /{" "}
                      {membership.anniversaryTargetDays} 天
                    </b>
                  </div>
                  <div
                    className="portal-anniversary-track"
                    role="progressbar"
                    aria-label="一周年有效订阅进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={membership.anniversaryProgressPercent}
                  >
                    <span
                      style={{
                        width: `${membership.anniversaryProgressPercent}%`,
                      }}
                    />
                  </div>
                  <p>
                    我们会在您使用一周年送上一份神秘礼物
                    {membership.anniversaryEligible
                      ? "，您已达成一周年。"
                      : `，还差 ${membership.anniversaryRemainingDays} 个有效订阅日。`}
                  </p>
                </div>
              </section>
            </div>
          );
        })()
      ) : emptyState ? (
        <Panel
          title="还没有生效中的套餐"
          copy="当前账号还没有可用订阅，可以选择套餐下单或使用 CDK 立即开通。"
        >
          <div className="toolbar-actions">
            <Link className="action-button" href="/portal/plans">
              去选套餐
            </Link>
            <Link className="ghost-button" href="/portal/redeem">
              去兑换中心
            </Link>
          </div>
        </Panel>
      ) : null}
    </ConsoleShell>
  );
}
