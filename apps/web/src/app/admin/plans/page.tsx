"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { clearDraft, getDraft, saveDraft } from "@/lib/draft";
import { formatBytes, formatMoney } from "@/lib/format";
import type { NodeRecord, PlanBindingRecord, PlanRecord } from "@/lib/types";
import { slugifyValue } from "@/lib/ui";

const GB = 1024 * 1024 * 1024;
const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
const DRAFT_KEY = "plan";

type PlanForm = {
  slug: string;
  name: string;
  description: string;
  active: boolean;
  trafficBytes: number;
  durationDays: number;
  speedUpMbps: number;
  speedDownMbps: number;
  deviceLimit: number;
  priceCents: number;
  accent: string;
};

type Feedback = { msg: string; kind: "success" | "error" };

function emptyForm(): PlanForm {
  return {
    slug: "",
    name: "",
    description: "",
    active: true,
    trafficBytes: 200 * GB,
    durationDays: 30,
    speedUpMbps: 20,
    speedDownMbps: 120,
    deviceLimit: 3,
    priceCents: 1800,
    accent: "green",
  };
}

function fromRecord(plan: PlanRecord): PlanForm {
  return {
    slug: plan.slug,
    name: plan.name,
    description: plan.description ?? "",
    active: plan.active,
    trafficBytes: plan.trafficBytes,
    durationDays: plan.durationDays,
    speedUpMbps: plan.speedUpMbps,
    speedDownMbps: plan.speedDownMbps,
    deviceLimit: plan.deviceLimit,
    priceCents: plan.priceCents,
    accent: plan.accent,
  };
}

