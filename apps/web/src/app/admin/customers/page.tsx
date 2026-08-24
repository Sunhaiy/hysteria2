"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
  primaryAccessTokenLastUsedAt?: string | null;
  createdAt: string;
};

type CustomerPage = { items: Customer[]; total: number; nextCursor: string | null };

const statusLabel = { active: "正常", suspended: "停用", banned: "封禁" } as const;

export default function CustomersPage() {
  const { token } = useAuth();
  const [data, setData] = useState<CustomerPage>({ items: [], total: 0, nextCursor: null });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [quota, setQuota] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ limit: "100" });
    if (search.trim()) query.set("q", search.trim());
    if (status) query.set("status", status);
    if (quota) query.set("quotaState", quota);
    try {
      setData(
        await apiRequest<CustomerPage>(`/api/admin/customers?${query}`, { token }),
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "客户数据加载失败。");
    } finally {
      setLoading(false);
    }
  }, [quota, search, status, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(timer);
  }, [load]);

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
        <button className="toolbar-button" type="button" onClick={() => void load()}>
          <Icon name="refresh" />刷新
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard label="客户总数" value={String(data.total)} footnote="仅会员账户" />
          <MetricCard label="正常客户" value={String(active)} footnote="当前筛选结果" />
          <MetricCard label="额度关注" value={String(lowQuota)} footnote="低额度或已耗尽" />
          <MetricCard label="钱包负债" value={formatMoney(wallet)} footnote="当前筛选余额合计" />
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
                onChange={setStatus}
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
                onChange={setQuota}
                options={[
                  { value: "", label: "全部额度" },
                  { value: "available", label: "充足" },
                  { value: "low", label: "偏低" },
                  { value: "exhausted", label: "已耗尽" },
                ]}
              />
            </label>
          </div>
          {data.items.length ? (
            <DataTable
              headers={["客户", "状态", "有效权益", "剩余额度", "钱包", "最近接入"]}
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
                formatMoney(customer.balanceCents),
                customer.primaryAccessTokenLastUsedAt
                  ? formatDateTime(customer.primaryAccessTokenLastUsedAt)
                  : "从未接入",
              ])}
            />
          ) : !loading ? (
            <div className="empty-state"><div className="empty-state-title">没有符合条件的客户</div></div>
          ) : null}
        </Panel>
      </div>
    </ConsoleShell>
  );
}
