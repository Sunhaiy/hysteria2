"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type {
  AdminUser,
  NodeGroupRecord,
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
  nodeGroupId: string;
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

function createEmptySubscription(): SubscriptionFormState {
  return { userId: "", planId: "", nodeGroupId: "", status: "active", startsAt: "", endsAt: "" };
}

function createSubscriptionForm(sub: SubscriptionRecord): SubscriptionFormState {
  return {
    userId: sub.userId,
    planId: sub.planId,
    nodeGroupId: sub.nodeGroupId,
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
  const [nodeGroups, setNodeGroups] = useState<NodeGroupRecord[]>([]);
  const [bindings, setBindings] = useState<PlanBindingRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<SubscriptionRecord | null>(null);
  const [form, setForm] = useState<SubscriptionFormState>(createEmptySubscription);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextSubscriptions, nextUsers, nextPlans, nextNodeGroups, nextBindings] =
        await Promise.all([
          apiRequest<SubscriptionRecord[]>("/api/admin/subscriptions", { token }),
          apiRequest<AdminUser[]>("/api/admin/users", { token }),
          apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
          apiRequest<NodeGroupRecord[]>("/api/admin/node-groups", { token }),
          apiRequest<PlanBindingRecord[]>("/api/admin/plan-bindings", { token }),
        ]);
      setSubscriptions(nextSubscriptions);
      setUsers(nextUsers.filter((u) => u.role === "member"));
      setPlans(nextPlans);
      setNodeGroups(nextNodeGroups);
      setBindings(nextBindings);
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

  const originalForm = useMemo(
    () => (editingSub ? createSubscriptionForm(editingSub) : createEmptySubscription()),
    [editingSub],
  );

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === form.planId) ?? null,
    [form.planId, plans],
  );

  const selectedUser = useMemo(
    () => users.find((u) => u.id === form.userId) ?? null,
    [form.userId, users],
  );

  const availableBindings = useMemo(
    () =>
      bindings
        .filter((b) => b.planId === form.planId)
        .sort((a, b) => a.priority - b.priority),
    [bindings, form.planId],
  );

  const availableNodeGroups = useMemo(
    () =>
      availableBindings
        .map((b) => nodeGroups.find((g) => g.id === b.nodeGroupId))
        .filter((g): g is NodeGroupRecord => Boolean(g)),
    [availableBindings, nodeGroups],
  );

  const defaultNodeGroupId = availableBindings[0]?.nodeGroupId ?? "";
  const defaultNodeGroupName =
    availableNodeGroups.find((g) => g.id === defaultNodeGroupId)?.name ?? "未指定";
  const effectiveNodeGroupId = form.nodeGroupId || defaultNodeGroupId;
  const effectiveNodeGroupName =
    availableNodeGroups.find((g) => g.id === effectiveNodeGroupId)?.name ?? "未指定";
  const canResetToDefaultNodeGroup = Boolean(
    editingSub && defaultNodeGroupId && form.nodeGroupId !== defaultNodeGroupId,
  );

  const subDirty = JSON.stringify(form) !== JSON.stringify(originalForm);

  const submitDisabled =
    submitting ||
    !form.userId ||
    !form.planId ||
    (Boolean(form.planId) && availableBindings.length === 0) ||
    (editingSub ? !subDirty : false);

  function openCreate() {
    setEditingSub(null);
    setForm(createEmptySubscription());
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function openEdit(sub: SubscriptionRecord) {
    setEditingSub(sub);
    setForm(createSubscriptionForm(sub));
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingSub(null);
    setDrawerError(null);
  }

  function handlePlanChange(nextPlanId: string) {
    const nextBindings = bindings
      .filter((b) => b.planId === nextPlanId)
      .sort((a, b) => a.priority - b.priority);
    const nextDefaultGroupId = nextBindings[0]?.nodeGroupId ?? "";
    setForm((f) => ({
      ...f,
      planId: nextPlanId,
      nodeGroupId:
        f.nodeGroupId && nextBindings.some((b) => b.nodeGroupId === f.nodeGroupId)
          ? f.nodeGroupId
          : nextDefaultGroupId,
    }));
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
              nodeGroupId:
                form.nodeGroupId !== originalForm.nodeGroupId ? form.nodeGroupId : undefined,
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
              nodeGroupId: form.nodeGroupId || undefined,
              status: form.status,
              startsAt: fromDateTimeLocal(form.startsAt),
            },
          });
      setEditingSub(saved);
      setForm(createSubscriptionForm(saved));
      setFeedback(editingSub ? "订阅已更新。" : "订阅已创建。");
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
      subtitle="把用户、套餐、默认节点组和订阅快照放到同一视角里连续调整。"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">
          {loading ? "加载中..." : `${subscriptions.length} 条订阅`}
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
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      <Panel
        title="订阅列表"
        copy="点击订阅行编辑状态、到期时间和节点组；「新建订阅」为会员开通一条新订阅。"
      >
        {loading && subscriptions.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}

        {subscriptions.length > 0 ? (
          <DataTable
            headers={["用户", "套餐", "节点组", "状态", "剩余流量", "到期时间"]}
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
              sub.planName,
              sub.nodeGroupName,
              <span key={`${sub.id}-st`} className={`badge ${statusTone(sub.status)}`}>
                {sub.status}
              </span>,
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
        onClose={closeDrawer}
        title={editingSub ? `编辑订阅：${editingSub.userDisplayName}` : "新建订阅"}
        subtitle={editingSub ? `${editingSub.planName} · ${editingSub.nodeGroupName}` : undefined}
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
            <button className="ghost-button" type="button" onClick={closeDrawer}>
              取消
            </button>
          </div>
        }
      >
        {drawerError ? <div className="feedback error">{drawerError}</div> : null}

        {selectedPlan || selectedUser ? (
          <div className="metric-grid" style={{ marginBottom: 16 }}>
            <article className="metric-card">
              <span className="metric-label">套餐</span>
              <strong>{selectedPlan?.name ?? "未选择"}</strong>
              <span className="metric-footnote">
                {selectedPlan
                  ? `${formatBytes(selectedPlan.trafficBytes)} / ${selectedPlan.durationDays} 天`
                  : "选择后可预览配额"}
              </span>
            </article>
            <article className="metric-card">
              <span className="metric-label">{editingSub ? "当前节点组" : "默认节点组"}</span>
              <strong>{effectiveNodeGroupName}</strong>
              <span className="metric-footnote">
                {availableBindings.length === 0
                  ? "当前套餐还没有绑定节点组"
                  : `${availableBindings.length} 条可选绑定`}
              </span>
            </article>
          </div>
        ) : null}

        <form id="sub-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span className="fine-print">用户</span>
            <select
              className="control"
              disabled={Boolean(editingSub)}
              value={form.userId}
              onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
            >
              <option value="">请选择用户</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} / {u.email}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="fine-print">套餐</span>
            <select
              className="control"
              disabled={Boolean(editingSub)}
              value={form.planId}
              onChange={(e) => handlePlanChange(e.target.value)}
            >
              <option value="">请选择套餐</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {form.planId && availableBindings.length === 0 ? (
            <div className="feedback info">
              当前套餐还没有节点组绑定，请先去套餐页补绑定。
            </div>
          ) : null}

          <label className="field">
            <div className="field-inline-actions">
              <span className="fine-print">节点组</span>
              {editingSub && canResetToDefaultNodeGroup ? (
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, nodeGroupId: defaultNodeGroupId }))}
                >
                  切回默认组 ({defaultNodeGroupName})
                </button>
              ) : null}
            </div>
            <select
              className="control"
              value={form.nodeGroupId}
              onChange={(e) => setForm((f) => ({ ...f, nodeGroupId: e.target.value }))}
            >
              {editingSub ? null : <option value="">自动选择默认节点组</option>}
              {availableNodeGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <span className="field-hint">
              {editingSub
                ? `留空则用当前套餐默认绑定（${defaultNodeGroupName}）。`
                : `留空时默认落到 ${defaultNodeGroupName}。`}
            </span>
          </label>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">状态</span>
              <select
                className="control"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as SubscriptionRecord["status"] }))
                }
              >
                {subscriptionStatusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
