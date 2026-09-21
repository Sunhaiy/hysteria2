"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { formatBytes, formatSpeedLimit } from "@/lib/format";
import { customerDateTime } from "@/lib/customer-display";
import type { PaginatedResponse } from "@/lib/types";
import { Panel } from "./panel";
import { Drawer } from "./drawer";
import { PlanValidityButton } from "./plan-validity-button";

export type CustomerQuotaBucket = {
  id: string;
  startsAt: string;
  endsAt: string;
  grantedBytes: number;
  consumedBytes: number;
  remainingBytes: number;
  canAdjust: boolean;
};
export type CustomerGrant = {
  id: string;
  productName: string;
  offerName: string | null;
  displayState: string;
  group: string;
  permanent: boolean;
  remainingDays: number;
  startsAt: string;
  endsAt: string;
  nextResetAt: string | null;
  speedUpMbps: number;
  speedDownMbps: number;
  deviceLimit: number;
  canAdjustValidity: boolean;
  canActivate: boolean;
  buckets: CustomerQuotaBucket[];
  orders: Array<{ id: string; source: string; amountCents: number }>;
};
type Preview = {
  expectedState: string;
  productName: string;
  orderId: string;
  startsAt: string;
  endsAt: string;
  current: {
    productName: string;
    endsAt: string;
    remainingBytes: number;
  } | null;
  message: string;
};
const stateLabels: Record<string, string> = {
  current: "当前生效",
  scheduled: "待生效",
  canceled: "已取消",
  expired: "已到期",
  revoked: "已撤销",
};
export const entitlementDate = customerDateTime;

