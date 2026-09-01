"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { EChart } from "@/components/echart";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiDownload, apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";

type Summary = {
  fulfilledNetRevenueCents: number;
  cdkRevenueCents: number;
  refundCents: number;
  amortizedNodeCostCents: number;
  grossProfitCents: number;
  walletLiabilityCents: number;
  appliedOrders: number;
  pendingOrders: number;
};
type Order = {
  id: string;
  userEmail: string;
  productName?: string | null;
  status: string;
  source: string;
  amountCents: number;
  refundedCents: number;
  createdAt: string;
};
type Ledger = {
  id: string;
  userEmail: string;
  actorEmail?: string | null;
  kind: string;
  amountCents: number;
  beforeBalanceCents?: number | null;
  afterBalanceCents?: number | null;
  createdAt: string;
};
type Refund = {
  id: string;
  orderId: string;
  userEmail: string;
  method: string;
  status: string;
  amountCents: number;
  reason: string;
  createdAt: string;
};
type NodeCost = {
  id: string;
  nodeLabel: string;
  amountCents: number;
  amortizedCents: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  providerReference?: string | null;
};
type AnnualBreakEven = {
  year: number;
  status: "unconfigured" | "not_recovered" | "recovered";
  annualCostCents: number | null;
  recognizedRevenueCents: number;
  refundCents: number;
  netRevenueCents: number;
  progressPercent: number | null;
  differenceCents: number | null;
  remainingCents: number | null;
  profitCents: number | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
};
type View = "overview" | "orders" | "ledger" | "refunds" | "costs";

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const currentShanghaiYear = () =>
  Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(new Date()),
  );
const emptyPage = <T,>(): PaginatedResponse<T> => ({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
});

