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
import { formatBytes, formatDateTime } from "@/lib/format";
import type {
  AdminUser,
  NodeRecord,
  PaginatedResponse,
  PlanBindingRecord,
  PlanRecord,
  SubscriptionRecord,
} from "@/lib/types";
import {
  fromDateTimeLocal,
  humanizeSubscriptionStatus,
  shiftDateTimeLocal,
  statusTone,
  toDateTimeLocal,
} from "@/lib/ui";

type SubscriptionFormState = {
  userId: string;
  planId: string;
  nodeId: string;
  status: SubscriptionRecord["status"];
  startsAt: string;
  endsAt: string;
};

const subscriptionStatusOptions: Array<{ value: SubscriptionRecord["status"]; label: string }> = [
  { value: "active", label: "active / 生效" },
  { value: "paused", label: "paused / 暂停" },
  { value: "canceled", label: "canceled / 已取消" },
  { value: "expired", label: "expired / 已过期" },
];

const DRAFT_KEY = "subscription";
type Feedback = { msg: string; kind: "success" | "error" };

function createEmptySubscription(): SubscriptionFormState {
  return { userId: "", planId: "", nodeId: "", status: "active", startsAt: "", endsAt: "" };
}

function createSubscriptionForm(sub: SubscriptionRecord): SubscriptionFormState {
  return {
    userId: sub.userId,
    planId: sub.planId,
    nodeId: sub.nodeId,
    status: sub.status,
    startsAt: toDateTimeLocal(sub.startsAt),
    endsAt: toDateTimeLocal(sub.endsAt),
  };
}

