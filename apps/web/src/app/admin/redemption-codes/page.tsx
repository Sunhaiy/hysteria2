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
import type {
  PlanRecord,
  RedemptionCodeRecord,
  RedemptionUseRecord,
  TrafficPackProductRecord,
} from "@/lib/types";
import {
  fromDateTimeLocal,
  humanizeRedemptionKind,
  humanizeRedemptionStatus,
  statusTone,
} from "@/lib/ui";

type CdkKind = "plan" | "traffic_pack" | "balance" | "discount";

function describeCodeValue(item: RedemptionCodeRecord) {
  switch (item.kind) {
    case "plan":
      return item.planName ?? "套餐开通";
    case "traffic_pack":
      return item.trafficPackProductName ??
        (item.trafficBytes ? formatBytes(item.trafficBytes) : "流量包");
    case "balance":
      return `充值 ${formatMoney(item.amountCents)}`;
    case "discount":
      return item.discountPercent
        ? `减 ${item.discountPercent}%`
        : `减 ${formatMoney(item.discountCents ?? 0)}`;
    default:
      return "-";
  }
}

function emptyForm(planId = "") {
  return {
    label: "",
    customCode: "",
    kind: "plan" as CdkKind,
    planId,
    trafficPackProductId: "",
    amountCents: 1800,
    discountMode: "percent" as "percent" | "fixed",
    discountPercent: 20,
    discountAmountCents: 1000,
    maxUses: 1,
    count: 1,
    expiresAt: "",
    note: "",
  };
}

