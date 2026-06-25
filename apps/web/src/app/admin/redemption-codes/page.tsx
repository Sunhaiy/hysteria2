"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { clearDraft, getDraft } from "@/lib/draft";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { Toast, useToast } from "@/components/toast";
import type { PlanRecord, RedemptionCodeRecord } from "@/lib/types";
import {
  fromDateTimeLocal,
  humanizeRedemptionKind,
  humanizeRedemptionStatus,
  statusTone,
} from "@/lib/ui";

const GB = 1024 * 1024 * 1024;

function emptyForm(planId = "") {
  return {
    label: "",
    customCode: "",
    kind: "plan" as "plan" | "traffic_pack",
    planId,
    trafficBytes: 50 * GB,
    amountCents: 1800,
    expiresAt: "",
    note: "",
  };
}

export default function AdminRedemptionCodesPage() {
  const { token } = useAuth();
  const [codes, setCodes] = useState<RedemptionCodeRecord[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [form, setForm] = useState(() => emptyForm());
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hasDraftBanner, setHasDraftBanner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ msg: string; kind: "success" | "error" } | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextCodes, nextPlans] = await Promise.all([
        apiRequest<RedemptionCodeRecord[]>("/api/admin/redemption-codes", { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
      ]);
      setCodes(nextCodes);
      setPlans(nextPlans);
      setForm((f) => (!f.planId && nextPlans.length ? { ...f, planId: nextPlans[0].id } : f));
    } catch {
      // keep stale
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function copyText(value: string) {
    try {
      await copyToClipboard(value);
      showToast("已复制到剪贴板");
    } catch {
      showToast("复制失败，请手动复制", "error");
    }
  }

  const isDirty = drawerOpen && (form.label.trim() !== "" || form.note !== "");

  function requestClose() {
    if (isDirty && !window.confirm("有未保存的改动，关闭后将丢失。确定关闭？")) return;
    forceClose();
  }

  function forceClose() {
    setDrawerOpen(false);
    setDrawerError(null);
    setHasDraftBanner(false);
  }

  function openCreate() {
    const draft = getDraft<ReturnType<typeof emptyForm>>("code");
    if (draft) {
      setForm(draft);
      setHasDraftBanner(true);
    } else {
      setForm(emptyForm(plans[0]?.id ?? ""));
      setHasDraftBanner(false);
    }
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function discardDraft() {
    clearDraft("code");
    setForm(emptyForm(plans[0]?.id ?? ""));
    setHasDraftBanner(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setDrawerError(null);
    setFeedback(null);
    try {
      const created = await apiRequest<RedemptionCodeRecord>("/api/admin/redemption-codes", {
        method: "POST",
        token,
        body: {
          label: form.label,
          code: form.customCode.trim() || undefined,
          kind: form.kind,
          planId: form.kind === "plan" ? form.planId : undefined,
          trafficBytes: form.kind === "traffic_pack" ? form.trafficBytes : undefined,
          amountCents: form.amountCents,
          expiresAt: form.expiresAt === "permanent" ? undefined : fromDateTimeLocal(form.expiresAt),
          note: form.note || undefined,
        },
      });
      setLatestCode(created.code);
      clearDraft("code");
      setFeedback({ msg: `兑换码已生成：${created.code}`, kind: "success" });
      setForm(emptyForm(plans[0]?.id ?? ""));
      forceClose();
      await load();
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "生成兑换码失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVoid(codeId: string) {
    if (!token) return;
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/redemption-codes/${codeId}`, {
        method: "PATCH",
        token,
        body: { status: "void" },
      });
      setFeedback({ msg: "兑换码已作废。", kind: "success" });
      await load();
    } catch (cause) {
      setFeedback({ msg: cause instanceof ApiError ? cause.message : "作废兑换码失败。", kind: "error" });
    }
  }

  return (
    <ConsoleShell
      title="兑换码"
      subtitle="生成套餐开通码和流量包兑换码，让会员可以在前台自助开通权益"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">
          {loading ? "加载中..." : `${codes.length} 张兑换码`}
        </span>
      }
      toolbarActions={
        <>
          <button className="action-button" type="button" onClick={openCreate}>
            生成兑换码
          </button>
          {latestCode ? (
            <button
              className="ghost-button"
              type="button"
              onClick={() => void copyText(latestCode)}
            >
              复制最新 CDK
            </button>
          ) : null}
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
        </>
      }
    >
      <Toast toast={toast} />
      {feedback ? <div className={`feedback ${feedback.kind}`}>{feedback.msg}</div> : null}

      <Panel
        title="兑换码列表"
        copy="会员兑换后会自动生成订单记录，这里可以看到发放、兑换和作废状态。"
      >
        {loading && codes.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}
        {codes.length > 0 ? (
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
              <span key={`${item.id}-st`} className={`badge ${statusTone(item.status)}`}>
                {humanizeRedemptionStatus(item.status)}
              </span>,
              formatMoney(item.amountCents),
              <div key={`${item.id}-tl`} className="split">
                <span>{item.expiresAt ? formatDateTime(item.expiresAt) : "不限时"}</span>
                <span className="fine-print">
                  {item.redeemedAt
                    ? `已由 ${item.redeemedByEmail ?? "会员"} 兑换`
                    : "未兑换"}
                </span>
              </div>,
              <div key={`${item.id}-act`} className="table-actions">
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
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎟️</div>
            <div className="empty-state-title">还没有兑换码</div>
            <button className="action-button" type="button" onClick={openCreate}>
              生成第一张兑换码
            </button>
          </div>
        ) : null}
      </Panel>

      <Drawer
        open={drawerOpen}
        onClose={requestClose}
        title="生成兑换码"
        isDirty={isDirty}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="code-form"
              disabled={
                submitting ||
                !form.label.trim() ||
                (form.kind === "plan" && !form.planId) ||
                (form.kind === "traffic_pack" && !form.trafficBytes)
              }
            >
              {submitting ? "生成中..." : "生成兑换码"}
            </button>
            <button className="ghost-button" type="button" onClick={requestClose}>
              取消
            </button>
          </div>
        }
      >
        {drawerError ? <div className="feedback error">{drawerError}</div> : null}

        {hasDraftBanner ? (
          <div className="feedback info" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>已恢复上次未保存的草稿。</span>
            <button className="ghost-button compact" type="button" onClick={discardDraft}>
              丢弃草稿
            </button>
          </div>
        ) : null}

        <form id="code-form" className="form-grid" onSubmit={handleSubmit}>
          <div className="two-col">
            <label className="field">
              <span className="fine-print">标签</span>
              <input
                className="control"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="例如：Core 200 月卡 / 50GB 补量包"
                required
              />
            </label>
            <label className="field">
              <span className="fine-print">自定义兑换码（可选）</span>
              <input
                className="control mono"
                value={form.customCode}
                onChange={(e) => setForm((f) => ({ ...f, customCode: e.target.value }))}
                placeholder="留空则自动生成"
              />
            </label>
          </div>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">类型</span>
              <CustomSelect
                value={form.kind}
                onChange={(v) => setForm((f) => ({ ...f, kind: v as "plan" | "traffic_pack" }))}
                options={[
                  { value: "plan", label: "套餐开通码" },
                  { value: "traffic_pack", label: "流量包兑换码" },
                ]}
              />
            </label>

            <label className="field">
              <span className="fine-print">价值（元）</span>
              <input
                className="control"
                type="number"
                min="0"
                step="0.01"
                value={form.amountCents / 100}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amountCents: Math.round(Number(e.target.value) * 100) }))
                }
              />
            </label>
          </div>

          {form.kind === "plan" ? (
            <label className="field">
              <span className="fine-print">绑定套餐</span>
              <CustomSelect
                value={form.planId}
                onChange={(v) => setForm((f) => ({ ...f, planId: v }))}
                options={[
                  { value: "", label: "请选择套餐" },
                  ...plans.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </label>
          ) : (
            <label className="field">
              <span className="fine-print">流量（GB）</span>
              <input
                className="control"
                type="number"
                min="1"
                value={Math.round((form.trafficBytes / GB) * 100) / 100}
                onChange={(e) =>
                  setForm((f) => ({ ...f, trafficBytes: Math.round(Number(e.target.value) * GB) }))
                }
              />
              <span className="field-hint">{formatBytes(form.trafficBytes)}</span>
            </label>
          )}

          <div className="two-col">
            <div className="field">
              <span className="fine-print">失效时间</span>
              <input
                className="control"
                type="datetime-local"
                disabled={form.expiresAt === "permanent"}
                value={form.expiresAt === "permanent" ? "" : form.expiresAt}
                placeholder={form.expiresAt === "permanent" ? "永久有效" : ""}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
              />
              <label className="checkbox-inline" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={form.expiresAt === "permanent"}
                  onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.checked ? "permanent" : "" }))}
                />
                <span className="fine-print">永久有效</span>
              </label>
            </div>

            <label className="field">
              <span className="fine-print">备注（可选）</span>
              <input
                className="control"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="兑换后写进订单备注"
              />
            </label>
          </div>
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
