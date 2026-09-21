"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { OrderRefundButton } from "@/components/order-refund-button";
import { CustomerMemberships } from "@/components/customer-memberships";
import { CustomerManagement } from "@/components/customer-management";
import { CustomerTrafficChart } from "@/components/customer-traffic-chart";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { CustomerOverview } from "@/components/customer-overview";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatMoney } from "@/lib/format";
import { customerDateTime as formatDateTime } from "@/lib/customer-display";
import type { PaginatedResponse } from "@/lib/types";

type Customer = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  notes?: string | null;
  balanceCents: number;
  trafficMultiplier: number;
  planTrafficMultiplier: number;
  entitlementTrafficMultiplier: number;
  effectiveTrafficMultiplier: number | null;
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
type DailyTrafficItem = { physicalBytes: number };
type Order = {
  id: string;
  operationLabel: string;
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
  metadata?: {
    reason?: string;
    note?: string;
    before?: unknown;
    after?: unknown;
    beforeRemainingBytes?: string;
    afterRemainingBytes?: string;
  };
};
type View = "overview" | "entitlements" | "access" | "finance" | "timeline";

const emptyPage = <T,>(): PaginatedResponse<T> => ({
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
});

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [access, setAccess] = useState<AccessData>({
    identities: [],
    presence: emptyPage<Presence>(),
  });
  const [orders, setOrders] = useState(emptyPage<Order>);
  const [wallet, setWallet] = useState(emptyPage<Wallet>);
  const [timeline, setTimeline] = useState(emptyPage<Timeline>);
  const [view, setView] = useState<View>("overview");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);

  const loadSummary = useCallback(
    async (signal?: AbortSignal) => {
      if (!token || !params.id) return;
      setSummaryError(null);
      try {
        const nextCustomer = await apiRequest<Customer>(
          `/api/admin/customers/${params.id}`,
          { token, signal },
        );
        if (!signal?.aborted) setCustomer(nextCustomer);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setSummaryError(
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
    if (!token || !params.id || view === "overview" || view === "entitlements")
      return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const suffix = `page=${page}&pageSize=20`;
      const request =
        view === "access"
          ? apiRequest<AccessData>(
              `/api/admin/customers/${params.id}/access?${suffix}`,
              { token, signal: controller.signal },
            ).then(setAccess)
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
  }, [page, params.id, reloadKey, token, view]);

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

  async function deleteCustomerAccount() {
    if (!token || !customer) return;
    const confirmationEmail = window.prompt(
      `请输入客户邮箱 ${customer.email} 以确认删除账户`,
    );
    if (confirmationEmail === null) return;
    if (
      confirmationEmail.trim().toLowerCase() !==
      customer.email.trim().toLowerCase()
    ) {
      setError("确认邮箱不一致，账户未删除。");
      return;
    }
    if (
      !window.confirm(
        "确认永久删除该账户？登录、订阅和未使用权益会立即失效，原邮箱可重新注册；历史订单、退款和审计记录将脱敏保留。",
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/admin/customers/${customer.id}`, {
        method: "DELETE",
        token,
        body: { confirmationEmail },
      });
      router.replace("/admin/customers");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "删除账户失败。");
      setBusy(false);
    }
  }

  const currentPage =
    view === "access"
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

  if (!customer || customer.id !== params.id)
    return (
      <ConsoleShell
        title="客户详情"
        subtitle="客户 360"
        scope="CRM"
        navItems={adminNav}
        requireRole="admin"
      >
        {summaryError ? (
          <div className="feedback error">
            {summaryError}
            <button
              className="ghost-button"
              onClick={() => setReloadKey((v) => v + 1)}
            >
              重试
            </button>
          </div>
        ) : (
          <PageSkeleton variant="detail" />
        )}
      </ConsoleShell>
    );

  return (
    <ConsoleShell
      title="用户详情"
      subtitle={customer.email}
      scope="Customer 360"
      navItems={adminNav}
      requireRole="admin"
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {summaryError ? (
        <div className="feedback error">
          {summaryError}
          <button className="ghost-button" onClick={() => void loadSummary()}>
            重试概览
          </button>
        </div>
      ) : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      {resetUrl ? (
        <div className="feedback info">
          <span className="mono">{resetUrl}</span>
        </div>
      ) : null}
      <div className="page-stack customer-detail">
        <div className="customer-heading-region">
          <CustomerOverview customer={customer} identity />
          <div className="customer-header-meta">
            <>
              <span
                className={`badge ${customer.status === "active" ? "success" : "danger"}`}
              >
                {customer.status === "active" ? "正常" : "已停用"}
              </span>
              <span className="badge neutral">
                注册于 {formatDateTime(customer.createdAt)}
              </span>
            </>
          </div>
          <div className="customer-header-actions">
            <>
              <Link
                href="/admin/customers"
                className="toolbar-button"
                aria-label="返回客户列表"
              >
                <Icon name="arrow_back" />
                返回
              </Link>
              <details className="customer-more">
                <summary className="toolbar-button">更多操作</summary>
                <div className="customer-more-menu">
                  <button
                    className="toolbar-button"
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      void act(
                        `/api/admin/customers/${customer.id}/kick`,
                        "POST",
                      )
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
                    onClick={() => {
                      if (
                        window.confirm(
                          "确认更改账户状态？停用后将无法使用服务。",
                        )
                      )
                        void act(
                          `/api/admin/customers/${customer.id}/status`,
                          "PATCH",
                          {
                            status:
                              customer.status === "active"
                                ? "suspended"
                                : "active",
                          },
                        );
                    }}
                  >
                    {customer.status === "active" ? "停用客户" : "恢复客户"}
                  </button>
                  <button
                    className="danger-button"
                    disabled={busy}
                    type="button"
                    onClick={() => void deleteCustomerAccount()}
                  >
                    <Icon name="trash" />
                    删除账户
                  </button>
                </div>
              </details>
            </>
          </div>
        </div>
        <nav className="customer-section-nav" aria-label="客户详情视图">
          {(
            [
              ["overview", "总览"],
              ["entitlements", "套餐与流量"],
              ["access", "连接与订阅"],
              ["finance", "订单与余额"],
              ["timeline", "操作记录"],
            ] as Array<[View, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              className={view === key ? "active" : ""}
              aria-current={view === key ? "page" : undefined}
              type="button"
              onClick={() => {
                setView(key);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {view === "overview" ? (
          <div className="customer-workspace">
            <div className="customer-workspace-main">
              <CustomerMemberships
                userId={customer.id}
                token={token}
                reloadKey={reloadKey}
                onChanged={() => setReloadKey((v) => v + 1)}
                compact
              />
              <CustomerTrafficChart userId={customer.id} token={token} />
            </div>
            <aside
              className="customer-account-region"
              aria-label="账户与快捷调整"
            >
              <div className="customer-region-heading">
                <span className="customer-kicker">账户与额度</span>
                <h3>账户概况</h3>
              </div>
              <CustomerOverview customer={customer} />
              <CustomerManagement
                customer={customer}
                token={token}
                mode="balance"
                onChanged={() => setReloadKey((v) => v + 1)}
              />
              <CustomerManagement
                customer={customer}
                token={token}
                mode="plan"
                onChanged={() => setReloadKey((v) => v + 1)}
              />
            </aside>
          </div>
        ) : null}
        {view === "entitlements" ? (
          <CustomerMemberships
            userId={customer.id}
            token={token}
            reloadKey={reloadKey}
            onChanged={() => setReloadKey((v) => v + 1)}
          />
        ) : null}
        {view === "entitlements" || view === "finance" ? (
          <CustomerManagement
            customer={customer}
            token={token}
            mode={view === "finance" ? "balance" : "plan"}
            onChanged={() => setReloadKey((v) => v + 1)}
          />
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
        {view === "finance" ? (
          <>
            <Panel title="订单">
              <DataTable
                loading={loading}
                pagination={pagination}
                emptyText="暂无订单"
                headers={[
                  "时间",
                  "商品",
                  "业务类型",
                  "来源",
                  "成交额",
                  "已退金额",
                  "状态",
                  "操作",
                ]}
                rows={orders.items.map((order) => [
                  formatDateTime(order.createdAt),
                  order.productName ?? order.id,
                  order.operationLabel,
                  {
                    payment: "在线支付",
                    wallet: "余额",
                    cdk: "兑换码",
                    admin: "管理员发放",
                    legacy: "历史订单",
                  }[order.source] ?? order.source,
                  formatMoney(order.amountCents),
                  formatMoney(order.refundedCents),
                  { applied: "已到账", pending: "待处理", void: "已关闭" }[
                    order.status
                  ] ?? order.status,
                  <OrderRefundButton
                    key={order.id}
                    order={{
                      ...order,
                      productName: order.productName ?? "订单",
                    }}
                    token={token}
                    onComplete={() => setReloadKey((value) => value + 1)}
                  />,
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
              headers={["时间", "操作", "原因 / 变化", "操作者"]}
              rows={timeline.items.map((event) => [
                formatDateTime(event.createdAt),
                (
                  {
                    "entitlement.scheduled.activated": "提前启用已购套餐",
                    "entitlement.validity.updated": "调整套餐有效期",
                    "entitlement.quota_bucket.adjusted": "调整剩余额度",
                    "entitlement.traffic_multiplier.updated": "调整用户倍率",
                    CUSTOMER_BALANCE_ADJUSTED: "调整余额",
                    "customer.complimentary.confirmed": "免费赠送并切换",
                  } as Record<string, string>
                )[event.action] ?? event.action,
                <span key={`${event.id}-detail`}>
                  {event.metadata?.reason ?? event.metadata?.note ?? "—"}
                  {event.metadata?.beforeRemainingBytes !== undefined ? (
                    <small className="muted">
                      {" "}
                      ·{" "}
                      {formatBytes(
                        Number(event.metadata.beforeRemainingBytes),
                      )}{" "}
                      →{" "}
                      {formatBytes(Number(event.metadata.afterRemainingBytes))}
                    </small>
                  ) : event.metadata?.before !== undefined &&
                    event.metadata?.after !== undefined ? (
                    <small className="muted">
                      {" "}
                      · {String(event.metadata.before)} →{" "}
                      {String(event.metadata.after)}
                    </small>
                  ) : null}
                </span>,
                event.actorEmail ?? "系统",
              ])}
            />
          </Panel>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
