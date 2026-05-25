"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatMoney } from "@/lib/format";
import type { NodeGroupRecord, PlanBindingRecord, PlanRecord } from "@/lib/types";
import { slugifyValue } from "@/lib/ui";

type PlanFormState = {
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

type BindingFormState = {
  planId: string;
  nodeGroupId: string;
  priority: number;
};

type PendingActionState = {
  message: string;
  actionLabel: string;
  affectsPlan: boolean;
  affectsBinding: boolean;
};

function createEmptyPlan(): PlanFormState {
  return {
    slug: "",
    name: "",
    description: "",
    active: true,
    trafficBytes: 200 * 1024 * 1024 * 1024,
    durationDays: 30,
    speedUpMbps: 20,
    speedDownMbps: 120,
    deviceLimit: 3,
    priceCents: 1800,
    accent: "green",
  };
}

function createPlanForm(plan: PlanRecord): PlanFormState {
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

function createBindingForm(planId = "", priority = 0): BindingFormState {
  return {
    planId,
    nodeGroupId: "",
    priority,
  };
}

function createBindingEditForm(binding: PlanBindingRecord): BindingFormState {
  return {
    planId: binding.planId,
    nodeGroupId: binding.nodeGroupId,
    priority: binding.priority,
  };
}

function getNextBindingPriority(bindings: PlanBindingRecord[], planId: string) {
  if (!planId) {
    return 0;
  }
  return (
    bindings
      .filter((binding) => binding.planId === planId)
      .reduce((highest, binding) => Math.max(highest, binding.priority), -1) + 1
  );
}

function formsMatch<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function describeDirtyScope(affectsPlan: boolean, affectsBinding: boolean) {
  if (affectsPlan && affectsBinding) {
    return "当前套餐和绑定草稿";
  }
  if (affectsPlan) {
    return "当前套餐草稿";
  }
  return "当前绑定草稿";
}

export default function AdminPlansPage() {
  const { token } = useAuth();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [nodeGroups, setNodeGroups] = useState<NodeGroupRecord[]>([]);
  const [bindings, setBindings] = useState<PlanBindingRecord[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormState>(createEmptyPlan);
  const [bindingForm, setBindingForm] = useState<BindingFormState>(() => createBindingForm());
  const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [planSaving, setPlanSaving] = useState(false);
  const [bindingSaving, setBindingSaving] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextPlans, nextNodeGroups, nextBindings] = await Promise.all([
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
        apiRequest<NodeGroupRecord[]>("/api/admin/node-groups", { token }),
        apiRequest<PlanBindingRecord[]>("/api/admin/plan-bindings", { token }),
      ]);

      setPlans(nextPlans);
      setNodeGroups(nextNodeGroups);
      setBindings(nextBindings);

      if (selectedPlanId && !nextPlans.some((plan) => plan.id === selectedPlanId)) {
        setSelectedPlanId(null);
        setPlanForm(createEmptyPlan());
      }

      if (selectedBindingId && !nextBindings.some((binding) => binding.id === selectedBindingId)) {
        setSelectedBindingId(null);
        setBindingForm(createBindingForm(selectedPlanId ?? ""));
      }

      return { nextPlans, nextNodeGroups, nextBindings };
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "套餐数据加载失败。");
      return null;
    } finally {
      setLoading(false);
    }
  }, [selectedBindingId, selectedPlanId, token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const selectedBinding = useMemo(
    () => bindings.find((binding) => binding.id === selectedBindingId) ?? null,
    [bindings, selectedBindingId],
  );

  const visibleBindings = useMemo(() => {
    if (!selectedPlanId) {
      return bindings;
    }
    return bindings.filter((binding) => binding.planId === selectedPlanId);
  }, [bindings, selectedPlanId]);

  const activeBindingPlanId = bindingForm.planId || selectedPlanId || "";
  const bindingDraftPlanId = selectedPlanId || "";

  const bindingDraftDefault = useMemo(
    () => createBindingForm(bindingDraftPlanId, getNextBindingPriority(bindings, bindingDraftPlanId)),
    [bindingDraftPlanId, bindings],
  );

  const originalPlanForm = useMemo(
    () => (selectedPlan ? createPlanForm(selectedPlan) : createEmptyPlan()),
    [selectedPlan],
  );

  const originalBindingForm = useMemo(
    () => (selectedBinding ? createBindingEditForm(selectedBinding) : bindingDraftDefault),
    [bindingDraftDefault, selectedBinding],
  );

  const planDirty = !formsMatch(planForm, originalPlanForm);
  const bindingDirty = !formsMatch(bindingForm, originalBindingForm);
  const dirtyDraftCount = Number(planDirty) + Number(bindingDirty);
  const hasDirtyChanges = dirtyDraftCount > 0;

  const duplicateBinding = useMemo(
    () =>
      bindings.some(
        (binding) =>
          binding.planId === bindingForm.planId &&
          binding.nodeGroupId === bindingForm.nodeGroupId &&
          binding.id !== selectedBindingId,
      ),
    [bindingForm.nodeGroupId, bindingForm.planId, bindings, selectedBindingId],
  );

  const planSubmitDisabled =
    planSaving ||
    !planForm.slug.trim() ||
    !planForm.name.trim() ||
    planForm.trafficBytes < 1 ||
    planForm.durationDays < 1 ||
    planForm.speedUpMbps < 1 ||
    planForm.speedDownMbps < 1 ||
    planForm.deviceLimit < 1 ||
    planForm.priceCents < 0 ||
    (selectedPlan ? !planDirty : false);

  const bindingSubmitDisabled =
    bindingSaving ||
    !bindingForm.planId ||
    !bindingForm.nodeGroupId ||
    duplicateBinding ||
    (selectedBinding ? !bindingDirty : false);

  const clearPendingAction = useCallback(() => {
    pendingActionRef.current = null;
    setPendingAction(null);
  }, []);

  const requestGuardedAction = useCallback(
    (
      input: {
        actionLabel: string;
        affectsPlan?: boolean;
        affectsBinding?: boolean;
        message?: string;
      },
      action: () => void,
    ) => {
      const affectsPlan = input.affectsPlan ?? false;
      const affectsBinding = input.affectsBinding ?? false;
      const shouldGuard = (affectsPlan && planDirty) || (affectsBinding && bindingDirty);

      if (!shouldGuard) {
        clearPendingAction();
        action();
        return;
      }

      pendingActionRef.current = action;
      setPendingAction({
        actionLabel: input.actionLabel,
        affectsPlan,
        affectsBinding,
        message:
          input.message ??
          `${input.actionLabel}会丢弃${describeDirtyScope(affectsPlan, affectsBinding)}。确认继续吗？`,
      });
      setFeedback(null);
    },
    [bindingDirty, clearPendingAction, planDirty],
  );

  const applyBeginCreatePlan = useCallback(() => {
    setSelectedPlanId(null);
    setSelectedBindingId(null);
    setPlanForm(createEmptyPlan());
    setBindingForm(createBindingForm());
    setFeedback(null);
  }, []);

  const applyBeginCreateBinding = useCallback(
    (planId = activeBindingPlanId) => {
      setSelectedBindingId(null);
      setBindingForm(createBindingForm(planId, getNextBindingPriority(bindings, planId)));
      setFeedback(null);
    },
    [activeBindingPlanId, bindings],
  );

  const applySelectPlan = useCallback(
    (plan: PlanRecord | null) => {
      if (!plan) {
        applyBeginCreatePlan();
        return;
      }

      setSelectedPlanId(plan.id);
      setPlanForm(createPlanForm(plan));

      if (!selectedBinding || selectedBinding.planId !== plan.id) {
        setSelectedBindingId(null);
        setBindingForm(createBindingForm(plan.id, getNextBindingPriority(bindings, plan.id)));
      }

      setFeedback(null);
    },
    [applyBeginCreatePlan, bindings, selectedBinding],
  );

  const applySelectBinding = useCallback(
    (binding: PlanBindingRecord | null) => {
      if (!binding) {
        applyBeginCreateBinding();
        return;
      }

      const plan = plans.find((item) => item.id === binding.planId) ?? null;
      if (plan) {
        setSelectedPlanId(plan.id);
        setPlanForm(createPlanForm(plan));
      }
      setSelectedBindingId(binding.id);
      setBindingForm(createBindingEditForm(binding));
      setFeedback(null);
    },
    [applyBeginCreateBinding, plans],
  );

  useEffect(() => {
    if (!hasDirtyChanges) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") {
        return;
      }

      const currentUrl = new URL(window.location.href);
      const nextUrl = new URL(anchor.href, window.location.href);

      if (
        currentUrl.pathname === nextUrl.pathname &&
        currentUrl.search === nextUrl.search &&
        currentUrl.hash === nextUrl.hash
      ) {
        return;
      }

      event.preventDefault();
      requestGuardedAction(
        {
          actionLabel: "离开套餐页",
          affectsPlan: true,
          affectsBinding: true,
          message: "离开套餐页会丢弃当前未保存的套餐或绑定草稿。确认继续吗？",
        },
        () => {
          window.location.assign(nextUrl.toString());
        },
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [clearPendingAction, hasDirtyChanges, requestGuardedAction]);

  function beginCreatePlan() {
    requestGuardedAction(
      {
        actionLabel: "切到新建套餐",
        affectsPlan: true,
        affectsBinding: true,
      },
      () => applyBeginCreatePlan(),
    );
  }

  function beginCreateBinding(planId = activeBindingPlanId) {
    requestGuardedAction(
      {
        actionLabel: "切到新建绑定",
        affectsBinding: true,
      },
      () => applyBeginCreateBinding(planId),
    );
  }

  function restoreCurrentPlan() {
    setPlanForm(originalPlanForm);
    clearPendingAction();
    setFeedback(selectedPlan ? "已恢复当前套餐记录。" : "已清空套餐草稿。");
  }

  function restoreCurrentBinding() {
    setBindingForm(originalBindingForm);
    clearPendingAction();
    setFeedback(selectedBinding ? "已恢复当前绑定记录。" : "已清空绑定草稿。");
  }

  function confirmPendingAction() {
    const action = pendingActionRef.current;
    clearPendingAction();
    action?.();
  }

  function keepEditing() {
    clearPendingAction();
  }

  function restorePendingDrafts() {
    if (pendingAction?.affectsPlan) {
      setPlanForm(originalPlanForm);
    }
    if (pendingAction?.affectsBinding) {
      setBindingForm(originalBindingForm);
    }
    clearPendingAction();
    setFeedback("已恢复当前记录，可以继续编辑。");
  }

  function selectPlan(plan: PlanRecord | null) {
    if (!plan) {
      beginCreatePlan();
      return;
    }

    requestGuardedAction(
      {
        actionLabel: `切换到套餐「${plan.name}」`,
        affectsPlan: true,
        affectsBinding: true,
      },
      () => applySelectPlan(plan),
    );
  }

  function selectBinding(binding: PlanBindingRecord | null) {
    if (!binding) {
      beginCreateBinding();
      return;
    }

    requestGuardedAction(
      {
        actionLabel: `切换到绑定「${binding.planName} / ${binding.nodeGroupName}」`,
        affectsPlan: true,
        affectsBinding: true,
      },
      () => applySelectBinding(binding),
    );
  }

  function changeBindingPlan(nextPlanId: string) {
    requestGuardedAction(
      {
        actionLabel: "切换绑定目标套餐",
        affectsBinding: true,
      },
      () => {
        setSelectedBindingId(null);
        setBindingForm(createBindingForm(nextPlanId, getNextBindingPriority(bindings, nextPlanId)));
        setFeedback(null);
      },
    );
  }

  async function handlePlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    clearPendingAction();
    setPlanSaving(true);
    setError(null);
    setFeedback(null);

    try {
      const payload = {
        ...planForm,
        slug: planForm.slug.trim(),
        name: planForm.name.trim(),
        description: planForm.description.trim(),
        accent: planForm.accent.trim() || "green",
      };

      const savedPlan = selectedPlan
        ? await apiRequest<PlanRecord>(`/api/admin/plans/${selectedPlan.id}`, {
            method: "PATCH",
            token,
            body: payload,
          })
        : await apiRequest<PlanRecord>("/api/admin/plans", {
            method: "POST",
            token,
            body: payload,
          });

      setSelectedPlanId(savedPlan.id);
      setPlanForm(createPlanForm(savedPlan));
      setFeedback(selectedPlan ? "套餐已更新。" : "套餐已创建。");

      if (!selectedBinding || selectedBinding.planId !== savedPlan.id) {
        applyBeginCreateBinding(savedPlan.id);
      }

      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存套餐失败。");
    } finally {
      setPlanSaving(false);
    }
  }

  async function handleBindingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    clearPendingAction();
    setBindingSaving(true);
    setError(null);
    setFeedback(null);

    try {
      const savedBinding = selectedBinding
        ? await apiRequest<PlanBindingRecord>(`/api/admin/plan-bindings/${selectedBinding.id}`, {
            method: "PATCH",
            token,
            body: {
              nodeGroupId: bindingForm.nodeGroupId,
              priority: bindingForm.priority,
            },
          })
        : await apiRequest<PlanBindingRecord>("/api/admin/plan-bindings", {
            method: "POST",
            token,
            body: bindingForm,
          });

      setSelectedPlanId(savedBinding.planId);
      setSelectedBindingId(savedBinding.id);
      setBindingForm(createBindingEditForm(savedBinding));
      setFeedback(selectedBinding ? "套餐绑定已更新。" : "套餐绑定已创建。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存套餐绑定失败。");
    } finally {
      setBindingSaving(false);
    }
  }

  return (
    <ConsoleShell
      title="套餐管理"
      subtitle="控制套餐配额、速率、设备数，并把节点组绑定关系也整理清楚。"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <>
          <span className="badge info">
            {loading ? "加载中..." : `${plans.length} 个套餐 / ${bindings.length} 条绑定`}
          </span>
          {hasDirtyChanges ? <span className="badge warn">{dirtyDraftCount} 处未保存改动</span> : null}
        </>
      }
      toolbarActions={
        <button className="toolbar-button" type="button" onClick={() => void load()}>
          刷新
        </button>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      {hasDirtyChanges && !pendingAction ? (
        <div className="feedback info">当前有未保存改动，切换套餐、切换绑定或离开页面前会先要求确认。</div>
      ) : null}
      {pendingAction ? (
        <div className="feedback warn">
          <div>{pendingAction.message}</div>
          <div className="panel-actions">
            <button className="action-button" type="button" onClick={confirmPendingAction}>
              {pendingAction.actionLabel}
            </button>
            <button className="ghost-button" type="button" onClick={keepEditing}>
              继续编辑
            </button>
            <button className="ghost-button" type="button" onClick={restorePendingDrafts}>
              先恢复当前记录
            </button>
          </div>
        </div>
      ) : null}

      <section className="workspace-grid">
        <Panel
          title="套餐列表"
          copy="点一行进入编辑态；切换记录前若有草稿，会先要求确认而不是直接冲掉。"
          action={
            <div className="panel-actions">
              {selectedPlan ? (
                <button className="ghost-button compact" type="button" onClick={beginCreatePlan}>
                  新建套餐
                </button>
              ) : null}
              <span className="fine-print">{loading ? "同步中..." : `${plans.length} 条`}</span>
            </div>
          }
        >
          <DataTable
            headers={["套餐", "配额", "速率", "设备数", "价格", "节点组"]}
            rows={plans.map((plan) => [
              <button
                key={plan.id}
                type="button"
                className={`link-button${selectedPlanId === plan.id ? " active" : ""}`}
                onClick={() => selectPlan(plan)}
              >
                <span>{plan.name}</span>
                <span className="muted">
                  {plan.slug} · {plan.active ? "启用中" : "已停用"}
                </span>
              </button>,
              formatBytes(plan.trafficBytes),
              `${plan.speedUpMbps} / ${plan.speedDownMbps} Mbps`,
              `${plan.deviceLimit} 台`,
              formatMoney(plan.priceCents),
              plan.boundNodeGroups.join(" / ") || "未绑定",
            ])}
          />
        </Panel>

        <div className="split">
          <Panel
            title={selectedPlan ? "编辑套餐" : "新建套餐"}
            copy="套餐本身决定订阅创建时继承的流量、速率、周期和设备上限。"
            action={
              selectedPlan ? (
                <span className={`badge ${planDirty ? "warn" : "success"}`}>
                  {planDirty ? "有未保存改动" : "已同步"}
                </span>
              ) : planDirty ? (
                <span className="badge warn">新建草稿未保存</span>
              ) : (
                <span className="badge info">新建草稿</span>
              )
            }
          >
            <div className="usage-grid">
              <article className="metric-card">
                <span className="metric-label">套餐配额</span>
                <strong>{formatBytes(planForm.trafficBytes)}</strong>
                <span className="metric-footnote">订阅创建后会复制到快照里</span>
              </article>
              <article className="metric-card">
                <span className="metric-label">速率快照</span>
                <strong>
                  {planForm.speedUpMbps} / {planForm.speedDownMbps} Mbps
                </strong>
                <span className="metric-footnote">{planForm.deviceLimit} 台并发设备</span>
              </article>
              <article className="metric-card">
                <span className="metric-label">账单节奏</span>
                <strong>{formatMoney(planForm.priceCents)}</strong>
                <span className="metric-footnote">{planForm.durationDays} 天一个周期</span>
              </article>
            </div>

            <form className="form-grid" onSubmit={handlePlanSubmit}>
              <div className="two-col">
                <label className="field">
                  <span className="fine-print">Slug</span>
                  <input
                    className="control"
                    value={planForm.slug}
                    onChange={(event) =>
                      setPlanForm((current) => ({ ...current, slug: slugifyValue(event.target.value) }))
                    }
                  />
                  <span className="field-hint">建议使用小写短横线，如 `core-200`。</span>
                </label>
                <label className="field">
                  <span className="fine-print">套餐名</span>
                  <input
                    className="control"
                    value={planForm.name}
                    onChange={(event) =>
                      setPlanForm((current) => {
                        const nextName = event.target.value;
                        const derivedSlug = slugifyValue(current.name);
                        const shouldSyncSlug =
                          !selectedPlan && (!current.slug || current.slug === derivedSlug);

                        return {
                          ...current,
                          name: nextName,
                          slug: shouldSyncSlug ? slugifyValue(nextName) : current.slug,
                        };
                      })
                    }
                  />
                </label>
              </div>

              <label className="field">
                <span className="fine-print">描述</span>
                <textarea
                  className="control textarea"
                  value={planForm.description}
                  onChange={(event) =>
                    setPlanForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </label>

              <div className="tri-grid">
                <label className="field">
                  <span className="fine-print">流量字节数</span>
                  <input
                    className="control"
                    type="number"
                    value={planForm.trafficBytes}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        trafficBytes: Number(event.target.value),
                      }))
                    }
                  />
                  <span className="field-hint">约 {formatBytes(planForm.trafficBytes || 0)}</span>
                </label>
                <label className="field">
                  <span className="fine-print">上行 Mbps</span>
                  <input
                    className="control"
                    type="number"
                    value={planForm.speedUpMbps}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        speedUpMbps: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">下行 Mbps</span>
                  <input
                    className="control"
                    type="number"
                    value={planForm.speedDownMbps}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        speedDownMbps: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">设备数</span>
                  <input
                    className="control"
                    type="number"
                    value={planForm.deviceLimit}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        deviceLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">周期天数</span>
                  <input
                    className="control"
                    type="number"
                    value={planForm.durationDays}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        durationDays: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">价格（分）</span>
                  <input
                    className="control"
                    type="number"
                    value={planForm.priceCents}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        priceCents: Number(event.target.value),
                      }))
                    }
                  />
                  <span className="field-hint">{formatMoney(planForm.priceCents || 0)}</span>
                </label>
              </div>

              <div className="two-col">
                <label className="field">
                  <span className="fine-print">Accent</span>
                  <input
                    className="control"
                    value={planForm.accent}
                    onChange={(event) =>
                      setPlanForm((current) => ({ ...current, accent: event.target.value }))
                    }
                  />
                  <span className="field-hint">例如 green、teal、orange，用于界面语义点缀。</span>
                </label>
                <label className="field checkbox-row">
                  <input
                    type="checkbox"
                    checked={planForm.active}
                    onChange={(event) =>
                      setPlanForm((current) => ({ ...current, active: event.target.checked }))
                    }
                  />
                  <span>启用该套餐</span>
                </label>
              </div>

              <div className="toolbar-actions">
                <button className="action-button" type="submit" disabled={planSubmitDisabled}>
                  {planSaving ? "保存中..." : selectedPlan ? "保存套餐" : "创建套餐"}
                </button>
                <button className="ghost-button" type="button" onClick={restoreCurrentPlan} disabled={!planDirty}>
                  {selectedPlan ? "恢复当前记录" : "清空草稿"}
                </button>
                {selectedPlan ? (
                  <button className="ghost-button" type="button" onClick={beginCreatePlan}>
                    切到新建
                  </button>
                ) : null}
              </div>
            </form>
          </Panel>

          <Panel
            title={selectedBinding ? "编辑套餐绑定" : "套餐节点组绑定"}
            copy="绑定优先级越小，订阅创建时越容易被自动选作默认节点组。"
            action={
              <div className="panel-actions">
                {selectedBinding ? (
                  <button className="ghost-button compact" type="button" onClick={() => beginCreateBinding()}>
                    新建绑定
                  </button>
                ) : null}
                {selectedBinding ? (
                  <span className={`badge ${bindingDirty ? "warn" : "success"}`}>
                    {bindingDirty ? "有未保存改动" : "已同步"}
                  </span>
                ) : bindingDirty ? (
                  <span className="badge warn">绑定草稿未保存</span>
                ) : activeBindingPlanId ? (
                  <span className="badge info">
                    当前套餐：{plans.find((plan) => plan.id === activeBindingPlanId)?.name ?? "未选择"}
                  </span>
                ) : (
                  <span className="badge">先选一个套餐</span>
                )}
              </div>
            }
          >
            <form className="form-grid" onSubmit={handleBindingSubmit}>
              <label className="field">
                <span className="fine-print">套餐</span>
                <select
                  className="control"
                  value={bindingForm.planId}
                  onChange={(event) => changeBindingPlan(event.target.value)}
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
                <span className="fine-print">节点组</span>
                <select
                  className="control"
                  value={bindingForm.nodeGroupId}
                  onChange={(event) =>
                    setBindingForm((current) => ({ ...current, nodeGroupId: event.target.value }))
                  }
                >
                  <option value="">请选择节点组</option>
                  {nodeGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                {duplicateBinding ? (
                  <span className="field-hint">同一套餐不能重复绑定同一节点组。</span>
                ) : (
                  <span className="field-hint">
                    新绑定默认排在 {bindingDraftDefault.priority} 优先级，可再微调。
                  </span>
                )}
              </label>

              <label className="field">
                <span className="fine-print">优先级</span>
                <input
                  className="control"
                  type="number"
                  value={bindingForm.priority}
                  onChange={(event) =>
                    setBindingForm((current) => ({
                      ...current,
                      priority: Number(event.target.value),
                    }))
                  }
                />
              </label>

              <div className="toolbar-actions">
                <button className="action-button" type="submit" disabled={bindingSubmitDisabled}>
                  {bindingSaving ? "保存中..." : selectedBinding ? "保存绑定" : "添加绑定"}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={restoreCurrentBinding}
                  disabled={!bindingDirty}
                >
                  {selectedBinding ? "恢复当前记录" : "清空草稿"}
                </button>
                {selectedBinding ? (
                  <button className="ghost-button" type="button" onClick={() => beginCreateBinding()}>
                    切到新建
                  </button>
                ) : null}
              </div>
            </form>

            {visibleBindings.length === 0 ? (
              <div className="feedback info">当前套餐还没有绑定任何节点组，订阅创建时将无法自动分配入口。</div>
            ) : null}

            <DataTable
              headers={["套餐 / 节点组", "优先级", "创建时间"]}
              rows={visibleBindings.map((binding) => [
                <button
                  key={binding.id}
                  type="button"
                  className={`link-button${selectedBindingId === binding.id ? " active" : ""}`}
                  onClick={() => selectBinding(binding)}
                >
                  <span>{binding.planName}</span>
                  <span className="muted">{binding.nodeGroupName}</span>
                </button>,
                String(binding.priority),
                binding.createdAt.slice(0, 10),
              ])}
            />
          </Panel>
        </div>
      </section>
    </ConsoleShell>
  );
}
