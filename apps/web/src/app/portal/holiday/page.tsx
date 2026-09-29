"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConsoleShell } from "@/components/console-shell";
import { useAuth } from "@/components/auth-provider";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { CheckoutPaymentOptions } from "@/components/checkout-payment-options";
import { bestHolidayBundle } from "@/lib/holiday-savings";
import { apiRequest } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatMoney, formatBytes, formatDateTime } from "@/lib/format";
import "./holiday.scss";
import { type HolidayView, type HolidayOffer } from "@/lib/holiday";

type Quote = {
  finalPriceCents: number;
  revision: number;
  expectsDraw: boolean;
  planActivationMode: string;
  planEffectiveAt: string;
  currentPlanName: string | null;
  currentPlanEndsAt: string | null;
};
type Selection =
  | { kind: "TOPUP"; tierId: string; price: number; gift: number }
  | { kind: "PLAN"; offer: HolidayOffer };
type Payment = {
  status: string;
  orderId?: string;
  gateway?: {
    url: string;
    method: "GET" | "POST";
    fields: Record<string, string>;
  };
};

export default function HolidayPage() {
  const { token } = useAuth();
  const [data, setData] = useState<HolidayView | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [period, setPeriod] = useState("QUARTERLY"),
    [selection, setSelection] = useState<Selection | null>(null),
    [quote, setQuote] = useState<Quote | null>(null),
    [activation, setActivation] = useState("scheduled_switch"),
    [confirmed, setConfirmed] = useState(false),
    [paymentType, setPaymentType] = useState("alipay"),
    [busy, setBusy] = useState(false),
    [drawBusy, setDrawBusy] = useState(false),
    [drawing, setDrawing] = useState(false);
  const purchaseKey = useRef(""),
    drawKey = useRef("");
  const campaignRevision = data?.campaign?.revision;
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!token || !selection) return;
    const controller = new AbortController();
    void apiRequest<{ balanceCents: number }>("/api/portal/wallet", {
      token,
      signal: controller.signal,
    })
      .then((wallet) => setBalance(wallet.balanceCents))
      .catch(() => {
        if (!controller.signal.aborted) setBalance(null);
      });
    return () => controller.abort();
  }, [token, selection]);
  const canEarnDraw = data?.campaign?.canEarnDraw;
  const selectedOfferPrice =
    selection?.kind === "PLAN"
      ? data?.offers.find((o) => o.offerId === selection.offer.offerId)
          ?.priceCents
      : undefined;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      try {
        setData(
          await apiRequest<HolidayView>("/api/portal/holiday", {
            token,
            signal,
          }),
        );
      } catch (e) {
        if (!signal?.aborted)
          setError(e instanceof Error ? e.message : "加载活动失败");
      }
    },
    [token],
  );
  useEffect(() => {
    const controller = new AbortController();
    if (token)
      void apiRequest<HolidayView>("/api/portal/holiday", {
        token,
        signal: controller.signal,
      })
        .then(setData)
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : "加载活动失败");
        });
    const timer = setInterval(() => void refresh(controller.signal), 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh, token]);
  useEffect(() => {
    if (selection?.kind !== "PLAN" || !token) return;
    const controller = new AbortController();
    void apiRequest<Quote>("/api/portal/holiday/quote", {
      token,
      method: "POST",
      signal: controller.signal,
      body: { offerId: selection.offer.offerId, planActivation: activation },
    })
      .then(setQuote)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "报价失败");
      });
    return () => controller.abort();
  }, [
    selection,
    activation,
    token,
    campaignRevision,
    canEarnDraw,
    selectedOfferPrice,
  ]);
  const c = data?.campaign;
  const best = bestHolidayBundle(data);
  function select(s: Selection) {
    setQuote(null);
    setSelection(s);
    setActivation("scheduled_switch");
    setConfirmed(false);
    setPaymentType("alipay");
    purchaseKey.current = crypto.randomUUID();
    setError("");
  }
  async function resume(attemptId: string) {
    const target = `holiday-resume-${attemptId}`,
      win = window.open("", target);
    if (!win) {
      setError("请允许打开支付页面后重试");
      return;
    }
    win.opener = null;
    win.document.body.textContent = "正在核对支付状态…";
    try {
      const payment = await apiRequest<Payment>(
        `/api/portal/payments/epay/${attemptId}`,
        { token },
      );
      if (!payment.gateway)
        throw new Error("该支付已结束或正在核验，请查看活动记录");
      const url = new URL(payment.gateway.url);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("支付地址无效");
      if (payment.gateway.method === "GET") {
        Object.entries(payment.gateway.fields).forEach(([k, v]) =>
          url.searchParams.set(k, v),
        );
        win.location.replace(url.href);
      } else {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = url.href;
        form.target = target;
        Object.entries(payment.gateway.fields).forEach(([name, value]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
        form.remove();
      }
    } catch (e) {
      win.close();
      setError(e instanceof Error ? e.message : "打开支付失败");
    }
    await refresh();
  }
  async function pay() {
    if (!c || !selection || busy || (selection.kind === "PLAN" && !quote))
      return;
    const target = `holiday-${purchaseKey.current}`,
      win = paymentType !== "wallet" ? window.open("", target) : null;
    if (paymentType !== "wallet" && !win) {
      setError("请允许打开支付页面后重试");
      return;
    }
    if (win) {
      win.opener = null;
      win.document.body.textContent = "正在创建活动订单…";
    }
    setBusy(true);
    setError("");
    try {
      const payment = await apiRequest<Payment>(
        "/api/portal/holiday/payments",
        {
          method: "POST",
          token,
          headers: { "Idempotency-Key": purchaseKey.current },
          body: {
            kind: selection.kind,
            ...(selection.kind === "TOPUP"
              ? { tierId: selection.tierId }
              : {
                  offerId: selection.offer.offerId,
                  planActivation: activation,
                }),
            paymentType,
            immediateConfirmed: confirmed,
            revision: quote?.revision ?? c.revision,
            expectedPriceCents:
              selection.kind === "TOPUP"
                ? selection.price
                : quote!.finalPriceCents,
            expectsDraw:
              selection.kind === "PLAN" ? quote!.expectsDraw : c.canEarnDraw,
          },
        },
      );
      if (payment.status === "settled") {
        win?.close();
        setMessage(
          quote?.planActivationMode === "scheduled_switch"
            ? `套餐已到账，将于 ${formatDateTime(quote.planEffectiveAt)} 生效`
            : "订单已到账，可在活动记录和订单中心查看",
        );
      } else if (payment.gateway && win) {
        const url = new URL(payment.gateway.url);
        if (!["https:", "http:"].includes(url.protocol))
          throw new Error("支付地址无效");
        if (payment.gateway.method === "GET") {
          Object.entries(payment.gateway.fields).forEach(([k, v]) =>
            url.searchParams.set(k, v),
          );
          win.location.replace(url.href);
        } else {
          const form = document.createElement("form");
          form.method = "POST";
          form.action = url.href;
          form.target = target;
          Object.entries(payment.gateway.fields).forEach(([name, value]) => {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = value;
            form.appendChild(input);
          });
          document.body.appendChild(form);
          form.submit();
          form.remove();
        }
        setMessage("支付页已打开，到账状态将自动刷新。");
      } else {
        win?.close();
        setMessage("该支付已结束，请刷新活动记录核对。");
      }
      setSelection(null);
      await refresh();
    } catch (e) {
      win?.close();
      setError(e instanceof Error ? e.message : "支付失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  async function draw() {
    if (drawBusy) return;
    setDrawBusy(true);
    setDrawing(true);
    if (!drawKey.current) drawKey.current = crypto.randomUUID();
    try {
      const r = await apiRequest<{ prizeCents: number }>(
        "/api/portal/holiday/draw",
        {
          method: "POST",
          token,
          headers: { "Idempotency-Key": drawKey.current },
        },
      );
      setMessage(
        r.prizeCents
          ? `恭喜获得 ${formatMoney(r.prizeCents)}，已入余额`
          : "谢谢参与，祝您假期愉快",
      );
      drawKey.current = "";
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "抽奖失败，请重试");
    } finally {
      setDrawBusy(false);
      setDrawing(false);
    }
  }
  return (
    <ConsoleShell
      title={c?.title ?? "中秋·国庆活动"}
      subtitle="中秋返场 · 国庆限定"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
    >
      <div
        className="holiday-page holiday-storefront"
        style={
          c?.config.backgroundImageUrl
            ? {
                backgroundImage: `linear-gradient(var(--holiday-image-overlay), var(--holiday-image-overlay)), url(${JSON.stringify(c.config.backgroundImageUrl)})`,
              }
            : undefined
        }
      >
        {error && (
          <div role="alert" className="holiday-notice">
            {error}
            <button
              className="ghost-button"
              onClick={() => {
                setError("");
                void refresh();
              }}
            >
              刷新
            </button>
          </div>
        )}
        {message && (
          <div role="status" className="holiday-notice">
            {message}
          </div>
        )}
        {!data ? (
          <p>正在加载活动…</p>
        ) : !c ? (
          <section className="holiday-hero">
            <h2>节日活动筹备中</h2>
            <p>活动开放后，充值赠额、限定套餐和幸运抽奖将在这里展示。</p>
          </section>
        ) : (
          <>
            <section
              className="holiday-rules"
              aria-labelledby="holiday-rules-title"
            >
              <header>
                <h2 id="holiday-rules-title">国庆限定优惠</h2>
                <span>
                  {c.live ? "进行中" : "未开放"} · 至 {formatDateTime(c.endsAt)}
                  （北京时间）
                </span>
              </header>
              {best ? (
                <div className="holiday-saving holiday-saving-simple">
                  <div className="holiday-saving-path">
                    <strong>
                      充 {formatMoney(best.paid)} 送 {formatMoney(best.gift)} ·{" "}
                      {best.offer.name}
                      {best.offer.billingPeriod === "YEARLY" ? "年付" : "季付"}
                    </strong>
                    <p>单档充值赠额 + 套餐立减，余额还能继续用。</p>
                  </div>
                  <div className="holiday-saving-total">
                    <strong>{formatMoney(best.saving)}</strong>
                    <small>合计优惠价值，含赠送余额</small>
                  </div>
                </div>
              ) : (
                <p>充值赠余额，套餐享活动价。</p>
              )}
              <details>
                <summary>查看活动规则</summary>
                <div className="holiday-rule-details">
                  {best && (
                    <p>
                      <strong>优惠示例：</strong>实充 {formatMoney(best.paid)}
                      ，到账 {formatMoney(best.paid + best.gift)}；
                      {best.offer.name} 套餐扣款{" "}
                      {formatMoney(best.offer.priceCents)}，余{" "}
                      {formatMoney(best.remaining)}。优惠价值为赠额{" "}
                      {formatMoney(best.gift)} 加套餐立减{" "}
                      {formatMoney(
                        best.offer.originalPriceCents - best.offer.priceCents,
                      )}
                      。只按单档充值计算，不叠加已有余额，不是现金返还，下单仍需核验套餐资格。
                    </p>
                  )}
                  <p>
                    <strong>邀请奖励：</strong>
                    活动期间通过你的邀请码注册的好友，首次外部充值后给你{" "}
                    {formatMoney(c.config.inviteRewardCents ?? 500)}{" "}
                    余额，每位好友一次，充值金额最低10元（普通充值与活动充值均可）。现金奖励与抽奖次数分别计算，抽奖名额用完不影响现金返现。退款须追回对应现金和中奖奖励；余额不足转人工核验，不重新恢复资格。
                  </p>
                  <p>
                    <strong>充值返利：</strong>
                    {c.config.tiers
                      .map(
                        (t) =>
                          `充 ${formatMoney(t.amountCents)} 送 ${formatMoney(t.giftCents)}`,
                      )
                      .join("；")}
                    。每人每档一次，仅外部支付可充值，受全站赠额预算限制。本金与赠额永久有效，可支付活动套餐。首页普通充值不参加本活动。
                  </p>
                  <p>
                    <strong>套餐优惠：</strong>
                    仅本页指定套餐季付、年付参加，折扣以当前报价为准，原价为同套餐同周期普通商城价格。Start、Go、永久
                    Ultra、流量包和重置不参加；不叠加优惠码或拼团奖励。邀请现金奖励按本活动规则执行。
                  </p>
                  <p>
                    <strong>套餐生效：</strong>
                    首次购买立即开通，同套餐续期不清空本周期已用流量；不同套餐默认到期切换，也可确认后立即切换。立即切换放弃旧套餐剩余时间与流量，不折现、不顺延。已有预约套餐时不能重复购买。
                  </p>
                  <p>
                    <strong>抽奖规则：</strong>
                    每笔成功活动订单送三次机会，不设个人三次上限，名额以付款确认页为准。活动期间好友通过你的邀请码注册，送你一次；好友首次成功充值再补两次，合计三次，重复充值不重复送邀请机会。邀请充值包含普通充值与活动充值。全站抽奖名额有限，耗尽后不再新增机会。奖品不放回抽取，概率随剩余库存变化；机会不保证中奖。中奖余额永久有效，普通商城及拼团订单不送购买机会。
                  </p>
                  <p>
                    <strong>活动时间：</strong>
                    {formatDateTime(c.startsAt)} 至 {formatDateTime(c.endsAt)}
                    ，抽奖截止 {formatDateTime(c.drawEndsAt)}
                    （北京时间）。付款时价格及生效方式保存快照，后续改价不影响已确认订单，活动结束保留记录。
                  </p>
                  <p>
                    <strong>退款说明：</strong>
                    充值仅在本金、赠额及相关中奖奖励可完整追回时支持全额自动退款；已有消费等情况需人工处理，不产生负余额。退款撤销未使用的抽奖机会，不恢复参与资格。叠加示例需有对应档位资格及赠额预算，未使用余额可继续消费。
                  </p>
                </div>
              </details>
            </section>
            <div className="holiday-activities">
              <section
                className="holiday-activity holiday-invite"
                aria-labelledby="holiday-invite-title"
              >
                <div>
                  <h2 id="holiday-invite-title">
                    邀请好友，领{formatMoney(c.config.inviteRewardCents ?? 500)}
                    余额
                  </h2>
                  <p>
                    好友注册送你 <strong>1 次抽奖</strong>，首次充值再送{" "}
                    <strong>
                      2 次 + {formatMoney(c.config.inviteRewardCents ?? 500)}
                    </strong>
                    。
                  </p>
                </div>
                <Link className="action-button" href="/portal/referrals">
                  去邀请
                </Link>
              </section>
              <section
                className="holiday-activity"
                aria-labelledby="holiday-topup"
              >
                <header>
                  <span className="holiday-step">01</span>
                  <h2 id="holiday-topup">充值返利</h2>
                </header>
                <p className="holiday-caption">
                  充值多到账，赠额也能买折扣套餐
                </p>
                <div className="holiday-topups">
                  {c.config.tiers.map((t) => {
                    const claimed =
                      data.claimedTierIds?.includes(t.id) ??
                      data.entries.some(
                        (e) => e.tierId === t.id && e.status !== "CLOSED",
                      );
                    const pending = data.entries.find(
                      (e) =>
                        e.tierId === t.id &&
                        e.status === "RESERVED" &&
                        e.attemptId,
                    );
                    const soldOut =
                      t.giftCents > c.giftBudgetCents - c.reservedGiftCents;
                    return (
                      <article className="holiday-topup-row" key={t.id}>
                        <div>
                          <strong>
                            充 {formatMoney(t.amountCents)}{" "}
                            <em>送 {formatMoney(t.giftCents)}</em>
                          </strong>
                          <small>
                            到账 {formatMoney(t.amountCents + t.giftCents)} ·
                            每档限一次
                          </small>
                        </div>
                        <button
                          className="action-button"
                          disabled={
                            busy ||
                            (!pending && (!c.live || claimed || soldOut))
                          }
                          onClick={() =>
                            pending?.attemptId
                              ? void resume(pending.attemptId)
                              : select({
                                  kind: "TOPUP",
                                  tierId: t.id,
                                  price: t.amountCents,
                                  gift: t.giftCents,
                                })
                          }
                        >
                          {pending
                            ? "继续付款"
                            : claimed
                              ? "已参与"
                              : !c.live
                                ? "未开放"
                                : soldOut
                                  ? "已领完"
                                  : "充值"}
                        </button>
                      </article>
                    );
                  })}
                </div>
                <p className="holiday-footnote">
                  剩余赠额预算{" "}
                  {formatMoney(
                    Math.max(0, c.giftBudgetCents - c.reservedGiftCents),
                  )}
                  。余额永久有效。
                </p>
              </section>
              <section
                className="holiday-activity"
                aria-labelledby="holiday-plans"
              >
                <header>
                  <span className="holiday-step">02</span>
                  <h2 id="holiday-plans">
                    {c.config.offers.length > 0 &&
                    c.config.offers.every((o) => o.discountBasisPoints === 8000)
                      ? "套餐 8 折"
                      : "套餐优惠"}
                  </h2>
                  <div className="holiday-periods" aria-label="购买周期">
                    {["QUARTERLY", "YEARLY"].map((p) => (
                      <button
                        key={p}
                        aria-pressed={period === p}
                        className={
                          period === p ? "action-button" : "ghost-button"
                        }
                        onClick={() => setPeriod(p)}
                      >
                        {p === "YEARLY" ? "年付" : "季付"}
                      </button>
                    ))}
                  </div>
                </header>
                <p className="holiday-caption">
                  可用充值本金 + 赠额支付，一次付清
                </p>
                <div className="holiday-offer-list">
                  {data.offers
                    .filter((o) => o.billingPeriod === period)
                    .map((o) => (
                      <article className="holiday-offer-row" key={o.offerId}>
                        <div>
                          <strong>{o.name}</strong>
                          <small>
                            每月 {formatBytes(Number(o.trafficBytes))}
                          </small>
                        </div>
                        <div className="holiday-offer-price">
                          <strong>{formatMoney(o.priceCents)}</strong>
                          <small>
                            <del>{formatMoney(o.originalPriceCents)}</del> · 省{" "}
                            {formatMoney(o.originalPriceCents - o.priceCents)}
                          </small>
                        </div>
                        <button
                          className="action-button"
                          disabled={!c.live}
                          onClick={() => select({ kind: "PLAN", offer: o })}
                        >
                          选购
                        </button>
                      </article>
                    ))}
                </div>
                <p className="holiday-footnote">
                  同套餐续费延长有效期，不清空本周期已用流量。
                </p>
              </section>
              <section
                className="holiday-activity"
                aria-labelledby="holiday-draw"
              >
                <header>
                  <span className="holiday-step">03</span>
                  <h2 id="holiday-draw">幸运抽奖</h2>
                </header>
                <p className="holiday-caption">
                  每笔成功活动订单送 3 次，邀请好友再送
                </p>
                <div className="holiday-draw-balance">
                  <strong>{data.drawAvailable}</strong>
                  <span>次可用机会</span>
                </div>
                <button
                  className="action-button holiday-draw-button"
                  disabled={!c.drawOpen || !data.drawAvailable || drawBusy}
                  onClick={() => void draw()}
                >
                  {drawBusy ? "正在揭晓…" : "立即抽奖"}
                </button>
                {drawing && (
                  <span className="holiday-drawing" aria-hidden="true" />
                )}
                <div className="holiday-prize-list">
                  {c.prizes.map((p) => (
                    <div key={p.cents}>
                      <strong>
                        {p.cents ? formatMoney(p.cents) : "谢谢参与"}
                      </strong>
                      <span>{(p.probability * 100).toFixed(2)}%</span>
                      <small>剩 {p.count} 份</small>
                    </div>
                  ))}
                </div>
                <p className="holiday-footnote">
                  以上为当前库存概率，抽取后变化。
                  <br />
                  截止 {formatDateTime(c.drawEndsAt)}。
                </p>
              </section>
            </div>
          </>
        )}
      </div>
      <Drawer
        open={!!selection}
        onClose={() => {
          if (!busy) setSelection(null);
        }}
        title={
          selection?.kind === "TOPUP"
            ? "活动充值"
            : `购买 ${selection?.kind === "PLAN" ? selection.offer.name : "套餐"}`
        }
        subtitle="确认金额与支付方式后继续"
        footer={
          <div className="toolbar-actions checkout-footer-actions">
            <button
              className="action-button"
              disabled={
                busy ||
                !c?.live ||
                (paymentType === "wallet" &&
                  (balance == null ||
                    !quote ||
                    balance < quote.finalPriceCents)) ||
                (selection?.kind === "PLAN" &&
                  quote?.revision !== c.revision) ||
                (selection?.kind === "PLAN" && !quote) ||
                (quote?.planActivationMode === "immediate_switch" && !confirmed)
              }
              onClick={() => void pay()}
            >
              {busy
                ? "正在处理…"
                : `${paymentType === "wallet" ? "余额支付" : "前往支付"} · ${formatMoney(selection?.kind === "TOPUP" ? selection.price : (quote?.finalPriceCents ?? 0))}`}
            </button>
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() => setSelection(null)}
            >
              取消
            </button>
          </div>
        }
      >
        {selection && (
          <div className="checkout-dialog-content holiday-checkout-content">
            {error && (
              <div className="feedback error" role="alert">
                {error}
              </div>
            )}
            <section className="checkout-product-summary">
              <span>
                {selection.kind === "TOPUP" ? "活动余额充值" : "国庆专享套餐"}
              </span>
              <strong>
                {selection.kind === "TOPUP"
                  ? `充值 ${formatMoney(selection.price)}`
                  : selection.offer.name}
              </strong>
              <p>
                {selection.kind === "TOPUP"
                  ? "本金与赠额永久有效，可用于购买活动套餐。"
                  : `${selection.offer.billingPeriod === "YEARLY" ? "年付" : "季付"} · 每月 ${formatBytes(Number(selection.offer.trafficBytes))}`}
              </p>
            </section>
            {selection.kind === "PLAN" && (
              <>
                {quote &&
                  ["scheduled_switch", "immediate_switch"].includes(
                    quote.planActivationMode,
                  ) && (
                    <section className="checkout-option-section">
                      <div className="checkout-section-heading">
                        <strong>套餐生效方式</strong>
                        <span>默认到期后切换</span>
                      </div>
                      <div
                        className="checkout-purchase-action-options"
                        role="radiogroup"
                        aria-label="套餐生效方式"
                      >
                        {[
                          ["scheduled_switch", "到期后切换"],
                          ["immediate_switch", "立即切换"],
                        ].map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={activation === mode}
                            className={activation === mode ? "selected" : ""}
                            disabled={busy}
                            onClick={() => {
                              setQuote(null);
                              setActivation(mode);
                              setConfirmed(false);
                              purchaseKey.current = crypto.randomUUID();
                            }}
                          >
                            <Icon
                              name={
                                mode === "scheduled_switch"
                                  ? "schedule"
                                  : "bolt"
                              }
                            />
                            <span>
                              <strong>{label}</strong>
                              <small>
                                {mode === "scheduled_switch"
                                  ? "保留当前套餐剩余时间与流量"
                                  : "放弃旧套餐剩余时间与流量"}
                              </small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                {quote ? (
                  <>
                    <p>
                      {quote.planActivationMode === "renewal"
                        ? "续费当前套餐，延长有效期，不清空本周期已用流量"
                        : quote.planActivationMode === "initial"
                          ? "付款后立即开通"
                          : quote.planActivationMode === "scheduled_switch"
                            ? "套餐到账后预约生效，不因流量耗尽提前切换"
                            : "立即结束当前普通套餐并切换"}
                    </p>
                    <p>
                      生效时间：{formatDateTime(quote.planEffectiveAt)}
                      （北京时间）
                    </p>

                    {quote.planActivationMode === "immediate_switch" && (
                      <label className="checkout-switch-confirmation">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        我确认旧套餐剩余时间和流量不折现、不顺延。
                      </label>
                    )}
                  </>
                ) : (
                  <p>正在核对套餐状态…</p>
                )}
              </>
            )}
            <CheckoutPaymentOptions
              value={paymentType}
              disabled={busy}
              balance={selection.kind === "PLAN" ? balance : undefined}
              amountCents={quote?.finalPriceCents}
              onChange={(value) => {
                setPaymentType(value);
                purchaseKey.current = crypto.randomUUID();
              }}
            />
            <div className="checkout-price-summary">
              <div>
                <span>
                  {selection.kind === "TOPUP" ? "充值本金" : "套餐原价"}
                </span>
                <strong>
                  {formatMoney(
                    selection.kind === "TOPUP"
                      ? selection.price
                      : selection.offer.originalPriceCents,
                  )}
                </strong>
              </div>
              <div className="saving">
                <span>
                  {selection.kind === "TOPUP" ? "活动赠额" : "国庆优惠"}
                </span>
                <strong>
                  {selection.kind === "TOPUP" ? "+" : "−"}
                  {formatMoney(
                    selection.kind === "TOPUP"
                      ? selection.gift
                      : selection.offer.originalPriceCents -
                          (quote?.finalPriceCents ??
                            selection.offer.priceCents),
                  )}
                </strong>
              </div>
              {selection.kind === "TOPUP" && (
                <div>
                  <span>合计到账余额</span>
                  <strong>
                    {formatMoney(selection.price + selection.gift)}
                  </strong>
                </div>
              )}
              <div className="total">
                <span>实付金额</span>
                <strong>
                  {formatMoney(
                    selection.kind === "TOPUP"
                      ? selection.price
                      : (quote?.finalPriceCents ?? selection.offer.priceCents),
                  )}
                </strong>
              </div>
            </div>
            <p>
              {(selection.kind === "PLAN" ? quote?.expectsDraw : c?.canEarnDraw)
                ? "本单到账赠三次抽奖机会。"
                : "本单不赠抽奖机会（剩余名额不足三次）。"}
            </p>
            <p>
              活动订单不能叠加拼团或优惠码；付款后按本次确认的价格和生效方式处理。
            </p>
          </div>
        )}
      </Drawer>
    </ConsoleShell>
  );
}
