"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type {
  AdminCreateUserResponse,
  AdminUser,
  AdminUserAccessResponse,
  PlanRecord,
} from "@/lib/types";
import { statusTone } from "@/lib/ui";

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
  nodeGroupId: string;
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
    nodeGroupId: fallbackPlan?.bindings[0]?.nodeGroupId ?? "",
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

  const allowedGroupIds = selectedPlan.bindings.map((binding) => binding.nodeGroupId);

  return {
    enabled: current.enabled,
    planId: selectedPlan.id,
    nodeGroupId: allowedGroupIds.includes(current.nodeGroupId)
      ? current.nodeGroupId
      : allowedGroupIds[0] ?? "",
  };
}

export default function AdminUsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const [provision, setProvision] = useState<ProvisionState>(() =>
    createProvisionState([], "member"),
  );
  const [delivery, setDelivery] = useState<DeliveryState | null>(null);
  const [loadingDelivery, setLoadingDelivery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  const syncProvisionForDraft = useCallback((
    nextRole: UserFormState["role"],
    nextPlans: PlanRecord[],
  ) => {
    setProvision((current) => {
      const next = normalizeProvisionState(current, nextPlans, nextRole);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!token) {
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextUsers, nextPlans] = await Promise.all([
        apiRequest<AdminUser[]>("/api/admin/users", { token }),
        apiRequest<PlanRecord[]>("/api/admin/plans", { token }),
      ]);

      setUsers(nextUsers);
      setPlans(nextPlans);
      if (!selectedId) {
        syncProvisionForDraft(form.role, nextPlans);
      }

      if (selectedId && !nextUsers.some((user) => user.id === selectedId)) {
        setSelectedId(null);
        setForm(emptyForm);
        setProvision(createProvisionState(nextPlans, "member"));
        setDelivery(null);
        setDeliveryError(null);
      }

      return {
        nextUsers,
        nextPlans,
      };
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "用户列表加载失败。");
      return null;
    } finally {
      setLoading(false);
    }
  }, [form.role, selectedId, syncProvisionForDraft, token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const selectedUser = users.find((user) => user.id === selectedId) ?? null;
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === provision.planId) ?? null,
    [plans, provision.planId],
  );
  const availableBindings = selectedPlan?.bindings ?? [];
  const provisioningEnabled = !selectedUser && form.role === "member" && provision.enabled;
  const provisioningBlocked = provisioningEnabled && availableBindings.length === 0;
  const submitDisabled =
    submitting ||
    !form.email.trim() ||
    !form.displayName.trim() ||
    (!selectedUser && !form.password.trim()) ||
    provisioningBlocked ||
    (provisioningEnabled && !provision.planId);

  function applySelection(
    user: AdminUser | null,
    options?: {
      preserveDelivery?: boolean;
    },
  ) {
    if (!user) {
      setSelectedId(null);
      setForm(emptyForm);
      setProvision(createProvisionState(plans, "member"));
      if (!options?.preserveDelivery) {
        setDelivery(null);
        setDeliveryError(null);
      }
      return;
    }

    setSelectedId(user.id);
    setForm({
      email: user.email,
      displayName: user.displayName,
      password: "",
      role: user.role,
      status: user.status,
      notes: user.notes ?? "",
    });
    if (!options?.preserveDelivery) {
      setDelivery(null);
      setDeliveryError(null);
    }
  }

  function handleProvisionPlanChange(nextPlanId: string) {
    const nextPlan = plans.find((plan) => plan.id === nextPlanId) ?? null;
    setProvision((current) => ({
      ...current,
      planId: nextPlanId,
      nodeGroupId: nextPlan?.bindings[0]?.nodeGroupId ?? "",
    }));
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("已复制到剪贴板。");
    } catch {
      setFeedback("复制失败，请手动复制。");
    }
  }

  async function loadAccess(user: AdminUser) {
    if (!token || user.role !== "member") {
      return;
    }

    setLoadingDelivery(true);
    setDeliveryError(null);
    setFeedback(null);

    try {
      const access = await apiRequest<AdminUserAccessResponse>(
        `/api/admin/users/${user.id}/access`,
        { token },
      );
      setDelivery({
        userId: user.id,
        displayName: user.displayName,
        email: user.email,
        access,
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setDelivery({
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          access: null,
        });
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
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setFeedback(null);
    setDeliveryError(null);

    try {
      if (selectedUser) {
        const updated = await apiRequest<AdminUser>(`/api/admin/users/${selectedUser.id}`, {
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
        setFeedback("用户信息已更新。");
        applySelection(updated, { preserveDelivery: true });
        await load();
      } else {
        const created = await apiRequest<AdminCreateUserResponse>("/api/admin/users", {
          method: "POST",
          token,
          body: {
            ...form,
            initialPlanId: provisioningEnabled ? provision.planId : undefined,
            initialNodeGroupId:
              provisioningEnabled && provision.nodeGroupId ? provision.nodeGroupId : undefined,
          },
        });

        setDelivery({
          userId: created.id,
          displayName: created.displayName,
          email: created.email,
          primaryAccessToken: created.primaryAccessToken ?? null,
          access: created.provisionedAccess ?? null,
        });

        setFeedback(
          created.provisionedAccess
            ? "用户已创建，套餐已开通，专属接入信息已生成。"
            : created.primaryAccessToken
              ? "用户已创建，主访问令牌已签发。"
              : "用户已创建。",
        );

        if (!created.provisionedAccess) {
          setDeliveryError("当前仅完成账号签发。开通有效订阅后，这里会自动生成专属链接和二维码。");
        }

        const refreshed = await load();
        const createdUser =
          refreshed?.nextUsers.find((candidate) => candidate.id === created.id) ?? created;
        applySelection(createdUser, { preserveDelivery: true });
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存用户失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleKick(userId: string) {
    if (!token) {
      return;
    }

    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/admin/users/${userId}/kick`, {
        method: "POST",
        token,
      });
      setFeedback("踢线请求已发送。");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "踢线失败。");
    }
  }

  return (
    <ConsoleShell
      title="用户管理"
      subtitle="建档、开通会员接入、签发专属链接与二维码都集中在这一页完成"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">{loading ? "加载中..." : `${users.length} 个用户`}</span>}
      toolbarActions={
        <>
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
          <button className="action-button" type="button" onClick={() => applySelection(null)}>
            新建用户
          </button>
        </>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      <section className="workspace-grid">
        <Panel
          title="账号列表"
          copy="创建会员后可直接在右侧开通初始套餐并交付专属 URI。"
          action={<span className="fine-print">{loading ? "同步中..." : `${users.length} 条`}</span>}
        >
          <DataTable
            headers={["用户", "角色", "状态", "访问令牌", "最近使用", "操作"]}
            rows={users.map((user) => [
              <button
                key={`${user.id}-select`}
                type="button"
                className={`link-button${selectedId === user.id ? " active" : ""}`}
                onClick={() => applySelection(user)}
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
                  onClick={() => void handleKick(user.id)}
                >
                  踢线
                </button>
              </div>,
            ])}
          />
        </Panel>

        <div className="page-stack">
          <Panel
            title={selectedUser ? "编辑用户" : "新建用户"}
            copy="创建会员时可顺手开通首个套餐，保存成功后右侧会直接给出交付信息。"
          >
            <form className="form-grid" onSubmit={handleSubmit}>
              <label className="field">
                <span className="fine-print">邮箱</span>
                <input
                  className="control"
                  value={form.email}
                  disabled={Boolean(selectedUser)}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>

              <label className="field">
                <span className="fine-print">显示名</span>
                <input
                  className="control"
                  value={form.displayName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
              </label>

              <div className="two-col">
                <label className="field">
                  <span className="fine-print">角色</span>
                  <select
                    className="control"
                    value={form.role}
                    onChange={(event) => {
                      const nextRole = event.target.value as "admin" | "member";
                      setForm((current) => ({
                        ...current,
                        role: nextRole,
                      }));
                      if (!selectedUser) {
                        syncProvisionForDraft(nextRole, plans);
                      }
                    }}
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                </label>

                <label className="field">
                  <span className="fine-print">状态</span>
                  <select
                    className="control"
                    value={form.status}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        status: event.target.value as "active" | "suspended" | "banned",
                      }))
                    }
                  >
                    <option value="active">active</option>
                    <option value="suspended">suspended</option>
                    <option value="banned">banned</option>
                  </select>
                </label>
              </div>

              <label className="field">
                <span className="fine-print">密码</span>
                <input
                  className="control"
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder={selectedUser ? "留空则不修改" : "首次登录密码"}
                />
              </label>

              <label className="field">
                <span className="fine-print">备注</span>
                <textarea
                  className="control textarea"
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </label>

              {!selectedUser ? (
                <div className="page-stack">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={provision.enabled && form.role === "member"}
                      disabled={form.role !== "member" || !plans.some((plan) => plan.bindings.length > 0)}
                      onChange={(event) =>
                        setProvision((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                    />
                    <span>创建后立即开通套餐并生成专属接入信息</span>
                  </label>

                  {form.role !== "member" ? (
                    <div className="feedback info">
                      管理员账号默认不做会员接入开通，只签发后台登录凭据。
                    </div>
                  ) : null}

                  {provision.enabled && form.role === "member" ? (
                    <div className="tri-grid">
                      <label className="field">
                        <span className="fine-print">初始套餐</span>
                        <select
                          className="control"
                          value={provision.planId}
                          onChange={(event) => handleProvisionPlanChange(event.target.value)}
                        >
                          {plans
                            .filter((plan) => plan.bindings.length > 0)
                            .map((plan) => (
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
                          value={provision.nodeGroupId}
                          onChange={(event) =>
                            setProvision((current) => ({
                              ...current,
                              nodeGroupId: event.target.value,
                            }))
                          }
                        >
                          {availableBindings.map((binding) => (
                            <option key={binding.id} value={binding.nodeGroupId}>
                              {binding.nodeGroupName}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="field">
                        <span className="fine-print">交付说明</span>
                        <div className="feedback info">
                          保存后会自动生成 token、URI、二维码和 YAML 配置片段。
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="toolbar-actions">
                <button className="action-button" type="submit" disabled={submitDisabled}>
                  {submitting ? "保存中..." : selectedUser ? "保存修改" : "创建用户"}
                </button>
                {selectedUser ? (
                  <button className="ghost-button" type="button" onClick={() => applySelection(null)}>
                    结束编辑
                  </button>
                ) : null}
              </div>
            </form>
          </Panel>

          <Panel
            title="接入交付"
            copy="创建会员后专属链接会直接落在这里；选中已有会员时也可以随时重新读取。"
            action={
              selectedUser && selectedUser.role === "member" ? (
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => void loadAccess(selectedUser)}
                  disabled={loadingDelivery}
                >
                  {loadingDelivery ? "读取中..." : "读取当前接入信息"}
                </button>
              ) : null
            }
          >
            {deliveryError ? <div className="feedback warn">{deliveryError}</div> : null}

            {delivery?.access ? (
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
            ) : delivery?.primaryAccessToken ? (
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
            ) : (
              <div className="feedback info">
                新建会员并开通初始套餐后，这里会自动生成专属链接、二维码和推荐 YAML 配置。
              </div>
            )}
          </Panel>
        </div>
      </section>
    </ConsoleShell>
  );
}