export default function AdminRedemptionCodesPage() {
  const { token } = useAuth();
  const [codes, setCodes] = useState<RedemptionCodeRecord[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [trafficPacks, setTrafficPacks] = useState<TrafficPackProductRecord[]>([]);
  const [form, setForm] = useState(() => emptyForm());
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hasDraftBanner, setHasDraftBanner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ msg: string; kind: "success" | "error" } | null>(null);
  const { toast, showToast } = useToast();

  const [usesDrawerOpen, setUsesDrawerOpen] = useState(false);
  const [usesCode, setUsesCode] = useState<RedemptionCodeRecord | null>(null);
  const [uses, setUses] = useState<RedemptionUseRecord[]>([]);
  const [usesLoading, setUsesLoading] = useState(false);

  const [batchCodes, setBatchCodes] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  async function openUses(code: RedemptionCodeRecord) {
    if (!token) return;
    setUsesCode(code);
    setUses([]);
    setUsesDrawerOpen(true);
    setUsesLoading(true);
    try {
      const rows = await apiRequest<RedemptionUseRecord[]>(
        `/api/admin/redemption-codes/${code.id}/uses`,
        { token },
      );
      setUses(rows);
    } catch {
      // keep empty
    } finally {
      setUsesLoading(false);
    }
  }

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextCodes, nextPlans, nextTrafficPacks] = await Promise.all([
        apiRequest<RedemptionCodeRecord[]>("/api/admin/redemption-codes", { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
        apiRequest<TrafficPackProductRecord[]>("/api/admin/traffic-pack-products", {
          token,
        }),
      ]);
      setCodes(nextCodes);
      setPlans(nextPlans);
      setTrafficPacks(nextTrafficPacks);
      setForm((current) => ({
        ...current,
        planId: current.planId || nextPlans[0]?.id || "",
        trafficPackProductId:
          current.trafficPackProductId ||
          nextTrafficPacks.find((product) => !product.archivedAt)?.id ||
          "",
      }));
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
      const created = await apiRequest<RedemptionCodeRecord[]>("/api/admin/redemption-codes", {
        method: "POST",
        token,
        body: {
          label: form.label,
          code: form.count > 1 ? undefined : form.customCode.trim() || undefined,
          kind: form.kind,
          planId: form.kind === "plan" ? form.planId : undefined,
          trafficPackProductId:
            form.kind === "traffic_pack" ? form.trafficPackProductId : undefined,
          amountCents: form.amountCents,
          discountPercent:
            form.kind === "discount" && form.discountMode === "percent"
              ? form.discountPercent
              : undefined,
          discountCents:
            form.kind === "discount" && form.discountMode === "fixed"
              ? form.discountAmountCents
              : undefined,
          maxUses: form.maxUses,
          count: form.count,
          expiresAt: form.expiresAt === "permanent" ? undefined : fromDateTimeLocal(form.expiresAt),
          note: form.note || undefined,
        },
      });
      const newCodes = created.map((c) => c.code);
      setLatestCode(newCodes[0] ?? null);
      setBatchCodes(newCodes);
      clearDraft("code");
      setFeedback({
        msg: newCodes.length > 1 ? `已批量生成 ${newCodes.length} 张兑换码` : `兑换码已生成：${newCodes[0]}`,
        kind: "success",
      });
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

  const filtered = codes.filter((c) => {
    if (kindFilter !== "all" && c.kind !== kindFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (q && !c.code.toLowerCase().includes(q) && !c.label.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

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

      {batchCodes.length > 0 ? (
        <Panel
          title={`本次生成 ${batchCodes.length} 张兑换码`}
          copy="复制下面的卡密上架到你的店铺。关闭本页后此列表不再显示，请先复制保存。"
          action={
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                onClick={() => void copyText(batchCodes.join("\n"))}
              >
                复制全部
              </button>
              <button className="ghost-button" type="button" onClick={() => setBatchCodes([])}>
                收起
              </button>
            </div>
          }
        >
          <textarea
            className="control textarea mono"
            style={{ minHeight: 160 }}
            readOnly
            value={batchCodes.join("\n")}
          />
        </Panel>
      ) : null}

      <Panel
        title="兑换码列表"
        copy="会员兑换后会自动生成订单记录，这里可以看到发放、兑换和作废状态。"
        action={
          <div className="toolbar-actions" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              className="control"
              style={{ width: 200 }}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="搜索卡密 / 标签"
            />
            <div style={{ width: 140 }}>
              <CustomSelect
                value={kindFilter}
                onChange={(v) => {
                  setKindFilter(v);
                  setPage(0);
                }}
                options={[
                  { value: "all", label: "全部类型" },
                  { value: "plan", label: "套餐开通" },
                  { value: "traffic_pack", label: "流量包" },
                  { value: "balance", label: "余额充值" },
                  { value: "discount", label: "折扣券" },
                ]}
              />
            </div>
            <div style={{ width: 130 }}>
              <CustomSelect
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(v);
                  setPage(0);
                }}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "active", label: "可兑换" },
                  { value: "redeemed", label: "已用完" },
                  { value: "void", label: "已作废" },
                  { value: "expired", label: "已过期" },
                ]}
              />
            </div>
          </div>
        }
      >
        {loading && codes.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}
        {filtered.length > 0 ? (
          <DataTable
            headers={["标签 / CDK", "类型 / 权益", "状态", "使用次数", "到期", "操作"]}
            rows={pageItems.map((item) => [
              <div key={item.id} className="split">
                <strong>{item.label}</strong>
                <span className="mono">{item.code}</span>
              </div>,
              <div key={`${item.id}-v`} className="split">
                <span className="fine-print">{humanizeRedemptionKind(item.kind)}</span>
                <strong>{describeCodeValue(item)}</strong>
              </div>,
              <span key={`${item.id}-st`} className={`badge ${statusTone(item.status)}`}>
                {humanizeRedemptionStatus(item.status)}
              </span>,
              <span key={`${item.id}-u`} className="mono">
                {item.usedCount} / {item.maxUses}
              </span>,
              <span key={`${item.id}-tl`}>
                {item.expiresAt ? formatDateTime(item.expiresAt) : "不限时"}
              </span>,
              <div key={`${item.id}-act`} className="table-actions">
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => void openUses(item)}
                >
                  使用记录
                </button>
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
        ) : codes.length > 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">没有符合筛选条件的兑换码</div>
          </div>
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎟️</div>
            <div className="empty-state-title">还没有兑换码</div>
            <button className="action-button" type="button" onClick={openCreate}>
              生成第一张兑换码
            </button>
          </div>
        ) : null}

        {filtered.length > PAGE_SIZE ? (
          <div className="toolbar-actions" style={{ justifyContent: "space-between", marginTop: 12 }}>
            <span className="fine-print">
              共 {filtered.length} 张 · 第 {safePage + 1}/{pageCount} 页
            </span>
            <div className="toolbar-actions" style={{ gap: 8 }}>
              <button
                className="ghost-button compact"
                type="button"
                disabled={safePage <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                上一页
              </button>
              <button
                className="ghost-button compact"
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                下一页
              </button>
            </div>
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
                (form.kind === "traffic_pack" && !form.trafficPackProductId) ||
                (form.kind === "balance" && form.amountCents <= 0)
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
                onChange={(v) => setForm((f) => ({ ...f, kind: v as CdkKind }))}
                options={[
                  { value: "plan", label: "套餐开通码" },
                  { value: "traffic_pack", label: "流量包兑换码" },
                  { value: "balance", label: "余额充值码" },
                  { value: "discount", label: "折扣券" },
                ]}
              />
            </label>

            <label className="field">
              <span className="fine-print">
                {form.kind === "balance" ? "充值金额（元）" : "价值（元）"}
              </span>
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
          ) : null}

          {form.kind === "traffic_pack" ? (
            <label className="field">
              <span className="fine-print">绑定流量包商品</span>
              <CustomSelect
                value={form.trafficPackProductId}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    trafficPackProductId: value,
                  }))
                }
                options={[
                  { value: "", label: "请选择流量包商品" },
                  ...trafficPacks
                    .filter((product) => !product.archivedAt)
                    .map((product) => ({
                      value: product.id,
                      label: `${product.name} · ${formatBytes(product.trafficBytes)} · ${formatMoney(product.priceCents)}`,
                    })),
                ]}
              />
              <span className="field-hint">
                CDK 的流量、价格和有效期来自所选商品快照。
              </span>
            </label>
          ) : null}

          {form.kind === "discount" ? (
            <div className="two-col">
              <label className="field">
                <span className="fine-print">折扣方式</span>
                <CustomSelect
                  value={form.discountMode}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, discountMode: v as "percent" | "fixed" }))
                  }
                  options={[
                    { value: "percent", label: "百分比折扣" },
                    { value: "fixed", label: "定额减免" },
                  ]}
                />
              </label>
              {form.discountMode === "percent" ? (
                <label className="field">
                  <span className="fine-print">折扣百分比（%）</span>
                  <input
                    className="control"
                    type="number"
                    min="1"
                    max="100"
                    value={form.discountPercent}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, discountPercent: Math.round(Number(e.target.value)) }))
                    }
                  />
                  <span className="field-hint">减免 {form.discountPercent}%</span>
                </label>
              ) : (
                <label className="field">
                  <span className="fine-print">减免金额（元）</span>
                  <input
                    className="control"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.discountAmountCents / 100}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        discountAmountCents: Math.round(Number(e.target.value) * 100),
                      }))
                    }
                  />
                </label>
              )}
            </div>
          ) : null}

          <div className="two-col">
            <label className="field">
              <span className="fine-print">每张可使用次数</span>
              <input
                className="control"
                type="number"
                min="1"
                value={form.maxUses}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxUses: Math.max(1, Math.round(Number(e.target.value))) }))
                }
              />
              <span className="field-hint">同一会员每张码只能用一次</span>
            </label>
            <label className="field">
              <span className="fine-print">生成数量（批量上架）</span>
              <input
                className="control"
                type="number"
                min="1"
                max="500"
                value={form.count}
                onChange={(e) =>
                  setForm((f) => ({ ...f, count: Math.min(500, Math.max(1, Math.round(Number(e.target.value)))) }))
                }
              />
              <span className="field-hint">{form.count > 1 ? `批量生成 ${form.count} 张（忽略自定义码）` : "1-500，批量生成自动取随机码"}</span>
            </label>
          </div>

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

      <Drawer
        open={usesDrawerOpen}
        onClose={() => setUsesDrawerOpen(false)}
        title={usesCode ? `使用记录 · ${usesCode.label}` : "使用记录"}
      >
        {usesCode ? (
          <div className="kpi-list" style={{ marginBottom: 12 }}>
            <div className="list-row">
              <span className="muted">兑换码</span>
              <strong className="mono">{usesCode.code}</strong>
            </div>
            <div className="list-row">
              <span className="muted">已用 / 总次数</span>
              <strong>
                {usesCode.usedCount} / {usesCode.maxUses}
              </strong>
            </div>
          </div>
        ) : null}
        {usesLoading ? (
          <div className="skeleton-rows">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : uses.length ? (
          <DataTable
            headers={["会员", "邮箱", "使用时间"]}
            rows={uses.map((u) => [
              u.userDisplayName ?? "-",
              u.userEmail ?? "-",
              formatDateTime(u.redeemedAt),
            ])}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-title">还没有人使用这张兑换码</div>
          </div>
        )}
      </Drawer>
    </ConsoleShell>
  );
}