export default function AdminSubscriptionsPage() {
  const { token } = useAuth();
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [bindings, setBindings] = useState<PlanBindingRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<SubscriptionRecord | null>(null);
  const [form, setForm] = useState<SubscriptionFormState>(createEmptySubscription);
  const [hasDraftBanner, setHasDraftBanner] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [nodeFilter, setNodeFilter] = useState("");
  const [quotaFilter, setQuotaFilter] = useState("");
  const [totalSubscriptions, setTotalSubscriptions] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (search.trim()) params.set("q", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (planFilter) params.set("planId", planFilter);
      if (nodeFilter) params.set("nodeId", nodeFilter);
      if (quotaFilter) params.set("quotaState", quotaFilter);
      const [nextSubscriptions, nextUsers, nextPlans, nextNodes, nextBindings] =
        await Promise.all([
          apiRequest<PaginatedResponse<SubscriptionRecord>>(`/api/admin/subscriptions?${params}`, { token }),
          apiRequest<PaginatedResponse<AdminUser>>("/api/admin/users?limit=200", { token }),
          apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
          apiRequest<NodeRecord[]>("/api/admin/nodes", { token }),
          apiRequest<PlanBindingRecord[]>("/api/admin/plan-bindings", { token }),
        ]);
      setSubscriptions(nextSubscriptions.items);
      setTotalSubscriptions(nextSubscriptions.total);
      setUsers(nextUsers.items.filter((u) => u.role === "member"));
      setPlans(nextPlans);
      setNodes(nextNodes);
      setBindings(nextBindings);
    } catch {
      // keep stale
    } finally {
      setLoading(false);
    }
  }, [nodeFilter, planFilter, quotaFilter, search, statusFilter, token]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(id);
  }, [load]);

  const originalForm = useMemo(
    () => (editingSub ? createSubscriptionForm(editingSub) : createEmptySubscription()),
    [editingSub],
  );

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === form.planId) ?? null,
    [form.planId, plans],
  );

  const availableBindings = useMemo(
    () =>
      bindings
        .filter((b) => b.planId === form.planId)
        .sort((a, b) => a.priority - b.priority),
    [bindings, form.planId],
  );

  const availableNodes = useMemo(
    () =>
      availableBindings
        .map((b) => nodes.find((n) => n.id === b.nodeId))
        .filter((n): n is NodeRecord => Boolean(n)),
    [availableBindings, nodes],
  );

  const defaultNodeId = availableBindings[0]?.nodeId ?? "";
  const defaultNodeLabel =
    availableNodes.find((n) => n.id === defaultNodeId)?.label ?? "未指定";
  const effectiveNodeId = form.nodeId || defaultNodeId;
  const effectiveNodeLabel =
    availableNodes.find((n) => n.id === effectiveNodeId)?.label ?? "未指定";
  const canResetToDefaultNode = Boolean(
    editingSub && defaultNodeId && form.nodeId !== defaultNodeId,
  );

  const subDirty = drawerOpen && JSON.stringify(form) !== JSON.stringify(originalForm);
  const isDirty = subDirty;

  function requestClose() {
    if (isDirty && !window.confirm("有未保存的改动，关闭后将丢失。确定关闭？")) return;
    forceClose();
  }

  function forceClose() {
    setDrawerOpen(false);
    setEditingSub(null);
    setDrawerError(null);
    setHasDraftBanner(false);
    clearDraft(DRAFT_KEY);
  }

  const submitDisabled =
    submitting ||
    !form.userId ||
    !form.planId ||
    (Boolean(form.planId) && availableBindings.length === 0) ||
    (editingSub ? !subDirty : false);

  function openCreate() {
    const draft = getDraft<SubscriptionFormState>(DRAFT_KEY);
    if (draft) {
      setForm(draft);
      setHasDraftBanner(true);
    } else {
      setForm(createEmptySubscription());
      setHasDraftBanner(false);
    }
    setEditingSub(null);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function openEdit(sub: SubscriptionRecord) {
    setEditingSub(sub);
    setForm(createSubscriptionForm(sub));
    setHasDraftBanner(false);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function discardDraft() {
    clearDraft(DRAFT_KEY);
    setForm(createEmptySubscription());
    setHasDraftBanner(false);
  }

  function handlePlanChange(nextPlanId: string) {
    const nextBindings = bindings
      .filter((b) => b.planId === nextPlanId)
      .sort((a, b) => a.priority - b.priority);
    const nextDefaultNodeId = nextBindings[0]?.nodeId ?? "";
    setForm((f) => {
      const n = {
        ...f,
        planId: nextPlanId,
        nodeId:
          f.nodeId && nextBindings.some((b) => b.nodeId === f.nodeId)
            ? f.nodeId
            : nextDefaultNodeId,
      };
      if (!editingSub) saveDraft(DRAFT_KEY, n);
      return n;
    });
  }

  function extendEndsAt(days: number) {
    setForm((f) => ({
      ...f,
      endsAt: shiftDateTimeLocal(f.endsAt || originalForm.endsAt, days),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setDrawerError(null);
    setFeedback(null);
    try {
      const saved = editingSub
        ? await apiRequest<SubscriptionRecord>(`/api/admin/subscriptions/${editingSub.id}`, {
            method: "PATCH",
            token,
            body: {
              status: form.status !== originalForm.status ? form.status : undefined,
              nodeId:
                form.nodeId !== originalForm.nodeId ? form.nodeId : undefined,
              endsAt:
                form.endsAt !== originalForm.endsAt ? fromDateTimeLocal(form.endsAt) : undefined,
            },
          })
        : await apiRequest<SubscriptionRecord>("/api/admin/subscriptions", {
            method: "POST",
            token,
            body: {
              userId: form.userId,
              planId: form.planId,
              nodeId: form.nodeId || undefined,
              status: form.status,
              startsAt: fromDateTimeLocal(form.startsAt),
            },
          });
      setEditingSub(saved);
      setForm(createSubscriptionForm(saved));
      if (!editingSub) clearDraft(DRAFT_KEY);
      setFeedback({ msg: editingSub ? "订阅已更新。" : "订阅已创建。", kind: "success" });
      forceClose();
      await load();
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "保存订阅失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConsoleShell
      title="订阅管理"
      subtitle="把用户、套餐、节点和订阅快照放到同一视角里连续调整。"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">
          {loading ? "加载中..." : `${totalSubscriptions} 条订阅`}
        </span>
      }
      toolbarActions={
        <>
          <button className="action-button" type="button" onClick={openCreate}>
            新建订阅
          </button>
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
        </>
      }
    >
      {feedback ? <div className={`feedback ${feedback.kind}`}>{feedback.msg}</div> : null}

      <Panel
        title="订阅列表"
        copy="点击订阅行编辑状态、到期时间和节点；「新建订阅」为会员开通一条新订阅。"
      >
        <div className="admin-filter-bar">
          <label className="field grow-field">
            <span className="fine-print">搜索订阅</span>
            <input className="control" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="用户邮箱、名称或订阅 ID" />
          </label>
          <label className="field">
            <span className="fine-print">状态</span>
            <select className="control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">全部</option><option value="active">生效</option><option value="paused">暂停</option><option value="expired">过期</option><option value="canceled">取消</option>
            </select>
          </label>
          <label className="field">
            <span className="fine-print">套餐</span>
            <select className="control" value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
              <option value="">全部</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="fine-print">节点</span>
            <select className="control" value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)}>
              <option value="">全部</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="fine-print">额度</span>
            <select className="control" value={quotaFilter} onChange={(event) => setQuotaFilter(event.target.value)}>
              <option value="">全部</option><option value="available">充足</option><option value="low">偏低</option><option value="exhausted">耗尽</option>
            </select>
          </label>
        </div>
        {loading && subscriptions.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}

        {subscriptions.length > 0 ? (
          <DataTable
            headers={["用户", "套餐 / 周期", "节点", "状态", "倍率", "剩余流量", "到期时间"]}
            rows={subscriptions.map((sub) => [
              <button
                key={sub.id}
                type="button"
                className="link-button"
                onClick={() => openEdit(sub)}
              >
                <span>{sub.userDisplayName}</span>
                <span className="muted">{sub.userEmail}</span>
              </button>,
              <div key={`${sub.id}-offer`}><strong>{sub.planName}</strong><span className="muted">{sub.offerName ?? sub.billingPeriod ?? "legacy"}</span></div>,
              sub.nodeLabel,
              <span key={`${sub.id}-st`} className={`badge ${statusTone(sub.status)}`}>
                {sub.status}
              </span>,
              `${(sub.trafficMultiplier ?? 1).toFixed(2)}x`,
              formatBytes(sub.trafficRemainingBytes),
              formatDateTime(sub.endsAt),
            ])}
          />
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">📅</div>
            <div className="empty-state-title">还没有订阅</div>
            <button className="action-button" type="button" onClick={openCreate}>
              新建第一条订阅
            </button>
          </div>
        ) : null}
      </Panel>

      <Drawer
        open={drawerOpen}
        onClose={requestClose}
        title={editingSub ? `编辑订阅：${editingSub.userDisplayName}` : "新建订阅"}
        subtitle={editingSub ? `${editingSub.planName} · ${editingSub.nodeLabel}` : undefined}
        isDirty={isDirty}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="sub-form"
              disabled={submitDisabled}
            >
              {submitting ? "保存中..." : editingSub ? "保存订阅" : "创建订阅"}
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

        {selectedPlan ? (
          <div className="metric-grid" style={{ marginBottom: 16 }}>
            <article className="metric-card">
              <span className="metric-label">套餐</span>
              <strong>{selectedPlan.name}</strong>
              <span className="metric-footnote">
                {`${formatBytes(selectedPlan.trafficBytes)} / ${selectedPlan.durationDays} 天`}
              </span>
            </article>
            <article className="metric-card">
              <span className="metric-label">{editingSub ? "当前节点" : "默认节点"}</span>
              <strong>{effectiveNodeLabel}</strong>
              <span className="metric-footnote">
                {availableBindings.length === 0
                  ? "当前套餐还没有绑定节点"
                  : `${availableBindings.length} 个可选节点`}
              </span>
            </article>
          </div>
        ) : null}

        <form id="sub-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span className="fine-print">用户</span>
            <CustomSelect
              disabled={Boolean(editingSub)}
              value={form.userId}
              onChange={(v) => setForm((f) => ({ ...f, userId: v }))}
              options={[
                { value: "", label: "请选择用户" },
                ...users.map((u) => ({ value: u.id, label: `${u.displayName} / ${u.email}` })),
              ]}
            />
          </label>

          <label className="field">
            <span className="fine-print">套餐</span>
            <CustomSelect
              disabled={Boolean(editingSub)}
              value={form.planId}
              onChange={handlePlanChange}
              options={[
                { value: "", label: "请选择套餐" },
                ...plans.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </label>

          {form.planId && availableBindings.length === 0 ? (
            <div className="feedback info">
              当前套餐还没有绑定节点，请先去套餐页添加节点绑定。
            </div>
          ) : null}

          <label className="field">
            <div className="field-inline-actions">
              <span className="fine-print">节点</span>
              {editingSub && canResetToDefaultNode ? (
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, nodeId: defaultNodeId }))}
                >
                  切回默认节点 ({defaultNodeLabel})
                </button>
              ) : null}
            </div>
            <CustomSelect
              value={form.nodeId}
              onChange={(v) => setForm((f) => ({ ...f, nodeId: v }))}
              options={[
                ...(editingSub ? [] : [{ value: "", label: "自动选择默认节点" }]),
                ...availableNodes.map((n) => ({ value: n.id, label: n.label })),
              ]}
            />
            <span className="field-hint">
              {editingSub
                ? `留空则用当前套餐默认节点（${defaultNodeLabel}）。`
                : `留空时默认落到 ${defaultNodeLabel}。`}
            </span>
          </label>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">状态</span>
              <CustomSelect
                value={form.status}
                onChange={(v) => setForm((f) => ({ ...f, status: v as SubscriptionRecord["status"] }))}
                options={subscriptionStatusOptions}
              />
              <span className="field-hint">{humanizeSubscriptionStatus(form.status)}</span>
            </label>

            <label className="field">
              <span className="fine-print">开始时间</span>
              <input
                className="control"
                type="datetime-local"
                disabled={Boolean(editingSub)}
                value={form.startsAt}
                onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              />
            </label>
          </div>

          {editingSub ? (
            <label className="field">
              <div className="field-inline-actions">
                <span className="fine-print">到期时间</span>
                <div className="inline-stack">
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={() => extendEndsAt(7)}
                  >
                    +7 天
                  </button>
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={() => extendEndsAt(30)}
                  >
                    +30 天
                  </button>
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={() => setForm(originalForm)}
                    disabled={!subDirty}
                  >
                    恢复
                  </button>
                </div>
              </div>
              <input
                className="control"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
              />
              <span className="field-hint">
                已用：{formatBytes(editingSub.consumedTrafficBytes)} ·
                剩余：{formatBytes(editingSub.trafficRemainingBytes)}
              </span>
            </label>
          ) : null}
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