export default function FinancePage() {
  const { token } = useAuth();
  const [view, setView] = useState<View>("overview");
  const [from, setFrom] = useState(() =>
    isoDate(new Date(Date.now() - 30 * 86400000)),
  );
  const [to, setTo] = useState(() => isoDate(new Date(Date.now() + 86400000)));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState(emptyPage<Order>);
  const [ledger, setLedger] = useState(emptyPage<Ledger>);
  const [refunds, setRefunds] = useState(emptyPage<Refund>);
  const [costs, setCosts] = useState(emptyPage<NodeCost>);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [annualYear, setAnnualYear] = useState(currentShanghaiYear);
  const [annualCostYuan, setAnnualCostYuan] = useState("");
  const [annual, setAnnual] = useState<AnnualBreakEven | null>(null);
  const [annualSaving, setAnnualSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({ from, to });
      void apiRequest<Summary>(`/api/admin/finance/summary?${query}`, {
        token,
        signal: controller.signal,
      })
        .then(setSummary)
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setError(
            cause instanceof ApiError ? cause.message : "财务汇总加载失败。",
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
  }, [from, reloadKey, to, token]);

  const loadAnnual = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      try {
        const result = await apiRequest<AnnualBreakEven>(
          `/api/admin/finance/annual-break-even?year=${annualYear}`,
          { token, signal },
        );
        setAnnual(result);
        setAnnualCostYuan(
          result.annualCostCents == null
            ? ""
            : String(result.annualCostCents / 100),
        );
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof ApiError ? cause.message : "年度回本数据加载失败。",
        );
      }
    },
    [annualYear, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadAnnual(controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadAnnual, reloadKey]);

  useEffect(() => {
    if (!token || view === "overview") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({
        from,
        to,
        page: String(page),
        pageSize: "20",
      });
      void apiRequest<PaginatedResponse<Order | Ledger | Refund | NodeCost>>(
        `/api/admin/finance/${view === "costs" ? "node-costs" : view}?${query}`,
        { token, signal: controller.signal },
      )
        .then((result) => {
          if (view === "orders") setOrders(result as PaginatedResponse<Order>);
          if (view === "ledger") setLedger(result as PaginatedResponse<Ledger>);
          if (view === "refunds")
            setRefunds(result as PaginatedResponse<Refund>);
          if (view === "costs") setCosts(result as PaginatedResponse<NodeCost>);
        })
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setError(
            cause instanceof ApiError ? cause.message : "财务列表加载失败。",
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
  }, [from, page, reloadKey, to, token, view]);

  const changeView = useCallback((next: View) => {
    if (next === "orders") {
      window.location.assign("/admin/orders");
      return;
    }
    setView(next);
    setPage(1);
  }, []);

  const profitOption = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: ["履约收入", "退款", "节点成本", "毛利"],
      },
      yAxis: {
        type: "value",
        axisLabel: {
          formatter: (value: number) => `¥${(value / 100).toFixed(0)}`,
        },
      },
      series: [
        {
          type: "bar",
          data: summary
            ? [
                summary.fulfilledNetRevenueCents,
                -summary.refundCents,
                -summary.amortizedNodeCostCents,
                summary.grossProfitCents,
              ]
            : [],
        },
      ],
    }),
    [summary],
  );

  const activePage =
    view === "orders"
      ? orders
      : view === "ledger"
        ? ledger
        : view === "refunds"
          ? refunds
          : costs;
  const pagination = {
    page: activePage.page,
    pageSize: activePage.pageSize,
    total: activePage.total,
    totalPages: activePage.totalPages,
    onPageChange: setPage,
  };
  const queryString = new URLSearchParams({ from, to }).toString();

  async function saveAnnualCost() {
    if (!token) return;
    const totalCostCents = Math.round(Number(annualCostYuan) * 100);
    if (!Number.isSafeInteger(totalCostCents) || totalCostCents < 0) {
      setError("请输入有效的年度总成本。");
      return;
    }
    setAnnualSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/admin/finance/annual-costs/${annualYear}`, {
        method: "PUT",
        token,
        body: { totalCostCents },
      });
      await loadAnnual();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "年度成本保存失败。",
      );
    } finally {
      setAnnualSaving(false);
    }
  }

  return (
    <ConsoleShell
      title="财务中心"
      subtitle="按权益发放确认收入，退款实时冲减"
      scope="Finance"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">CNY · Asia/Shanghai</span>}
      toolbarActions={
        view === "orders" || view === "ledger" ? (
          <button
            className="toolbar-button"
            type="button"
            onClick={() =>
              void apiDownload(
                `/api/admin/finance/export?kind=${view}&${queryString}`,
                "finance.csv",
              )
            }
          >
            <Icon name="download" />
            导出
          </button>
        ) : null
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="page-stack">
        <Panel title="查询区间">
          <div className="inline-form">
            <label className="field">
              <span className="fine-print">开始日期</span>
              <input
                className="control"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="field">
              <span className="fine-print">结束日期（不含）</span>
              <input
                className="control"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <button
              className="action-button"
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              <Icon name="refresh" />
              刷新
            </button>
          </div>
        </Panel>
        <div className="metric-grid">
          <MetricCard
            label="已履约净收入"
            value={formatMoney(summary?.fulfilledNetRevenueCents ?? 0)}
            footnote={`${summary?.appliedOrders ?? 0} 笔已履约订单`}
          />
          <MetricCard
            label="退款"
            value={formatMoney(summary?.refundCents ?? 0)}
            footnote="冲减区间净收入"
          />
          <MetricCard
            label="摊销节点成本"
            value={formatMoney(summary?.amortizedNodeCostCents ?? 0)}
            footnote="按有效日期逐日摊销"
          />
          <MetricCard
            label="毛利"
            value={formatMoney(summary?.grossProfitCents ?? 0)}
            footnote={`钱包负债 ${formatMoney(summary?.walletLiabilityCents ?? 0)}`}
          />
        </div>
        <div className="segmented-control" aria-label="财务视图">
          {(
            [
              ["overview", "经营概览"],
              ["orders", "订单"],
              ["ledger", "钱包流水"],
              ["refunds", "退款与冲正"],
              ["costs", "节点成本"],
            ] as Array<[View, string]>
          ).map(([key, label]) => (
            <button
              type="button"
              className={view === key ? "active" : ""}
              key={key}
              onClick={() => changeView(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "overview" ? (
          <>
            <Panel
              title="年度回本"
              copy="年度总成本独立计算，不与节点成本重复相加。"
            >
              <div className="annual-break-even-layout">
                <div className="annual-cost-form">
                  <label className="field">
                    <span className="fine-print">年份</span>
                    <input
                      className="control"
                      type="number"
                      min={2000}
                      max={2100}
                      value={annualYear}
                      onChange={(event) =>
                        setAnnualYear(Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="fine-print">年度总成本（元）</span>
                    <input
                      className="control"
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="例如 12000"
                      value={annualCostYuan}
                      onChange={(event) =>
                        setAnnualCostYuan(event.target.value)
                      }
                    />
                  </label>
                  <button
                    className="action-button"
                    type="button"
                    disabled={annualSaving || annualCostYuan === ""}
                    onClick={() => void saveAnnualCost()}
                  >
                    {annualSaving ? "保存中..." : "保存年度成本"}
                  </button>
                </div>
                <div className="annual-break-even-summary">
                  <div className="split-row">
                    <span>年度净收入</span>
                    <strong>{formatMoney(annual?.netRevenueCents ?? 0)}</strong>
                  </div>
                  <div className="split-row">
                    <span>年度成本</span>
                    <strong>
                      {annual?.annualCostCents == null
                        ? "未配置"
                        : formatMoney(annual.annualCostCents)}
                    </strong>
                  </div>
                  <div className="bar-track" aria-label="年度回本进度">
                    <span
                      className="bar-fill bar-fill-success"
                      style={{ width: `${annual?.progressPercent ?? 0}%` }}
                    />
                  </div>
                  <div className="split-row fine-print">
                    <span>回本进度 {annual?.progressPercent ?? 0}%</span>
                    <span>
                      {annual?.status === "recovered"
                        ? `已回本 · 盈利 ${formatMoney(annual.profitCents ?? 0)}`
                        : annual?.status === "not_recovered"
                          ? `未回本 · 还差 ${formatMoney(annual.remainingCents ?? 0)}`
                          : "请先填写年度总成本"}
                    </span>
                  </div>
                </div>
              </div>
            </Panel>
            <div className="two-col">
              <Panel title="毛利构成">
                <EChart
                  option={profitOption}
                  height={280}
                  ariaLabel="毛利构成图"
                />
              </Panel>
              <Panel title="收入确认">
                <DataTable
                  headers={["分类", "金额"]}
                  rows={[
                    [
                      "全部已履约收入",
                      formatMoney(summary?.fulfilledNetRevenueCents ?? 0),
                    ],
                    [
                      "CDK 套餐收入（周期实际价）",
                      formatMoney(summary?.cdkRevenueCents ?? 0),
                    ],
                    [
                      "钱包余额负债",
                      formatMoney(summary?.walletLiabilityCents ?? 0),
                    ],
                    ["待处理订单", String(summary?.pendingOrders ?? 0)],
                  ]}
                />
              </Panel>
            </div>
          </>
        ) : null}
        {view === "orders" ? (
          <Panel title="订单">
            <DataTable
              loading={loading}
              error={error}
              onRetry={() => setReloadKey((value) => value + 1)}
              pagination={pagination}
              emptyText="该区间暂无订单"
              headers={["时间", "客户", "商品", "来源", "成交", "退款", "状态"]}
              rows={orders.items.map((order) => [
                formatDateTime(order.createdAt),
                order.userEmail,
                order.productName ?? order.id,
                order.source,
                formatMoney(order.amountCents),
                formatMoney(order.refundedCents),
                order.status,
              ])}
            />
          </Panel>
        ) : null}
        {view === "ledger" ? (
          <Panel title="钱包流水">
            <DataTable
              loading={loading}
              error={error}
              onRetry={() => setReloadKey((value) => value + 1)}
              pagination={pagination}
              emptyText="该区间暂无钱包流水"
              headers={[
                "时间",
                "客户",
                "类型",
                "变更",
                "变更前",
                "变更后",
                "操作者",
              ]}
              rows={ledger.items.map((entry) => [
                formatDateTime(entry.createdAt),
                entry.userEmail,
                entry.kind,
                formatMoney(entry.amountCents),
                entry.beforeBalanceCents == null
                  ? "-"
                  : formatMoney(entry.beforeBalanceCents),
                entry.afterBalanceCents == null
                  ? "-"
                  : formatMoney(entry.afterBalanceCents),
                entry.actorEmail ?? "系统",
              ])}
            />
          </Panel>
        ) : null}
        {view === "refunds" ? (
          <Panel title="退款与冲正">
            <DataTable
              loading={loading}
              error={error}
              onRetry={() => setReloadKey((value) => value + 1)}
              pagination={pagination}
              emptyText="该区间暂无退款"
              headers={["时间", "客户", "订单", "方式", "金额", "原因", "状态"]}
              rows={refunds.items.map((refund) => [
                formatDateTime(refund.createdAt),
                refund.userEmail,
                refund.orderId,
                refund.method,
                formatMoney(refund.amountCents),
                refund.reason,
                refund.status,
              ])}
            />
          </Panel>
        ) : null}
        {view === "costs" ? (
          <Panel title="节点成本">
            <DataTable
              loading={loading}
              error={error}
              onRetry={() => setReloadKey((value) => value + 1)}
              pagination={pagination}
              emptyText="该区间暂无节点成本"
              headers={["节点", "合同金额", "区间摊销", "有效期", "供应商单号"]}
              rows={costs.items.map((cost) => [
                cost.nodeLabel,
                formatMoney(cost.amountCents),
                formatMoney(cost.amortizedCents),
                `${formatDateTime(cost.effectiveFrom)} - ${cost.effectiveTo ? formatDateTime(cost.effectiveTo) : "持续"}`,
                cost.providerReference ?? "-",
              ])}
            />
          </Panel>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
