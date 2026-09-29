"use client";

import { useRef, useState } from "react";
import { Drawer } from "@/components/drawer";
import { apiRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";

export function OrderRefundButton({
  order,
  token,
  onComplete,
}: {
  order: {
    id: string;
    amountCents: number;
    refundedCents: number;
    source: string;
    status: string;
    productName: string;
  };
  token: string | null;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState("wallet");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const amount = order.amountCents - order.refundedCents;
  const enabled =
    order.status === "applied" &&
    amount > 0 &&
    ["payment", "wallet"].includes(order.source);
  const close = () => {
    if (!lock.current) {
      setOpen(false);
      setConfirm(false);
    }
  };
  async function submit() {
    if (lock.current || !token || !confirm) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ status: string; reason?: string }>(
        `/api/admin/finance/orders/${order.id}/refunds`,
        {
          token,
          method: "POST",
          body: { amountCents: amount, method, reason: reason.trim() },
        },
      );
      if (result.status === "manual_review") {
        setError(result.reason ?? "退款需要人工核验，尚未退款");
        onComplete();
        return;
      }
      if (result.status === "refund_pending") {
        setPending(true);
        setError("已提交原路退款，等待网关确认；请勿重复线下转账。");
        onComplete();
        return;
      }
      setOpen(false);
      setConfirm(false);
      onComplete();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "退款失败，请刷新订单核对后重试",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="ghost-button compact"
        disabled={!enabled}
        title={
          !enabled ? "仅已到账的在线或余额订单且仍有可退金额时可退款" : "退款"
        }
        onClick={() => {
          setOpen(true);
          setConfirm(false);
          setReason("");
          setMethod(order.productName.includes("充值") ? "original" : "wallet");
          setError("");
        }}
      >
        {amount <= 0 && order.refundedCents > 0 ? "已退款" : "退款"}
      </button>
      <Drawer
        open={open}
        onClose={close}
        title={confirm ? "确认退款" : "订单退款"}
        subtitle={order.productName}
      >
        <div className="list">
          <p>
            本次退还剩余可退金额：<strong>{formatMoney(amount)}</strong>
          </p>
          <p className="muted">
            全额退款会撤销对应订单的未使用权益，并按规则追回拼团和邀请奖励。
          </p>
          {confirm ? (
            <>
              <p>
                {method === "original"
                  ? "将先追回充值本金和活动奖励，再提交网关原路退款；网关确认前显示处理中。"
                  : method === "wallet"
                    ? "退款将进入用户站内余额，不会退回微信或支付宝。"
                    : "确认你已在线下完成转账。此操作仅登记退款，不会再次转账。"}
              </p>
              <p>原因：{reason}</p>
              <button
                className="action-button"
                type="button"
                disabled={busy || pending}
                onClick={() => void submit()}
              >
                {busy
                  ? "处理中…"
                  : `确认${method === "original" ? "申请原路退款" : method === "wallet" ? "退回余额" : "已线下退款"} ${formatMoney(amount)}`}
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                返回修改
              </button>
            </>
          ) : (
            <>
              <label className="field">
                <span>退款方式</span>
                <select
                  className="control"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="wallet">退回站内余额</option>
                  <option value="manual">登记已完成的线下退款</option>
                  {order.productName.includes("充值") && (
                    <option value="original">充值原路自动退款</option>
                  )}
                </select>
              </label>
              <label className="field">
                <span>退款原因</span>
                <textarea
                  className="control"
                  maxLength={240}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                className="action-button"
                type="button"
                disabled={!reason.trim()}
                onClick={() => setConfirm(true)}
              >
                下一步，核对退款
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </Drawer>
    </>
  );
}
