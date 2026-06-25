"use client";

import Image from "next/image";
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
import { copyToClipboard } from "@/lib/clipboard";
import { Toast, useToast } from "@/components/toast";
import type {
  AdminCreateUserResponse,
  AdminUser,
  AdminUserAccessResponse,
  PlanRecord,
  SubscriptionRecord,
  UsageRollupRecord,
} from "@/lib/types";

const UNLIMITED_TRAFFIC = Number.MAX_SAFE_INTEGER;
import { statusTone } from "@/lib/ui";

const DRAFT_KEY = "user";
type Feedback = { msg: string; kind: "success" | "error" };

type UserFormState = {
  email: string;
  displayName: string;
  password: string;
  role: "admin" | "member";
  status: "active" | "suspended" | "banned";
  notes: string;
};

type ProvisionState = {
  enabled: boolean;
  planId: string;
  nodeId: string;
};

type DeliveryState = {
  userId: string;
  displayName: string;
  email: string;
  primaryAccessToken?: string | null;
  access?: AdminUserAccessResponse | null;
};

const emptyForm: UserFormState = {
  email: "",
  displayName: "",
  password: "",
  role: "member",
  status: "active",
  notes: "",
};

function createProvisionState(plans: PlanRecord[], role: UserFormState["role"]): ProvisionState {
  const fallbackPlan =
    plans.find((plan) => plan.active && plan.bindings.length > 0) ??
    plans.find((plan) => plan.bindings.length > 0) ??
    null;

  return {
    enabled: role === "member" && Boolean(fallbackPlan),
    planId: fallbackPlan?.id ?? "",
    nodeId: fallbackPlan?.bindings[0]?.nodeId ?? "",
  };
}

function normalizeProvisionState(
  current: ProvisionState,
  plans: PlanRecord[],
  role: UserFormState["role"],
): ProvisionState {
  const defaults = createProvisionState(plans, role);
  if (role !== "member") {
    return { ...defaults, enabled: false };
  }

  if (!defaults.planId) {
    return defaults;
  }

  const selectedPlan =
    plans.find((plan) => plan.id === current.planId && plan.bindings.length > 0) ??
    plans.find((plan) => plan.id === defaults.planId) ??
    null;

  if (!selectedPlan) {
    return defaults;
  }

  const allowedNodeIds = selectedPlan.bindings.map((binding) => binding.nodeId);

  return {
    enabled: current.enabled,
    planId: selectedPlan.id,
    nodeId: allowedNodeIds.includes(current.nodeId)
      ? current.nodeId
      : allowedNodeIds[0] ?? "",
  };
}

