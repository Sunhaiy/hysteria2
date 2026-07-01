"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { EChart } from "@/components/echart";
import { Icon } from "@/components/icon";
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
  UsageSummaryResponse,
} from "@/lib/types";
import { statusTone } from "@/lib/ui";

const GB = 1024 * 1024 * 1024;

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [authEvents, setAuthEvents] = useState<AuthEventRecord[]>([]);
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [nextUsers, nextPlans, nextSubscriptions, nextNodes, nextEvents, nextUsage] = await Promise.all([
        apiRequest<AdminUser[]>("/api/admin/users", { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
        apiRequest<SubscriptionRecord[]>("/api/admin/subscriptions", { token }),
        apiRequest<NodeRecord[]>("/api/admin/nodes", { token }),
        apiRequest<AuthEventRecord[]>("/api/admin/auth-events", { token }),
        apiRequest<UsageSummaryResponse>("/api/admin/usage/summary", { token }),
      ]);
      setUsers(nextUsers);
      setPlans(nextPlans);
      setSubscriptions(nextSubscriptions);
      setNodes(nextNodes);
      setAuthEvents(nextEvents);
      setUsage(nextUsage);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "管理台数据加载失败。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const activeSubscriptions = subscriptions.filter((item) => item.status === "active");
  const restrictedUsers = users.filter((item) => item.status !== "active");
  const activeNodes = nodes.filter((item) => item.active);
  const totalConcurrent = nodes.reduce((sum, node) => sum + node.concurrentUsers, 0);
  const passEvents = authEvents.filter((event) => event.granted).length;
  const blockEvents = authEvents.length - passEvents;

  const trafficOption = useMemo<EChartsOption>(() => ({
    animationDuration: 500,
    tooltip: { trigger: "axis", valueFormatter: (value) => `${Number(value).toFixed(2)} GB` },
    legend: { data: ["上传", "下载"], top: 0, right: 0 },
    grid: { left: 10, right: 12, top: 42, bottom: 10, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: usage?.daily.map((item) => item.date.slice(5).replace("-", "/")) ?? [],
    },
    yAxis: { type: "value", name: "GB", nameTextStyle: { color: "#8a8a8a" } },
    series: [
      {
        name: "上传",
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.08 },
        data: usage?.daily.map((item) => Number((item.txBytes / GB).toFixed(3))) ?? [],
      },
      {
        name: "下载",
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.08 },
        data: usage?.daily.map((item) => Number((item.rxBytes / GB).toFixed(3))) ?? [],
      },
    ],
  }), [usage]);

  const nodeTrafficOption = useMemo<EChartsOption>(() => {
    const rows = [...(usage?.nodes ?? [])].slice(0, 8).reverse();
    return {
      animationDuration: 500,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (value) => `${Number(value).toFixed(2)} GB` },
      grid: { left: 8, right: 18, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value", name: "GB" },
      yAxis: { type: "category", data: rows.map((item) => item.nodeLabel) },
      series: [{
        name: "累计流量",
        type: "bar",
        barMaxWidth: 20,
        itemStyle: { borderRadius: [0, 5, 5, 0] },
        data: rows.map((item) => Number((item.totalBytes / GB).toFixed(3))),
      }],
    };
  }, [usage]);

  const statusOption = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [{
      type: "pie",
      radius: ["54%", "76%"],
      center: ["50%", "44%"],
      label: { show: false },
      data: [
        { name: "活跃", value: activeSubscriptions.length },
        { name: "过期", value: subscriptions.filter((item) => item.status === "expired").length },
        { name: "暂停", value: subscriptions.filter((item) => item.status === "paused").length },
        { name: "取消", value: subscriptions.filter((item) => item.status === "canceled").length },
      ],
    }],
  }), [activeSubscriptions.length, subscriptions]);

  const authOption = useMemo<EChartsOption>(() => ({
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [{
      type: "pie",
      radius: ["54%", "76%"],
      center: ["50%", "44%"],
      label: { show: false },
      data: [{ name: "通过", value: passEvents }, { name: "拦截", value: blockEvents }],
    }],
  }), [blockEvents, passEvents]);

  const attentionSubscriptions = [...subscriptions]
    .sort((a, b) => {
      if (a.status !== "active" && b.status === "active") return -1;
      if (a.status === "active" && b.status !== "active") return 1;
      return new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime();
    })
    .slice(0, 8);

  return (
    <ConsoleShell
      title="管理台总览"
      subtitle="用户、订阅、节点、流量和鉴权状态集中概览"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge success">{activeNodes.length}/{nodes.length} 节点在线</span>}
      toolbarActions={<button className="toolbar-button" type="button" disabled={loading} onClick={() => void load()}><Icon name="refresh" />刷新数据</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}

      <section className="metric-grid admin-primary-metrics">
        <MetricCard label="累计总流量" value={formatBytes(usage?.totals.totalBytes ?? 0)} footnote={`上传 ${formatBytes(usage?.totals.txBytes ?? 0)} · 下载 ${formatBytes(usage?.totals.rxBytes ?? 0)}`} />
        <MetricCard label="近 24 小时" value={formatBytes(usage?.totals.last24HoursBytes ?? 0)} footnote={`近 7 天 ${formatBytes(usage?.totals.last7DaysBytes ?? 0)}`} />
        <MetricCard label="活跃订阅" value={`${activeSubscriptions.length}/${subscriptions.length}`} footnote={`${users.length} 位用户 · ${restrictedUsers.length} 位受限`} />
        <MetricCard label="当前在线设备" value={String(totalConcurrent)} footnote={`${activeNodes.length} 个活跃节点承载`} />
      </section>

      <section className="admin-chart-grid">
        <Panel title="近 14 天流量趋势" copy="按日汇总全部节点上传和下载流量。">
          <EChart option={trafficOption} height={320} ariaLabel="近十四天上传下载流量趋势" />
        </Panel>
        <Panel title="节点累计流量排行" copy="展示每个节点自记录以来累计处理的总流量。">
          <EChart option={nodeTrafficOption} height={320} ariaLabel="节点累计流量排行" />
        </Panel>
      </section>

      <section className="admin-overview-row">
        <Panel title="订阅状态" copy={`${subscriptions.length} 条订阅`}>
          <EChart option={statusOption} height={240} ariaLabel="订阅状态分布" />
        </Panel>
        <Panel title="鉴权结果" copy={`最近 ${authEvents.length} 条记录`}>
          <EChart option={authOption} height={240} ariaLabel="鉴权结果分布" />
        </Panel>
        <Panel title="快捷操作" copy="常用管理入口集中到这里。">
          <div className="admin-quick-actions">
            <Link href="/admin/users"><Icon name="group" /><span><strong>新增用户</strong><small>创建账号并开通套餐</small></span><b>›</b></Link>
            <Link href="/admin/subscriptions"><Icon name="subscription" /><span><strong>新增订阅</strong><small>为现有会员开通服务</small></span><b>›</b></Link>
            <Link href="/admin/nodes"><Icon name="hub" /><span><strong>新增节点</strong><small>接入 Hysteria 2 节点</small></span><b>›</b></Link>
            <Link href="/admin/plans"><Icon name="stacks" /><span><strong>新增套餐</strong><small>配置价格、流量与速率</small></span><b>›</b></Link>
          </div>
        </Panel>
      </section>

      <Panel title="节点运行概览" copy="累计流量来自完整用量记录，在线数来自最近节点快照。">
        <DataTable
          headers={["节点", "状态", "累计总流量", "上传", "下载", "当前并发", "最近流量"]}
          rows={(usage?.nodes ?? []).map((item) => {
            const node = nodes.find((candidate) => candidate.id === item.nodeId);
            return [
              <strong key={`${item.nodeId}-name`}>{item.nodeLabel}</strong>,
              <span key={`${item.nodeId}-status`} className={`badge ${item.active ? "success" : "warn"}`}>{item.active ? "运行中" : "已停用"}</span>,
              <strong key={`${item.nodeId}-total`}>{formatBytes(item.totalBytes)}</strong>,
              formatBytes(item.txBytes),
              formatBytes(item.rxBytes),
              String(node?.concurrentUsers ?? 0),
              item.lastSeenAt ? formatDateTime(item.lastSeenAt) : "暂无记录",
            ];
          })}
        />
      </Panel>

      <section className="workspace-grid">
        <Panel title="需要关注的订阅" copy="状态异常和即将到期的订阅排在前面。">
          <DataTable
            headers={["用户", "套餐", "节点", "状态", "剩余流量", "到期时间"]}
            rows={attentionSubscriptions.map((subscription) => [
              <div key={`${subscription.id}-user`} className="split"><strong>{subscription.userDisplayName}</strong><span className="muted">{subscription.userEmail}</span></div>,
              subscription.planName,
              subscription.nodeLabel,
              <span key={`${subscription.id}-status`} className={`badge ${statusTone(subscription.status)}`}>{subscription.status}</span>,
              formatBytes(subscription.trafficRemainingBytes),
              formatDateTime(subscription.endsAt),
            ])}
          />
        </Panel>
        <Panel title="高用量用户" copy="按历史累计总流量排序。">
          <div className="rank-list">
            {(usage?.users ?? []).slice(0, 8).map((item, index) => (
              <div className="rank-row" key={item.userId}>
                <span>{index + 1}</span>
                <div><strong>{item.userDisplayName}</strong><small>{item.userEmail}</small></div>
                <b>{formatBytes(item.totalBytes)}</b>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <div className="fine-print admin-dashboard-footnote">当前共有 {plans.filter((plan) => plan.active).length} 个可售套餐，统计数据基于 {usage?.totals.recordCount ?? 0} 条流量记录。</div>
    </ConsoleShell>
  );
}