export function CustomerMemberships({
  userId,
  token,
  reloadKey,
  onChanged,
  compact = false,
}: {
  userId: string;
  token: string | null;
  reloadKey: number;
  onChanged: () => void;
  compact?: boolean;
}) {
  const [items, setItems] = useState<CustomerGrant[]>([]);
  const [history, setHistory] =
    useState<PaginatedResponse<CustomerGrant> | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [edit, setEdit] = useState<{
    grant: CustomerGrant;
    bucket?: CustomerQuotaBucket;
  } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [amount, setAmount] = useState("");
  const reason = edit?.bucket ? "后台调整剩余额度" : "后台提前启用已购套餐";
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  useEffect(() => {
    if (!token) return;
    const c = new AbortController();
    void apiRequest<PaginatedResponse<CustomerGrant>>(
      `/api/admin/customers/${userId}/entitlements?scope=current`,
      { token, signal: c.signal },
    )
      .then((data) => {
        if (c.signal.aborted) return;
        setItems(data.items);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(e instanceof Error ? e.message : "套餐加载失败");
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [userId, token, reloadKey, retry]);
  useEffect(() => {
    if (!showHistory || !token) return;
    const c = new AbortController();
    void apiRequest<PaginatedResponse<CustomerGrant>>(
      `/api/admin/customers/${userId}/entitlements?scope=history&page=${page}&pageSize=10`,
      { token, signal: c.signal },
    )
      .then((data) => {
        if (c.signal.aborted) return;
        setHistory(data);
        setHistoryError("");
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setHistoryError(e instanceof Error ? e.message : "历史加载失败");
      });
    return () => c.abort();
  }, [showHistory, page, userId, token, reloadKey, retry]);
  const current = items.filter(
    (g) => g.group === "standard" && g.displayState === "current",
  );
  function open(grant: CustomerGrant, bucket?: CustomerQuotaBucket) {
    setEdit({ grant, bucket });
    setActionError("");
    setPreview(null);
    setKey(crypto.randomUUID());
    if (bucket) setAmount(String(bucket.remainingBytes / 1024 ** 3));
  }
  useEffect(() => {
    if (!edit || edit.bucket || !token) return;
    const c = new AbortController();
    void apiRequest<Preview>(
      `/api/admin/customers/${userId}/entitlements/${edit.grant.id}/activation-preview`,
      { token, signal: c.signal },
    )
      .then((data) => {
        if (!c.signal.aborted) setPreview(data);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setActionError(e instanceof Error ? e.message : "预览失败");
      });
    return () => c.abort();
  }, [edit, userId, token]);
  async function submit() {
    if (!edit || busy) return;
    const bytes = Math.round(Number(amount) * 1024 ** 3);
    if (edit.bucket && (!Number.isSafeInteger(bytes) || bytes < 0)) {
      setActionError("请输入有效的非负额度");
      return;
    }
    if (!edit.bucket && !preview) return;
    if (
      !window.confirm(
        edit.bucket
          ? "确认按所示结果调整剩余额度？已用流量与有效期不变。"
          : "确认提前启用？旧普通套餐剩余时间和流量将失效，不额外赠送套餐。",
      )
    )
      return;
    setBusy(true);
    setActionError("");
    try {
      await apiRequest(
        `/api/admin/customers/${userId}/${edit.bucket ? `quota-buckets/${edit.bucket.id}/adjustments` : `entitlements/${edit.grant.id}/activate`}`,
        {
          method: "POST",
          token,
          headers: { "Idempotency-Key": key },
          body: edit.bucket
            ? {
                remainingBytes: bytes,
                expectedRemainingBytes: edit.bucket.remainingBytes,
                reason: reason.trim(),
              }
            : { expectedState: preview!.expectedState, reason: reason.trim() },
        },
      );
      setEdit(null);
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "调整失败");
    } finally {
      setBusy(false);
    }
  }
  function row(grant: CustomerGrant, historical = false) {
    const active = grant.buckets.filter((b) => b.canAdjust);
    const remaining = active.reduce((sum, b) => sum + b.remainingBytes, 0);
    return (
      <article
        className={`customer-grant customer-grant-${grant.displayState}`}
        key={grant.id}
      >
        <div className="customer-grant-heading">
          <div>
            <strong>{grant.productName}</strong>{" "}
            <span
              className={`badge ${grant.displayState === "current" ? "success" : grant.displayState === "scheduled" ? "info" : ""}`}
            >
              {stateLabels[grant.displayState] ?? grant.displayState}
            </span>
            <p className="muted">
              {grant.offerName ?? "一次性"} ·{" "}
              {formatSpeedLimit(grant.speedDownMbps)} 下载 /{" "}
              {formatSpeedLimit(grant.speedUpMbps)} 上传 ·{" "}
              {grant.deviceLimit > 0
                ? `${grant.deviceLimit} 台设备`
                : "不限设备"}
            </p>
            {!compact ? (
              <small className="muted">
                {grant.orders.length
                  ? `来源订单：${grant.orders[0].id}${grant.orders.length > 1 ? ` 等 ${grant.orders.length} 笔` : ""}`
                  : "无直接关联订单（历史导入或赠送权益）"}
              </small>
            ) : null}
          </div>
          <div className="customer-grant-actions">
            {!historical && grant.canAdjustValidity ? (
              <PlanValidityButton
                userId={userId}
                grant={grant}
                token={token}
                onComplete={onChanged}
              />
            ) : null}
            {!historical && grant.canActivate ? (
              <button
                className="action-button compact"
                onClick={() => void open(grant)}
              >
                提前启用已购套餐
              </button>
            ) : null}
          </div>
        </div>
        <div className="customer-grant-facts">
          <div>
            <small>
              {grant.displayState === "scheduled" ? "预约生效时间" : "开始时间"}
            </small>
            <strong>{entitlementDate(grant.startsAt)}</strong>
          </div>
          <div>
            <small>套餐 / 权益到期</small>
            <strong>{entitlementDate(grant.endsAt)}</strong>
            {grant.displayState === "current" && !grant.permanent ? (
              <small>剩余 {grant.remainingDays} 天</small>
            ) : null}
          </div>
          <div>
            <small>{historical ? "历史权益" : "当前可用额度"}</small>
            <strong>
              {historical
                ? "已失效"
                : grant.displayState === "scheduled"
                  ? "尚未生效"
                  : active.length
                    ? formatBytes(remaining)
                    : "当前周期无额度记录，请核对"}
            </strong>
            {grant.nextResetAt ? (
              <small>下次重置：{entitlementDate(grant.nextResetAt)}</small>
            ) : null}
          </div>
        </div>
        {grant.displayState === "scheduled" ? (
          <p className="field-hint">
            到期切换，不随当前流量耗尽自动切换；待生效额度不计入当前可用流量。
          </p>
        ) : null}
        {!compact ? (
          <details>
            <summary>额度周期与来源订单</summary>
            <div className="customer-grant-detail">
              {grant.orders.map((o) => (
                <p key={o.id}>
                  来源：
                  {o.source === "ADMIN"
                    ? "后台赠送"
                    : o.source === "PAYMENT"
                      ? "在线支付"
                      : o.source === "WALLET"
                        ? "余额支付"
                        : o.source}{" "}
                  · <span className="mono">订单 {o.id}</span>
                </p>
              ))}
              {grant.buckets.map((b) => (
                <div className="customer-bucket" key={b.id}>
                  <div>
                    <span>
                      {entitlementDate(b.startsAt)} 至{" "}
                      {entitlementDate(b.endsAt)}
                    </span>
                    <p className="muted">
                      已用 {formatBytes(b.consumedBytes)} / 授予{" "}
                      {formatBytes(b.grantedBytes)}
                      {b.canAdjust
                        ? ` · 剩余 ${formatBytes(b.remainingBytes)}`
                        : " · 非当前可用额度"}
                    </p>
                  </div>
                  {!historical && b.canAdjust ? (
                    <button
                      className="ghost-button compact"
                      onClick={() => void open(grant, b)}
                    >
                      调整剩余额度
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </article>
    );
  }
  return (
    <>
      <Panel
        className={compact ? "customer-membership-focus" : undefined}
        title={compact ? "当前套餐" : "套餐与流量"}
        copy={
          compact
            ? "有效期与可用权益 · 北京时间"
            : "套餐有效期与流量重置周期分别展示，所有时间为北京时间。"
        }
      >
        {loading ? (
          <div className="empty-state">正在加载套餐…</div>
        ) : error ? (
          <div className="feedback error">
            {error}
            <button
              className="ghost-button"
              onClick={() => setRetry((v) => v + 1)}
            >
              重试
            </button>
          </div>
        ) : (
          <>
            {current.length > 1 ? (
              <div className="feedback error">
                发现多个当前普通套餐，请核对历史操作；系统未自动选择或合并。
              </div>
            ) : null}
            {current.length ? (
              current.map((g) => row(g))
            ) : (
              <div className="empty-state">
                暂无当前普通套餐
                {items.some((g) => g.group !== "standard")
                  ? "，可用权益见下方。"
                  : "。"}
              </div>
            )}
            {(
              [
                ["standard", "待生效套餐"],
                ["ultra", "永久 Ultra"],
                ["pack", "独立流量包"],
                ["reward", "奖励流量"],
              ] as const
            ).map(([group, label]) => {
              const list = items.filter(
                (g) =>
                  g.group === group &&
                  (group !== "standard" || g.displayState === "scheduled"),
              );
              return list.length ? (
                <section key={group} className="customer-grant-group">
                  <h3>{label}</h3>
                  {list.map((g) => row(g))}
                </section>
              ) : null;
            })}
          </>
        )}
        {!compact ? (
          <>
            <button
              className="ghost-button"
              aria-expanded={showHistory}
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory ? "收起历史" : "查看已取消 / 已过期权益"}
            </button>
            {showHistory ? (
              <div className="customer-grant-history">
                {historyError ? (
                  <div className="feedback error">
                    {historyError}
                    <button onClick={() => setRetry((v) => v + 1)}>重试</button>
                  </div>
                ) : history ? (
                  history.items.length ? (
                    history.items.map((g) => row(g, true))
                  ) : (
                    <p className="muted">暂无历史权益</p>
                  )
                ) : (
                  <p>正在加载历史…</p>
                )}
                <div className="customer-grant-actions">
                  <button
                    className="ghost-button"
                    disabled={page <= 1}
                    onClick={() => {
                      setHistory(null);
                      setHistoryError("");
                      setPage((v) => v - 1);
                    }}
                  >
                    上一页
                  </button>
                  <span>
                    {page} / {history?.totalPages ?? 1}
                  </span>
                  <button
                    className="ghost-button"
                    disabled={!history || page >= history.totalPages}
                    onClick={() => {
                      setHistory(null);
                      setHistoryError("");
                      setPage((v) => v + 1);
                    }}
                  >
                    下一页
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </Panel>
      <Drawer
        open={!!edit}
        onClose={() => {
          if (!busy) setEdit(null);
        }}
        title={edit?.bucket ? "调整剩余额度" : "提前启用已购套餐"}
        subtitle={edit?.grant.productName}
      >
        <form
          className="list"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {edit?.bucket ? (
            <>
              <p>
                当前剩余：{formatBytes(edit.bucket.remainingBytes)}；已用：
                {formatBytes(edit.bucket.consumedBytes)}
              </p>
              <label className="field">
                调整后剩余（GiB）
                <input
                  className="control"
                  type="number"
                  min="0"
                  step="any"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <p>
                变化：
                {Number.isFinite(Number(amount))
                  ? `${Number(amount) - edit.bucket.remainingBytes / 1024 ** 3 >= 0 ? "+" : ""}${(Number(amount) - edit.bucket.remainingBytes / 1024 ** 3).toFixed(3)} GiB`
                  : "—"}
                ；额度到期不变：{entitlementDate(edit.bucket.endsAt)}
              </p>
            </>
          ) : preview ? (
            <>
              <p>原订单：{preview.orderId}</p>
              {preview.current ? (
                <p>
                  将结束 {preview.current.productName}：原到期{" "}
                  {entitlementDate(preview.current.endsAt)}，剩余{" "}
                  {formatBytes(preview.current.remainingBytes)}。
                </p>
              ) : null}
              <p>
                新套餐：{preview.productName}，从确认时起{" "}
                {edit?.grant.offerName}。预计到期{" "}
                {entitlementDate(preview.endsAt)}。
              </p>
              <p className="field-hint">{preview.message}</p>
            </>
          ) : !actionError ? (
            <p>正在核对预约…</p>
          ) : null}
          {actionError ? (
            <div className="feedback error">{actionError}</div>
          ) : null}
          <button
            className="action-button"
            disabled={busy || !reason.trim() || (!edit?.bucket && !preview)}
          >
            确认调整
          </button>
        </form>
      </Drawer>
    </>
  );
}
