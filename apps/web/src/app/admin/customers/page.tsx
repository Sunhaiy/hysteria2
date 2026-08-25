"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { PaginatedResponse, PlanRecord } from "@/lib/types";

type Customer = {
  id: string;
  email: string;
  displayName: string;
  status: "active" | "suspended" | "banned";
  balanceCents: number;
  remainingBytes: number;
  activePlanNames: string[];
  activeTrafficPackCount: number;
  quotaState: "available" | "low" | "exhausted";
  online: boolean;
  onlineClients: number;
  primaryAccessTokenLastUsedAt?: string | null;
  createdAt: string;
};

const statusLabel = { active: "正常", suspended: "停用", banned: "封禁" } as const;
const emptyPage: PaginatedResponse<Customer> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};

export default function CustomersPage() {
  const { token } = useAuth();
  const [data, setData] = useState<PaginatedResponse<Customer>>(emptyPage);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [quota, setQuota] = useState("");
  const [planId, setPlanId] = useState("");
  const [online, setOnline] = useState("");
  const [subscriptionHistory, setSubscriptionHistory] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<PlanRecord[]>("/api/admin/plans", {
      token,
      signal: controller.signal,
    })
      .then(setPlans)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setPlans([]);
      });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (debouncedSearch) query.set("q", debouncedSearch);
      if (status) query.set("status", status);
      if (quota) query.set("quotaState", quota);
      if (planId) query.set("planId", planId);
      if (online) query.set("online", online);
      if (subscriptionHistory)
        query.set("subscriptionHistory", subscriptionHistory);

      setLoading(true);
      setError(null);
      void apiRequest<PaginatedResponse<Customer>>(
        `/api/admin/customers?${query}`,
        { token, signal: controller.signal },
      )
        .then(setData)
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setError(
            cause instanceof ApiError ? cause.message : "客户数据加载失败。",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [debouncedSearch, online, page, planId, quota, refreshKey, status, subscriptionHistory, token]);

  const active = data.items.filter((customer) => customer.status === "active").length;
  const lowQuota = data.items.filter((customer) => customer.quotaState !== "available").length;
  const wallet = data.items.reduce((sum, customer) => sum + customer.balanceCents, 0);

  return (
    <ConsoleShell
      title="客户"
      subtitle="客户运营与服务控制"
      scope="CRM"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">{data.total} 位客户</span>}
      toolbarActions={
        <button
          className="toolbar-button"
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          <Icon name="refresh" />刷新
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard label="客户总数" value={String(data.total)} footnote="仅会员账户" />
          <MetricCard label="正常客户" value={String(active)} footnote="当前页" />
          <MetricCard label="额度关注" value={String(lowQuota)} footnote="当前页低额度或已耗尽" />
          <MetricCard label="钱包负债" value={formatMoney(wallet)} footnote="当前页余额合计" />
        </div>
        <Panel title="客户列表" copy="点击客户进入 360 详情页。">
          <div className="filter-grid">
            <label className="field">
              <span className="fine-print">搜索</span>
              <input
                className="control"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="邮箱、名称或客户 ID"
              />
            </label>
            <label className="field">
              <span className="fine-print">账户状态</span>
              <CustomSelect
                value={status}
                onChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "全部状态" },
                  { value: "active", label: "正常" },
                  { value: "suspended", label: "停用" },
                  { value: "banned", label: "封禁" },
                ]}
              />
            </label>
            <label className="field">
              <span className="fine-print">额度状态</span>
              <CustomSelect
                value={quota}
                onChange={(value) => {
                  setQuota(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "全部额度" },
                  { value: "available", label: "充足" },
                  { value: "low", label: "偏低" },
                  { value: "exhausted", label: "已耗尽" },
                ]}
              />
            </label>
            <label className="field">
              <span className="fine-print">当前套餐</span>
              <CustomSelect
                value={planId}
                onChange={(value) => {
                  setPlanId(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "全部套餐" },
                  ...plans.map((plan) => ({
                    value: plan.id,
                    label: plan.name,
                  })),
                ]}
              />
            </label>
            <label className="field">
              <span className="fine-print">在线状态</span>
              <CustomSelect
                value={online}
                onChange={(value) => {
                  setOnline(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "全部在线状态" },
                  { value: "true", label: "在线" },
                  { value: "false", label: "离线" },
                ]}
              />
            </label>
            <label className="field">
              <span className="fine-print">订阅历史</span>
              <CustomSelect
                value={subscriptionHistory}
                onChange={(value) => {
                  setSubscriptionHistory(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: "全部客户" },
                  { value: "ever", label: "所有曾订阅的人" },
                  { value: "never", label: "从未订阅" },
                ]}
              />
            </label>
          </div>
          <DataTable
            loading={loading}
            error={error}
            emptyText="没有符合条件的客户"
            onRetry={() => setRefreshKey((value) => value + 1)}
            pagination={{
              page: data.page,
              pageSize: data.pageSize,
              total: data.total,
              totalPages: data.totalPages,
              onPageChange: setPage,
            }}
            headers={[
              "客户",
              "状态",
              "有效权益",
              "剩余额度",
              "在线",
              "钱包",
              "最近接入",
            ]}
            rows={data.items.map((customer) => [
                <Link className="link-button" href={`/admin/customers/${customer.id}`} key={customer.id}>
                  <strong>{customer.displayName}</strong>
                  <span>{customer.email}</span>
                </Link>,
                <span className={`badge ${customer.status === "active" ? "success" : "danger"}`} key={`${customer.id}-status`}>
                  {statusLabel[customer.status]}
                </span>,
                customer.activePlanNames.length
                  ? `${customer.activePlanNames.join(" · ")} + ${customer.activeTrafficPackCount} 个流量包`
                  : `${customer.activeTrafficPackCount} 个独立流量包`,
                <span className={`badge ${customer.quotaState === "available" ? "success" : customer.quotaState === "low" ? "warn" : "danger"}`} key={`${customer.id}-quota`}>
                  {formatBytes(customer.remainingBytes)}
                </span>,
                <span
                  className={`badge ${customer.online ? "success" : "neutral"}`}
                  key={`${customer.id}-online`}
                >
                  {customer.online ? `${customer.onlineClients} 个连接` : "离线"}
                </span>,
                formatMoney(customer.balanceCents),
                customer.primaryAccessTokenLastUsedAt
                  ? formatDateTime(customer.primaryAccessTokenLastUsedAt)
                  : "从未接入",
              ])}
          />
        </Panel>
      </div>
    </ConsoleShell>
  );
}
