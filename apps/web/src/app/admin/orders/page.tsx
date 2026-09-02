"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomerLink } from "@/components/customer-link";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiDownload, apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { PaginatedResponse, PlanRecord } from "@/lib/types";
import { statusTone } from "@/lib/ui";

type View = "orders" | "attempts";

type OrderRecord = {
  id: string;
  user: { id: string; email: string; displayName: string };
  product: { id: string | null; name: string; kind: "plan" | "traffic_pack" };
  offer: { id: string; name: string; billingPeriod: string } | null;
  source: string;
  fulfillmentStatus: "pending" | "applied" | "void";
  paymentStatus: string;
  paymentType: "alipay" | "wxpay" | null;
  amountCents: number;
  paidCents: number;
  refundedCents: number;
  currency: string;
  merchantOrderNo: string | null;
  gatewayTradeNo: string | null;
  createdAt: string;
  processedAt: string | null;
};

type PaymentAttempt = {
  id: string;
  orderId: string | null;
  merchantOrderNo: string;
  gatewayTradeNo: string | null;
  status: "pending" | "settled" | "expired" | "failed";
  paymentType: "alipay" | "wxpay";
  amountCents: number;
  productName: string;
  fulfillmentPending: boolean;
  settlementFailureCount: number;
  lastSettlementError: string | null;
  lastSettlementFailedAt: string | null;
  lastQueryAt: string | null;
  queryFailureCount: number;
  lastQueryError: string | null;
  closedAt: string | null;
  expiresAt: string;
  settledAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; displayName: string };
  product: { id: string; name: string; kind: "plan" | "traffic_pack" };
  offer: { id: string; name: string; billingPeriod: string };
};

type OrderDetail = OrderRecord & {
  basePriceCents: number | null;
  discountCents: number;
  durationDays: number | null;
  validityDays: number | null;
  trafficBytes: number | null;
  entitlementExpiresAt: string | null;
  speedUpMbps: number | null;
  speedDownMbps: number | null;
  trafficMultiplier: number | null;
  processedBy: { id: string; email: string; displayName: string } | null;
  note: string | null;
  payments: Array<{
    id: string;
    source: string;
    status: string;
    amountCents: number;
    externalRef: string | null;
    paidAt: string | null;
    reconciledAt: string | null;
    createdAt: string;
  }>;
  refunds: Array<{
    id: string;
    method: string;
    status: string;
    amountCents: number;
    reason: string;
    processedAt: string | null;
    createdAt: string;
  }>;
  paymentAttempt: PaymentAttempt | null;
  audits: Array<{ id: string; action: string; createdAt: string }>;
};

type RevenueWindow = {
  from: string;
  to: string;
  grossRevenueCents: number;
  refundCents: number;
  netRevenueCents: number;
  orderCount: number;
  refundCount: number;
};

type OrderSummary = {
  timezone: "Asia/Shanghai";
  currency: "CNY";
  generatedAt: string;
  today: RevenueWindow;
  month: RevenueWindow;
};

type AnnualBreakEven = {
  year: number;
  status: "unconfigured" | "not_recovered" | "recovered";
  annualCostCents: number | null;
  netRevenueCents: number;
  progressPercent: number | null;
  remainingCents: number | null;
  profitCents: number | null;
  updatedAt: string | null;
};

type Catalog = {
  products: Array<{
    id: string;
    name: string;
    kind: "plan" | "traffic_pack";
    status: string;
  }>;
};

const emptyPage = <T,>(): PaginatedResponse<T> => ({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
});

const emptyFilters = {
  q: "",
  from: "",
  to: "",
  status: "",
  source: "",
  paymentStatus: "",
  productKind: "",
  productId: "",
  paymentType: "",
};

const emptyManualForm = {
  userId: "",
  kind: "renewal" as "renewal" | "traffic_pack" | "manual_credit",
  status: "pending" as "pending" | "applied",
  planId: "",
  amountCents: 0,
  durationDays: 30,
  trafficBytes: 0,
  note: "",
};

const paymentStatusLabel: Record<string, string> = {
  settled: "已支付",
  pending: "待支付",
  refunded: "已退款",
  partially_refunded: "部分退款",
  void: "已作废",
  not_required: "无需支付",
  expired: "已过期",
  failed: "失败",
};

