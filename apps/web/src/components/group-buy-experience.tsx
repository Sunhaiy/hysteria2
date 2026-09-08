"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "./console-shell";
import { Drawer } from "./drawer";
import { Icon } from "./icon";
import { useAuth } from "./auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type {
  GroupBuyCampaignRecord,
  GroupBuyRecord,
  PaginatedResponse,
  PortalOverviewResponse,
} from "@/lib/types";

type EpayPayment = {
  id: string;
  status: "pending" | "settled" | "expired" | "failed";
  amountCents: number;
  productName: string;
  expiresAt: string;
  orderId: string | null;
  planActivationMode?:
    | "initial"
    | "renewal"
    | "scheduled_switch"
    | "immediate_switch"
    | null;
  planEffectiveAt?: string | null;
  gateway?: {
    url: string;
    method: "GET" | "POST";
    fields: Record<string, string>;
  };
};

type Checkout =
  | { kind: "create"; campaign: GroupBuyCampaignRecord }
  | { kind: "join"; group: GroupBuyRecord };

const emptyGroups: PaginatedResponse<GroupBuyRecord> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};

const periodNames: Record<string, string> = {
  monthly: "月付",
  quarterly: "季付",
  yearly: "年付",
  one_time: "一次性",
  legacy: "固定期",
};

const statusNames: Record<string, string> = {
  pending_payment: "等待发起支付",
  fulfilling: "正在发放",
  succeeded: "拼团成功",
  refunding: "退款处理中",
  refunded: "已原路退款",
  fallback_fulfilled: "已按原套餐发放",
  exception: "需要人工处理",
  canceled: "已取消",
};

function groupStatusLabel(group: GroupBuyRecord) {
  if (group.status === "open") {
    return `差 ${Math.max(group.requiredMembers - group.paidMembers, 0)} 人成团`;
  }
  return statusNames[group.status] ?? group.status;
}

function submitGateway(
  payment: EpayPayment,
  targetName: string,
  paymentWindow: Window,
) {
  if (!payment.gateway) throw new Error("支付网关信息不可用，请重新创建订单。");
  const target = new URL(payment.gateway.url);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("支付网关地址无效。");
  }
  if (payment.gateway.method === "GET") {
    for (const [name, value] of Object.entries(payment.gateway.fields)) {
      target.searchParams.set(name, value);
    }
    paymentWindow.location.replace(target.toString());
    return;
  }
  const form = document.createElement("form");
  form.method = payment.gateway.method;
  form.action = target.toString();
  form.target = targetName;
  form.style.display = "none";
  for (const [name, value] of Object.entries(payment.gateway.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => form.remove(), 0);
}

function remainingLabel(expiresAt: string | null, now: number) {
  if (!expiresAt) return "付款后开始计时";
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return "已到期，正在处理";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.max(1, Math.floor((remaining % 3_600_000) / 60_000));
  return `${hours} 小时 ${minutes} 分钟`;
}

function discountLabel(percent: number) {
  return `${Number((percent / 10).toFixed(2))} 折`;
}

function savedCents(originalPriceCents: number, priceCents: number) {
  return Math.max(0, originalPriceCents - priceCents);
}

function paymentActivationMessage(payment: EpayPayment) {
  if (
    payment.planActivationMode === "scheduled_switch" &&
    payment.planEffectiveAt
  ) {
    return `套餐已到账，将于 ${formatDateTime(payment.planEffectiveAt)} 自动生效`;
  }
  if (payment.planActivationMode === "renewal") {
    return "套餐续费已到账，当前流量不会清空";
  }
  if (payment.planActivationMode === "immediate_switch") {
    return "新套餐已立即生效";
  }
  return "套餐已立即开通";
}

