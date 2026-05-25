"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
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

const subscriptionStatusOptions: Array<{
  value: SubscriptionRecord["status"];
  label: string;
}> = [
  { value: "active", label: "active / 生效" },
  { value: "paused", label: "paused / 暂停" },
  { value: "canceled", label: "canceled / 已取消" },
  { value: "expired", label: "expired / 已过期" },
];

function createEmptySubscription(): SubscriptionFormState {
  return {
    userId: "",
    planId: "",
    nodeGroupId: "",
    status: "active",
    startsAt: "",
    endsAt: "",
  };
}

function createSubscriptionForm(subscription: SubscriptionRecord): SubscriptionFormState {
  return {
    userId: subscription.userId,
    planId: subscription.planId,
    nodeGroupId: subscription.nodeGroupId,
    status: subscription.status,
    startsAt: toDateTimeLocal(subscription.startsAt),
    endsAt: toDateTimeLocal(subscription.endsAt),
  };
}

function formsMatch<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export default function AdminSubscriptionsPage() {
  const { token } = useAuth();
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [nodeGroups, setNodeGroups] = useState<NodeGroupRecord[]>([]);
  const [bindings, setBindings] = useState<PlanBindingRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<SubscriptionFormState>(createEmptySubscription);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      return null;
    }

    setLoading(true);
    setError(null);

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
      setUsers(nextUsers.filter((user) => user.role === "member"));
      setPlans(nextPlans);
      setNodeGroups(nextNodeGroups);
      setBindings(nextBindings);

      if (selectedId && !nextSubscriptions.some((item) => item.id === selectedId)) {
        setSelectedId(null);
        setForm(createEmptySubscription());
      }

      return {
        nextSubscriptions,
        nextUsers,
        nextPlans,
        nextNodeGroups,
        nextBindings,
      };
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "订阅数据加载失败。");
      return null;
    } finally {
      setLoading(false);
    }
  }, [selectedId, token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const selectedSubscription = useMemo(
    () => subscriptions.find((subscription) => subscription.id === selectedId) ?? null,
    [selectedId, subscriptions],
  );

  const originalForm = useMemo(
    () => (selectedSubscription ? createSubscriptionForm(selectedSubscription) : createEmptySubscription()),
    [selectedSubscription],
  );

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === form.planId) ?? null,
    [form.planId, plans],
  );

  const selectedUser = useMemo(
    () => users.find((user) => user.id === form.userId) ?? null,
    [form.userId, users],
  );

  const availableBindings = useMemo(
    () =>
      bindings
        .filter((binding) => binding.planId === form.planId)
        .sort((left, right) => left.priority - right.priority),
    [bindings, form.planId],
  );

  const availableNodeGroups = useMemo(
    () =>
      availableBindings
        .map((binding) => nodeGroups.find((group) => group.id === binding.nodeGroupId))
        .filter((group): group is NodeGroupRecord => Boolean(group)),
    [availableBindings, nodeGroups],
  );

  const defaultNodeGroupId = availableBindings[0]?.nodeGroupId ?? "";
  const defaultNodeGroupName =
    availableNodeGroups.find((group) => group.id === defaultNodeGroupId)?.name ?? "未指定";
  const effectiveNodeGroupId = form.nodeGroupId || defaultNodeGroupId;
  const effectiveNodeGroupName =
    availableNodeGroups.find((group) => group.id === effectiveNodeGroupId)?.name ?? "未指定";
  const canResetToDefaultNodeGroup = Boolean(
    selectedSubscription && defaultNodeGroupId && form.nodeGroupId !== defaultNodeGroupId,
  );

  const subscriptionDirty = !formsMatch(form, originalForm);

  const submitDisabled =
    submitting ||
    !form.userId ||
    !form.planId ||
    (Boolean(form.planId) && availableBindings.length === 0) ||
    (selectedSubscription ? !subscriptionDirty : false);

  function beginCreateSubscription() {
    setSelectedId(null);
    setForm(createEmptySubscription());
    setFeedback(null);
  }

  function resetSelectedSubscription() {
    setForm(originalForm);
    setFeedback(null);
  }

  function selectSubscription(subscription: SubscriptionRecord | null) {
    if (!subscription) {
      beginCreateSubscription();
      return;
    }

    setSelectedId(subscription.id);
    setForm(createSubscriptionForm(subscription));
  }

  function handlePlanChange(nextPlanId: string) {
    const nextBindings = bindings
      .filter((binding) => binding.planId === nextPlanId)
      .sort((left, right) => left.priority - right.priority);
    const nextDefaultGroupId = nextBindings[0]?.nodeGroupId ?? "";

    setForm((current) => ({
      ...current,
      planId: nextPlanId,
      nodeGroupId:
        current.nodeGroupId && nextBindings.some((binding) => binding.nodeGroupId === current.nodeGroupId)
          ? current.nodeGroupId
          : nextDefaultGroupId,
    }));
  }

  function resetNodeGroupToDefault() {
    if (!defaultNodeGroupId) {
      return;
    }

    setForm((current) => ({
      ...current,
      nodeGroupId: defaultNodeGroupId,
    }));
  }

  function extendEndsAt(days: number) {
    setForm((current) => ({
      ...current,
      endsAt: shiftDateTimeLocal(current.endsAt || originalForm.endsAt, days),
    }));
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
      const savedSubscription = selectedSubscription
        ? await apiRequest<SubscriptionRecord>(`/api/admin/subscriptions/${selectedSubscription.id}`, {
            method: "PATCH",
            token,
            body: {
              status: form.status !== originalForm.status ? form.status : undefined,
              nodeGroupId: form.nodeGroupId !== originalForm.nodeGroupId ? form.nodeGroupId : undefined,
              endsAt: form.endsAt !== originalForm.endsAt ? fromDateTimeLocal(form.endsAt) : undefined,
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

      setSelectedId(savedSubscription.id);
      setForm(createSubscriptionForm(savedSubscription));
      setFeedback(selectedSubscription ? "订阅已更新。" : "订阅已创建。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存订阅失败。");
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
          {loading ? "加载中..." : `${subscriptions.length} 条订阅 / ${plans.length} 个套餐`}
        </span>
      }
      toolbarActions={
        <button className="toolbar-button" type="button" onClick={() => void load()}>
          刷新
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      <section className="workspace-grid">
        <Panel
          title="订阅列表"
          copy="保存后会停留在当前订阅，适合继续调状态、到期时间和默认节点组。"
          action={
            <div className="panel-actions">
              {selectedSubscription ? (
                <button className="ghost-button compact" type="button" onClick={beginCreateSubscription}>
                  新建订阅
                </button>
              ) : null}
              <span className="fine-print">{loading ? "同步中..." : `${subscriptions.length} 条`}</span>
            </div>
          }
        >
          <DataTable
            headers={["用户", "套餐", "节点组", "状态", "剩余流量", "到期时间"]}
            rows={subscriptions.map((subscription) => [
              <button
                key={subscription.id}
                type="button"
                className={`link-button${selectedId === subscription.id ? " active" : ""}`}
                onClick={() => selectSubscription(subscription)}
              >
                <span>{subscription.userDisplayName}</span>
                <span className="muted">{subscription.userEmail}</span>
              </button>,
              subscription.planName,
              subscription.nodeGroupName,
              <span key={`${subscription.id}-status`} className={`badge ${statusTone(subscription.status)}`}>
                {subscription.status}
              </span>,
              formatBytes(subscription.trafficRemainingBytes),
              formatDateTime(subscription.endsAt),
            ])}
          />
        </Panel>

        <Panel
          title={selectedSubscription ? "编辑订阅" : "新建订阅"}
          copy="套餐一旦选定，节点组只能来自该套餐的绑定列表；新建时留空会按优先级自动挑默认组。"
          action={
            selectedSubscription ? (
              <span className={`badge ${subscriptionDirty ? "warn" : "success"}`}>
                {subscriptionDirty ? "有未保存改动" : "已同步"}
              </span>
            ) : availableBindings.length > 0 ? (
              <span className="badge info">默认节点组：{defaultNodeGroupName}</span>
            ) : (
              <span className="badge">先选套餐</span>
            )
          }
        >
          <div className="metric-grid">
            <article className="metric-card">
              <span className="metric-label">当前套餐</span>
              <strong>{selectedPlan?.name ?? "未选择"}</strong>
              <span className="metric-footnote">
                {selectedPlan
                  ? `${formatBytes(selectedPlan.trafficBytes)} / ${selectedPlan.durationDays} 天`
                  : "选择后可预览配额与周期"}
              </span>
            </article>
            <article className="metric-card">
              <span className="metric-label">{selectedSubscription ? "当前节点组" : "默认节点组"}</span>
              <strong>{effectiveNodeGroupName}</strong>
              <span className="metric-footnote">
                {availableBindings.length === 0
                  ? "当前套餐还没有绑定节点组"
                  : canResetToDefaultNodeGroup
                    ? `当前默认绑定为 ${defaultNodeGroupName}`
                    : `${availableBindings.length} 条可选绑定`}
              </span>
            </article>
            <article className="metric-card">
              <span className="metric-label">成员</span>
              <strong>{selectedUser?.displayName ?? "未选择"}</strong>
              <span className="metric-footnote">{selectedUser?.email ?? "先选一个会员账号"}</span>
            </article>
            <article className="metric-card">
              <span className="metric-label">当前快照</span>
              <strong>
                {selectedSubscription
                  ? `${selectedSubscription.speedUpMbpsSnapshot} / ${selectedSubscription.speedDownMbpsSnapshot} Mbps`
                  : selectedPlan
                    ? `${selectedPlan.speedUpMbps} / ${selectedPlan.speedDownMbps} Mbps`
                    : "等待套餐选择"}
              </strong>
              <span className="metric-footnote">
                {selectedSubscription
                  ? `设备上限 ${selectedSubscription.deviceLimitSnapshot} 台`
                  : selectedPlan
                    ? `设备上限 ${selectedPlan.deviceLimit} 台`
                    : "订阅创建时自动复制"}
              </span>
            </article>
          </div>

          {form.planId && availableBindings.length === 0 ? (
            <div className="feedback info">当前套餐还没有节点组绑定，订阅无法创建，请先去套餐页补绑定。</div>
          ) : null}

          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span className="fine-print">用户</span>
              <select
                className="control"
                disabled={Boolean(selectedSubscription)}
                value={form.userId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, userId: event.target.value }))
                }
              >
                <option value="">请选择用户</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} / {user.email}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="fine-print">套餐</span>
              <select
                className="control"
                disabled={Boolean(selectedSubscription)}
                value={form.planId}
                onChange={(event) => handlePlanChange(event.target.value)}
              >
                <option value="">请选择套餐</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <div className="field-inline-actions">
                <span className="fine-print">节点组</span>
                {selectedSubscription ? (
                  <div className="inline-stack">
                    <button
                      className="ghost-button compact"
                      type="button"
                      onClick={resetNodeGroupToDefault}
                      disabled={!canResetToDefaultNodeGroup}
                    >
                      切回默认组
                    </button>
                  </div>
                ) : null}
              </div>
              <select
                className="control"
                value={form.nodeGroupId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, nodeGroupId: event.target.value }))
                }
              >
                {selectedSubscription ? null : <option value="">自动选择默认节点组</option>}
                {availableNodeGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {selectedSubscription
                  ? `编辑时会直接写入具体节点组；如需跟随当前套餐默认绑定，可切回 ${defaultNodeGroupName}。`
                  : `留空时默认使用优先级最高的节点组，当前将落到 ${defaultNodeGroupName}。`}
              </span>
            </label>

            <div className="two-col">
              <label className="field">
                <span className="fine-print">状态</span>
                <select
                  className="control"
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as SubscriptionRecord["status"],
                    }))
                  }
                >
                  {subscriptionStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint">当前状态：{humanizeSubscriptionStatus(form.status)}</span>
              </label>

              <label className="field">
                <span className="fine-print">开始时间</span>
                <input
                  className="control"
                  type="datetime-local"
                  disabled={Boolean(selectedSubscription)}
                  value={form.startsAt}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, startsAt: event.target.value }))
                  }
                />
                <span className="field-hint">
                  创建时留空默认使用当前时间；编辑阶段开始时间保持只读。
                </span>
              </label>
            </div>

            {selectedSubscription ? (
              <div className="two-col">
                <label className="field">
                  <div className="field-inline-actions">
                    <span className="fine-print">到期时间</span>
                    <div className="inline-stack">
                      <button
                        className="ghost-button compact"
                        type="button"
                        onClick={() => extendEndsAt(7)}
                        disabled={!form.endsAt}
                      >
                        +7 天
                      </button>
                      <button
                        className="ghost-button compact"
                        type="button"
                        onClick={() => extendEndsAt(30)}
                        disabled={!form.endsAt}
                      >
                        +30 天
                      </button>
                      <button
                        className="ghost-button compact"
                        type="button"
                        onClick={resetSelectedSubscription}
                        disabled={!subscriptionDirty}
                      >
                        恢复原值
                      </button>
                    </div>
                  </div>
                  <input
                    className="control"
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, endsAt: event.target.value }))
                    }
                  />
                  <span className="field-hint">常用续期可以直接顺延，到期时间不会再因为时区被静默平移。</span>
                </label>
                <div className="list">
                  <span className="fine-print">
                    已用流量：{formatBytes(selectedSubscription.consumedTrafficBytes)}
                  </span>
                  <span className="fine-print">
                    剩余流量：{formatBytes(selectedSubscription.trafficRemainingBytes)}
                  </span>
                  <span className="fine-print">
                    当前节点组：{selectedSubscription.nodeGroupName}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="toolbar-actions">
              <button className="action-button" type="submit" disabled={submitDisabled}>
                {submitting ? "保存中..." : selectedSubscription ? "保存订阅" : "创建订阅"}
              </button>
              {selectedSubscription ? (
                <>
                  <button className="ghost-button" type="button" onClick={resetSelectedSubscription}>
                    恢复当前记录
                  </button>
                  <button className="ghost-button" type="button" onClick={beginCreateSubscription}>
                    切到新建
                  </button>
                </>
              ) : null}
            </div>
          </form>
        </Panel>
      </section>
    </ConsoleShell>
  );
}
