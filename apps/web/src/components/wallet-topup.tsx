"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useAuth } from "./auth-provider";
import { Drawer } from "./drawer";
import { CheckoutPaymentOptions } from "./checkout-payment-options";
import { apiRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import "./wallet-topup.scss";

type Payment = {
  id: string;
  status: string;
  fulfillmentStatus: string;
  amountCents: number;
  gateway?: {
    url: string;
    method: "GET" | "POST";
    fields: Record<string, string>;
  };
};
export function WalletTopup({ onSettled }: { onSettled: () => void }) {
  const { token } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("10");
  const [channel, setChannel] = useState("alipay");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const request = useRef({ key: "", fingerprint: "" });
  const lock = useRef(false);
  const paymentId = payment?.id;
  const paymentStatus = payment?.status;
  const notified = useRef("");
  const callback = useRef(onSettled);
  useEffect(() => {
    callback.current = onSettled;
  }, [onSettled]);
  const refreshBalance = useCallback(async () => {
    const wallet = await apiRequest<{ balanceCents: number }>(
      "/api/portal/wallet",
      { token },
    );
    setBalance(wallet.balanceCents);
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void Promise.all([
      apiRequest<{ balanceCents: number }>("/api/portal/wallet", {
        token,
        signal: controller.signal,
      }),
      apiRequest<Payment[]>("/api/portal/wallet/topups", {
        token,
        signal: controller.signal,
      }),
    ])
      .then(([wallet, attempts]) => {
        setBalance(wallet.balanceCents);
        setPayment(attempts.find((p) => p.status === "pending") ?? null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "余额加载失败");
      });
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    if (!token || !paymentId || paymentStatus !== "pending") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const next = await apiRequest<Payment>(
          `/api/portal/payments/epay/${paymentId}`,
          { token, signal: controller.signal },
        );
        setPayment(next);
        if (next.status === "settled") {
          if (next.fulfillmentStatus === "applied") {
            setNotice(`充值成功，${formatMoney(next.amountCents)} 已到账。`);
            await refreshBalance();
            if (notified.current !== next.id) {
              notified.current = next.id;
              callback.current();
            }
          } else setNotice("款项正在核验或退款处理中，请到订单记录查看。");
        } else if (next.status !== "pending")
          setNotice(
            "支付已结束或过期；若已付款，请在订单记录中核对到账或退款状态。",
          );
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "核对充值状态失败");
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void check(), 5000);
    }
    timer = setTimeout(() => void check(), 3000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, paymentId, paymentStatus, refreshBalance]);

  const valid = /^\d+(?:\.\d{1,2})?$/.test(amount.trim());
  const cents = valid ? Math.round(Number(amount) * 100) : 0;
  const amountValid =
    valid &&
    Number.isSafeInteger(cents) &&
    cents >= 1000 &&
    cents <= 2147483647;
  async function pay(resume = false) {
    if (lock.current || !token) return;
    if (!resume && !amountValid) {
      setError("请输入不少于 10 元的充值金额，最多两位小数。");
      return;
    }
    const fingerprint = `${cents}:${channel}`;
    if (request.current.fingerprint !== fingerprint || !request.current.key)
      request.current = { fingerprint, key: crypto.randomUUID() };
    const target = `wallet-${request.current.key}`;
    const win = window.open("", target);
    if (!win) {
      setError("请允许弹出支付页面后重试。");
      return;
    }
    win.opener = null;
    win.document.body.textContent = "正在准备充值支付…";
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next =
        resume && payment
          ? await apiRequest<Payment>(
              `/api/portal/wallet/topups/${payment.id}/checkout`,
              { token },
            )
          : await apiRequest<Payment>("/api/portal/wallet/topups", {
              token,
              method: "POST",
              headers: { "Idempotency-Key": request.current.key },
              body: { amountCents: cents, paymentType: channel },
            });
      setPayment(next);
      if (!next.gateway) {
        win.close();
        if (next.status === "settled" && next.fulfillmentStatus === "applied") {
          setNotice("充值已到账。");
          await refreshBalance();
          callback.current();
        } else
          setNotice("该支付已结束，请查看订单记录；需要充值时请重新发起。");
        request.current = { key: "", fingerprint: "" };
        return;
      }
      const url = new URL(next.gateway.url);
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("支付地址无效");
      if (next.gateway.method === "GET") {
        Object.entries(next.gateway.fields).forEach(([key, value]) =>
          url.searchParams.set(key, value),
        );
        win.location.replace(url.href);
      } else {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = url.href;
        form.target = target;
        Object.entries(next.gateway.fields).forEach(([name, value]) => {
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
      setNotice("支付页面已打开，到账后余额将自动更新。");
      request.current = { key: "", fingerprint: "" };
    } catch (e) {
      win.close();
      setError(e instanceof Error ? e.message : "充值失败，请重试");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <section className="wallet-topup-banner" aria-label="账户余额与充值">
        <div>
          <span>余额</span>
          <strong>{balance === null ? "—" : formatMoney(balance)}</strong>
        </div>
        <button className="action-button" onClick={() => setOpen(true)}>
          充值
        </button>
      </section>
      {notice && (
        <p className="feedback" role="status">
          {notice}
        </p>
      )}
      {error && !open && (
        <p className="feedback error" role="alert">
          {error}
          <button
            className="ghost-button"
            onClick={() => {
              setOpen(true);
              void refreshBalance().catch(() => {});
            }}
          >
            查看充值
          </button>
        </p>
      )}
      {open &&
        createPortal(
          <Drawer
            open={open}
            onClose={() => {
              if (!busy) setOpen(false);
            }}
            title="余额充值"
            subtitle="确认金额与支付方式后继续"
            footer={
              <div className="toolbar-actions checkout-footer-actions">
                <button
                  className="action-button"
                  disabled={busy || !amountValid}
                  onClick={() => void pay()}
                >
                  {busy ? "正在处理…" : `前往支付 · ${formatMoney(cents || 0)}`}
                </button>
                <button
                  className="ghost-button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  取消
                </button>
              </div>
            }
          >
            <div className="checkout-dialog-content wallet-topup-form">
              <section className="checkout-product-summary">
                <span>账户余额充值</span>
                <strong>普通充值</strong>
                <p>
                  当前余额 {balance === null ? "—" : formatMoney(balance)} ·
                  充值余额永久有效
                </p>
              </section>
              <label className="field">
                充值金额（元）
                <input
                  className="control"
                  inputMode="decimal"
                  value={amount}
                  disabled={busy}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="10 元起，支持自定义金额"
                  aria-describedby="wallet-topup-help"
                />
              </label>
              <div className="wallet-topup-presets">
                {[10, 30, 50, 100].map((value) => (
                  <button
                    key={value}
                    className={
                      Number(amount) === value
                        ? "action-button"
                        : "ghost-button"
                    }
                    disabled={busy}
                    onClick={() => setAmount(String(value))}
                  >
                    {value} 元
                  </button>
                ))}
              </div>
              <p id="wallet-topup-help">
                单次至少 10 元，支持两位小数。充值多少到账多少，余额永久有效。
              </p>
              <CheckoutPaymentOptions
                value={channel}
                onChange={setChannel}
                disabled={busy}
              />
              <div className="checkout-price-summary">
                <div>
                  <span>到账余额</span>
                  <strong>{amountValid ? formatMoney(cents) : "—"}</strong>
                </div>
                <div className="total">
                  <span>实付金额</span>
                  <strong>{amountValid ? formatMoney(cents) : "—"}</strong>
                </div>
              </div>
              <p>
                这是普通余额充值，不含节日赠额或抽奖机会。参与充值赠额请前往{" "}
                <Link href="/portal/holiday">活动中心</Link>。
              </p>
              {payment?.status === "pending" && (
                <div className="wallet-topup-pending">
                  <p>
                    待支付充值：{formatMoney(payment.amountCents)}
                    。发起新充值会替代旧支付单。
                  </p>
                  <button
                    className="ghost-button"
                    disabled={busy}
                    onClick={() => void pay(true)}
                  >
                    继续付款 / 核对状态
                  </button>
                </div>
              )}
              {notice && <p role="status">{notice}</p>}
              {error && (
                <p role="alert" className="feedback error">
                  {error}
                </p>
              )}
              <Link href="/portal/orders">查看充值订单与支付记录 →</Link>
            </div>
          </Drawer>,
          document.body,
        )}
    </>
  );
}
