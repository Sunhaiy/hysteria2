"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { EChart } from "@/components/echart";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";
import type { EChartsOption } from "echarts";

type Bucket = {
  id: string;
  kind: string;
  startsAt: string;
  endsAt: string;
  grantedBytes: number;
  consumedBytes: number;
  remainingBytes: number;
};
type Grant = {
  id: string;
  kind: string;
  status: string;
  productName: string;
  offerName?: string | null;
  startsAt: string;
  endsAt: string;
  accessProfileName: string;
  speedUpMbps: number;
  speedDownMbps: number;
  deviceLimit: number;
  buckets: Bucket[];
};
type Customer = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  notes?: string | null;
  balanceCents: number;
  trafficMultiplier: number;
  planTrafficMultiplier: number;
  effectiveTrafficMultiplier: number;
  createdAt: string;
  summary: {
    activeGrantCount: number;
    grantedBytes: number;
    consumedBytes: number;
    remainingBytes: number;
    online: boolean;
    onlineNodeCount: number;
    onlineClients: number;
    recentTraffic: DailyTrafficItem[];
  };
};
type Identity = {
  id: string;
  label: string;
  tokenPreview: string;
  subscriptionUrl: string;
  mihomoSubscriptionUrl: string;
  vlessUuid: string;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
};
type Presence = {
  id: string;
  nodeLabel: string;
  serverName: string;
  protocol: string;
  concurrentClients: number;
  observedAt: string;
};
type AccessData = {
  identities: Identity[];
  presence: PaginatedResponse<Presence>;
};
type DailyTrafficItem = {
  date: string;
  txBytes: number;
  rxBytes: number;
  physicalBytes: number;
  accountedBytes: number;
  actualMultiplier: number | null;
  minMultiplier: number | null;
  maxMultiplier: number | null;
};
type DailyTraffic = {
  timezone: string;
  from: string;
  to: string;
  totals: {
    txBytes: number;
    rxBytes: number;
    physicalBytes: number;
    accountedBytes: number;
  };
  items: DailyTrafficItem[];
};
type Order = {
  id: string;
  status: string;
  source: string;
  productName?: string | null;
  amountCents: number;
  refundedCents: number;
  createdAt: string;
};
type Wallet = {
  id: string;
  kind: string;
  amountCents: number;
  beforeBalanceCents?: number | null;
  afterBalanceCents?: number | null;
  actorEmail?: string | null;
  createdAt: string;
};
type Timeline = {
  id: string;
  action: string;
  actorEmail?: string | null;
  createdAt: string;
};
type Catalog = {
  products: Array<{
    kind: string;
    status: string;
    name: string;
    offers: Array<{
      id: string;
      name: string;
      active: boolean;
      archivedAt?: string | null;
    }>;
  }>;
};
type View = "entitlements" | "access" | "traffic" | "finance" | "timeline";

const emptyPage = <T,>(): PaginatedResponse<T> => ({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
});

const emptyDailyTraffic: DailyTraffic = {
  timezone: "Asia/Shanghai",
  from: "",
  to: "",
  totals: { txBytes: 0, rxBytes: 0, physicalBytes: 0, accountedBytes: 0 },
  items: [],
};

function shanghaiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDateKey(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const { token } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [grants, setGrants] = useState(emptyPage<Grant>);
  const [access, setAccess] = useState<AccessData>({
    identities: [],
    presence: emptyPage<Presence>(),
  });
  const [dailyTraffic, setDailyTraffic] = useState(emptyDailyTraffic);
  const [orders, setOrders] = useState(emptyPage<Order>);
  const [wallet, setWallet] = useState(emptyPage<Wallet>);
  const [timeline, setTimeline] = useState(emptyPage<Timeline>);
  const [view, setView] = useState<View>("entitlements");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [balanceDelta, setBalanceDelta] = useState("");
  const [offerId, setOfferId] = useState("");
  const [multiplier, setMultiplier] = useState("1");
  const [remainingGb, setRemainingGb] = useState("");
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [trafficDays, setTrafficDays] = useState<7 | 30>(7);

  const loadSummary = useCallback(
    async (signal?: AbortSignal) => {
      if (!token || !params.id) return;
      setError(null);
      try {
        const nextCustomer = await apiRequest<Customer>(
          `/api/admin/customers/${params.id}`,
          { token, signal },
        );
        setCustomer(nextCustomer);
        setMultiplier(String(nextCustomer.trafficMultiplier));
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof ApiError ? cause.message : "客户详情加载失败。",
        );
      }
    },
    [params.id, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadSummary(controller.signal),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadSummary, reloadKey]);

  useEffect(() => {
    if (!token || view !== "entitlements" || catalog) return;
    const controller = new AbortController();
    void apiRequest<Catalog>("/api/admin/catalog", {
      token,
      signal: controller.signal,
    })
      .then((nextCatalog) => {
        setCatalog(nextCatalog);
        const firstPlanOffer = nextCatalog.products
          .filter(
            (product) => product.kind === "plan" && product.status === "active",
          )
          .flatMap((product) => product.offers)
          .find((offer) => offer.active && !offer.archivedAt);
        setOfferId((current) => current || firstPlanOffer?.id || "");
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof ApiError ? cause.message : "商品目录加载失败。");
      });
    return () => controller.abort();
  }, [catalog, token, view]);

  useEffect(() => {
    if (!token || !params.id) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const suffix = `page=${page}&pageSize=20`;
      const request =
        view === "entitlements"
          ? apiRequest<PaginatedResponse<Grant>>(
              `/api/admin/customers/${params.id}/entitlements?${suffix}`,
              { token, signal: controller.signal },
            ).then(setGrants)
          : view === "access"
            ? apiRequest<AccessData>(
                `/api/admin/customers/${params.id}/access?${suffix}`,
                { token, signal: controller.signal },
              ).then(setAccess)
            : view === "traffic"
              ? (() => {
                  const to = shanghaiDateKey();
                  const from = shiftDateKey(to, 1 - trafficDays);
                  const query = new URLSearchParams({ from, to });
                  return apiRequest<DailyTraffic>(
                    `/api/admin/customers/${params.id}/traffic/daily?${query}`,
                    { token, signal: controller.signal },
                  ).then(setDailyTraffic);
                })()
              : view === "finance"
                ? Promise.all([
                    apiRequest<PaginatedResponse<Order>>(
                      `/api/admin/customers/${params.id}/finance?kind=orders&${suffix}`,
                      { token, signal: controller.signal },
                    ),
                    apiRequest<PaginatedResponse<Wallet>>(
                      `/api/admin/customers/${params.id}/finance?kind=wallet&${suffix}`,
                      { token, signal: controller.signal },
                    ),
                  ]).then(([nextOrders, nextWallet]) => {
                    setOrders(nextOrders);
                    setWallet(nextWallet);
                  })
                : apiRequest<PaginatedResponse<Timeline>>(
                    `/api/admin/customers/${params.id}/timeline?${suffix}`,
                    { token, signal: controller.signal },
                  ).then(setTimeline);
      void request
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setError(
            cause instanceof ApiError
              ? cause.message
              : "客户标签数据加载失败。",
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
  }, [page, params.id, reloadKey, token, trafficDays, view]);

  const planOffers = useMemo(
    () =>
      catalog?.products
        .filter(
          (product) => product.kind === "plan" && product.status === "active",
        )
        .flatMap((product) =>
          product.offers
            .filter((offer) => offer.active && !offer.archivedAt)
            .map((offer) => ({
              value: offer.id,
              label: `${product.name} · ${offer.name}`,
            })),
        ) ?? [],
    [catalog],
  );

  const trafficChartOption = useMemo<EChartsOption>(() => {
    const points = dailyTraffic.items;
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => formatBytes(Number(value)),
      },
      legend: {
        data: ["实际流量", "计费流量"],
        top: 0,
        left: "center",
      },
      grid: { left: 12, right: 18, top: 48, bottom: 36, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: points.map((item) => item.date.slice(5).replace("-", "/")),
      },
      yAxis: {
        type: "value",
        axisLabel: { formatter: (value: number) => formatBytes(value) },
      },
      series: [
        {
          name: "实际流量",
          type: "line",
          smooth: true,
          showSymbol: points.length < 24,
          data: points.map((item) => item.physicalBytes),
        },
        {
          name: "计费流量",
          type: "line",
          smooth: true,
          showSymbol: points.length < 24,
          data: points.map((item) => item.accountedBytes),
        },
      ],
    };
  }, [dailyTraffic.items]);

  const recentTrafficOption = useMemo<EChartsOption>(
    () => ({
      animationDuration: 400,
      grid: { left: 0, right: 0, top: 5, bottom: 0 },
      xAxis: { type: "category", show: false },
      yAxis: { type: "value", show: false },
      series: [
        {
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.1 },
          data: customer?.summary.recentTraffic.map((item) => item.physicalBytes) ?? [],
        },
      ],
    }),
    [customer],
  );

  async function act(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ) {
    if (!token) return null;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const result = await apiRequest<{ resetUrl?: string }>(path, {
        method,
        token,
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body,
      });
      setFeedback("操作已完成。");
      setReloadKey((value) => value + 1);
      return result;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "操作失败。");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function adjustBucket(bucket: Bucket) {
    const value = window.prompt(
      "调整后的剩余额度（GB）",
      (bucket.remainingBytes / 1024 ** 3).toFixed(2),
    );
    if (value === null) return;
    const bytes = Math.round(Number(value) * 1024 ** 3);
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      return setError("请输入有效的非负 GB 数值。");
    await act(
      `/api/admin/customers/${params.id}/quota-buckets/${bucket.id}/adjustments`,
      "POST",
      { remainingBytes: bytes },
    );
  }

  const currentPage =
    view === "entitlements"
      ? grants
      : view === "access"
        ? access.presence
        : view === "finance"
            ? orders
            : timeline;
  const pagination = {
    page: currentPage.page,
    pageSize: currentPage.pageSize,
    total: currentPage.total,
    totalPages: currentPage.totalPages,
    onPageChange: setPage,
  };

  if (!customer)
    return (
      <ConsoleShell
        title="客户详情"
        subtitle="客户 360"
        scope="CRM"
        navItems={adminNav}
        requireRole="admin"
      >
        {error ? (
          <div className="feedback error">{error}</div>
        ) : (
          <div className="skeleton" style={{ height: 320 }} />
        )}
      </ConsoleShell>
    );

  return (
    <ConsoleShell
      title={customer.displayName}
      subtitle={customer.email}
      scope="Customer 360"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span
          className={`badge ${customer.status === "active" ? "success" : "danger"}`}
        >
          {customer.status === "active" ? "正常" : "已停用"}
        </span>
      }
      toolbarActions={
        <>
          <Link href="/admin/customers" className="toolbar-button">
            <Icon name="arrow_back" />
            返回
          </Link>
          <button
            className="toolbar-button"
            disabled={busy}
            type="button"
            onClick={() =>
              void act(`/api/admin/customers/${customer.id}/kick`, "POST")
            }
          >
            <Icon name="logout" />
            踢线
          </button>
          <button
            className="toolbar-button"
            disabled={busy}
            type="button"
            onClick={async () => {
              const result = await act(
                `/api/admin/customers/${customer.id}/password-reset`,
                "POST",
              );
              if (result?.resetUrl) setResetUrl(result.resetUrl);
            }}
          >
            <Icon name="key" />
            重置密码
          </button>
          <button
            className="action-button"
            disabled={busy}
            type="button"
            onClick={() =>
              void act(`/api/admin/customers/${customer.id}/status`, "PATCH", {
                status: customer.status === "active" ? "suspended" : "active",
              })
            }
          >
            {customer.status === "active" ? "停用客户" : "恢复客户"}
          </button>
        </>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      {resetUrl ? (
        <div className="feedback info">
          <span className="mono">{resetUrl}</span>
        </div>
      ) : null}
      <div className="page-stack">
        <div className="metric-grid customer-summary-grid">
          <MetricCard
            label="有效权益"
            value={String(customer.summary.activeGrantCount)}
            footnote="套餐与独立流量包"
          />
          <article className="metric-card customer-quota-card">
            <span className="metric-label">剩余额度</span>
            <strong className="metric-value">
              {formatBytes(customer.summary.remainingBytes)}
            </strong>
            <div className="bar-track" aria-label="额度使用进度">
              <span
                className="bar-fill bar-fill-success"
                style={{
                  width: `${Math.min(
                    100,
                    customer.summary.grantedBytes
                      ? (customer.summary.consumedBytes /
                          customer.summary.grantedBytes) *
                          100
                      : 0,
                  )}%`,
                }}
              />
            </div>
            <span className="metric-footnote">
              已用 {formatBytes(customer.summary.consumedBytes)} · {customer.effectiveTrafficMultiplier}x
            </span>
          </article>
          <MetricCard
            label="活跃连接"
            value={String(customer.summary.onlineClients)}
            footnote={`${customer.summary.online ? "在线" : "离线"} · ${customer.summary.onlineNodeCount} 个连接节点 · 同一设备可能产生多条连接`}
          />
          <article className="metric-card customer-traffic-card">
            <span className="metric-label">最近 7 日流量</span>
            <strong className="metric-value">
              {formatBytes(
                customer.summary.recentTraffic.reduce(
                  (sum, item) => sum + item.physicalBytes,
                  0,
                ),
              )}
            </strong>
            <EChart
              option={recentTrafficOption}
              height={58}
              ariaLabel="客户最近七日流量趋势"
            />
          </article>
        </div>
        <div className="segmented-control" aria-label="客户详情视图">
          {(
            [
              ["entitlements", "权益与额度"],
              ["access", "接入与会话"],
              ["traffic", "流量"],
              ["finance", "订单与余额"],
              ["timeline", "操作时间线"],
            ] as Array<[View, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              className={view === key ? "active" : ""}
              type="button"
              onClick={() => {
                setView(key);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "entitlements" ? (
          <>
            <Panel
              title="流量倍率与总额度"
              copy={`套餐倍率 ${customer.planTrafficMultiplier}x，用户倍率 ${customer.trafficMultiplier}x，计费自动取较高值。`}
            >
              <div className="inline-form">
                <label className="field">
                  <span className="fine-print">用户倍率</span>
                  <input
                    className="control"
                    type="number"
                    min={0.1}
                    max={100}
                    step={0.1}
                    value={multiplier}
                    onChange={(event) => setMultiplier(event.target.value)}
                  />
                </label>
                <button
                  className="ghost-button"
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void act(
                      `/api/admin/customers/${customer.id}/traffic-policy`,
                      "PATCH",
                      { trafficMultiplier: Number(multiplier) },
                    )
                  }
                >
                  保存倍率
                </button>
                <label className="field">
                  <span className="fine-print">总剩余额度（GB）</span>
                  <input
                    className="control"
                    type="number"
                    min={0}
                    step={0.01}
                    value={remainingGb}
                    onChange={(event) => setRemainingGb(event.target.value)}
                  />
                </label>
                <button
                  className="action-button"
                  disabled={busy || remainingGb === ""}
                  type="button"
                  onClick={() =>
                    void act(
                      `/api/admin/customers/${customer.id}/quota-adjustments`,
                      "POST",
                      {
                        mode: "set_remaining",
                        remainingBytes: Math.round(
                          Number(remainingGb) * 1024 ** 3,
                        ),
                      },
                    )
                  }
                >
                  设置总额度
                </button>
              </div>
            </Panel>
            <Panel title="权益与额度">
              <DataTable
                loading={loading}
                error={error}
                onRetry={() => setReloadKey((value) => value + 1)}
                pagination={pagination}
                emptyText="暂无权益"
                headers={[
                  "商品",
                  "类型",
                  "有效期",
                  "速率与设备",
                  "额度",
                  "操作",
                ]}
                rows={grants.items.flatMap((grant) =>
                  grant.buckets.map((bucket) => [
                    <span className="list" key={`${grant.id}-name`}>
                      <strong>{grant.productName}</strong>
                      <small>{grant.offerName ?? grant.status}</small>
                    </span>,
                    grant.kind === "plan" ? "套餐月度额度" : "一次性流量包",
                    `${formatDateTime(bucket.startsAt)} - ${formatDateTime(bucket.endsAt)}`,
                    `${grant.speedDownMbps} Mbps · ${grant.deviceLimit} 台`,
                    `${formatBytes(bucket.remainingBytes)} / ${formatBytes(bucket.grantedBytes)}`,
                    <button
                      className="ghost-button compact"
                      type="button"
                      key={`${bucket.id}-adjust`}
                      onClick={() => void adjustBucket(bucket)}
                    >
                      调整额度
                    </button>,
                  ]),
                )}
              />
            </Panel>
            <Panel
              title="套餐切换"
              copy="选择具体计费周期后，将立即结束旧套餐并免费赠送新套餐。"
              allowOverflow
            >
              <div className="plan-switch-form">
                <CustomSelect
                  value={offerId}
                  onChange={setOfferId}
                  options={planOffers}
                />
                <button
                  className="action-button"
                  disabled={!offerId || busy}
                  type="button"
                  onClick={() =>
                    void act(
                      `/api/admin/customers/${customer.id}/plan-switch`,
                      "POST",
                      { offerId },
                    )
                  }
                >
                  免费赠送并立即切换
                </button>
              </div>
            </Panel>
          </>
        ) : null}
        {view === "access" ? (
          <>
            <Panel
              title="订阅链接"
              action={
                <button
                  className="action-button"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "重新创建后，所有旧订阅链接会立即失效。确认继续？",
                      )
                    ) {
                      void act(
                        `/api/admin/customers/${customer.id}/access-tokens/rotate`,
                        "POST",
                      );
                    }
                  }}
                >
                  <Icon name="refresh" />
                  重新创建
                </button>
              }
            >
              {access.identities.length ? (
                <div className="admin-access-identities">
                  {access.identities.map((identity) => (
                    <section
                      className="admin-access-identity"
                      key={identity.id}
                    >
                      <div className="admin-access-identity-head">
                        <div className="split">
                          <strong>{identity.label}</strong>
                          <span className="fine-print">
                            {identity.lastUsedAt
                              ? `最后使用 ${formatDateTime(identity.lastUsedAt)}`
                              : "尚未使用"}
                          </span>
                        </div>
                        <span
                          className={`badge ${identity.revokedAt ? "neutral" : "success"}`}
                        >
                          {identity.revokedAt ? "已撤销" : "有效"}
                        </span>
                      </div>
                      <div className="admin-subscription-links">
                        {[
                          {
                            label: "Clash / Mihomo",
                            value: identity.mihomoSubscriptionUrl,
                          },
                          {
                            label: "v2rayN / Hiddify",
                            value: identity.subscriptionUrl,
                          },
                        ].map((link) => (
                          <div
                            className="admin-subscription-row"
                            key={link.label}
                          >
                            <span className="fine-print">{link.label}</span>
                            <span className="mono">{link.value}</span>
                            <button
                              className="ghost-button compact"
                              type="button"
                              title={`复制${link.label}订阅链接`}
                              onClick={() => {
                                void navigator.clipboard.writeText(link.value);
                                setFeedback(`${link.label} 订阅链接已复制。`);
                              }}
                            >
                              <Icon name="content_copy" />
                              复制
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="admin-access-identity-foot">
                        <span className="fine-print">
                          VLESS UUID：
                          <span className="mono">{identity.vlessUuid}</span>
                        </span>
                        {!identity.revokedAt ? (
                          <button
                            className="danger-button compact"
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "销毁后这条订阅链接会立即失效。确认销毁？",
                                )
                              ) {
                                void act(
                                  `/api/admin/customers/${customer.id}/access-tokens/${identity.id}`,
                                  "DELETE",
                                );
                              }
                            }}
                          >
                            销毁订阅
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="empty-state">暂无接入身份</div>
              )}
            </Panel>
            <Panel title="当前在线">
              <DataTable
                loading={loading}
                error={error}
                pagination={pagination}
                emptyText="当前没有在线连接"
                headers={["服务器", "协议端点", "连接数", "最后在线"]}
                rows={access.presence.items.map((item) => [
                  item.serverName,
                  `${item.protocol === "vless_reality" ? "VLESS + Reality" : "Hysteria2"} · ${item.nodeLabel}`,
                  item.concurrentClients,
                  formatDateTime(item.observedAt),
                ])}
              />
            </Panel>
          </>
        ) : null}
        {view === "traffic" ? (
          <>
            <Panel
              title="流量趋势"
              copy="对比节点上报的实际流量与倍率计费后的流量。"
              action={
                <div className="segmented-control compact" aria-label="流量日期范围">
                  {([7, 30] as const).map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={trafficDays === days ? "active" : ""}
                      onClick={() => setTrafficDays(days)}
                    >
                      {days} 天
                    </button>
                  ))}
                </div>
              }
            >
              {dailyTraffic.items.some((item) => item.physicalBytes > 0) ? (
                <EChart
                  option={trafficChartOption}
                  height={320}
                  ariaLabel="客户实际流量与计费流量趋势图"
                />
              ) : (
                <div className="empty-state">暂无流量记录</div>
              )}
            </Panel>
            <Panel
              title="每日流量"
              copy={`合计物理流量 ${formatBytes(dailyTraffic.totals.physicalBytes)} · 计费流量 ${formatBytes(dailyTraffic.totals.accountedBytes)}`}
            >
              <DataTable
                loading={loading}
                error={error}
                emptyText="暂无流量记录"
                headers={[
                  "日期",
                  "上传",
                  "下载",
                  "物理流量",
                  "计费流量",
                  "实际倍率",
                ]}
                rows={[...dailyTraffic.items].reverse().map((item) => [
                  item.date,
                  formatBytes(item.txBytes),
                  formatBytes(item.rxBytes),
                  formatBytes(item.physicalBytes),
                  formatBytes(item.accountedBytes),
                  item.actualMultiplier == null
                    ? "-"
                    : item.minMultiplier === item.maxMultiplier
                      ? `${item.actualMultiplier}x`
                      : `${item.actualMultiplier}x (${item.minMultiplier}x-${item.maxMultiplier}x)`,
                ])}
              />
            </Panel>
          </>
        ) : null}
        {view === "finance" ? (
          <>
            <Panel title="余额调整">
              <div className="inline-form">
                <input
                  className="control"
                  inputMode="decimal"
                  value={balanceDelta}
                  onChange={(event) => setBalanceDelta(event.target.value)}
                  placeholder="变更金额（元，可为负）"
                />
                <button
                  className="action-button"
                  disabled={busy || balanceDelta === ""}
                  type="button"
                  onClick={async () => {
                    const cents = Math.round(Number(balanceDelta) * 100);
                    if (!Number.isSafeInteger(cents) || cents === 0)
                      return setError("请输入非零金额。");
                    await act(
                      `/api/admin/customers/${customer.id}/balance-adjustments`,
                      "POST",
                      { deltaCents: cents },
                    );
                    setBalanceDelta("");
                  }}
                >
                  调整余额
                </button>
              </div>
            </Panel>
            <Panel title="订单">
              <DataTable
                loading={loading}
                pagination={pagination}
                emptyText="暂无订单"
                headers={["时间", "商品", "来源", "成交额", "退款", "状态"]}
                rows={orders.items.map((order) => [
                  formatDateTime(order.createdAt),
                  order.productName ?? order.id,
                  order.source,
                  formatMoney(order.amountCents),
                  formatMoney(order.refundedCents),
                  order.status,
                ])}
              />
            </Panel>
            <Panel title="钱包流水">
              <DataTable
                loading={loading}
                pagination={{
                  page: wallet.page,
                  pageSize: wallet.pageSize,
                  total: wallet.total,
                  totalPages: wallet.totalPages,
                  onPageChange: setPage,
                }}
                emptyText="暂无钱包流水"
                headers={["时间", "类型", "变更", "变更前", "变更后", "操作者"]}
                rows={wallet.items.map((entry) => [
                  formatDateTime(entry.createdAt),
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
          </>
        ) : null}
        {view === "timeline" ? (
          <Panel title="操作时间线">
            <DataTable
              loading={loading}
              error={error}
              pagination={pagination}
              emptyText="暂无操作记录"
              headers={["时间", "操作", "操作者"]}
              rows={timeline.items.map((event) => [
                formatDateTime(event.createdAt),
                event.action,
                event.actorEmail ?? "系统",
              ])}
            />
          </Panel>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