export default function AdminUsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const [hasDraftBanner, setHasDraftBanner] = useState(false);
  const [provision, setProvision] = useState<ProvisionState>(() =>
    createProvisionState([], "member"),
  );
  const [delivery, setDelivery] = useState<DeliveryState | null>(null);
  const [loadingDelivery, setLoadingDelivery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  const [statsDrawerOpen, setStatsDrawerOpen] = useState(false);
  const [statsUser, setStatsUser] = useState<AdminUser | null>(null);
  const [statsSubscription, setStatsSubscription] = useState<SubscriptionRecord | null>(null);
  const [statsUsage, setStatsUsage] = useState<UsageRollupRecord[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);

  const syncProvisionForDraft = useCallback(
    (nextRole: UserFormState["role"], nextPlans: PlanRecord[]) => {
      setProvision((current) => {
        const next = normalizeProvisionState(current, nextPlans, nextRole);
        return JSON.stringify(next) === JSON.stringify(current) ? current : next;
      });
    },
    [],
  );

  const load = useCallback(async () => {
    if (!token) return null;
    setLoading(true);
    try {
      const [nextUsers, nextPlans] = await Promise.all([
        apiRequest<AdminUser[]>("/api/admin/users", { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
      ]);
      setUsers(nextUsers);
      setPlans(nextPlans);
      if (!editingUser) {
        syncProvisionForDraft(form.role, nextPlans);
      }
      return { nextUsers, nextPlans };
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [editingUser, form.role, syncProvisionForDraft, token]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === provision.planId) ?? null,
    [plans, provision.planId],
  );
  const availableBindings = selectedPlan?.bindings ?? [];
  const provisioningEnabled = !editingUser && form.role === "member" && provision.enabled;
  const provisioningBlocked = provisioningEnabled && availableBindings.length === 0;
  const submitDisabled =
    submitting ||
    !form.email.trim() ||
    !form.displayName.trim() ||
    (!editingUser && !form.password.trim()) ||
    provisioningBlocked ||
    (provisioningEnabled && !provision.planId);

  const isDirty = useMemo(() => {
    if (!drawerOpen) return false;
    if (editingUser) {
      const orig: UserFormState = {
        email: editingUser.email,
        displayName: editingUser.displayName,
        password: "",
        role: editingUser.role,
        status: editingUser.status,
        notes: editingUser.notes ?? "",
      };
      return JSON.stringify(form) !== JSON.stringify(orig);
    }
    return JSON.stringify(form) !== JSON.stringify(emptyForm);
  }, [drawerOpen, editingUser, form]);

  function requestClose() {
    if (isDirty && !window.confirm("有未保存的改动，关闭后将丢失。确定关闭？")) return;
    forceClose();
  }

  function forceClose() {
    setDrawerOpen(false);
    setEditingUser(null);
    setDrawerError(null);
    setHasDraftBanner(false);
  }

  function openCreate() {
    const draft = getDraft<UserFormState>(DRAFT_KEY);
    if (draft) {
      setForm(draft);
      setHasDraftBanner(true);
    } else {
      setForm(emptyForm);
      setHasDraftBanner(false);
    }
    setEditingUser(null);
    setProvision(createProvisionState(plans, "member"));
    setDelivery(null);
    setDeliveryError(null);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function openEdit(user: AdminUser) {
    setEditingUser(user);
    setForm({
      email: user.email,
      displayName: user.displayName,
      password: "",
      role: user.role,
      status: user.status,
      notes: user.notes ?? "",
    });
    setShowPassword(false);
    setHasDraftBanner(false);
    setDelivery(null);
    setDeliveryError(null);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function discardDraft() {
    clearDraft(DRAFT_KEY);
    setForm(emptyForm);
    setHasDraftBanner(false);
  }

  function handleProvisionPlanChange(nextPlanId: string) {
    const nextPlan = plans.find((plan) => plan.id === nextPlanId) ?? null;
    setProvision((current) => ({
      ...current,
      planId: nextPlanId,
      nodeId: nextPlan?.bindings[0]?.nodeId ?? "",
    }));
  }

  async function copyText(value: string) {
    try {
      await copyToClipboard(value);
      showToast("已复制到剪贴板");
    } catch {
      showToast("复制失败，请手动复制", "error");
    }
  }

  async function openStats(user: AdminUser) {
    setStatsUser(user);
    setStatsDrawerOpen(true);
    setStatsSubscription(null);
    setStatsUsage([]);
    if (!token) return;
    setLoadingStats(true);
    try {
      const [sub, usage] = await Promise.all([
        apiRequest<SubscriptionRecord | null>(`/api/admin/users/${user.id}/subscription`, { token }),
        apiRequest<UsageRollupRecord[]>(`/api/admin/users/${user.id}/usage`, { token }),
      ]);
      setStatsSubscription(sub);
      setStatsUsage(usage);
    } catch {
      // keep empty
    } finally {
      setLoadingStats(false);
    }
  }

  async function loadAccess(user: AdminUser) {
    if (!token || user.role !== "member") return;
    setLoadingDelivery(true);
    setDeliveryError(null);
    setFeedback(null);
    try {
      const access = await apiRequest<AdminUserAccessResponse>(
        `/api/admin/users/${user.id}/access`,
        { token },
      );
      setDelivery({ userId: user.id, displayName: user.displayName, email: user.email, access });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setDelivery({ userId: user.id, displayName: user.displayName, email: user.email, access: null });
        setDeliveryError("当前用户还没有生效中的订阅，开通套餐后这里会生成专属链接。");
      } else {
        setDeliveryError(cause instanceof ApiError ? cause.message : "接入信息加载失败。");
      }
    } finally {
      setLoadingDelivery(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setDrawerError(null);
    setFeedback(null);
    try {
      if (editingUser) {
        const updated = await apiRequest<AdminUser>(`/api/admin/users/${editingUser.id}`, {
          method: "PATCH",
          token,
          body: {
            displayName: form.displayName,
            password: form.password || undefined,
            role: form.role,
            status: form.status,
            notes: form.notes || undefined,
          },
        });
        setEditingUser(updated);
        setFeedback({ msg: "用户信息已更新。", kind: "success" });
        await load();
      } else {
        const created = await apiRequest<AdminCreateUserResponse>("/api/admin/users", {
          method: "POST",
          token,
          body: {
            ...form,
            initialPlanId: provisioningEnabled ? provision.planId : undefined,
            initialNodeId:
              provisioningEnabled && provision.nodeId ? provision.nodeId : undefined,
          },
        });
        setDelivery({
          userId: created.id,
          displayName: created.displayName,
          email: created.email,
          primaryAccessToken: created.primaryAccessToken ?? null,
          access: created.provisionedAccess ?? null,
        });
        if (!created.provisionedAccess) {
          setDeliveryError("当前仅完成账号签发。开通有效订阅后，这里会自动生成专属链接和二维码。");
        }
        clearDraft(DRAFT_KEY);
        setFeedback({
          msg: created.provisionedAccess
            ? "用户已创建，套餐已开通，专属接入信息已生成。"
            : created.primaryAccessToken
              ? "用户已创建，主访问令牌已签发。"
              : "用户已创建。",
          kind: "success",
        });
        const refreshed = await load();
        const createdUser =
          refreshed?.nextUsers.find((u) => u.id === created.id) ?? null;
        if (createdUser) {
          setEditingUser(createdUser);
          setForm({
            email: createdUser.email,
            displayName: createdUser.displayName,
            password: "",
            role: createdUser.role,
            status: createdUser.status,
            notes: createdUser.notes ?? "",
          });
        }
      }
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "保存用户失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleKick(userId: string) {
    if (!token) return;
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/users/${userId}/kick`, { method: "POST", token });
      setFeedback({ msg: "踢线请求已发送。", kind: "success" });
    } catch (cause) {
      setFeedback({ msg: cause instanceof ApiError ? cause.message : "踢线失败。", kind: "error" });
    }
  }

  return (
    <ConsoleShell
      title="用户管理"
      subtitle="建档、开通会员接入、签发专属链接与二维码都集中在这一页完成"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">{loading ? "加载中..." : `${users.length} 个用户`}</span>
      }
      toolbarActions={
        <>
          <button className="action-button" type="button" onClick={openCreate}>
            新建用户
          </button>
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
        </>
      }
    >
      <Toast toast={toast} />
      {feedback ? <div className={`feedback ${feedback.kind}`}>{feedback.msg}</div> : null}

      <Panel
        title="账号列表"
        copy="点击行编辑用户；创建会员时可顺手开通首个套餐并交付专属 URI。"
        action={<span className="fine-print">{loading ? "同步中..." : `${users.length} 条`}</span>}
      >
        {loading && users.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}
        {users.length > 0 ? (
          <DataTable
            headers={["用户", "角色", "状态", "访问令牌", "最近使用", "操作"]}
            rows={users.map((user) => [
              <button
                key={`${user.id}-select`}
                type="button"
                className="link-button"
                onClick={() => openEdit(user)}
              >
                <span>{user.displayName}</span>
                <span className="muted">{user.email}</span>
              </button>,
              user.role,
              <span key={`${user.id}-status`} className={`badge ${statusTone(user.status)}`}>
                {user.status}
              </span>,
              <span className="mono" key={`${user.id}-token`}>
                {user.primaryAccessTokenPreview ?? "未签发"}
              </span>,
              user.primaryAccessTokenLastUsedAt
                ? formatDateTime(user.primaryAccessTokenLastUsedAt)
                : "从未使用",
              <div key={`${user.id}-action`} className="table-actions">
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => void openStats(user)}
                >
                  流量
                </button>
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => void handleKick(user.id)}
                >
                  踢线
                </button>
              </div>,
            ])}
          />
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">👤</div>
            <div className="empty-state-title">还没有用户</div>
            <button className="action-button" type="button" onClick={openCreate}>
              新建第一个用户
            </button>
          </div>
        ) : null}
      </Panel>

      {delivery?.access ? (
        <Panel
          title="接入交付"
          copy="专属链接和二维码，直接复制给会员。"
          action={
            editingUser && editingUser.role === "member" ? (
              <button
                className="ghost-button compact"
                type="button"
                onClick={() => void loadAccess(editingUser)}
                disabled={loadingDelivery}
              >
                {loadingDelivery ? "读取中..." : "刷新接入信息"}
              </button>
            ) : null
          }
        >
          {deliveryError ? <div className="feedback warn">{deliveryError}</div> : null}
          <div className="page-stack">
            <div className="split">
              <div>
                <strong>{delivery.displayName}</strong>
                <div className="fine-print">{delivery.email}</div>
              </div>
              <span className="badge success">{delivery.access.nodeLabel}</span>
            </div>
            <div className="two-col">
              <div className="qr-card">
                <Image
                  src={delivery.access.qrCode}
                  alt={`${delivery.displayName} access qr`}
                  className="qr-image"
                  width={240}
                  height={240}
                  unoptimized
                />
              </div>
              <div className="page-stack">
                <label className="field">
                  <span className="fine-print">访问令牌</span>
                  <input className="control mono" value={delivery.access.token} readOnly />
                </label>
                <label className="field">
                  <span className="fine-print">连接 URI</span>
                  <textarea className="control textarea mono" value={delivery.access.uri} readOnly />
                </label>
                <div className="toolbar-actions">
                  <button
                    className="action-button"
                    type="button"
                    onClick={() => void copyText(delivery.access!.uri)}
                  >
                    复制 URI
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void copyText(delivery.access!.configSnippet)}
                  >
                    复制配置片段
                  </button>
                </div>
              </div>
            </div>
            <div className="two-col">
              <div className="kpi-list">
                <div className="list-row">
                  <span className="muted">到期时间</span>
                  <strong>{formatDateTime(delivery.access.expiresAt)}</strong>
                </div>
                <div className="list-row">
                  <span className="muted">剩余流量</span>
                  <strong>{formatBytes(delivery.access.trafficRemaining)}</strong>
                </div>
                <div className="list-row">
                  <span className="muted">推荐节点</span>
                  <strong>{delivery.access.nodeLabel}</strong>
                </div>
              </div>
              <div className="code-card">
                <pre>{delivery.access.configSnippet}</pre>
              </div>
            </div>
          </div>
        </Panel>
      ) : delivery?.primaryAccessToken ? (
        <Panel title="接入交付" copy="主访问令牌，转交给会员。">
          {deliveryError ? <div className="feedback warn">{deliveryError}</div> : null}
          <div className="page-stack">
            <div className="split">
              <div>
                <strong>{delivery.displayName}</strong>
                <div className="fine-print">{delivery.email}</div>
              </div>
              <span className="badge info">token only</span>
            </div>
            <label className="field">
              <span className="fine-print">主访问令牌</span>
              <input className="control mono" value={delivery.primaryAccessToken} readOnly />
            </label>
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="button"
                onClick={() => void copyText(delivery.primaryAccessToken ?? "")}
              >
                复制令牌
              </button>
            </div>
          </div>
        </Panel>
      ) : null}

      <Drawer
        open={drawerOpen}
        onClose={requestClose}
        title={editingUser ? `编辑用户：${editingUser.displayName}` : "新建用户"}
        subtitle={editingUser?.email}
        isDirty={isDirty}
        footer={
          <div className="toolbar-actions">
            <button className="action-button" type="submit" form="user-form" disabled={submitDisabled}>
              {submitting ? "保存中..." : editingUser ? "保存修改" : "创建用户"}
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

        <form id="user-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span className="fine-print">邮箱</span>
            <input
              className="control"
              value={form.email}
              disabled={Boolean(editingUser)}
              onChange={(e) => setForm((f) => { const n = { ...f, email: e.target.value }; if (!editingUser) saveDraft(DRAFT_KEY, n); return n; })}
              required
            />
          </label>

          <label className="field">
            <span className="fine-print">显示名</span>
            <input
              className="control"
              value={form.displayName}
              onChange={(e) => setForm((f) => { const n = { ...f, displayName: e.target.value }; if (!editingUser) saveDraft(DRAFT_KEY, n); return n; })}
              required
            />
          </label>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">角色</span>
              <CustomSelect
                value={form.role}
                onChange={(v) => {
                  const nextRole = v as "admin" | "member";
                  setForm((f) => ({ ...f, role: nextRole }));
                  if (!editingUser) syncProvisionForDraft(nextRole, plans);
                }}
                options={[
                  { value: "member", label: "member" },
                  { value: "admin", label: "admin" },
                ]}
              />
            </label>

            <label className="field">
              <span className="fine-print">状态</span>
              <CustomSelect
                value={form.status}
                onChange={(v) => setForm((f) => ({ ...f, status: v as UserFormState["status"] }))}
                options={[
                  { value: "active", label: "active" },
                  { value: "suspended", label: "suspended" },
                  { value: "banned", label: "banned" },
                ]}
              />
            </label>
          </div>

          {editingUser ? (
            <div className="field">
              <span className="fine-print">当前密码</span>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  className="control mono"
                  type={showPassword ? "text" : "password"}
                  value={editingUser.plainPassword ?? ""}
                  readOnly
                  placeholder={editingUser.plainPassword ? undefined : "未记录"}
                />
                <button
                  type="button"
                  className="ghost-button compact"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </div>
            </div>
          ) : null}

          <label className="field">
            <span className="fine-print">{editingUser ? "重置密码" : "密码"}</span>
            <input
              className="control"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={editingUser ? "输入新密码以重置，留空不改" : "首次登录密码"}
            />
          </label>

          <label className="field">
            <span className="fine-print">备注</span>
            <textarea
              className="control textarea"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>

          {!editingUser ? (
            <div className="page-stack">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={provision.enabled && form.role === "member"}
                  disabled={
                    form.role !== "member" ||
                    !plans.some((plan) => plan.bindings.length > 0)
                  }
                  onChange={(e) =>
                    setProvision((current) => ({ ...current, enabled: e.target.checked }))
                  }
                />
                <span>创建后立即开通套餐并生成专属接入信息</span>
              </label>

              {form.role !== "member" ? (
                <div className="feedback info">管理员账号默认不做会员接入开通。</div>
              ) : null}

              {provision.enabled && form.role === "member" ? (
                <div className="two-col">
                  <label className="field">
                    <span className="fine-print">初始套餐</span>
                    <CustomSelect
                      value={provision.planId}
                      onChange={handleProvisionPlanChange}
                      options={plans
                        .filter((p) => p.bindings.length > 0)
                        .map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </label>

                  <label className="field">
                    <span className="fine-print">节点</span>
                    <CustomSelect
                      value={provision.nodeId}
                      onChange={(v) => setProvision((c) => ({ ...c, nodeId: v }))}
                      options={availableBindings.map((b) => ({ value: b.nodeId, label: b.nodeLabel }))}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
        </form>

        {editingUser && editingUser.role === "member" ? (
          <div className="form-grid">
            <div className="field-section-label">接入信息</div>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void loadAccess(editingUser)}
              disabled={loadingDelivery}
            >
              {loadingDelivery ? "读取中..." : "读取当前接入信息"}
            </button>
            {deliveryError ? <div className="feedback warn">{deliveryError}</div> : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={statsDrawerOpen}
        onClose={() => setStatsDrawerOpen(false)}
        title={statsUser ? `流量详情：${statsUser.displayName}` : "流量详情"}
        subtitle={statsUser?.email}
      >
        {loadingStats ? (
          <div className="skeleton-rows">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}
          </div>
        ) : statsSubscription ? (
          <div className="page-stack">
            <div className="kpi-list">
              <div className="list-row">
                <span className="muted">套餐</span>
                <strong>{statsSubscription.planName}</strong>
              </div>
              <div className="list-row">
                <span className="muted">状态</span>
                <span className={`badge ${statsSubscription.status === "active" ? "success" : "warn"}`}>
                  {statsSubscription.status}
                </span>
              </div>
              <div className="list-row">
                <span className="muted">已用流量</span>
                <strong>{formatBytes(statsSubscription.consumedTrafficBytes)}</strong>
              </div>
              <div className="list-row">
                <span className="muted">剩余流量</span>
                <strong>{statsSubscription.trafficRemainingBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(statsSubscription.trafficRemainingBytes)}</strong>
              </div>
              <div className="list-row">
                <span className="muted">总配额</span>
                <strong>{statsSubscription.includedTrafficBytes >= UNLIMITED_TRAFFIC ? "无限流量" : formatBytes(statsSubscription.includedTrafficBytes)}</strong>
              </div>
              <div className="list-row">
                <span className="muted">到期时间</span>
                <strong>{formatDateTime(statsSubscription.endsAt)}</strong>
              </div>
              <div className="list-row">
                <span className="muted">节点</span>
                <strong>{statsSubscription.nodeLabel}</strong>
              </div>
            </div>

            {statsUsage.length > 0 ? (
              <div>
                <div className="fine-print" style={{ marginBottom: 8 }}>最近流量记录</div>
                <DataTable
                  headers={["节点", "上传", "下载", "时间"]}
                  rows={statsUsage.slice(0, 15).map((r) => [
                    r.nodeLabel,
                    formatBytes(r.txBytes),
                    formatBytes(r.rxBytes),
                    formatDateTime(r.bucketStart),
                  ])}
                />
              </div>
            ) : (
              <div className="fine-print">暂无流量记录。</div>
            )}
          </div>
        ) : (
          <div className="fine-print">该用户还没有订阅记录。</div>
        )}
      </Drawer>
    </ConsoleShell>
  );
}
