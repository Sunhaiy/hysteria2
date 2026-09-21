"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { entitlementDate } from "./customer-memberships";
import { Drawer } from "./drawer";
import { Panel } from "./panel";
import { CustomSelect } from "./custom-select";

type Customer = { id: string; balanceCents: number; trafficMultiplier: number };
type GiftPreview = {
  expectedState: string;
  productName: string;
  offerName: string;
  ending: Array<{
    id: string;
    productName: string;
    startsAt: string;
    endsAt: string;
  }>;
};
type Catalog = {
  products: Array<{
    kind: string;
    series: string;
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
export function CustomerManagement({
  customer,
  token,
  mode,
  onChanged,
}: {
  customer: Customer;
  token: string | null;
  mode: "plan" | "balance";
  onChanged: () => void;
}) {
  const [edit, setEdit] = useState<"balance" | "multiplier" | "gift" | null>(
    null,
  );
  const [value, setValue] = useState("");
  const reason =
    edit === "balance"
      ? "后台调整用户余额"
      : edit === "multiplier"
        ? "后台调整用户倍率"
        : "后台免费赠送并切换套餐";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [options, setOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [preview, setPreview] = useState<GiftPreview | null>(null);
  useEffect(() => {
    if (edit !== "gift" || !token) return;
    const c = new AbortController();
    void apiRequest<Catalog>("/api/admin/catalog", { token, signal: c.signal })
      .then((data) =>
        setOptions(
          data.products
            .filter(
              (p) =>
                p.kind === "plan" &&
                p.series !== "ultra" &&
                p.status === "active",
            )
            .flatMap((p) =>
              p.offers
                .filter((o) => o.active && !o.archivedAt)
                .map((o) => ({ value: o.id, label: `${p.name} · ${o.name}` })),
            ),
        ),
      )
      .catch((e) => {
        if (!c.signal.aborted)
          setError(e instanceof Error ? e.message : "商品加载失败");
      });
    return () => c.abort();
  }, [edit, token]);
  useEffect(() => {
    if (edit !== "gift" || !value || !token) return;
    const c = new AbortController();
    void apiRequest<GiftPreview>(
      `/api/admin/customers/${customer.id}/plan-switch/preview?offerId=${encodeURIComponent(value)}`,
      { token, signal: c.signal },
    )
      .then((result) => {
        if (!c.signal.aborted) setPreview(result);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(e instanceof Error ? e.message : "预览失败");
      });
    return () => c.abort();
  }, [edit, value, customer.id, token]);
  function open(next: NonNullable<typeof edit>) {
    setEdit(next);
    setValue(next === "multiplier" ? String(customer.trafficMultiplier) : "");
    setError("");
    setPreview(null);
    setKey(crypto.randomUUID());
  }
  async function submit() {
    if (!edit || busy) return;
    const delta = Math.round(Number(value) * 100);
    if (
      edit === "balance" &&
      (!Number.isSafeInteger(delta) ||
        !delta ||
        customer.balanceCents + delta < 0)
    ) {
      setError("请输入有效金额，调整后余额不能为负");
      return;
    }
    if (
      edit === "multiplier" &&
      (!Number.isFinite(Number(value)) ||
        Number(value) < 0.1 ||
        Number(value) > 100)
    ) {
      setError("倍率必须在 0.1 到 100 之间");
      return;
    }
    if (edit === "gift" && !preview) return;
    if (
      !window.confirm(
        edit === "gift"
          ? "确认免费赠送并立即切换？所列当前及预约套餐将失效，此操作不是提前启用已购套餐。"
          : "确认按预览结果调整？",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        `/api/admin/customers/${customer.id}/${edit === "balance" ? "balance-adjustments" : edit === "multiplier" ? "traffic-policy" : "plan-switch"}`,
        {
          method: edit === "multiplier" ? "PATCH" : "POST",
          token,
          headers: { "Idempotency-Key": key },
          body:
            edit === "balance"
              ? {
                  deltaCents: delta,
                  note: reason,
                  expectedBalanceCents: customer.balanceCents,
                }
              : edit === "multiplier"
                ? {
                    trafficMultiplier: Number(value),
                    expectedMultiplier: customer.trafficMultiplier,
                    reason,
                  }
                : {
                    offerId: value,
                    expectedState: preview!.expectedState,
                    reason,
                  },
        },
      );
      setEdit(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel
        title={mode === "balance" ? "余额调整" : "套餐管理"}
        copy={
          mode === "balance"
            ? `当前余额 ${formatMoney(customer.balanceCents)}`
            : `用户倍率 ${customer.trafficMultiplier}×，计费取用户与机器倍率中的较高值。`
        }
      >
        <div className="customer-grant-actions">
          {mode === "balance" ? (
            <button className="ghost-button" onClick={() => open("balance")}>
              调整余额
            </button>
          ) : (
            <>
              <button
                className="ghost-button"
                onClick={() => open("multiplier")}
              >
                调整用户倍率
              </button>
              <button className="ghost-button" onClick={() => open("gift")}>
                免费赠送并切换
              </button>
            </>
          )}
        </div>
      </Panel>
      <Drawer
        open={!!edit}
        onClose={() => {
          if (!busy) setEdit(null);
        }}
        title={
          edit === "balance"
            ? "调整余额"
            : edit === "multiplier"
              ? "调整用户倍率"
              : "免费赠送并切换"
        }
      >
        <form
          className="list"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {edit === "gift" ? (
            <>
              <p className="field-hint">
                此操作新增免费订单。提前启用已付款的预约套餐，请使用套餐行中的“提前启用已购套餐”。
              </p>
              <CustomSelect
                value={value}
                options={options}
                onChange={(v) => {
                  setValue(v);
                  setPreview(null);
                  setError("");
                }}
              />
              {preview ? (
                <>
                  <p>
                    将免费开通：{preview.productName} · {preview.offerName}
                  </p>
                  <strong>将结束的当前及预约权益</strong>
                  {preview.ending.length ? (
                    preview.ending.map((g) => (
                      <p key={g.id}>
                        {g.productName}
                        <br />
                        {entitlementDate(g.startsAt)} 至{" "}
                        {entitlementDate(g.endsAt)}
                      </p>
                    ))
                  ) : (
                    <p>无当前或预约普通套餐</p>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <>
              <label className="field">
                {edit === "balance"
                  ? "变更金额（元，可为负）"
                  : "调整后用户倍率"}
                <input
                  className="control"
                  type="number"
                  step={edit === "balance" ? "0.01" : "0.01"}
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <p>
                {edit === "balance"
                  ? `${formatMoney(customer.balanceCents)} → ${formatMoney(customer.balanceCents + Math.round(Number(value) * 100))}`
                  : `${customer.trafficMultiplier}× → ${value || "—"}×`}
              </p>
            </>
          )}
          {error ? <div className="feedback error">{error}</div> : null}
          <button
            className="action-button"
            disabled={
              busy || !reason.trim() || !value || (edit === "gift" && !preview)
            }
          >
            确认调整
          </button>
        </form>
      </Drawer>
    </>
  );
}