export function GroupBuyExperience({ shareCode }: { shareCode?: string }) {
  const { token, session, refresh } = useAuth();
  const [campaigns, setCampaigns] = useState<GroupBuyCampaignRecord[]>([]);
  const [openGroups, setOpenGroups] = useState(emptyGroups);
  const [myGroups, setMyGroups] = useState(emptyGroups);
  const [sharedGroup, setSharedGroup] = useState<GroupBuyRecord | null>(null);
  const [tab, setTab] = useState<"open" | "mine">("open");
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [paymentType, setPaymentType] = useState<
    "alipay" | "wxpay" | "balance"
  >("alipay");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [pendingPaymentId, setPendingPaymentId] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<Checkout["kind"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelingGroupId, setCancelingGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [currentPlan, setCurrentPlan] = useState<{
    id: string;
    name: string;
    endsAt: string;
  } | null>(null);
  const [immediateSwitchConfirmed, setImmediateSwitchConfirmed] =
    useState(false);
  const [planActivation, setPlanActivation] = useState<
    "scheduled_switch" | "immediate_switch"
  >("scheduled_switch");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      try {
        const [nextCampaigns, nextOpen, nextMine, nextShared, overview] =
          await Promise.all([
            apiRequest<GroupBuyCampaignRecord[]>(
              "/api/portal/group-buys/campaigns",
              {
                token,
                signal,
              },
            ),
            apiRequest<PaginatedResponse<GroupBuyRecord>>(
              "/api/portal/group-buys?scope=open&pageSize=30",
              { token, signal },
            ),
            apiRequest<PaginatedResponse<GroupBuyRecord>>(
              "/api/portal/group-buys?scope=mine&pageSize=30",
              { token, signal },
            ),
            shareCode
              ? apiRequest<GroupBuyRecord>(
                  `/api/portal/group-buys/${shareCode}`,
                  {
                    token,
                    signal,
                  },
                )
              : Promise.resolve(null),
            apiRequest<PortalOverviewResponse>("/api/portal/subscription", {
              token,
              signal,
            }).catch(() => null),
          ]);
        setCampaigns(nextCampaigns);
        setOpenGroups(nextOpen);
        setMyGroups(nextMine);
        setSharedGroup(nextShared);
        setCurrentPlan(
          overview &&
            overview.plan.id !== "traffic_pack" &&
            overview.subscription.includedTrafficBytes > 0
            ? {
                id: overview.plan.id,
                name: overview.plan.name,
                endsAt: overview.subscription.endsAt,
              }
            : null,
        );
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof ApiError ? cause.message : "拼团信息加载失败。",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [shareCode, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!token || !pendingPaymentId) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const payment = await apiRequest<EpayPayment>(
          `/api/portal/payments/epay/${pendingPaymentId}`,
          { token },
        );
        if (stopped) return;
        if (payment.status === "settled") {
          setPendingPaymentId(null);
          setCheckout(null);
          setFeedback(
            pendingKind === "create"
              ? `${paymentActivationMessage(payment)}；拼团已开启，分享链接邀请另一位成员即可。`
              : `${paymentActivationMessage(payment)}；拼团成功奖励正在到账。`,
          );
          await load();
          return;
        }
        if (payment.status === "failed" || payment.status === "expired") {
          setPendingPaymentId(null);
          setError("支付单已关闭，可以重新发起拼团付款。");
          await load();
          return;
        }
      } catch {
        // Temporary query failures are retried without interrupting payment.
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 2_000);
    };
    timer = window.setTimeout(() => void poll(), 2_000);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [load, pendingKind, pendingPaymentId, token]);

  const selected = useMemo(() => {
    if (!checkout) return null;
    return checkout.kind === "create"
      ? {
          name: checkout.campaign.productName,
          offer: checkout.campaign.offerName,
          originalPriceCents: checkout.campaign.originalPriceCents,
          priceCents: checkout.campaign.priceCents,
          discountPercent: checkout.campaign.discountPercent,
          bonusBytes: checkout.campaign.bonusTrafficBytes,
          settlementMode: checkout.campaign.settlementMode,
          productId: checkout.campaign.productId,
        }
      : {
          name: checkout.group.productName,
          offer: checkout.group.offerName,
          originalPriceCents: checkout.group.originalPriceCents,
          priceCents: checkout.group.priceCents,
          discountPercent: checkout.group.discountPercent,
          bonusBytes: checkout.group.bonusTrafficBytes,
          settlementMode: checkout.group.settlementMode,
          productId: checkout.group.productId,
        };
  }, [checkout]);
  const balanceRebateCheckout =
    selected?.settlementMode === "original_price_balance_rebate";
  const checkoutAmountCents = balanceRebateCheckout
    ? (selected?.originalPriceCents ?? 0)
    : (selected?.priceCents ?? 0);
  const switchesCurrentPlan = Boolean(
    selected?.productId && currentPlan && selected.productId !== currentPlan.id,
  );
  const renewsCurrentPlan = Boolean(
    selected?.productId && currentPlan && selected.productId === currentPlan.id,
  );

  function openCheckout(next: Checkout) {
    setCheckout(next);
    setPaymentType("alipay");
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
    setFeedback(null);
    setImmediateSwitchConfirmed(false);
    setPlanActivation("scheduled_switch");
  }

  async function confirmPayment() {
    if (!token || !checkout) return;
    if (
      switchesCurrentPlan &&
      planActivation === "immediate_switch" &&
      !immediateSwitchConfirmed
    ) {
      setError("请先确认立即切换套餐的影响。");
      return;
    }
    const targetName = `epay-group-${idempotencyKey.replace(/[^A-Za-z0-9_-]/g, "")}`;
    const paymentWindow =
      paymentType === "balance" ? null : window.open("about:blank", targetName);
    if (paymentType !== "balance" && !paymentWindow) {
      setError("浏览器阻止了支付窗口，请允许本站打开新窗口后重试。");
      return;
    }
    if (paymentWindow) {
      paymentWindow.opener = null;
      paymentWindow.document.title = "正在前往支付";
      paymentWindow.document.body.textContent = "正在创建拼团支付订单...";
    }
    setBusy(true);
    setError(null);
    try {
      const path =
        checkout.kind === "create"
          ? "/api/portal/group-buys"
          : `/api/portal/group-buys/${checkout.group.id}/join`;
      const body =
        checkout.kind === "create"
          ? {
              campaignId: checkout.campaign.id,
              paymentType,
              planActivation: switchesCurrentPlan ? planActivation : undefined,
            }
          : {
              paymentType,
              planActivation: switchesCurrentPlan ? planActivation : undefined,
            };
      const payment = await apiRequest<EpayPayment>(path, {
        method: "POST",
        token,
        headers: { "Idempotency-Key": idempotencyKey },
        body,
      });
      setPendingKind(checkout.kind);
      if (payment.status === "settled") {
        paymentWindow?.close();
        setCheckout(null);
        setFeedback(
          checkout.kind === "create"
            ? `${paymentActivationMessage(payment)}；拼团已开启，成团后返余额并赠送流量。`
            : `${paymentActivationMessage(payment)}；拼团成功奖励正在到账。`,
        );
        await refresh();
        await load();
        return;
      }
      if (payment.status === "failed") {
        paymentWindow?.close();
        throw new Error("支付订单已关闭，请重新发起。");
      }
      setPendingPaymentId(payment.id);
      if (!paymentWindow) throw new Error("余额支付状态异常，请重新尝试。");
      submitGateway(payment, targetName, paymentWindow);
    } catch (cause) {
      paymentWindow?.close();
      setPendingPaymentId(null);
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "支付通道暂时无法打开。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyShare(group: GroupBuyRecord) {
    try {
      await copyToClipboard(group.shareUrl);
      setFeedback("拼团链接已复制，可以发给另一位成员。");
    } catch {
      setError("复制失败，请稍后重试。");
    }
  }

  async function cancelGroup(group: GroupBuyRecord) {
    if (!token || !group.canCancel) return;
    const confirmed = window.confirm(
      "取消后已开通套餐保持有效，但不会获得成团返余额和赠送流量。确认取消拼团？",
    );
    if (!confirmed) return;
    setCancelingGroupId(group.id);
    setError(null);
    setFeedback(null);
    try {
      const canceled = await apiRequest<GroupBuyRecord>(
        `/api/portal/group-buys/${group.id}/cancel`,
        { method: "POST", token },
      );
      if (sharedGroup?.id === group.id) setSharedGroup(canceled);
      await load();
      setFeedback("拼团已取消，已开通套餐保持有效，本次不返余额、不赠流量。");
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "取消拼团失败，请重试。",
      );
    } finally {
      setCancelingGroupId(null);
    }
  }

  const visibleGroups = tab === "open" ? openGroups.items : myGroups.items;

  return (
    <ConsoleShell
      title="双人拼团"
      subtitle="找一位搭子，一起拿下更低价格和更多流量"
      scope="GROUP"
      navItems={portalNav}
      requireRole="member"
    >
      <div className="group-buy-page">
        {error ? <div className="feedback error">{error}</div> : null}
        {feedback ? <div className="feedback success">{feedback}</div> : null}

        {sharedGroup ? (
          <section className="group-buy-share-banner">
            <div>
              <span>好友邀请您加入</span>
              <strong>
                {sharedGroup.productName} · {sharedGroup.offerName}
              </strong>
              <small>
                {sharedGroup.settlementMode === "original_price_balance_rebate"
                  ? "原价付款即开通 · 成团返余额 "
                  : `${discountLabel(sharedGroup.discountPercent)}拼团价 · 每人立省 `}
                {formatMoney(
                  savedCents(
                    sharedGroup.originalPriceCents,
                    sharedGroup.priceCents,
                  ),
                )}{" "}
                · 再得 {formatBytes(sharedGroup.bonusTrafficBytes)}
              </small>
            </div>
            <button
              className="action-button"
              type="button"
              disabled={!sharedGroup.canJoin}
              onClick={() => openCheckout({ kind: "join", group: sharedGroup })}
            >
              <Icon name="group_add" />
              {sharedGroup.canJoin
                ? `${formatMoney(
                    sharedGroup.settlementMode ===
                      "original_price_balance_rebate"
                      ? sharedGroup.originalPriceCents
                      : sharedGroup.priceCents,
                  )} 加入`
                : groupStatusLabel(sharedGroup)}
            </button>
          </section>
        ) : null}

        <div className="group-buy-section-intro">
          <div>
            <span className="eyebrow">GROUP EXCLUSIVE</span>
            <h2>拼团专享套餐</h2>
            <p>
              各自按原价付款，套餐立即到账。24
              小时内两人成团后返还优惠差额到余额并加送流量；未成团原价开通，不返不送。
            </p>
          </div>
        </div>

        <section className="group-buy-campaign-grid">
          {campaigns.map((campaign) => (
            <article className="group-buy-campaign-card" key={campaign.id}>
              <div className="group-buy-card-head">
                <span>
                  {periodNames[campaign.billingPeriod] ?? campaign.offerName}
                </span>
                <span className="badge success">
                  成团加送 {formatBytes(campaign.bonusTrafficBytes)}
                </span>
              </div>
              <h3>{campaign.productName}</h3>
              <p>{campaign.offerName} · 每人原价付款，套餐立即到账</p>
              <div className="group-buy-price">
                <strong>{formatMoney(campaign.originalPriceCents)}</strong>
                <small>/ 人</small>
                {campaign.discountPercent < 100 ? (
                  <em>
                    成团返{" "}
                    {formatMoney(
                      savedCents(
                        campaign.originalPriceCents,
                        campaign.priceCents,
                      ),
                    )}
                  </em>
                ) : null}
              </div>
              <div className="group-buy-value-strip">
                <span>
                  成团返余额
                  <strong>
                    {formatMoney(
                      savedCents(
                        campaign.originalPriceCents,
                        campaign.priceCents,
                      ),
                    )}
                  </strong>
                </span>
                <span>
                  成团后实际成本
                  <strong>{formatMoney(campaign.priceCents)}</strong>
                </span>
              </div>
              <div className="group-buy-card-facts">
                <span>套餐 {formatBytes(campaign.trafficBytes)}</span>
                <span>加送 {formatBytes(campaign.bonusTrafficBytes)}</span>
              </div>
              <button
                className="action-button"
                type="button"
                onClick={() => openCheckout({ kind: "create", campaign })}
              >
                <Icon name="group_add" />
                {formatMoney(campaign.originalPriceCents)} 发起拼团
              </button>
            </article>
          ))}
          {!loading && campaigns.length === 0 ? (
            <div className="empty-state group-buy-empty">
              <Icon name="group" />
              <div className="empty-state-title">当前没有开放的拼团套餐</div>
            </div>
          ) : null}
        </section>

        <section className="group-buy-list-section">
          <div className="group-buy-list-heading">
            <div>
              <span className="eyebrow">JOIN A GROUP</span>
              <h2>差一位，就能成团</h2>
            </div>
            <p>直接加入等待中的拼团，付款后套餐立即生效，成团奖励随后到账。</p>
          </div>
          <div className="group-buy-list-toolbar">
            <div className="segmented-control">
              <button
                type="button"
                className={tab === "open" ? "active" : ""}
                onClick={() => setTab("open")}
              >
                可加入的团
              </button>
              <button
                type="button"
                className={tab === "mine" ? "active" : ""}
                onClick={() => setTab("mine")}
              >
                我的拼团
              </button>
            </div>
            <span>
              {tab === "open" ? openGroups.total : myGroups.total} 个拼团
            </span>
          </div>
          <div className="group-buy-results-shell">
            <div className="group-buy-list-stage" key={tab}>
              <div className="group-buy-list">
                {visibleGroups.map((group) => (
                  <article className="group-buy-row" key={group.id}>
                    <div className="group-buy-row-plan">
                      <div className="group-buy-row-title">
                        <strong>
                          {group.productName} · {group.offerName}
                        </strong>
                        <span
                          className={`badge group-buy-status-badge ${group.status} ${group.status === "succeeded" ? "success" : group.status === "exception" ? "danger" : "neutral"}`}
                        >
                          {groupStatusLabel(group)}
                        </span>
                      </div>
                      <small>团号 {group.shareCode}</small>
                    </div>
                    <div className="group-buy-row-meta">
                      <span>
                        还差{" "}
                        {Math.max(group.requiredMembers - group.paidMembers, 0)}{" "}
                        人 · 剩余 {remainingLabel(group.expiresAt, now)}
                      </span>
                      <span
                        className="group-buy-progress"
                        aria-label="成团进度"
                      >
                        <i
                          style={{
                            width: `${Math.min((group.paidMembers / group.requiredMembers) * 100, 100)}%`,
                          }}
                        />
                      </span>
                      <strong>
                        {formatMoney(
                          group.settlementMode ===
                            "original_price_balance_rebate"
                            ? group.originalPriceCents
                            : group.priceCents,
                        )}{" "}
                        / 人 ·{" "}
                        {group.settlementMode ===
                        "original_price_balance_rebate"
                          ? "原价付款"
                          : discountLabel(group.discountPercent)}
                      </strong>
                      <small>
                        {group.settlementMode ===
                        "original_price_balance_rebate"
                          ? "成团返余额 "
                          : "立省 "}
                        {formatMoney(
                          savedCents(
                            group.originalPriceCents,
                            group.priceCents,
                          ),
                        )}{" "}
                        · 成团再得 {formatBytes(group.bonusTrafficBytes)}
                      </small>
                    </div>
                    <div className="group-buy-row-actions">
                      {group.canJoin ? (
                        <button
                          className="action-button compact"
                          type="button"
                          onClick={() => openCheckout({ kind: "join", group })}
                        >
                          <Icon name="group_add" />
                          {formatMoney(
                            group.settlementMode ===
                              "original_price_balance_rebate"
                              ? group.originalPriceCents
                              : group.priceCents,
                          )}{" "}
                          立即参团
                        </button>
                      ) : null}
                      {group.viewerMemberId && group.status === "open" ? (
                        <button
                          className="ghost-button compact"
                          type="button"
                          onClick={() => void copyShare(group)}
                        >
                          <Icon name="content_copy" />
                          分享链接
                        </button>
                      ) : null}
                      {group.canCancel ? (
                        <button
                          className="ghost-button compact"
                          type="button"
                          disabled={cancelingGroupId === group.id}
                          onClick={() => void cancelGroup(group)}
                        >
                          <Icon name="close" />
                          {cancelingGroupId === group.id
                            ? "取消中..."
                            : "取消拼团"}
                        </button>
                      ) : null}
                      {group.completedAt ? (
                        <small>{formatDateTime(group.completedAt)}</small>
                      ) : null}
                    </div>
                  </article>
                ))}
                {!loading && visibleGroups.length === 0 ? (
                  <div className="empty-state group-buy-empty">
                    <div className="empty-state-title">
                      {tab === "open"
                        ? "暂时没有等待成员的拼团"
                        : "您还没有参与拼团"}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>

      <Drawer
        open={Boolean(checkout)}
        onClose={() => !busy && setCheckout(null)}
        title={checkout?.kind === "join" ? "加入双人拼团" : "发起双人拼团"}
        subtitle={
          balanceRebateCheckout
            ? "付款即开通套餐，成团后返余额并赠送流量"
            : "两位成员均付款后统一发放权益"
        }
        footer={
          <div className="toolbar-actions checkout-footer-actions">
            <button
              className="action-button"
              type="button"
              disabled={
                busy ||
                (switchesCurrentPlan &&
                  planActivation === "immediate_switch" &&
                  !immediateSwitchConfirmed)
              }
              onClick={() => void confirmPayment()}
            >
              <Icon name="payments" />
              {busy
                ? "处理中..."
                : `${paymentType === "balance" ? "余额支付" : "前往支付"} · ${formatMoney(checkoutAmountCents)}`}
            </button>
            <button
              className="ghost-button"
              type="button"
              disabled={busy}
              onClick={() => setCheckout(null)}
            >
              取消
            </button>
          </div>
        }
      >
        {selected ? (
          <div className="checkout-dialog-content group-buy-checkout">
            {error ? <div className="feedback error">{error}</div> : null}
            <section className="checkout-product-summary">
              <span>
                {checkout?.kind === "join" ? "加入现有拼团" : "创建新拼团"}
              </span>
              <strong>
                {selected.name} · {selected.offer}
              </strong>
              {balanceRebateCheckout ? (
                <p>
                  本次按原价 {formatMoney(selected.originalPriceCents)}
                  付款，套餐立即开通。24
                  小时内两人成团后，每人返还优惠差额到站内余额。
                </p>
              ) : (
                <p>
                  原价 {formatMoney(selected.originalPriceCents)}，本团每人按{" "}
                  {discountLabel(selected.discountPercent)}支付。24
                  小时内两人付款成功后统一发放套餐。
                </p>
              )}
            </section>
            <section
              className="group-buy-checkout-saving"
              aria-label="成团双重奖励"
            >
              <div className="group-buy-checkout-saving-head">
                <Icon name="gift" />
                <span>
                  <strong>成团双重奖励</strong>
                  <small>两人均付款后自动到账</small>
                </span>
              </div>
              <div className="group-buy-checkout-rewards">
                <span>
                  <small>
                    {balanceRebateCheckout ? "返还余额" : "节省金额"}
                  </small>
                  <strong>
                    {formatMoney(
                      savedCents(
                        selected.originalPriceCents,
                        selected.priceCents,
                      ),
                    )}
                  </strong>
                </span>
                <span>
                  <small>额外流量</small>
                  <strong>+{formatBytes(selected.bonusBytes)}</strong>
                </span>
              </div>
              <small>仅成团成功发放 · 赠送流量随购买套餐到期</small>
            </section>
            {!currentPlan ? (
              <section className="group-buy-plan-activation-summary">
                <Icon name="bolt" />
                <span>
                  <strong>付款后立即开通</strong>
                  <small>支付确认后套餐立即到账并可以使用</small>
                </span>
              </section>
            ) : renewsCurrentPlan ? (
              <section className="group-buy-plan-activation-summary">
                <Icon name="schedule" />
                <span>
                  <strong>续费当前套餐</strong>
                  <small>
                    从 {formatDateTime(currentPlan.endsAt)}{" "}
                    起延长有效期，当前流量不会清空
                  </small>
                </span>
              </section>
            ) : switchesCurrentPlan ? (
              <section className="checkout-option-section">
                <div className="checkout-section-heading">
                  <strong>选择生效方式</strong>
                  <span>默认保留当前套餐剩余时间</span>
                </div>
                <div
                  className="checkout-purchase-action-options"
                  role="radiogroup"
                  aria-label="拼团套餐生效方式"
                >
                  <button
                    type="button"
                    className={
                      planActivation === "scheduled_switch" ? "selected" : ""
                    }
                    role="radio"
                    aria-checked={planActivation === "scheduled_switch"}
                    onClick={() => {
                      setPlanActivation("scheduled_switch");
                      setImmediateSwitchConfirmed(false);
                    }}
                  >
                    <Icon name="schedule" />
                    <span>
                      <strong>到期后切换</strong>
                      <small>
                        {currentPlan.name} 保留至{" "}
                        {formatDateTime(currentPlan.endsAt)}
                        ，届时自动启用新套餐
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={
                      planActivation === "immediate_switch" ? "selected" : ""
                    }
                    role="radio"
                    aria-checked={planActivation === "immediate_switch"}
                    onClick={() => {
                      setPlanActivation("immediate_switch");
                      setImmediateSwitchConfirmed(false);
                    }}
                  >
                    <Icon name="bolt" />
                    <span>
                      <strong>立即切换</strong>
                      <small>支付确认后立即使用新套餐</small>
                    </span>
                  </button>
                </div>
                {planActivation === "immediate_switch" ? (
                  <label className="checkout-switch-confirmation">
                    <input
                      type="checkbox"
                      checked={immediateSwitchConfirmed}
                      onChange={(event) =>
                        setImmediateSwitchConfirmed(event.target.checked)
                      }
                    />
                    <span>
                      我确认立即切换套餐，当前 {currentPlan.name}
                      的剩余有效期和流量将不折现、不顺延。
                    </span>
                  </label>
                ) : null}
              </section>
            ) : null}
            <section className="checkout-option-section">
              <div className="checkout-section-heading">
                <strong>选择支付方式</strong>
                <span>
                  {paymentType === "balance"
                    ? "将从站内余额即时扣款"
                    : "将在新窗口完成支付"}
                </span>
              </div>
              <div
                className="checkout-payment-options group-buy-payment-options"
                role="radiogroup"
              >
                <button
                  type="button"
                  className={paymentType === "alipay" ? "selected" : ""}
                  role="radio"
                  aria-checked={paymentType === "alipay"}
                  onClick={() => setPaymentType("alipay")}
                >
                  <Icon name="payments" />
                  <span>支付宝</span>
                </button>
                <button
                  type="button"
                  className={paymentType === "wxpay" ? "selected" : ""}
                  role="radio"
                  aria-checked={paymentType === "wxpay"}
                  onClick={() => setPaymentType("wxpay")}
                >
                  <Icon name="payments" />
                  <span>微信支付</span>
                </button>
                {balanceRebateCheckout ? (
                  <button
                    type="button"
                    className={paymentType === "balance" ? "selected" : ""}
                    role="radio"
                    aria-checked={paymentType === "balance"}
                    onClick={() => setPaymentType("balance")}
                  >
                    <Icon name="payments" />
                    <span className="group-buy-balance-option">
                      <strong>余额支付</strong>
                      <small>
                        可用 {formatMoney(session?.user.balanceCents ?? 0)}
                      </small>
                    </span>
                  </button>
                ) : null}
              </div>
            </section>
            <div className="group-buy-refund-note">
              <Icon name="shield" />
              <div>
                <strong>付款与成团规则</strong>
                <span>
                  {balanceRebateCheckout
                    ? "付款后按原价立即开通套餐。成团成功返还优惠差额到余额并赠送流量；未成团保留原价套餐，不返余额、不赠流量。"
                    : "历史拼团继续按优惠价付款；未成团时按原规则尝试退款或兜底发放原套餐。"}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </ConsoleShell>
  );
}
