"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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

type Bucket = { id: string; kind: string; startsAt: string; endsAt: string; grantedBytes: number; consumedBytes: number; remainingBytes: number };
type Grant = { id: string; kind: string; status: string; productName: string; offerName?: string | null; startsAt: string; endsAt: string; accessProfileName: string; speedUpMbps: number; speedDownMbps: number; deviceLimit: number; buckets: Bucket[] };
type Customer = {
  id: string; email: string; displayName: string; status: string; notes?: string | null; balanceCents: number; trafficMultiplier: number; createdAt: string;
  summary: { activeGrantCount: number; remainingBytes: number; onlineClients: number; lifetimeOrderCents: number };
  grants: Grant[];
  accessIdentities: Array<{ id: string; label: string; tokenPreview: string; vlessUuid: string; revokedAt?: string | null; lastUsedAt?: string | null }>;
  usage: Array<{ id: string; nodeLabel: string; bucketStart: string; physicalBytes: number; accountedBytes: number; allocations: Array<{ quotaBucketId: string; accountedBytes: number }> }>;
  sessions: Array<{ nodeId: string; nodeLabel: string; concurrentClients: number; capturedAt: string }>;
  orders: Array<{ id: string; status: string; source: string; productName?: string | null; amountCents: number; refundedCents: number; createdAt: string }>;
  wallet: Array<{ id: string; kind: string; amountCents: number; beforeBalanceCents?: number | null; afterBalanceCents?: number | null; actorEmail?: string | null; note?: string | null; createdAt: string }>;
  authEvents: Array<{ id: string; granted: boolean; reason: string; nodeLabel?: string | null; remoteAddr?: string | null; createdAt: string }>;
  timeline: Array<{ id: string; action: string; actorEmail?: string | null; createdAt: string }>;
};
type Catalog = { products: Array<{ kind: string; status: string; name: string; offers: Array<{ id: string; name: string; active: boolean; archivedAt?: string | null }> }> };
type View = "entitlements" | "access" | "traffic" | "finance" | "timeline";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const { token } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [view, setView] = useState<View>("entitlements");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [balanceDelta, setBalanceDelta] = useState("");
  const [balanceNote, setBalanceNote] = useState("");
  const [offerId, setOfferId] = useState("");
  const [resetUrl, setResetUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !params.id) return;
    setError(null);
    try {
      const [nextCustomer, nextCatalog] = await Promise.all([
        apiRequest<Customer>(`/api/admin/customers/${params.id}`, { token }),
        apiRequest<Catalog>("/api/admin/catalog", { token }),
      ]);
      setCustomer(nextCustomer);
      setCatalog(nextCatalog);
      const firstPlanOffer = nextCatalog.products
        .filter((product) => product.kind === "plan" && product.status === "active")
        .flatMap((product) => product.offers)
        .find((offer) => offer.active && !offer.archivedAt);
      setOfferId((current) => current || firstPlanOffer?.id || "");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "客户详情加载失败。");
    }
  }, [params.id, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const planOffers = useMemo(
    () =>
      catalog?.products
        .filter((product) => product.kind === "plan" && product.status === "active")
        .flatMap((product) =>
          product.offers
            .filter((offer) => offer.active && !offer.archivedAt)
            .map((offer) => ({ value: offer.id, label: `${product.name} · ${offer.name}` })),
        ) ?? [],
    [catalog],
  );

  async function act(path: string, method: "POST" | "PATCH", body?: unknown) {
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
      await load();
      return result;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "操作失败。");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function adjustBucket(bucket: Bucket) {
    const value = window.prompt("调整后的剩余额度（GB）", (bucket.remainingBytes / 1024 ** 3).toFixed(2));
    if (value === null) return;
    const bytes = Math.round(Number(value) * 1024 ** 3);
    if (!Number.isSafeInteger(bytes) || bytes < 0) return setError("请输入有效的非负 GB 数值。");
    await act(
      `/api/admin/customers/${params.id}/quota-buckets/${bucket.id}/adjustments`,
      "POST",
      { remainingBytes: bytes, reason: "客户 360 人工调整" },
    );
  }

  if (!customer) {
    return (
      <ConsoleShell title="客户详情" subtitle="客户 360" scope="CRM" navItems={adminNav} requireRole="admin">
        {error ? <div className="feedback error">{error}</div> : <div className="skeleton" style={{ height: 320 }} />}
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title={customer.displayName}
      subtitle={customer.email}
      scope="Customer 360"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className={`badge ${customer.status === "active" ? "success" : "danger"}`}>{customer.status === "active" ? "正常" : "已停用"}</span>}
      toolbarActions={
        <>
          <Link href="/admin/customers" className="toolbar-button"><Icon name="arrow_back" />返回</Link>
          <button className="toolbar-button" disabled={busy} type="button" onClick={() => void act(`/api/admin/customers/${customer.id}/kick`, "POST")}><Icon name="logout" />踢线</button>
          <button className="toolbar-button" disabled={busy} type="button" onClick={async () => {
            const result = await act(`/api/admin/customers/${customer.id}/password-reset`, "POST");
            if (result?.resetUrl) setResetUrl(result.resetUrl);
          }}><Icon name="key" />重置密码</button>
          <button className="action-button" disabled={busy} type="button" onClick={() => void act(`/api/admin/customers/${customer.id}/status`, "PATCH", { status: customer.status === "active" ? "suspended" : "active" })}>
            {customer.status === "active" ? "停用客户" : "恢复客户"}
          </button>
        </>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      {resetUrl ? <div className="feedback info"><span className="mono">{resetUrl}</span></div> : null}
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard label="有效权益" value={String(customer.summary.activeGrantCount)} footnote="套餐与独立流量包" />
          <MetricCard label="剩余额度" value={formatBytes(customer.summary.remainingBytes)} footnote={`计费倍率 ${customer.trafficMultiplier}x`} />
          <MetricCard label="在线设备" value={String(customer.summary.onlineClients)} footnote="最近三分钟" />
          <MetricCard label="累计成交" value={formatMoney(customer.summary.lifetimeOrderCents)} footnote={`钱包余额 ${formatMoney(customer.balanceCents)}`} />
        </div>
        <div className="segmented-control" aria-label="客户详情视图">
          {([['entitlements','权益与额度'],['access','接入与会话'],['traffic','流量'],['finance','订单与余额'],['timeline','操作时间线']] as Array<[View,string]>).map(([key, label]) => (
            <button key={key} className={view === key ? "active" : ""} type="button" onClick={() => setView(key)}>{label}</button>
          ))}
        </div>

        {view === "entitlements" ? (
          <>
            <Panel title="权益与额度" copy="权益叠加时节点取并集，速率和设备数取最高值。">
              <DataTable headers={["商品", "类型", "有效期", "访问策略", "额度", "操作"]} rows={customer.grants.flatMap((grant) =>
                grant.buckets.map((bucket) => [
                  <span className="list" key={`${grant.id}-name`}><strong>{grant.productName}</strong><small>{grant.offerName ?? grant.status}</small></span>,
                  grant.kind === "plan" ? "套餐月度额度" : "一次性流量包",
                  `${formatDateTime(bucket.startsAt)} - ${formatDateTime(bucket.endsAt)}`,
                  `${grant.accessProfileName} · ${grant.speedDownMbps} Mbps · ${grant.deviceLimit} 台`,
                  `${formatBytes(bucket.remainingBytes)} / ${formatBytes(bucket.grantedBytes)}`,
                  <button className="ghost-button compact" type="button" key={`${bucket.id}-adjust`} onClick={() => void adjustBucket(bucket)}>调整额度</button>,
                ]),
              )} />
            </Panel>
            <Panel title="套餐切换" copy="立即生效，旧套餐取消且不补偿剩余价值；已有流量包不受影响。">
              <div className="inline-form">
                <CustomSelect value={offerId} onChange={setOfferId} options={planOffers} />
                <button className="action-button" disabled={!offerId || busy} type="button" onClick={() => void act(`/api/admin/customers/${customer.id}/plan-switch`, "POST", { offerId })}>立即切换</button>
              </div>
            </Panel>
          </>
        ) : null}

        {view === "access" ? (
          <>
            <Panel title="接入身份">
              <DataTable headers={["标签", "Token", "VLESS UUID", "最后使用", "状态"]} rows={customer.accessIdentities.map((identity) => [identity.label, <span className="mono" key={identity.id}>{identity.tokenPreview}</span>, <span className="mono" key={`${identity.id}-uuid`}>{identity.vlessUuid}</span>, identity.lastUsedAt ? formatDateTime(identity.lastUsedAt) : "从未", identity.revokedAt ? "已撤销" : "有效"])} />
            </Panel>
            <Panel title="在线会话">
              <DataTable headers={["节点", "连接数", "采集时间"]} rows={customer.sessions.map((session) => [session.nodeLabel, session.concurrentClients, formatDateTime(session.capturedAt)])} />
            </Panel>
          </>
        ) : null}

        {view === "traffic" ? (
          <Panel title="流量与额度分摊">
            <DataTable headers={["时间", "节点", "物理流量", "计费流量", "额度分摊"]} rows={customer.usage.map((item) => [formatDateTime(item.bucketStart), item.nodeLabel, formatBytes(item.physicalBytes), formatBytes(item.accountedBytes), item.allocations.map((allocation) => formatBytes(allocation.accountedBytes)).join(" + ") || "未分摊"])} />
          </Panel>
        ) : null}

        {view === "finance" ? (
          <>
            <Panel title="余额调整">
              <div className="inline-form">
                <input className="control" inputMode="decimal" value={balanceDelta} onChange={(event) => setBalanceDelta(event.target.value)} placeholder="变更金额（元，可为负）" />
                <input className="control" value={balanceNote} onChange={(event) => setBalanceNote(event.target.value)} placeholder="调整原因" />
                <button className="action-button" disabled={busy || !balanceNote.trim()} type="button" onClick={async () => {
                  const cents = Math.round(Number(balanceDelta) * 100);
                  if (!Number.isSafeInteger(cents) || cents === 0) return setError("请输入非零金额。");
                  await act(`/api/admin/customers/${customer.id}/balance-adjustments`, "POST", { deltaCents: cents, note: balanceNote.trim() });
                  setBalanceDelta(""); setBalanceNote("");
                }}>调整余额</button>
              </div>
            </Panel>
            <Panel title="订单">
              <DataTable headers={["时间", "商品", "来源", "成交额", "退款", "状态"]} rows={customer.orders.map((order) => [formatDateTime(order.createdAt), order.productName ?? order.id, order.source, formatMoney(order.amountCents), formatMoney(order.refundedCents), order.status])} />
            </Panel>
            <Panel title="钱包流水">
              <DataTable headers={["时间", "类型", "变更", "变更前", "变更后", "操作者"]} rows={customer.wallet.map((entry) => [formatDateTime(entry.createdAt), entry.kind, formatMoney(entry.amountCents), entry.beforeBalanceCents == null ? "-" : formatMoney(entry.beforeBalanceCents), entry.afterBalanceCents == null ? "-" : formatMoney(entry.afterBalanceCents), entry.actorEmail ?? "系统"])} />
            </Panel>
          </>
        ) : null}

        {view === "timeline" ? (
          <Panel title="操作时间线">
            <DataTable headers={["时间", "操作", "操作者"]} rows={customer.timeline.map((event) => [formatDateTime(event.createdAt), event.action, event.actorEmail ?? "系统"])} />
          </Panel>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
