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
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { Toast, useToast } from "@/components/toast";
import type {
  AdminCreateUserResponse,
  AdminUser,
  AdminUserAccessResponse,
  PaginatedResponse,
  PlanRecord,
  SubscriptionRecord,
  UsageRollupRecord,
  WalletResponse,
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
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const { toast, showToast } = useToast();
  const [statsDrawerOpen, setStatsDrawerOpen] = useState(false);
  const [statsUser, setStatsUser] = useState<AdminUser | null>(null);
  const [statsSubscription, setStatsSubscription] = useState<SubscriptionRecord | null>(null);
  const [statsUsage, setStatsUsage] = useState<UsageRollupRecord[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsWallet, setStatsWallet] = useState<WalletResponse | null>(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [quotaFilter, setQuotaFilter] = useState("");
  const [totalUsers, setTotalUsers] = useState(0);
  const [multiplierInput, setMultiplierInput] = useState("1");
  const [quotaGbInput, setQuotaGbInput] = useState("");
  const [quotaReason, setQuotaReason] = useState("");
  const [savingEntitlement, setSavingEntitlement] = useState(false);

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
      const params = new URLSearchParams({ limit: "200" });
      if (search.trim()) params.set("q", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (roleFilter) params.set("role", roleFilter);
      if (quotaFilter) params.set("quotaState", quotaFilter);
      const [nextUsers, nextPlans] = await Promise.all([
        apiRequest<PaginatedResponse<AdminUser>>(`/api/admin/users?${params}`, { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
      ]);
      setUsers(nextUsers.items);
      setTotalUsers(nextUsers.total);
      setPlans(nextPlans);
      if (!editingUser) {
        syncProvisionForDraft(form.role, nextPlans);
      }
      return { nextUsers: nextUsers.items, nextPlans };
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [editingUser, form.role, quotaFilter, roleFilter, search, statusFilter, syncProvisionForDraft, token]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 250);
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
    setMultiplierInput(String(user.trafficMultiplier ?? 1));
    setQuotaGbInput("");
    setQuotaReason("");
    setStatsDrawerOpen(true);
    setStatsSubscription(null);
    setStatsUsage([]);
    setStatsWallet(null);
    setBalanceInput("");
    if (!token) return;
    setLoadingStats(true);
    try {
      const [sub, usage, wallet] = await Promise.all([
        apiRequest<SubscriptionRecord | null>(`/api/admin/users/${user.id}/subscription`, { token }),
        apiRequest<UsageRollupRecord[]>(`/api/admin/users/${user.id}/usage`, { token }),
        apiRequest<WalletResponse>(`/api/admin/users/${user.id}/wallet`, { token }),
      ]);
      setStatsSubscription(sub);
      setStatsUsage(usage);
      setStatsWallet(wallet);
      setBalanceInput((wallet.balanceCents / 100).toFixed(2));
    } catch {
      // keep empty
    } finally {
      setLoadingStats(false);
    }
  }

  async function saveEntitlementPolicy() {
    if (!token || !statsUser) return;
    const multiplier = Number(multiplierInput);
    if (!Number.isFinite(multiplier) || multiplier < 0.1 || multiplier > 100) {
      showToast("倍率必须在 0.1 到 100 之间。", "error");
      return;
    }
    setSavingEntitlement(true);
    try {
      await apiRequest(`/api/admin/access-accounts/${statsUser.id}/policy`, {
        method: "PATCH",
        token,
        body: { trafficMultiplier: multiplier },
      });
      if (statsSubscription && quotaGbInput.trim()) {
        const remainingBytes = Math.round(Number(quotaGbInput) * 1024 * 1024 * 1024);
        if (!Number.isSafeInteger(remainingBytes) || remainingBytes < 0 || quotaReason.trim().length < 3) {
          throw new Error("设置剩余流量时必须填写有效 GB 数和至少 3 个字的原因。");
        }
        await apiRequest(`/api/admin/subscriptions/${statsSubscription.id}/quota-adjustments`, {
          method: "POST",
          token,
          body: { mode: "set_remaining", remainingBytes, reason: quotaReason.trim() },
        });
      }
      showToast("流量策略已保存。", "success");
      await openStats({ ...statsUser, trafficMultiplier: multiplier });
      await load();
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "流量策略保存失败。", "error");
    } finally {
      setSavingEntitlement(false);
    }
  }

  async function saveBalance() {
    if (!token || !statsUser) return;
    const cents = Math.round(Number(balanceInput) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      showToast("请输入有效的余额", "error");
      return;
    }
    setSavingBalance(true);
    try {
      const wallet = await apiRequest<WalletResponse>(
        `/api/admin/users/${statsUser.id}/balance`,
        { method: "PATCH", token, body: { balanceCents: cents } },
      );
      setStatsWallet(wallet);
      setBalanceInput((wallet.balanceCents / 100).toFixed(2));
      showToast("余额已更新");
      await load();
    } catch (cause) {
      showToast(cause instanceof ApiError ? cause.message : "更新余额失败", "error");
    } finally {
      setSavingBalance(false);
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

  async function issuePasswordReset(user: AdminUser) {
    if (!token) return;
    setFeedback(null);
    try {
      const result = await apiRequest<{ resetUrl: string; expiresAt: string }>(
        `/api/admin/users/${user.id}/password-reset`,
        { method: "POST", token },
      );
      await copyText(result.resetUrl);
      setFeedback({
        msg: `已生成 ${user.displayName} 的一次性重置链接并复制，30 分钟内有效。`,
        kind: "success",
      });
    } catch (cause) {
      setFeedback({
        msg: cause instanceof ApiError ? cause.message : "生成密码重置链接失败。",
        kind: "error",
      });
    }
  }

  return (
    <ConsoleShell
      title="用户管理"
      subtitle="建档、开通会员接入、签发专属链接与二维码都集中在这一页完成"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      dataViewport
      toolbarMeta={
        <span className="badge info">{loading ? "加载中..." : `${totalUsers} 个用户`}</span>
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
        className="admin-data-panel"
        title="账号列表"
        copy="点击行编辑用户；创建会员时可顺手开通首个套餐并交付专属 URI。"
        action={<span className="fine-print">{loading ? "同步中..." : `${users.length} 条`}</span>}
      >
        <div className="admin-filter-bar admin-compact-filters">
          <label className="field grow-field">
            <span className="fine-print">搜索用户</span>
            <input className="control" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="邮箱、名称或用户 ID" />
          </label>
          <label className="field">
            <span className="fine-print">状态</span>
            <select className="control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">全部</option><option value="active">正常</option><option value="suspended">暂停</option><option value="banned">封禁</option>
            </select>
          </label>
          <label className="field">
            <span className="fine-print">角色</span>
            <select className="control" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">全部</option><option value="member">会员</option><option value="admin">管理员</option>
            </select>
          </label>
          <label className="field">
            <span className="fine-print">额度</span>
            <select className="control" value={quotaFilter} onChange={(event) => setQuotaFilter(event.target.value)}>
              <option value="">全部</option><option value="available">充足</option><option value="low">偏低</option><option value="exhausted">耗尽</option>
            </select>
          </label>
        </div>
        {loading && users.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}
        {users.length > 0 ? (
          <DataTable
            headers={["用户", "角色", "状态", "倍率", "可用流量", "最近使用", "操作"]}
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
              `${(user.trafficMultiplier ?? 1).toFixed(2)}x`,
              formatBytes(user.remainingBytes ?? 0),
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
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => void issuePasswordReset(user)}
                >
                  重置密码
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

          {!editingUser ? (
            <label className="field">
              <span className="fine-print">初始密码</span>
              <input
                className="control"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="首次登录密码"
                autoComplete="new-password"
              />
            </label>
          ) : null}

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
        ) : (
          <div className="page-stack">
            <div className="kpi-list">
              <div className="list-row">
                <span className="muted">钱包余额</span>
                <strong>{formatMoney(statsWallet?.balanceCents ?? 0)}</strong>
              </div>
              <div className="list-row" style={{ alignItems: "center" }}>
                <span className="muted">调整余额（元）</span>
                <div className="toolbar-actions" style={{ gap: 8 }}>
                  <input
                    className="control"
                    type="number"
                    min="0"
                    step="0.01"
                    style={{ width: 130 }}
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                  />
                  <button
                    className="ghost-button compact"
                    type="button"
                    disabled={savingBalance}
                    onClick={() => void saveBalance()}
                  >
                    {savingBalance ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>
            </div>

            {statsWallet && statsWallet.transactions.length > 0 ? (
              <div>
                <div className="fine-print" style={{ marginBottom: 8 }}>钱包流水</div>
                <DataTable
                  headers={["类型", "金额", "备注", "时间"]}
                  rows={statsWallet.transactions.slice(0, 10).map((t) => [
                    t.kind,
                    `${t.amountCents >= 0 ? "+" : ""}${formatMoney(t.amountCents)}`,
                    t.note ?? "-",
                    formatDateTime(t.createdAt),
                  ])}
                />
              </div>
            ) : null}

            {statsSubscription ? (
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
            ) : (
              <div className="fine-print">该用户还没有订阅记录。</div>
            )}

            <div className="kpi-list">
              <div className="field-section-label">计费策略</div>
              <label className="field">
                <span className="fine-print">流量倍率（0.1x - 100x）</span>
                <input className="control" type="number" min="0.1" max="100" step="0.1" value={multiplierInput} onChange={(event) => setMultiplierInput(event.target.value)} />
              </label>
              {statsSubscription ? (
                <>
                  <label className="field">
                    <span className="fine-print">将当前周期剩余流量设为（GB，留空则不调整）</span>
                    <input className="control" type="number" min="0" step="0.1" value={quotaGbInput} onChange={(event) => setQuotaGbInput(event.target.value)} />
                  </label>
                  <label className="field">
                    <span className="fine-print">调整原因</span>
                    <input className="control" value={quotaReason} onChange={(event) => setQuotaReason(event.target.value)} placeholder="退款补偿、运营赠送等" />
                  </label>
                </>
              ) : null}
              <button className="action-button" type="button" disabled={savingEntitlement} onClick={() => void saveEntitlementPolicy()}>
                {savingEntitlement ? "保存中..." : "保存流量策略"}
              </button>
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
            ) : null}
          </div>
        )}
      </Drawer>
    </ConsoleShell>
  );
}
