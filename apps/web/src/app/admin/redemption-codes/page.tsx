"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { PlanRecord, RedemptionCodeRecord } from "@/lib/types";
import { fromDateTimeLocal, humanizeRedemptionKind, humanizeRedemptionStatus, statusTone } from "@/lib/ui";

const emptyForm = {
  label: "",
  kind: "plan" as "plan" | "traffic_pack",
  planId: "",
  trafficBytes: 50 * 1024 * 1024 * 1024,
  amountCents: 1800,
  expiresAt: "",
  note: "",
};

export default function AdminRedemptionCodesPage() {
  const { token } = useAuth();
  const [codes, setCodes] = useState<RedemptionCodeRecord[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextCodes, nextPlans] = await Promise.all([
        apiRequest<RedemptionCodeRecord[]>("/api/admin/redemption-codes", { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
      ]);
      setCodes(nextCodes);
      setPlans(nextPlans);
      setForm((current) => {
        if (current.planId || !nextPlans.length) {
          return current;
        }
        return {
          ...current,
          planId: nextPlans[0].id,
        };
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "兑换码数据加载失败。");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("已复制到剪贴板。");
    } catch {
      setFeedback("复制失败，请手动复制。");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setFeedback(null);

    try {
      const created = await apiRequest<RedemptionCodeRecord>("/api/admin/redemption-codes", {
        method: "POST",
        token,
        body: {
          label: form.label,
          kind: form.kind,
          planId: form.kind === "plan" ? form.planId : undefined,
          trafficBytes: form.kind === "traffic_pack" ? form.trafficBytes : undefined,
          amountCents: form.amountCents,
          expiresAt: fromDateTimeLocal(form.expiresAt),
          note: form.note || undefined,
        },
      });

      setLatestCode(created.code);
      setFeedback(`兑换码已生成：${created.code}`);
      setForm({
        ...emptyForm,
        planId: plans[0]?.id ?? "",
      });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "生成兑换码失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVoid(codeId: string) {
    if (!token) {
      return;
    }

    setError(null);
    setFeedback(null);

    try {
      await apiRequest(`/api/admin/redemption-codes/${codeId}`, {
        method: "PATCH",
        token,
        body: {
          status: "void",
        },
      });
      setFeedback("兑换码已作废。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "作废兑换码失败。");
    }
  }

  return (
    <ConsoleShell
      title="兑换码"
      subtitle="生成套餐开通码和流量包兑换码，让会员可以在前台自助开通权益"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">{loading ? "加载中..." : `${codes.length} 张兑换码`}</span>}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      <section className="workspace-grid">
        <Panel title="兑换码列表" copy="会员兑换后会自动生成订单记录，这里可以看到发放、兑换和作废状态。">
          <DataTable
            headers={["标签 / CDK", "权益", "状态", "价值", "到期 / 兑换", "操作"]}
            rows={codes.map((item) => [
              <div key={item.id} className="split">
                <strong>{item.label}</strong>
                <span className="mono">{item.code}</span>
              </div>,
              item.kind === "plan"
                ? item.planName ?? humanizeRedemptionKind(item.kind)
                : item.trafficBytes
                  ? formatBytes(item.trafficBytes)
                  : humanizeRedemptionKind(item.kind),
              <span key={`${item.id}-status`} className={`badge ${statusTone(item.status)}`}>
                {humanizeRedemptionStatus(item.status)}
              </span>,
              formatMoney(item.amountCents),
              <div key={`${item.id}-timeline`} className="split">
                <span>{item.expiresAt ? formatDateTime(item.expiresAt) : "不限时"}</span>
                <span className="fine-print">
                  {item.redeemedAt
                    ? `已由 ${item.redeemedByEmail ?? "会员"} 兑换`
                    : "未兑换"}
                </span>
              </div>,
              <div key={`${item.id}-action`} className="table-actions">
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => void copyText(item.code)}
                >
                  复制
                </button>
                {item.status === "active" ? (
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={() => void handleVoid(item.id)}
                  >
                    作废
                  </button>
                ) : null}
              </div>,
            ])}
          />
        </Panel>

        <Panel
          title="生成兑换码"
          copy="套餐码会开通或续加套餐权益，流量包码会叠加到当前生效订阅。"
          action={
            latestCode ? (
              <button className="ghost-button compact" type="button" onClick={() => void copyText(latestCode)}>
                复制最新 CDK
              </button>
            ) : null
          }
        >
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span className="fine-print">标签</span>
              <input
                className="control"
                value={form.label}
                onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="例如：Core 200 月卡 / 50GB 补量包"
              />
            </label>

            <div className="two-col">
              <label className="field">
                <span className="fine-print">类型</span>
                <select
                  className="control"
                  value={form.kind}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      kind: event.target.value as "plan" | "traffic_pack",
                    }))
                  }
                >
                  <option value="plan">套餐开通码</option>
                  <option value="traffic_pack">流量包兑换码</option>
                </select>
              </label>

              <label className="field">
                <span className="fine-print">价值（分）</span>
                <input
                  className="control"
                  type="number"
                  value={form.amountCents}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, amountCents: Number(event.target.value) }))
                  }
                />
              </label>
            </div>

            {form.kind === "plan" ? (
              <label className="field">
                <span className="fine-print">绑定套餐</span>
                <select
                  className="control"
                  value={form.planId}
                  onChange={(event) => setForm((current) => ({ ...current, planId: event.target.value }))}
                >
                  <option value="">请选择套餐</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field">
                <span className="fine-print">流量字节数</span>
                <input
                  className="control"
                  type="number"
                  value={form.trafficBytes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, trafficBytes: Number(event.target.value) }))
                  }
                />
              </label>
            )}

            <div className="two-col">
              <label className="field">
                <span className="fine-print">失效时间</span>
                <input
                  className="control"
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))}
                />
              </label>

              <label className="field">
                <span className="fine-print">备注</span>
                <input
                  className="control"
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="可选，兑换后会写进订单备注"
                />
              </label>
            </div>

            <button
              className="action-button"
              type="submit"
              disabled={
                submitting ||
                !form.label.trim() ||
                (form.kind === "plan" && !form.planId) ||
                (form.kind === "traffic_pack" && !form.trafficBytes)
              }
            >
              {submitting ? "生成中..." : "生成兑换码"}
            </button>
          </form>
        </Panel>
      </section>
    </ConsoleShell>
  );
}
