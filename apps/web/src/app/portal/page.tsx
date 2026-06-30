"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { PortalOverviewResponse, PortalUsageResponse } from "@/lib/types";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildSevenDayUsage(recent: PortalUsageResponse["recent"]) {
  const totals = new Map<string, number>();
  recent.forEach((item) => {
    const key = new Date(item.bucketStart).toISOString().slice(0, 10);
    totals.set(key, (totals.get(key) ?? 0) + item.txBytes + item.rxBytes);
  });

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return {
      key,
      label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
      bytes: totals.get(key) ?? 0,
    };
  });
}

function UsageChart({ data }: { data: ReturnType<typeof buildSevenDayUsage> }) {
  const max = Math.max(...data.map((item) => item.bytes), 1);
  const points = data.map((item, index) => {
    const x = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
    const y = 76 - (item.bytes / max) * 58;
    return { ...item, x, y };
  });
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const area = `${line} L100,82 L0,82 Z`;

  return (
    <div className="portal-chart-wrap">
      <div className="portal-chart-unit">单位：GB</div>
      <svg className="portal-chart" viewBox="0 0 100 88" preserveAspectRatio="none" role="img" aria-label="近 7 日流量趋势">
        <defs>
          <linearGradient id="portal-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-500)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--accent-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[18, 34, 50, 66, 82].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} className="portal-chart-grid" />)}
        {points.map((point) => <line key={point.key} x1={point.x} x2={point.x} y1="12" y2="82" className="portal-chart-grid vertical" />)}
        <path d={area} fill="url(#portal-chart-fill)" />
        <path d={line} className="portal-chart-line" />
        {points.map((point) => <circle key={point.key} cx={point.x} cy={point.y} r="1.5" className="portal-chart-point" />)}
      </svg>
      <div className="portal-chart-labels">
        {points.map((point) => <span key={point.key}>{point.label}</span>)}
      </div>
      <div className="portal-chart-legend"><span /> 已使用流量</div>
    </div>
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
      const nextOverview = await apiRequest<PortalOverviewResponse>("/api/portal/subscription", { token });
      const nextUsage = await apiRequest<PortalUsageResponse>("/api/portal/usage", { token }).catch(() => null);
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

  const chartData = useMemo(() => buildSevenDayUsage(usage?.recent ?? []), [usage]);

  if (!overview && !emptyState && !error) {
    return (
      <ConsoleShell title="用户中心" subtitle="你的连接、流量与套餐状态" scope="Member" navItems={portalNav} requireRole="member">
        <div className="portal-dashboard-skeleton">
          {Array.from({ length: 8 }, (_, index) => <div className="skeleton" key={index} />)}
        </div>
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell title="用户中心" subtitle="你的连接、流量与套餐状态" scope="Member" navItems={portalNav} requireRole="member">
      {error ? <div className="feedback error">{error}</div> : null}

      {overview ? (() => {
        const unlimited = overview.remainingBytes >= UNLIMITED_TRAFFIC;
        const totalQuota = overview.subscription.includedTrafficBytes + overview.subscription.bonusTrafficBytes + overview.packs.reduce((sum, pack) => sum + pack.totalBytes, 0);
        const consumed = Math.max(0, totalQuota - overview.remainingBytes);
        const usagePercent = unlimited || totalQuota <= 0 ? 0 : Math.min(100, (consumed / totalQuota) * 100);
        const daysRemaining = Math.max(0, Math.ceil((new Date(overview.subscription.endsAt).getTime() - loadedAt) / DAY_MS));
        const deviceLimit = overview.subscription.deviceLimitSnapshot;
        const devicePercent = Math.min(100, (overview.online / Math.max(deviceLimit, 1)) * 100);
        const ringStyle = { "--portal-ring-progress": `${usagePercent * 3.6}deg` } as CSSProperties;

        return (
          <div className="portal-dashboard">
            <section className="portal-summary-grid">
              <article className="portal-summary-card traffic">
                <span className="portal-card-label">剩余总流量</span>
                <strong>{unlimited ? "无限流量" : formatBytes(overview.remainingBytes)}</strong>
                <p>当前套餐不限量，流量包将作为额外权益叠加</p>
                <div className="portal-infinity" aria-hidden="true">∞</div>
              </article>

              <article className="portal-summary-card">
                <span className="portal-card-label">在线设备</span>
                <strong>{overview.online}/{deviceLimit}</strong>
                <p>已连接设备 / 可用设备</p>
                <div className="portal-device-dots" aria-hidden="true">
                  {Array.from({ length: Math.min(deviceLimit, 8) }, (_, index) => <span key={index} className={index < overview.online ? "active" : ""} />)}
                </div>
                <span className="badge success">正常</span>
              </article>

              <article className="portal-summary-card">
                <span className="portal-card-label">套餐到期</span>
                <strong className="portal-date-value">{formatDateTime(overview.subscription.endsAt)}</strong>
                <p>到期后将停止新的鉴权接入</p>
                <span className="portal-status-pill">剩余 {daysRemaining.toLocaleString("zh-CN")} 天</span>
                <Icon name="receipt_long" />
              </article>

              <article className="portal-summary-card node">
                <span className="portal-card-label">推荐节点</span>
                <strong>{overview.nodeLabel ?? "未绑定"}</strong>
                <p>来自当前订阅绑定的默认节点</p>
                <span className="portal-status-pill">默认线路</span>
                <div className="portal-signal" aria-hidden="true"><i /><i /><i /><i /></div>
              </article>
            </section>

            <section className="portal-dashboard-main">
              <article className="portal-usage-panel portal-dash-panel">
                <h3>流量概览</h3>
                <div className="portal-usage-content">
                  <div className="portal-usage-ring" style={ringStyle}>
                    <div><strong>{unlimited ? "无限流量" : `${Math.round(100 - usagePercent)}%`}</strong><span>当前套餐</span></div>
                  </div>
                  <div className="portal-usage-kpis">
                    <div><Icon name="stacks" /><span>总配额<strong>{unlimited ? "无限" : formatBytes(totalQuota)}</strong></span></div>
                    <div><Icon name="monitoring" /><span>已使用<strong>{formatBytes(usage?.consumedBytes ?? consumed)}</strong></span></div>
                    <div><Icon name="network_node" /><span>使用率<strong>{unlimited ? "无限制" : `${usagePercent.toFixed(1)}%`}</strong></span></div>
                  </div>
                </div>
                <div className="portal-usage-note"><Icon name="shield" /> 当前套餐流量状态正常，可继续稳定接入。</div>
              </article>

              <article className="portal-trend-panel portal-dash-panel">
                <div className="portal-panel-heading"><h3>近 7 日流量趋势</h3><Link href="/portal/usage">查看明细 ›</Link></div>
                <UsageChart data={chartData} />
              </article>

              <div className="portal-side-stack">
                <article className="portal-dash-panel portal-pack-panel">
                  <div className="portal-panel-heading"><h3>流量包与权益</h3><Link href="/portal/plans">查看全部 ›</Link></div>
                  {overview.packs.length ? overview.packs.slice(0, 2).map((pack) => (
                    <div className="portal-pack-row" key={pack.id}>
                      <div><strong>{pack.label}</strong><span className="badge success">{pack.status}</span><small>{pack.expiresAt ? `生效至 ${formatDateTime(pack.expiresAt)}` : "跟随当前订阅"}</small></div>
                      <b>{formatBytes(pack.remainingBytes)}</b>
                    </div>
                  )) : <div className="portal-empty-inline">当前没有额外流量包</div>}
                </article>

                <article className="portal-dash-panel portal-device-panel">
                  <h3>设备接入状态</h3>
                  <div className="portal-device-status">
                    <Icon name="account_circle" />
                    <div><span>当前在线设备</span><strong>{overview.online} 台设备已连接</strong></div>
                    <b>{overview.online}/{deviceLimit}</b>
                  </div>
                  <div className="portal-device-progress"><span style={{ width: `${devicePercent}%` }} /></div>
                  <p>可用设备数 {Math.max(0, deviceLimit - overview.online)} 台</p>
                  <div className="portal-device-actions">
                    <Link href="/portal/access"><Icon name="qr_code_2" /> 接入信息</Link>
                    <Link href="/portal/tutorial"><Icon name="book" /> 查看教程</Link>
                  </div>
                </article>
              </div>
            </section>

            <section className="portal-quick-panel portal-dash-panel">
              <h3>快捷操作</h3>
              <div className="portal-quick-grid">
                <Link href="/portal/plans" className="renew"><Icon name="refresh" /><span><strong>续费套餐</strong><small>延长服务有效期</small></span><b>→</b></Link>
                <Link href="/portal/access" className="access"><Icon name="qr_code_2" /><span><strong>复制订阅</strong><small>获取专属连接信息</small></span><b>→</b></Link>
                <Link href="/portal/tutorial" className="guide"><Icon name="book" /><span><strong>查看教程</strong><small>三平台接入指引</small></span><b>→</b></Link>
                <Link href="/portal/usage" className="usage"><Icon name="monitoring" /><span><strong>流量明细</strong><small>查看使用记录</small></span><b>→</b></Link>
              </div>
            </section>
          </div>
        );
      })() : emptyState ? (
        <Panel title="还没有生效中的套餐" copy="当前账号还没有可用订阅，可以选择套餐下单或使用 CDK 立即开通。">
          <div className="toolbar-actions">
            <Link className="action-button" href="/portal/plans">去选套餐</Link>
            <Link className="ghost-button" href="/portal/redeem">去兑换中心</Link>
          </div>
        </Panel>
      ) : null}
    </ConsoleShell>
  );
}