const sourceLabel: Record<string, string> = {
  payment: "易支付",
  cdk: "CDK",
  wallet: "余额",
  admin: "人工",
  legacy: "历史",
};

const channelLabel: Record<string, string> = {
  alipay: "支付宝",
  wxpay: "微信支付",
};

function currentShanghaiYear() {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(new Date()),
  );
}

function queryString(filters: typeof emptyFilters, page: number, view: View) {
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    if (view === "attempts" && ["source", "paymentStatus"].includes(key)) {
      continue;
    }
    query.set(key, value);
  }
  return query.toString();
}

export default function AdminOrdersPage() {
  const { token } = useAuth();
  const annualYear = currentShanghaiYear();
  const [view, setView] = useState<View>("orders");
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const [annual, setAnnual] = useState<AnnualBreakEven | null>(null);
  const [annualCostYuan, setAnnualCostYuan] = useState("");
  const [annualSaving, setAnnualSaving] = useState(false);
  const [orders, setOrders] = useState(emptyPage<OrderRecord>());
  const [attempts, setAttempts] = useState(emptyPage<PaymentAttempt>());
  const [catalog, setCatalog] = useState<Catalog>({ products: [] });
  const [users, setUsers] = useState<
    Array<{ id: string; email: string; displayName: string }>
  >([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [attemptDetail, setAttemptDetail] = useState<PaymentAttempt | null>(
    null,
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState(emptyManualForm);
  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => ({ ...current, q: search.trim() }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setSummary(
      await apiRequest<OrderSummary>("/api/admin/orders/summary", { token }),
    );
  }, [token]);

  const loadAnnual = useCallback(async () => {
    if (!token) return;
    const result = await apiRequest<AnnualBreakEven>(
      `/api/admin/finance/annual-break-even?year=${annualYear}`,
      { token },
    );
    setAnnual(result);
    setAnnualCostYuan(
      result.annualCostCents == null
        ? ""
        : String(result.annualCostCents / 100),
    );
  }, [annualYear, token]);

  const loadPage = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (view === "orders") {
        setOrders(
          await apiRequest<PaginatedResponse<OrderRecord>>(
            `/api/admin/orders?${queryString(filters, page, view)}`,
            { token },
          ),
        );
      } else {
        setAttempts(
          await apiRequest<PaginatedResponse<PaymentAttempt>>(
            `/api/admin/orders/payment-attempts?${queryString(filters, page, view)}`,
            { token },
          ),
        );
      }
    } catch (cause) {
      setFeedback({
        kind: "error",
        message: cause instanceof ApiError ? cause.message : "订单加载失败。",
      });
    } finally {
      setLoading(false);
    }
  }, [filters, page, token, view]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => {
      void Promise.all([
        loadSummary(),
        loadAnnual(),
        apiRequest<Catalog>("/api/admin/catalog", { token }).then(setCatalog),
        apiRequest<Array<{ id: string; email: string; displayName: string }>>(
          "/api/admin/customers/options?pageSize=20",
          { token },
        ).then(setUsers),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }).then((items) =>
          setPlans(items.filter((item) => item.active)),
        ),
      ]).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAnnual, loadSummary, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPage(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPage]);

  const currentPage = view === "orders" ? orders : attempts;
  const products = useMemo(
    () =>
      catalog.products.filter(
        (product) =>
          !filters.productKind || product.kind === filters.productKind,
      ),
    [catalog.products, filters.productKind],
  );

  function updateFilter(key: keyof typeof emptyFilters, value: string) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "productKind" ? { productId: "" } : {}),
    }));
    setPage(1);
  }

  function switchView(next: View) {
    setView(next);
    setPage(1);
    setFilters((current) => ({
      ...current,
      status: "",
      source: "",
      paymentStatus: "",
    }));
  }

  async function refresh() {
    await Promise.all([loadPage(), loadSummary(), loadAnnual()]);
  }

  async function saveAnnualCost() {
    if (!token) return;
    const totalCostCents = Math.round(Number(annualCostYuan) * 100);
    if (!Number.isSafeInteger(totalCostCents) || totalCostCents < 0) {
      setFeedback({ kind: "error", message: "请输入有效的年度总成本。" });
      return;
    }
    setAnnualSaving(true);
    try {
      await apiRequest(`/api/admin/finance/annual-costs/${annualYear}`, {
        method: "PUT",
        token,
        body: { totalCostCents },
      });
      await loadAnnual();
      setFeedback({ kind: "success", message: "年度成本已更新。" });
    } catch (cause) {
      setFeedback({
        kind: "error",
        message:
          cause instanceof ApiError ? cause.message : "年度成本保存失败。",
      });
    } finally {
      setAnnualSaving(false);
    }
  }

  async function openDetail(id: string) {
    if (!token) return;
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(
        await apiRequest<OrderDetail>(`/api/admin/orders/${id}`, { token }),
      );
    } catch (cause) {
      setFeedback({
        kind: "error",
        message:
          cause instanceof ApiError ? cause.message : "订单详情加载失败。",
      });
    } finally {
      setDetailLoading(false);
    }
  }

  async function updateOrder(id: string, status: "applied" | "void") {
    if (!token) return;
    setActingId(id);
    try {
      await apiRequest(`/api/admin/orders/${id}`, {
        method: "PATCH",
        token,
        body: { status },
      });
      setFeedback({
        kind: "success",
        message:
          status === "applied" ? "订单已确认并发放权益。" : "订单已作废。",
      });
      await refresh();
    } catch (cause) {
      setFeedback({
        kind: "error",
        message: cause instanceof ApiError ? cause.message : "订单处理失败。",
      });
    } finally {
      setActingId(null);
    }
  }

  async function createManualOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    try {
      await apiRequest("/api/admin/orders/manual-credit", {
        method: "POST",
        token,
        body: {
          userId: manualForm.userId,
          kind: manualForm.kind,
          status: manualForm.status,
          planId:
            manualForm.kind === "renewal"
              ? manualForm.planId || undefined
              : undefined,
          amountCents: manualForm.amountCents,
          durationDays:
            manualForm.kind === "traffic_pack"
              ? undefined
              : manualForm.durationDays || undefined,
          trafficBytes:
            manualForm.kind === "renewal"
              ? undefined
              : manualForm.trafficBytes || undefined,
          note: manualForm.note || undefined,
        },
      });
      setManualOpen(false);
      setManualForm(emptyManualForm);
      setFeedback({ kind: "success", message: "人工订单已创建。" });
      await refresh();
    } catch (cause) {
      setFeedback({
        kind: "error",
        message:
          cause instanceof ApiError ? cause.message : "人工订单创建失败。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function exportOrders() {
    setExporting(true);
    try {
      await apiDownload("/api/admin/reporting/orders.csv", "orders.csv");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ConsoleShell
      title="订单中心"
      subtitle="统一查看站内支付、CDK、余额与人工订单"
      scope="Commerce"
      navItems={adminNav}
      requireRole="admin"
      dataViewport
      toolbarMeta={
        <span className="badge info">
          {loading ? "加载中" : `${currentPage.total} 条记录`}
        </span>
      }
      toolbarActions={
        <>
          <button
            className="toolbar-button"
            type="button"
            disabled={exporting}
            onClick={() => void exportOrders()}
          >
            <Icon name="download" />
            {exporting ? "导出中" : "导出 CSV"}
          </button>
          <button
            className="action-button"
            type="button"
            onClick={() => setManualOpen(true)}
          >
            人工订单
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => void refresh()}
          >
            <Icon name="refresh" />
            刷新
          </button>
        </>
      }
    >
      {feedback ? (
        <div className={`feedback ${feedback.kind}`}>{feedback.message}</div>
      ) : null}

      <section className="order-summary-grid admin-data-metrics">
        <MetricCard
          label="今日实际收入"
          value={formatMoney(summary?.today.netRevenueCents ?? 0)}
          footnote={`${summary?.today.orderCount ?? 0} 笔在线支付 · 退款 ${formatMoney(summary?.today.refundCents ?? 0)}`}
        />
        <MetricCard
          label="本月实际收入"
          value={formatMoney(summary?.month.netRevenueCents ?? 0)}
          footnote={`本月 1 日起 · 不含 CDK 与人工调整`}
        />
        <article className="metric-card order-annual-cost-card">
          <div className="order-annual-cost-heading">
            <span className="metric-label">{annualYear} 年运营成本</span>
            <strong>{annual?.progressPercent ?? 0}%</strong>
          </div>
          <div className="order-annual-cost-form">
            <label className="field">
              <span className="visually-hidden">年度总成本（元）</span>
              <input
                className="control"
                type="number"
                min={0}
                step={0.01}
                value={annualCostYuan}
                onChange={(event) => setAnnualCostYuan(event.target.value)}
                placeholder="全年成本（元）"
              />
            </label>
            <button
              className="action-button compact"
              type="button"
              disabled={annualSaving || annualCostYuan === ""}
              onClick={() => void saveAnnualCost()}
            >
              {annualSaving ? "保存中" : "保存"}
            </button>
          </div>
          <div className="bar-track" aria-label="年度回本进度">
            <span
              className="bar-fill bar-fill-success"
              style={{ width: `${annual?.progressPercent ?? 0}%` }}
            />
          </div>
          <span className="metric-footnote">
            {annualYear}.01.01 - {annualYear}.12.31 ·{" "}
            {annual?.status === "recovered"
              ? `已回本，盈利 ${formatMoney(annual.profitCents ?? 0)}`
              : annual?.status === "not_recovered"
                ? `待回收 ${formatMoney(annual.remainingCents ?? 0)}`
                : "尚未设置成本"}
          </span>
        </article>
      </section>

      <Panel className="admin-data-panel" title="订单与支付">
        <div className="segmented-control" aria-label="订单视图">
          <button
            className={view === "orders" ? "active" : ""}
            type="button"
            onClick={() => switchView("orders")}
          >
            全部订单
          </button>
          <button
            className={view === "attempts" ? "active" : ""}
            type="button"
            onClick={() => switchView("attempts")}
          >
            支付异常
          </button>
        </div>

        <div className="filter-grid admin-compact-filters order-filter-grid">
          <label className="field">
            <span className="fine-print">搜索</span>
            <input
              className="control"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="订单号、交易号、邮箱或用户名"
            />
          </label>
          <div className="field order-date-field">
            <span className="fine-print">下单日期</span>
            <div className="order-date-range">
              <input
                className="control"
                aria-label="开始日期"
                type="date"
                value={filters.from}
                onChange={(event) => updateFilter("from", event.target.value)}
              />
              <span>至</span>
              <input
                className="control"
                aria-label="结束日期"
                type="date"
                value={filters.to}
                onChange={(event) => updateFilter("to", event.target.value)}
              />
            </div>
          </div>
          <label className="field">
            <span className="fine-print">商品类型</span>
            <CustomSelect
              value={filters.productKind}
              onChange={(value) => updateFilter("productKind", value)}
              options={[
                { value: "", label: "全部商品" },
                { value: "plan", label: "套餐" },
                { value: "traffic_pack", label: "流量包" },
              ]}
            />
          </label>
          <label className="field">
            <span className="fine-print">具体商品</span>
            <CustomSelect
              value={filters.productId}
              onChange={(value) => updateFilter("productId", value)}
              options={[
                { value: "", label: "全部商品" },
                ...products.map((product) => ({
                  value: product.id,
                  label: product.name,
                })),
              ]}
            />
          </label>
          <label className="field">
            <span className="fine-print">支付渠道</span>
            <CustomSelect
              value={filters.paymentType}
              onChange={(value) => updateFilter("paymentType", value)}
              options={[
                { value: "", label: "全部渠道" },
                { value: "alipay", label: "支付宝" },
                { value: "wxpay", label: "微信支付" },
              ]}
            />
          </label>
          {view === "orders" ? (
            <>
              <label className="field">
                <span className="fine-print">订单来源</span>
                <CustomSelect
                  value={filters.source}
                  onChange={(value) => updateFilter("source", value)}
                  options={[
                    { value: "", label: "全部来源" },
                    { value: "payment", label: "易支付" },
                    { value: "cdk", label: "CDK" },
                    { value: "wallet", label: "余额" },
                    { value: "admin", label: "人工" },
                    { value: "legacy", label: "历史" },
                  ]}
                />
              </label>
              <label className="field">
                <span className="fine-print">支付状态</span>
                <CustomSelect
                  value={filters.paymentStatus}
                  onChange={(value) => updateFilter("paymentStatus", value)}
                  options={[
                    { value: "", label: "全部状态" },
                    { value: "settled", label: "已支付" },
                    { value: "pending", label: "待支付" },
                    { value: "refunded", label: "已退款" },
                    { value: "void", label: "已作废" },
                    { value: "not_required", label: "无需支付" },
                  ]}
                />
              </label>
              <label className="field">
                <span className="fine-print">权益状态</span>
                <CustomSelect
                  value={filters.status}
                  onChange={(value) => updateFilter("status", value)}
                  options={[
                    { value: "", label: "全部状态" },
                    { value: "applied", label: "已生效" },
                    { value: "pending", label: "待处理" },
                    { value: "void", label: "已作废" },
                  ]}
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span className="fine-print">支付状态</span>
              <CustomSelect
                value={filters.status}
                onChange={(value) => updateFilter("status", value)}
                options={[
                  { value: "", label: "待支付与异常" },
                  { value: "pending", label: "待支付" },
                  { value: "expired", label: "已过期" },
                  { value: "failed", label: "失败" },
                  { value: "settled", label: "已结算" },
                ]}
              />
            </label>
          )}
        </div>

        {view === "orders" ? (
          <DataTable
            loading={loading}
            pagination={{
              page: orders.page,
              pageSize: orders.pageSize,
              total: orders.total,
              totalPages: orders.totalPages,
              onPageChange: setPage,
            }}
            headers={[
              "时间",
              "用户",
              "商品",
              "来源 / 渠道",
              "金额",
              "支付状态",
              "权益状态",
              "操作",
            ]}
            rows={orders.items.map((order) => [
              formatDateTime(order.processedAt ?? order.createdAt),
              <CustomerLink
                id={order.user.id}
                displayName={order.user.displayName}
                email={order.user.email}
                key={`${order.id}-user`}
              />,
              <div className="split" key={`${order.id}-product`}>
                <strong>{order.product.name}</strong>
                <span className="muted">
                  {order.product.kind === "plan" ? "套餐" : "流量包"}
                  {order.offer ? ` · ${order.offer.name}` : ""}
                </span>
              </div>,
              <div className="split" key={`${order.id}-source`}>
                <strong>{sourceLabel[order.source] ?? order.source}</strong>
                <span className="muted">
                  {order.paymentType ? channelLabel[order.paymentType] : "-"}
                </span>
              </div>,
              <div className="split" key={`${order.id}-amount`}>
                <strong>{formatMoney(order.amountCents)}</strong>
                <span className="muted">
                  {order.refundedCents
                    ? `退款 ${formatMoney(order.refundedCents)}`
                    : `实付 ${formatMoney(order.paidCents)}`}
                </span>
              </div>,
              <span
                className={`badge ${statusTone(order.paymentStatus)}`}
                key={`${order.id}-payment`}
              >
                {paymentStatusLabel[order.paymentStatus] ?? order.paymentStatus}
              </span>,
              <span
                className={`badge ${statusTone(order.fulfillmentStatus)}`}
                key={`${order.id}-fulfillment`}
              >
                {order.fulfillmentStatus === "applied"
                  ? "已生效"
                  : order.fulfillmentStatus === "pending"
                    ? "待处理"
                    : "已作废"}
              </span>,
              <div className="table-actions" key={`${order.id}-actions`}>
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => void openDetail(order.id)}
                >
                  查看
                </button>
                {order.fulfillmentStatus === "pending" ? (
                  <>
                    <button
                      className="action-button compact"
                      type="button"
                      disabled={actingId === order.id}
                      onClick={() => void updateOrder(order.id, "applied")}
                    >
                      确认
                    </button>
                    <button
                      className="ghost-button compact"
                      type="button"
                      disabled={actingId === order.id}
                      onClick={() => void updateOrder(order.id, "void")}
                    >
                      作废
                    </button>
                  </>
                ) : null}
              </div>,
            ])}
            emptyText="没有符合条件的订单"
          />
        ) : (
          <DataTable
            loading={loading}
            pagination={{
              page: attempts.page,
              pageSize: attempts.pageSize,
              total: attempts.total,
              totalPages: attempts.totalPages,
              onPageChange: setPage,
            }}
            headers={[
              "创建时间",
              "用户",
              "商品",
              "渠道",
              "金额",
              "状态",
              "异常",
              "操作",
            ]}
            rows={attempts.items.map((attempt) => [
              formatDateTime(attempt.createdAt),
              <CustomerLink
                id={attempt.user.id}
                displayName={attempt.user.displayName}
                email={attempt.user.email}
                key={`${attempt.id}-user`}
              />,
              <div className="split" key={`${attempt.id}-product`}>
                <strong>{attempt.product.name}</strong>
                <span className="muted">{attempt.offer.name}</span>
              </div>,
              channelLabel[attempt.paymentType],
              formatMoney(attempt.amountCents),
              <span
                className={`badge ${statusTone(attempt.status)}`}
                key={`${attempt.id}-status`}
              >
                {paymentStatusLabel[attempt.status] ?? attempt.status}
              </span>,
              attempt.fulfillmentPending
                ? `权益发放失败 ${attempt.settlementFailureCount} 次`
                : attempt.lastQueryError
                  ? `查单失败 ${attempt.queryFailureCount} 次`
                  : attempt.status === "pending"
                    ? "等待付款"
                    : "-",
              <button
                className="ghost-button compact"
                type="button"
                onClick={() => setAttemptDetail(attempt)}
                key={`${attempt.id}-detail`}
              >
                查看
              </button>,
            ])}
            emptyText="没有待支付或异常记录"
          />
        )}
      </Panel>

      <Drawer
        open={detailLoading || Boolean(detail)}
        onClose={() => {
          setDetail(null);
          setDetailLoading(false);
        }}
        title="订单详情"
      >
        {detailLoading ? (
          <div className="skeleton-rows">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="skeleton skeleton-row" key={index} />
            ))}
          </div>
        ) : detail ? (
          <div className="form-grid">
            <div className="list-row">
              <span className="muted">订单号</span>
              <strong className="mono">{detail.id}</strong>
            </div>
            <div className="list-row">
              <span className="muted">用户</span>
              <strong>{detail.user.email}</strong>
            </div>
            <div className="list-row">
              <span className="muted">商品</span>
              <strong>{detail.product.name}</strong>
            </div>
            <div className="list-row">
              <span className="muted">订单金额</span>
              <strong>{formatMoney(detail.amountCents)}</strong>
            </div>
            {detail.trafficBytes ? (
              <div className="list-row">
                <span className="muted">流量额度</span>
                <strong>{formatBytes(detail.trafficBytes)}</strong>
              </div>
            ) : null}
            {detail.entitlementExpiresAt ? (
              <div className="list-row">
                <span className="muted">权益到期</span>
                <strong>{formatDateTime(detail.entitlementExpiresAt)}</strong>
              </div>
            ) : null}
            {detail.paymentAttempt ? (
              <>
                <div className="list-row">
                  <span className="muted">商户订单号</span>
                  <strong className="mono">
                    {detail.paymentAttempt.merchantOrderNo}
                  </strong>
                </div>
                <div className="list-row">
                  <span className="muted">网关交易号</span>
                  <strong className="mono">
                    {detail.paymentAttempt.gatewayTradeNo ?? "-"}
                  </strong>
                </div>
              </>
            ) : null}
            {detail.payments.map((payment) => (
              <div className="list-row" key={payment.id}>
                <span className="muted">
                  {sourceLabel[payment.source] ?? payment.source}支付
                </span>
                <strong>{formatMoney(payment.amountCents)}</strong>
              </div>
            ))}
            {detail.refunds.map((refund) => (
              <div className="list-row" key={refund.id}>
                <span className="muted">退款 · {refund.reason}</span>
                <strong>-{formatMoney(refund.amountCents)}</strong>
              </div>
            ))}
            {detail.audits.length ? (
              <div className="feedback info">
                最近操作：{detail.audits[0].action} ·{" "}
                {formatDateTime(detail.audits[0].createdAt)}
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(attemptDetail)}
        onClose={() => setAttemptDetail(null)}
        title="支付尝试详情"
      >
        {attemptDetail ? (
          <div className="form-grid">
            {[
              ["商户订单号", attemptDetail.merchantOrderNo],
              ["网关交易号", attemptDetail.gatewayTradeNo ?? "-"],
              ["用户", attemptDetail.user.email],
              ["商品", attemptDetail.productName],
              ["渠道", channelLabel[attemptDetail.paymentType]],
              ["金额", formatMoney(attemptDetail.amountCents)],
              ["状态", paymentStatusLabel[attemptDetail.status]],
              ["创建时间", formatDateTime(attemptDetail.createdAt)],
              ["过期时间", formatDateTime(attemptDetail.expiresAt)],
              [
                "最近查单",
                attemptDetail.lastQueryAt
                  ? formatDateTime(attemptDetail.lastQueryAt)
                  : "尚未查单",
              ],
              ["查单失败次数", String(attemptDetail.queryFailureCount)],
              [
                "网关关闭时间",
                attemptDetail.closedAt
                  ? formatDateTime(attemptDetail.closedAt)
                  : "-",
              ],
            ].map(([label, value]) => (
              <div className="list-row" key={label}>
                <span className="muted">{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
            {attemptDetail.lastSettlementError ? (
              <div className="feedback error">
                权益发放失败 {attemptDetail.settlementFailureCount} 次：
                {attemptDetail.lastSettlementError}
              </div>
            ) : null}
            {attemptDetail.lastQueryError ? (
              <div className="feedback error">
                最近查单失败：{attemptDetail.lastQueryError}
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="创建人工订单"
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="manual-order-form"
              disabled={submitting || !manualForm.userId}
            >
              {submitting ? "提交中" : "创建订单"}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setManualOpen(false)}
            >
              取消
            </button>
          </div>
        }
      >
        <form
          id="manual-order-form"
          className="form-grid"
          onSubmit={createManualOrder}
        >
          <label className="field">
            <span className="fine-print">用户</span>
            <CustomSelect
              value={manualForm.userId}
              onChange={(value) =>
                setManualForm((current) => ({ ...current, userId: value }))
              }
              options={[
                { value: "", label: "选择用户" },
                ...users.map((user) => ({
                  value: user.id,
                  label: `${user.displayName} / ${user.email}`,
                })),
              ]}
            />
          </label>
          <div className="two-col">
            <label className="field">
              <span className="fine-print">订单类型</span>
              <CustomSelect
                value={manualForm.kind}
                onChange={(value) =>
                  setManualForm((current) => ({
                    ...current,
                    kind: value as typeof current.kind,
                  }))
                }
                options={[
                  { value: "renewal", label: "套餐 / 续期" },
                  { value: "traffic_pack", label: "流量包" },
                  { value: "manual_credit", label: "人工额度" },
                ]}
              />
            </label>
            <label className="field">
              <span className="fine-print">处理方式</span>
              <CustomSelect
                value={manualForm.status}
                onChange={(value) =>
                  setManualForm((current) => ({
                    ...current,
                    status: value as typeof current.status,
                  }))
                }
                options={[
                  { value: "pending", label: "待确认" },
                  { value: "applied", label: "立即生效" },
                ]}
              />
            </label>
          </div>
          {manualForm.kind === "renewal" ? (
            <label className="field">
              <span className="fine-print">套餐</span>
              <CustomSelect
                value={manualForm.planId}
                onChange={(value) => {
                  const plan = plans.find((item) => item.id === value);
                  setManualForm((current) => ({
                    ...current,
                    planId: value,
                    amountCents: plan?.priceCents ?? current.amountCents,
                    durationDays: plan?.durationDays ?? current.durationDays,
                  }));
                }}
                options={[
                  { value: "", label: "选择套餐" },
                  ...plans.map((plan) => ({
                    value: plan.id,
                    label: `${plan.name} / ${formatMoney(plan.priceCents)}`,
                  })),
                ]}
              />
            </label>
          ) : null}
          <div className="two-col">
            <label className="field">
              <span className="fine-print">金额（元）</span>
              <input
                className="control"
                type="number"
                min="0"
                step="0.01"
                value={manualForm.amountCents / 100}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    amountCents: Math.round(Number(event.target.value) * 100),
                  }))
                }
              />
            </label>
            {manualForm.kind !== "traffic_pack" ? (
              <label className="field">
                <span className="fine-print">有效天数</span>
                <input
                  className="control"
                  type="number"
                  min="0"
                  value={manualForm.durationDays}
                  onChange={(event) =>
                    setManualForm((current) => ({
                      ...current,
                      durationDays: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ) : null}
          </div>
          {manualForm.kind !== "renewal" ? (
            <label className="field">
              <span className="fine-print">流量（GB）</span>
              <input
                className="control"
                type="number"
                min="0"
                value={manualForm.trafficBytes / 1024 ** 3}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    trafficBytes: Math.round(
                      Number(event.target.value) * 1024 ** 3,
                    ),
                  }))
                }
              />
            </label>
          ) : null}
          <label className="field">
            <span className="fine-print">备注</span>
            <textarea
              className="control textarea"
              value={manualForm.note}
              onChange={(event) =>
                setManualForm((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
            />
          </label>
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
