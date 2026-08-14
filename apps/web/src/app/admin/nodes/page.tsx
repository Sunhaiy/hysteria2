"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { clearDraft, getDraft, saveDraft } from "@/lib/draft";
import type { NodeRecord } from "@/lib/types";

const DRAFT_KEY = "node";

type NodeForm = {
  protocol: "hysteria2" | "vless_reality";
  label: string;
  hostname: string;
  port: number;
  speedUpMbps: number;
  speedDownMbps: number;
  trafficApiBaseUrl: string;
  trafficApiSecret: string;
  active: boolean;
  sni: string;
  obfsPassword: string;
  pinSHA256: string;
  allowInsecureTls: boolean;
  realityPublicKey: string;
  realityShortId: string;
  realityFingerprint: string;
  realitySpiderX: string;
  vlessFlow: string;
};

type Feedback = { msg: string; kind: "success" | "error" };

function emptyForm(): NodeForm {
  return {
    protocol: "hysteria2",
    label: "",
    hostname: "",
    port: 443,
    speedUpMbps: 20,
    speedDownMbps: 120,
    trafficApiBaseUrl: "",
    trafficApiSecret: "",
    active: true,
    sni: "",
    obfsPassword: "",
    pinSHA256: "",
    allowInsecureTls: false,
    realityPublicKey: "",
    realityShortId: "",
    realityFingerprint: "chrome",
    realitySpiderX: "",
    vlessFlow: "xtls-rprx-vision",
  };
}

function fromRecord(node: NodeRecord): NodeForm {
  return {
    protocol: node.protocol,
    label: node.label,
    hostname: node.hostname,
    port: node.port,
    speedUpMbps: node.speedUpMbps,
    speedDownMbps: node.speedDownMbps,
    trafficApiBaseUrl: node.trafficApiBaseUrl,
    trafficApiSecret: node.trafficApiSecret,
    active: node.active,
    sni: node.sni ?? "",
    obfsPassword: node.obfsPassword ?? "",
    pinSHA256: node.pinSHA256 ?? "",
    allowInsecureTls: node.allowInsecureTls,
    realityPublicKey: node.realityPublicKey ?? "",
    realityShortId: node.realityShortId ?? "",
    realityFingerprint: node.realityFingerprint ?? "chrome",
    realitySpiderX: node.realitySpiderX ?? "",
    vlessFlow: node.vlessFlow ?? "xtls-rprx-vision",
  };
}

const protocolLabel = {
  hysteria2: "Hysteria 2",
  vless_reality: "VLESS + REALITY",
} as const;

const monitoringLabel = {
  online: "监控正常",
  stale: "数据过期",
  error: "同步失败",
  unknown: "尚未同步",
  disabled: "已停用",
} as const;

const monitoringTone = {
  online: "success",
  stale: "warn",
  error: "danger",
  unknown: "info",
  disabled: "danger",
} as const;