export default function AdminPlansPage() {
  const { token } = useAuth();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [bindings, setBindings] = useState<PlanBindingRecord[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRecord | null>(null);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [hasDraftBanner, setHasDraftBanner] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingBinding, setAddingBinding] = useState(false);
  const [newBindingNodeId, setNewBindingNodeId] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextPlans, nextBindings, nextNodes] = await Promise.all([
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
        apiRequest<PlanBindingRecord[]>("/api/admin/plan-bindings", { token }),
        apiRequest<NodeRecord[]>("/api/admin/nodes", { token }),
      ]);
      setPlans(nextPlans);
      setBindings(nextBindings);
      setNodes(nextNodes);
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

  const baseForm = useMemo(
    () => (editingPlan ? fromRecord(editingPlan) : emptyForm()),
    [editingPlan],
  );

  const isDirty = useMemo(
    () => drawerOpen && JSON.stringify(form) !== JSON.stringify(baseForm),
    [drawerOpen, form, baseForm],
  );

  function set<K extends keyof PlanForm>(key: K, value: PlanForm[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (!editingPlan) saveDraft(DRAFT_KEY, next);
      return next;
    });
  }

  function requestClose() {
    if (isDirty && !window.confirm("有未保存的改动，关闭后将丢失。确定关闭？")) return;
    forceClose();
  }

  function forceClose() {
    setDrawerOpen(false);
    setEditingPlan(null);
    setDrawerError(null);
    setHasDraftBanner(false);
    setNewBindingNodeId("");
  }

  function openCreate() {
    const draft = getDraft<PlanForm>(DRAFT_KEY);
    if (draft) {
      setForm(draft);
      setHasDraftBanner(true);
    } else {
      setForm(emptyForm());
      setHasDraftBanner(false);
    }
    setEditingPlan(null);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function openEdit(plan: PlanRecord) {
    setEditingPlan(plan);
    setForm(fromRecord(plan));
    setHasDraftBanner(false);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function discardDraft() {
    clearDraft(DRAFT_KEY);
    setForm(emptyForm());
    setHasDraftBanner(false);
  }

  async function handlePlanSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setDrawerError(null);
    try {
      const payload = {
        ...form,
        slug: form.slug.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        accent: form.accent.trim() || "green",
      };

      if (editingPlan) {
        await apiRequest<PlanRecord>(`/api/admin/plans/${editingPlan.id}`, {
          method: "PATCH",
          token,
          body: payload,
        });
      } else {
        clearDraft(DRAFT_KEY);
        await apiRequest<PlanRecord>("/api/admin/plans", {
          method: "POST",
          token,
          body: payload,
        });
      }

      setFeedback({ msg: editingPlan ? "套餐已更新。" : "套餐已创建。", kind: "success" });
      forceClose();
      await load();
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBinding() {
    if (!token || !editingPlan || !newBindingNodeId) return;
    setAddingBinding(true);
    setDrawerError(null);
    try {
      const planBindings = bindings.filter((b) => b.planId === editingPlan.id);
      const nextPriority = planBindings.reduce((m, b) => Math.max(m, b.priority), -1) + 1;
      await apiRequest("/api/admin/plan-bindings", {
        method: "POST",
        token,
        body: { planId: editingPlan.id, nodeId: newBindingNodeId, priority: nextPriority },
      });
      setNewBindingNodeId("");
      await load();
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "绑定失败。");
    } finally {
      setAddingBinding(false);
    }
  }

  async function handleRemoveBinding(bindingId: string) {
    if (!token) return;
    setDrawerError(null);
    try {
      await apiRequest(`/api/admin/plan-bindings/${bindingId}`, { method: "DELETE", token });
      await load();
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "移除绑定失败。");
    }
  }

  const drawerBindings = useMemo(
    () => (editingPlan ? bindings.filter((b) => b.planId === editingPlan.id) : []),
    [bindings, editingPlan],
  );

  const unboundNodes = useMemo(
    () => nodes.filter((n) => !drawerBindings.some((b) => b.nodeId === n.id)),
    [drawerBindings, nodes],
  );

  const unlimitedTraffic = form.trafficBytes >= UNLIMITED_TRAFFIC;
  const unlimitedSpeed = form.speedUpMbps === 0 && form.speedDownMbps === 0;

  const planSubmitDisabled =
    saving ||
    !form.slug.trim() ||
    !form.name.trim() ||
    form.trafficBytes < 1 ||
    form.durationDays < 1;

  return (
    <ConsoleShell
      title="套餐管理"
      subtitle="配置流量、速率和周期，绑定节点后会员订阅即可接入。"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">
          {loading ? "加载中..." : `${plans.length} 个套餐`}
        </span>
      }
      toolbarActions={
        <>
          <button className="action-button" type="button" onClick={openCreate}>
            新建套餐
          </button>
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
        </>
      }
    >
      {feedback ? <div className={`feedback ${feedback.kind}`}>{feedback.msg}</div> : null}

      <Panel
        title="套餐列表"
        copy="点击套餐行编辑详情和节点绑定；绑定节点后订阅用户才能连接。"
      >
        {loading && plans.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}

        {plans.length > 0 ? (
          <DataTable
            headers={["套餐", "流量", "速率", "周期", "价格", "节点"]}
            rows={plans.map((plan) => [
              <button
                key={plan.id}
                type="button"
                className="link-button"
                onClick={() => openEdit(plan)}
              >
                <span>{plan.name}</span>
                <span className="muted">
                  {plan.slug} · {plan.active ? "启用中" : "已停用"}
                </span>
              </button>,
              plan.trafficBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(plan.trafficBytes),
              plan.speedUpMbps === 0 && plan.speedDownMbps === 0 ? "不限速" : `${plan.speedUpMbps} / ${plan.speedDownMbps} Mbps`,
              `${plan.durationDays} 天`,
              formatMoney(plan.priceCents),
              plan.boundNodes.join(" / ") || (
                <span key={`${plan.id}-nb`} className="badge warn">
                  未绑定
                </span>
              ),
            ])}
          />
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">还没有套餐</div>
            <button className="action-button" type="button" onClick={openCreate}>
              新建第一个套餐
            </button>
          </div>
        ) : null}
      </Panel>

      <Drawer
        open={drawerOpen}
        onClose={requestClose}
        title={editingPlan ? `编辑套餐：${editingPlan.name}` : "新建套餐"}
        isDirty={isDirty}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="plan-form"
              disabled={planSubmitDisabled}
            >
              {saving ? "保存中..." : editingPlan ? "保存套餐" : "创建套餐"}
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

        <form id="plan-form" className="form-grid" onSubmit={handlePlanSubmit}>
          <div className="two-col">
            <label className="field">
              <span className="fine-print">套餐名</span>
              <input
                className="control"
                placeholder="如：标准 200G"
                value={form.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setForm((f) => {
                    const next = {
                      ...f,
                      name: nextName,
                      slug:
                        !editingPlan && (!f.slug || f.slug === slugifyValue(f.name))
                          ? slugifyValue(nextName)
                          : f.slug,
                    };
                    if (!editingPlan) saveDraft(DRAFT_KEY, next);
                    return next;
                  });
                }}
                required
              />
            </label>
            <label className="field">
              <span className="fine-print">Slug</span>
              <input
                className="control"
                placeholder="standard-200g"
                value={form.slug}
                onChange={(e) => set("slug", slugifyValue(e.target.value))}
                required
              />
            </label>
          </div>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">流量配额（GB）</span>
              <input
                className="control"
                type="number"
                min="1"
                step="1"
                disabled={unlimitedTraffic}
                value={unlimitedTraffic ? "" : Math.round((form.trafficBytes / GB) * 100) / 100}
                placeholder={unlimitedTraffic ? "无限流量" : ""}
                onChange={(e) => set("trafficBytes", Math.round(Number(e.target.value) * GB))}
              />
              {!unlimitedTraffic && <span className="field-hint">{formatBytes(form.trafficBytes)}</span>}
            </label>
            <label className="field">
              <span className="fine-print">周期天数</span>
              <input
                className="control"
                type="number"
                min="1"
                value={form.durationDays}
                onChange={(e) => set("durationDays", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field checkbox-row">
            <input
              type="checkbox"
              checked={unlimitedTraffic}
              onChange={(e) => set("trafficBytes", e.target.checked ? UNLIMITED_TRAFFIC : 200 * GB)}
            />
            <span>无限流量</span>
          </label>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">上行限速 Mbps</span>
              <input
                className="control"
                type="number"
                min="0"
                disabled={unlimitedSpeed}
                value={unlimitedSpeed ? "" : form.speedUpMbps}
                placeholder={unlimitedSpeed ? "不限速" : ""}
                onChange={(e) => set("speedUpMbps", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="fine-print">下行限速 Mbps</span>
              <input
                className="control"
                type="number"
                min="0"
                disabled={unlimitedSpeed}
                value={unlimitedSpeed ? "" : form.speedDownMbps}
                placeholder={unlimitedSpeed ? "不限速" : ""}
                onChange={(e) => set("speedDownMbps", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field checkbox-row">
            <input
              type="checkbox"
              checked={unlimitedSpeed}
              onChange={(e) => {
                if (e.target.checked) {
                  setForm((f) => {
                    const next = { ...f, speedUpMbps: 0, speedDownMbps: 0 };
                    if (!editingPlan) saveDraft(DRAFT_KEY, next);
                    return next;
                  });
                } else {
                  setForm((f) => {
                    const next = { ...f, speedUpMbps: 20, speedDownMbps: 120 };
                    if (!editingPlan) saveDraft(DRAFT_KEY, next);
                    return next;
                  });
                }
              }}
            />
            <span>不限制速率</span>
          </label>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">价格（元）</span>
              <input
                className="control"
                type="number"
                min="0"
                step="0.01"
                value={form.priceCents / 100}
                onChange={(e) => set("priceCents", Math.round(Number(e.target.value) * 100))}
              />
              <span className="field-hint">{formatMoney(form.priceCents)}</span>
            </label>
            <label className="field">
              <span className="fine-print">设备数上限</span>
              <input
                className="control"
                type="number"
                min="1"
                value={form.deviceLimit}
                onChange={(e) => set("deviceLimit", Number(e.target.value))}
              />
            </label>
          </div>

          <details className="field-section">
            <summary>其他配置（可选）</summary>
            <div className="field-section-body">
              <label className="field">
                <span className="fine-print">描述</span>
                <textarea
                  className="control textarea"
                  placeholder="套餐简介，展示给用户"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="fine-print">Accent 颜色</span>
                <input
                  className="control"
                  placeholder="green / teal / orange"
                  value={form.accent}
                  onChange={(e) => set("accent", e.target.value)}
                />
              </label>
            </div>
          </details>

          <label className="field checkbox-row">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            <span>启用该套餐</span>
          </label>
        </form>

        {editingPlan ? (
          <div className="form-grid">
            <div className="field-section-label">节点绑定</div>
            <span className="fine-print muted">
              套餐绑定的节点决定用户订阅后可以使用哪些节点。
            </span>

            {drawerBindings.length > 0 ? (
              <div className="inline-stack" style={{ flexWrap: "wrap" }}>
                {drawerBindings.map((b) => (
                  <span key={b.id} className="badge success" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    {b.nodeLabel}
                    <button
                      type="button"
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}
                      onClick={() => void handleRemoveBinding(b.id)}
                      title="移除绑定"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="feedback warn">该套餐尚未绑定节点，订阅用户将无法连接。</div>
            )}

            {unboundNodes.length > 0 ? (
              <div className="inline-stack">
                <CustomSelect
                  value={newBindingNodeId}
                  onChange={setNewBindingNodeId}
                  options={[
                    { value: "", label: "选择节点..." },
                    ...unboundNodes.map((n) => ({ value: n.id, label: `${n.label} (${n.hostname}:${n.port})` })),
                  ]}
                />
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void handleAddBinding()}
                  disabled={addingBinding || !newBindingNodeId}
                >
                  {addingBinding ? "绑定中..." : "添加"}
                </button>
              </div>
            ) : nodes.length > 0 ? (
              <div className="feedback info">所有节点均已绑定到此套餐。</div>
            ) : (
              <div className="feedback warn">还没有节点，请先在「节点管理」页添加节点。</div>
            )}
          </div>
        ) : null}
      </Drawer>
    </ConsoleShell>
  );
}
