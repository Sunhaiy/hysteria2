"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ConsoleShell } from "@/components/console-shell";
import { EChart } from "@/components/echart";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { PortalOverviewResponse, PortalUsageResponse } from "@/lib/types";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 * 1024 * 1024;

function buildSevenDayUsage(recent: PortalUsageResponse["recent"]) {
  const totals = new Map<string, { txBytes: number; rxBytes: number }>();
  recent.forEach((item) => {
    const key = new Date(item.bucketStart).toISOString().slice(0, 10);
    const current = totals.get(key) ?? { txBytes: 0, rxBytes: 0 };
    totals.set(key, {
      txBytes: current.txBytes + item.txBytes,
      rxBytes: current.rxBytes + item.rxBytes,
    });
  });

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
      txBytes: totals.get(key)?.txBytes ?? 0,
      rxBytes: totals.get(key)?.rxBytes ?? 0,
    };
  });
}

function buildNodeUsage(recent: PortalUsageResponse["recent"]) {
  const totals = new Map<
    string,
    { label: string; txBytes: number; rxBytes: number }
  >();
  recent.forEach((item) => {
    const current = totals.get(item.nodeId) ?? {
      label: item.nodeLabel,
      txBytes: 0,
      rxBytes: 0,
    };
    totals.set(item.nodeId, {
      label: item.nodeLabel,
      txBytes: current.txBytes + item.txBytes,
      rxBytes: current.rxBytes + item.rxBytes,
    });
  });

  return [...totals.values()].sort(
    (a, b) => b.txBytes + b.rxBytes - (a.txBytes + a.rxBytes),
  );
}

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
  const nodeData = useMemo(() => buildNodeUsage(usage?.recent ?? []), [usage]);

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

  const nodeTrafficOption = useMemo<EChartsOption>(
    () => ({
      animationDuration: 500,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => `${Number(value).toFixed(2)} GB`,
      },
      grid: { left: 8, right: 18, top: 10, bottom: 8, containLabel: true },
      xAxis: { type: "value", name: "GB" },
      yAxis: { type: "category", data: nodeData.map((item) => item.label) },
      series: [
        {
          name: "近期开销",
          type: "bar",
          barMaxWidth: 22,
          itemStyle: { borderRadius: [0, 5, 5, 0] },
          data: nodeData.map((item) =>
            Number(((item.txBytes + item.rxBytes) / GB).toFixed(3)),
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
        <div className="portal-dashboard-skeleton">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="skeleton" key={index} />
          ))}
        </div>
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
              (pack) => pack.status !== "expired",
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
            const recentTx = chartData.reduce((sum, item) => sum + item.txBytes, 0);
            const recentRx = chartData.reduce((sum, item) => sum + item.rxBytes, 0);
            const recentTotal = recentTx + recentRx;
            const distributionOption: EChartsOption = {
              tooltip: { trigger: "item" },
              legend: { bottom: 0 },
              series: [
                {
                  type: "pie",
                  radius: ["54%", "76%"],
                  center: ["50%", "44%"],
                  label: { show: false },
                  data: [
                    { name: "上传", value: recentTx },
                    { name: "下载", value: recentRx },
                  ],
                },
              ],
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
                  <MetricCard
                    label="连接状态"
                    value={overview.online > 0 ? "在线" : "离线"}
                    footnote={`${overview.online} 条活跃连接；活跃连接不等于设备数量`}
                  />
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

                <section className="admin-chart-grid">
                  <Panel
                    title="近 7 日流量趋势"
                    copy="按天汇总上传与下载流量。"
                    action={<Link href="/portal/usage">查看明细 ›</Link>}
                  >
                    <EChart
                      option={trafficOption}
                      height={320}
                      ariaLabel="近七天上传下载流量趋势"
                    />
                  </Panel>
                  <Panel
                    title="节点流量分布"
                    copy="查看近期流量主要经过哪些节点。"
                    action={<Link href="/portal/access">管理节点 ›</Link>}
                  >
                    {nodeData.length ? (
                      <EChart
                        option={nodeTrafficOption}
                        height={320}
                        ariaLabel="节点近期流量分布"
                      />
                    ) : (
                      <div className="portal-chart-empty">暂无节点流量记录</div>
                    )}
                  </Panel>
                </section>

                <section className="admin-overview-row portal-overview-row">
                  <Panel title="流量构成" copy="近 7 天上传与下载占比">
                    {recentTotal > 0 ? (
                      <EChart
                        option={distributionOption}
                        height={240}
                        ariaLabel="近七天上传下载流量占比"
                      />
                    ) : (
                      <div className="portal-chart-empty compact">近 7 天暂无流量</div>
                    )}
                  </Panel>
                  <Panel title="接入状态" copy="最近 45 秒节点会话投影">
                    <div className="portal-device-status">
                      <Icon name="plug" />
                      <div>
                        <span>当前状态</span>
                        <strong>{overview.online > 0 ? "在线" : "离线"}</strong>
                      </div>
                      <span className={`badge ${overview.online > 0 ? "success" : "neutral"}`}>
                        {overview.online} 条连接
                      </span>
                    </div>
                    <p className="fine-print portal-device-note">
                      当前不限设备数量；节点连接数包含测速、故障转移和并发会话，不代表唯一设备数。
                    </p>
                  </Panel>
                  <Panel title="快捷操作" copy="常用入口集中在这里。">
                    <div className="admin-quick-actions">
                      <Link href="/portal/plans">
                        <Icon name="refresh" />
                        <span><strong>续费套餐</strong><small>延长服务有效期</small></span>
                        <b>›</b>
                      </Link>
                      <Link href="/portal/access">
                        <Icon name="qr_code_2" />
                        <span><strong>复制订阅</strong><small>同步套餐内全部节点</small></span>
                        <b>›</b>
                      </Link>
                      <Link href="/portal/tutorial">
                        <Icon name="book" />
                        <span><strong>查看教程</strong><small>四平台接入指引</small></span>
                        <b>›</b>
                      </Link>
                      <Link href="/portal/usage">
                        <Icon name="monitoring" />
                        <span><strong>流量明细</strong><small>查看完整使用记录</small></span>
                        <b>›</b>
                      </Link>
                    </div>
                  </Panel>
                </section>

                <section className="workspace-grid portal-detail-grid">
                  <Panel title="当前套餐" copy="订阅配置与接入能力">
                    <div className="portal-plan-facts">
                      <div><span>套餐名称</span><strong>{overview.plan.name}</strong></div>
                      <div><span>订阅状态</span><strong>正常使用中</strong></div>
                      <div><span>上行速率</span><strong>{overview.subscription.speedUpMbpsSnapshot} Mbps</strong></div>
                      <div><span>下行速率</span><strong>{overview.subscription.speedDownMbpsSnapshot} Mbps</strong></div>
                      <div><span>设备数量</span><strong>不限设备</strong></div>
                      <div><span>账户余额</span><strong>¥{((overview.balanceCents ?? 0) / 100).toFixed(2)}</strong></div>
                    </div>
                  </Panel>
                  <Panel
                    title="流量包与权益"
                    copy={`${overview.packs.length} 个附加流量包`}
                    action={<Link href="/portal/plans">查看全部 ›</Link>}
                  >
                    {overview.packs.length ? (
                      overview.packs.slice(0, 3).map((pack) => (
                        <div className="portal-pack-row" key={pack.id}>
                          <div className="portal-pack-copy">
                            <div className="portal-pack-title">
                              <strong>{pack.label}</strong>
                              <span className="badge success">{pack.status}</span>
                            </div>
                            <small>
                              {pack.expiresAt
                                ? `生效至 ${formatDateTime(pack.expiresAt)}`
                                : "跟随当前订阅"}
                            </small>
                          </div>
                          <b>{formatBytes(pack.remainingBytes)}</b>
                        </div>
                      ))
                    ) : (
                      <div className="portal-empty-inline">当前没有额外流量包</div>
                    )}
                  </Panel>
                </section>

                <div className="fine-print portal-analytics-footnote">
                  数据来自节点实时快照与近期用量记录，刷新页面即可同步最新状态。
                </div>
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