export default function AdminNodesPage() {
  const { token } = useAuth();
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<NodeRecord | null>(null);
  const [form, setForm] = useState<NodeForm>(() => emptyForm());
  const [hasDraftBanner, setHasDraftBanner] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const nextNodes = await apiRequest<NodeRecord[]>("/api/admin/nodes", {
        token,
      });
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
    () => (editingNode ? fromRecord(editingNode) : emptyForm()),
    [editingNode],
  );

  const isDirty = useMemo(
    () => drawerOpen && JSON.stringify(form) !== JSON.stringify(baseForm),
    [drawerOpen, form, baseForm],
  );

  function requestClose() {
    if (isDirty && !window.confirm("有未保存的改动，关闭后将丢失。确定关闭？"))
      return;
    forceClose();
  }

  function forceClose() {
    setDrawerOpen(false);
    setEditingNode(null);
    setDrawerError(null);
    setHasDraftBanner(false);
  }

  function set<K extends keyof NodeForm>(key: K, value: NodeForm[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (!editingNode) saveDraft(DRAFT_KEY, next);
      return next;
    });
  }

  function openCreate() {
    const draft = getDraft<NodeForm>(DRAFT_KEY);
    if (draft) {
      setForm({ ...emptyForm(), ...draft });
      setHasDraftBanner(true);
    } else {
      setForm(emptyForm());
      setHasDraftBanner(false);
    }
    setEditingNode(null);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function openEdit(node: NodeRecord) {
    setEditingNode(node);
    setForm(fromRecord(node));
    setHasDraftBanner(false);
    setDrawerError(null);
    setDrawerOpen(true);
  }

  function discardDraft() {
    clearDraft(DRAFT_KEY);
    setForm(emptyForm());
    setHasDraftBanner(false);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setDrawerError(null);
    try {
      const payload = {
        ...form,
        label: form.label.trim(),
        hostname: form.hostname.trim(),
        sni: form.sni.trim() || null,
        obfsPassword: form.obfsPassword.trim() || null,
        pinSHA256: form.pinSHA256.trim() || null,
        realityPublicKey: form.realityPublicKey.trim() || null,
        realityShortId: form.realityShortId.trim(),
        realityFingerprint: form.realityFingerprint.trim() || "chrome",
        realitySpiderX: form.realitySpiderX.trim() || null,
        vlessFlow: form.vlessFlow.trim() || "xtls-rprx-vision",
        trafficApiBaseUrl: form.trafficApiBaseUrl.trim(),
        trafficApiSecret: form.trafficApiSecret.trim(),
      };
      if (editingNode) {
        await apiRequest(`/api/admin/nodes/${editingNode.id}`, {
          method: "PATCH",
          token,
          body: payload,
        });
        setFeedback({ msg: "节点已更新。", kind: "success" });
      } else {
        await apiRequest("/api/admin/nodes", {
          method: "POST",
          token,
          body: payload,
        });
        clearDraft(DRAFT_KEY);
        setFeedback({ msg: "节点已添加。", kind: "success" });
      }
      forceClose();
      await load();
    } catch (cause) {
      setDrawerError(
        cause instanceof ApiError ? cause.message : "保存失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !editingNode) return;
    if (
      !window.confirm(
        `确定要删除节点「${editingNode.label}」吗？此操作不可撤销。`,
      )
    )
      return;
    setSaving(true);
    setDrawerError(null);
    try {
      await apiRequest(`/api/admin/nodes/${editingNode.id}`, {
        method: "DELETE",
        token,
      });
      setFeedback({
        msg: `节点「${editingNode.label}」已删除。`,
        kind: "success",
      });
      forceClose();
      await load();
    } catch (cause) {
      setDrawerError(
        cause instanceof ApiError ? cause.message : "删除失败，请重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    if (!token || !editingNode) return;
    setSaving(true);
    setDrawerError(null);
    try {
      await apiRequest(`/api/admin/nodes/${editingNode.id}/sync`, {
        method: "POST",
        token,
      });
      setFeedback({
        msg: `节点「${editingNode.label}」同步成功。`,
        kind: "success",
      });
      forceClose();
      await load();
    } catch (cause) {
      setDrawerError(
        cause instanceof ApiError
          ? cause.message
          : "节点同步失败，请检查控制 API。 ",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConsoleShell
      title="节点管理"
      subtitle="统一管理 Hysteria 2 与 VLESS + REALITY 接入节点。"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">
          {loading ? "加载中..." : `${nodes.length} 个节点`}
        </span>
      }
      toolbarActions={
        <>
          <button className="action-button" type="button" onClick={openCreate}>
            添加节点
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => void load()}
          >
            刷新
          </button>
        </>
      }
    >
      {feedback ? (
        <div className={`feedback ${feedback.kind}`}>{feedback.msg}</div>
      ) : null}

      <Panel
        title="节点列表"
        copy="点击任意节点行进行编辑；「添加节点」在右侧弹出配置面板。"
      >
        {loading && nodes.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}

        {nodes.length > 0 ? (
          <DataTable
            headers={[
              "节点",
              "协议",
              "速率",
              "在线用户",
              "控制 API",
              "监控状态",
            ]}
            rows={nodes.map((node) => [
              <button
                key={node.id}
                type="button"
                className="link-button"
                onClick={() => openEdit(node)}
              >
                <span>{node.label}</span>
                <span className="muted">
                  {node.hostname}:{node.port}
                </span>
              </button>,
              <span className="badge info" key={`${node.id}-protocol`}>
                {protocolLabel[node.protocol]}
              </span>,
              node.speedUpMbps === 0 && node.speedDownMbps === 0
                ? "不限速"
                : `${node.speedUpMbps} / ${node.speedDownMbps} Mbps`,
              String(node.concurrentUsers),
              <span className="mono" key={`${node.id}-api`}>
                {node.trafficApiBaseUrl}
              </span>,
              <span
                key={`${node.id}-st`}
                className={`badge ${monitoringTone[node.monitoringStatus]}`}
                title={node.lastSyncError ?? undefined}
              >
                {monitoringLabel[node.monitoringStatus]}
              </span>,
            ])}
          />
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">🖥️</div>
            <div className="empty-state-title">还没有节点</div>
            <button
              className="action-button"
              type="button"
              onClick={openCreate}
            >
              添加第一个节点
            </button>
          </div>
        ) : null}
      </Panel>

      <Drawer
        open={drawerOpen}
        onClose={requestClose}
        title={editingNode ? `编辑：${editingNode.label}` : "添加节点"}
        subtitle={
          editingNode
            ? `${editingNode.hostname}:${editingNode.port}`
            : undefined
        }
        isDirty={isDirty}
        footer={
          <div className="drawer-footer-split">
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="submit"
                form="node-form"
                disabled={
                  saving ||
                  !form.label.trim() ||
                  !form.hostname.trim() ||
                  !form.trafficApiBaseUrl.trim() ||
                  (form.protocol === "vless_reality" &&
                    (!form.sni.trim() || !form.realityPublicKey.trim()))
                }
              >
                {saving ? "保存中..." : editingNode ? "保存" : "添加节点"}
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={requestClose}
              >
                取消
              </button>
              {editingNode ? (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void handleSync()}
                  disabled={saving}
                >
                  立即同步
                </button>
              ) : null}
            </div>
            {editingNode ? (
              <button
                className="danger-button"
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving}
              >
                删除节点
              </button>
            ) : null}
          </div>
        }
      >
        {drawerError ? (
          <div className="feedback error">{drawerError}</div>
        ) : null}

        {hasDraftBanner ? (
          <div
            className="feedback info"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>已恢复上次未保存的草稿。</span>
            <button
              className="ghost-button compact"
              type="button"
              onClick={discardDraft}
            >
              丢弃草稿
            </button>
          </div>
        ) : null}

        <form id="node-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span className="fine-print">显示名</span>
            <input
              className="control"
              placeholder="如：香港节点 01"
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="fine-print">节点协议</span>
            <select
              className="control"
              value={form.protocol}
              onChange={(e) =>
                set("protocol", e.target.value as NodeForm["protocol"])
              }
            >
              <option value="hysteria2">Hysteria 2</option>
              <option value="vless_reality">VLESS + REALITY</option>
            </select>
          </label>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">主机名 / IP</span>
              <input
                className="control"
                placeholder="1.2.3.4 或 hk.example.com"
                value={form.hostname}
                onChange={(e) => set("hostname", e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="fine-print">端口</span>
              <input
                className="control"
                type="number"
                min="1"
                max="65535"
                value={form.port}
                onChange={(e) => set("port", Number(e.target.value))}
              />
            </label>
          </div>

          <div className="two-col">
            <label className="field">
              <span className="fine-print">上行限速 Mbps</span>
              <input
                className="control"
                type="number"
                min="0"
                disabled={form.speedUpMbps === 0 && form.speedDownMbps === 0}
                value={
                  form.speedUpMbps === 0 && form.speedDownMbps === 0
                    ? ""
                    : form.speedUpMbps
                }
                placeholder={
                  form.speedUpMbps === 0 && form.speedDownMbps === 0
                    ? "不限速"
                    : ""
                }
                onChange={(e) => set("speedUpMbps", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="fine-print">下行限速 Mbps</span>
              <input
                className="control"
                type="number"
                min="0"
                disabled={form.speedUpMbps === 0 && form.speedDownMbps === 0}
                value={
                  form.speedUpMbps === 0 && form.speedDownMbps === 0
                    ? ""
                    : form.speedDownMbps
                }
                placeholder={
                  form.speedUpMbps === 0 && form.speedDownMbps === 0
                    ? "不限速"
                    : ""
                }
                onChange={(e) => set("speedDownMbps", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field checkbox-row">
            <input
              type="checkbox"
              checked={form.speedUpMbps === 0 && form.speedDownMbps === 0}
              onChange={(e) => {
                if (e.target.checked) {
                  setForm((f) => {
                    const next = { ...f, speedUpMbps: 0, speedDownMbps: 0 };
                    if (!editingNode) saveDraft(DRAFT_KEY, next);
                    return next;
                  });
                } else {
                  setForm((f) => {
                    const next = { ...f, speedUpMbps: 20, speedDownMbps: 120 };
                    if (!editingNode) saveDraft(DRAFT_KEY, next);
                    return next;
                  });
                }
              }}
            />
            <span>不限制速率</span>
          </label>

          <div className="field-section-label">节点监控与控制 API</div>

          <label className="field">
            <span className="fine-print">API 地址</span>
            <input
              className="control mono"
              placeholder="http://节点IP:9000"
              value={form.trafficApiBaseUrl}
              onChange={(e) => set("trafficApiBaseUrl", e.target.value)}
              required
            />
            <span className="field-hint">
              {form.protocol === "vless_reality"
                ? "部署在 Xray 节点上的控制代理地址，用于用户同步、流量、在线与踢下线"
                : "Hysteria2 服务端 Traffic Stats API 地址"}
            </span>
          </label>

          <label className="field">
            <span className="fine-print">API 密钥</span>
            <input
              className="control mono"
              placeholder="在服务端配置的 secret"
              value={form.trafficApiSecret}
              onChange={(e) => set("trafficApiSecret", e.target.value)}
            />
          </label>

          {form.protocol === "hysteria2" ? (
            <details
              className="field-section"
              open={
                !!(
                  form.sni ||
                  form.obfsPassword ||
                  form.pinSHA256 ||
                  form.allowInsecureTls
                )
              }
            >
              <summary>TLS / Obfs 进阶配置（可选）</summary>
              <div className="field-section-body">
                <label className="field">
                  <div className="field-inline-actions">
                    <span className="fine-print">SNI</span>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={() => set("sni", form.hostname)}
                      disabled={!form.hostname}
                    >
                      同步主机名
                    </button>
                  </div>
                  <input
                    className="control"
                    placeholder="留空则不验证 SNI"
                    value={form.sni}
                    onChange={(e) => set("sni", e.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="fine-print">Obfs 密码</span>
                  <input
                    className="control"
                    placeholder="salamander 混淆密码，留空不开启"
                    value={form.obfsPassword}
                    onChange={(e) => set("obfsPassword", e.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="fine-print">Pin SHA256</span>
                  <input
                    className="control mono"
                    placeholder="TLS 证书指纹，留空不固定"
                    value={form.pinSHA256}
                    onChange={(e) => set("pinSHA256", e.target.value)}
                  />
                </label>

                <label className="field checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.allowInsecureTls}
                    onChange={(e) => set("allowInsecureTls", e.target.checked)}
                  />
                  <span>允许不安全 TLS（跳过证书验证）</span>
                </label>
              </div>
            </details>
          ) : (
            <div className="field-section">
              <div className="field-section-label">VLESS + REALITY 配置</div>
              <div className="field-section-body">
                <label className="field">
                  <div className="field-inline-actions">
                    <span className="fine-print">SNI / Server Name</span>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={() => set("sni", form.hostname)}
                      disabled={!form.hostname}
                    >
                      同步主机名
                    </button>
                  </div>
                  <input
                    className="control"
                    placeholder="如：www.microsoft.com"
                    value={form.sni}
                    onChange={(e) => set("sni", e.target.value)}
                    required
                  />
                </label>

                <label className="field">
                  <span className="fine-print">REALITY 公钥 / Password</span>
                  <input
                    className="control mono"
                    placeholder="xray x25519 生成的 Password (PublicKey)"
                    value={form.realityPublicKey}
                    onChange={(e) => set("realityPublicKey", e.target.value)}
                    required
                  />
                </label>

                <div className="two-col">
                  <label className="field">
                    <span className="fine-print">Short ID</span>
                    <input
                      className="control mono"
                      placeholder="最多 16 位偶数长度十六进制"
                      value={form.realityShortId}
                      onChange={(e) => set("realityShortId", e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="fine-print">客户端指纹</span>
                    <input
                      className="control mono"
                      placeholder="chrome"
                      value={form.realityFingerprint}
                      onChange={(e) =>
                        set("realityFingerprint", e.target.value)
                      }
                    />
                  </label>
                </div>

                <label className="field">
                  <span className="fine-print">Flow</span>
                  <input
                    className="control mono"
                    placeholder="xtls-rprx-vision"
                    value={form.vlessFlow}
                    onChange={(e) => set("vlessFlow", e.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="fine-print">Spider X（可选）</span>
                  <input
                    className="control mono"
                    placeholder="/"
                    value={form.realitySpiderX}
                    onChange={(e) => set("realitySpiderX", e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          <label className="field checkbox-row">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            <span>启用节点</span>
          </label>
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
