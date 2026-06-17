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
};

type Feedback = { msg: string; kind: "success" | "error" };

function emptyForm(): NodeForm {
  return {
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
  };
}

function fromRecord(node: NodeRecord): NodeForm {
  return {
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
  };
}

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
      const nextNodes = await apiRequest<NodeRecord[]>("/api/admin/nodes", { token });
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
    if (isDirty && !window.confirm("有未保存的改动，关闭后将丢失。确定关闭？")) return;
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
        trafficApiBaseUrl: form.trafficApiBaseUrl.trim(),
        trafficApiSecret: form.trafficApiSecret.trim(),
      };
      if (editingNode) {
        await apiRequest(`/api/admin/nodes/${editingNode.id}`, { method: "PATCH", token, body: payload });
        setFeedback({ msg: "节点已更新。", kind: "success" });
      } else {
        await apiRequest("/api/admin/nodes", { method: "POST", token, body: payload });
        clearDraft(DRAFT_KEY);
        setFeedback({ msg: "节点已添加。", kind: "success" });
      }
      forceClose();
      await load();
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !editingNode) return;
    if (!window.confirm(`确定要删除节点「${editingNode.label}」吗？此操作不可撤销。`)) return;
    setSaving(true);
    setDrawerError(null);
    try {
      await apiRequest(`/api/admin/nodes/${editingNode.id}`, { method: "DELETE", token });
      setFeedback({ msg: `节点「${editingNode.label}」已删除。`, kind: "success" });
      forceClose();
      await load();
    } catch (cause) {
      setDrawerError(cause instanceof ApiError ? cause.message : "删除失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConsoleShell
      title="节点管理"
      subtitle="添加并管理 Hysteria 2 接入节点。"
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
          <button className="toolbar-button" type="button" onClick={() => void load()}>
            刷新
          </button>
        </>
      }
    >
      {feedback ? <div className={`feedback ${feedback.kind}`}>{feedback.msg}</div> : null}

      <Panel title="节点列表" copy="点击任意节点行进行编辑；「添加节点」在右侧弹出配置面板。">
        {loading && nodes.length === 0 ? (
          <div className="skeleton-rows">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton skeleton-row" />
            ))}
          </div>
        ) : null}

        {nodes.length > 0 ? (
          <DataTable
            headers={["节点", "速率", "在线用户", "Traffic API 地址", "状态"]}
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
              `${node.speedUpMbps} / ${node.speedDownMbps} Mbps`,
              String(node.concurrentUsers),
              <span className="mono" key={`${node.id}-api`}>
                {node.trafficApiBaseUrl}
              </span>,
              <span key={`${node.id}-st`} className={`badge ${node.active ? "success" : "danger"}`}>
                {node.active ? "启用" : "停用"}
              </span>,
            ])}
          />
        ) : !loading ? (
          <div className="empty-state">
            <div className="empty-state-icon">🖥️</div>
            <div className="empty-state-title">还没有节点</div>
            <button className="action-button" type="button" onClick={openCreate}>
              添加第一个节点
            </button>
          </div>
        ) : null}
      </Panel>

      <Drawer
        open={drawerOpen}
        onClose={requestClose}
        title={editingNode ? `编辑：${editingNode.label}` : "添加节点"}
        subtitle={editingNode ? `${editingNode.hostname}:${editingNode.port}` : undefined}
        isDirty={isDirty}
        footer={
          <div className="drawer-footer-split">
            <div className="toolbar-actions">
              <button
                className="action-button"
                type="submit"
                form="node-form"
                disabled={saving || !form.label.trim() || !form.hostname.trim() || !form.trafficApiBaseUrl.trim()}
              >
                {saving ? "保存中..." : editingNode ? "保存" : "添加节点"}
              </button>
              <button className="ghost-button" type="button" onClick={requestClose}>
                取消
              </button>
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
        {drawerError ? <div className="feedback error">{drawerError}</div> : null}

        {hasDraftBanner ? (
          <div className="feedback info" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>已恢复上次未保存的草稿。</span>
            <button className="ghost-button compact" type="button" onClick={discardDraft}>
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
                min="1"
                value={form.speedUpMbps}
                onChange={(e) => set("speedUpMbps", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="fine-print">下行限速 Mbps</span>
              <input
                className="control"
                type="number"
                min="1"
                value={form.speedDownMbps}
                onChange={(e) => set("speedDownMbps", Number(e.target.value))}
              />
            </label>
          </div>

          <div className="field-section-label">Traffic API</div>

          <label className="field">
            <span className="fine-print">API 地址</span>
            <input
              className="control mono"
              placeholder="http://节点IP:9000"
              value={form.trafficApiBaseUrl}
              onChange={(e) => set("trafficApiBaseUrl", e.target.value)}
              required
            />
            <span className="field-hint">Hysteria2 服务端流量统计接口的地址</span>
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

          <details
            className="field-section"
            open={!!(form.sni || form.obfsPassword || form.pinSHA256 || form.allowInsecureTls)}
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
