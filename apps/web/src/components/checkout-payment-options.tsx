"use client";
import { Icon } from "./icon";
import { formatMoney } from "@/lib/format";

export function CheckoutPaymentOptions({
  value,
  onChange,
  disabled = false,
  balance,
  amountCents,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  balance?: number | null;
  amountCents?: number;
}) {
  const insufficient =
    balance == null || amountCents == null || balance < amountCents;
  return (
    <section className="checkout-option-section">
      <div className="checkout-section-heading">
        <strong>选择支付方式</strong>
        <span>外部支付将在新页面完成</span>
      </div>
      <div
        className="checkout-payment-options"
        role="radiogroup"
        aria-label="支付方式"
      >
        {[
          ["alipay", "支付宝"],
          ["wxpay", "微信支付"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            className={value === key ? "selected" : ""}
            disabled={disabled}
            onClick={() => onChange(key)}
          >
            <Icon name="payments" />
            <span>{label}</span>
          </button>
        ))}
        {balance !== undefined && (
          <button
            type="button"
            role="radio"
            aria-checked={value === "wallet"}
            className={value === "wallet" ? "selected" : ""}
            disabled={disabled || insufficient}
            onClick={() => onChange("wallet")}
          >
            <Icon name="wallet" />
            <span className="checkout-payment-copy">
              <strong>余额支付</strong>
              <small>
                {balance === null
                  ? "正在读取余额"
                  : `可用 ${formatMoney(balance)}${insufficient ? " · 余额不足" : ""}`}
              </small>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
