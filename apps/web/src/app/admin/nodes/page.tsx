"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import type { NodeGroupRecord, NodeRecord } from "@/lib/types";
import { slugifyValue } from "@/lib/ui";

type NodeGroupFormState = {
  slug: string;
  name: string;
  description: string;
  active: boolean;
};

type NodeFormState = {
  nodeGroupId: string;
  label: string;
  hostname: string;
  port: number;
  obfsPassword: string;
  sni: string;
  pinSHA256: string;
  allowInsecureTls: boolean;
  trafficApiBaseUrl: string;
  trafficApiSecret: string;
  active: boolean;
  speedUpMbps: number;
  speedDownMbps: number;
};

function createEmptyNodeGroup(): NodeGroupFormState {
  return {
    slug: "",
    name: "",
    description: "",
    active: true,
  };
}

function createNodeGroupForm(nodeGroup: NodeGroupRecord): NodeGroupFormState {
  return {
    slug: nodeGroup.slug,
    name: nodeGroup.name,
    description: nodeGroup.description ?? "",
    active: nodeGroup.active,
  };
}

function createEmptyNode(nodeGroupId = ""): NodeFormState {
  return {
    nodeGroupId,
    label: "",
    hostname: "",
    port: 443,
    obfsPassword: "",
    sni: "",
    pinSHA256: "",
    allowInsecureTls: false,
    trafficApiBaseUrl: "mock://new-node",
    trafficApiSecret: "stats-secret",
    active: true,
    speedUpMbps: 20,
    speedDownMbps: 120,
  };
}

function createNodeForm(node: NodeRecord): NodeFormState {
  return {
    nodeGroupId: node.nodeGroupId,
    label: node.label,
    hostname: node.hostname,
    port: node.port,
    obfsPassword: node.obfsPassword ?? "",
    sni: node.sni ?? "",
    pinSHA256: node.pinSHA256 ?? "",
    allowInsecureTls: node.allowInsecureTls,
    trafficApiBaseUrl: node.trafficApiBaseUrl,
    trafficApiSecret: node.trafficApiSecret,
    active: node.active,
    speedUpMbps: node.speedUpMbps,
    speedDownMbps: node.speedDownMbps,
  };
}

function formsMatch<T>(left: T, right: T) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export default function AdminNodesPage() {
  const { token } = useAuth();
  const [nodeGroups, setNodeGroups] = useState<NodeGroupRecord[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [groupForm, setGroupForm] = useState<NodeGroupFormState>(createEmptyNodeGroup);
  const [nodeForm, setNodeForm] = useState<NodeFormState>(() => createEmptyNode());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupSaving, setGroupSaving] = useState(false);
  const [nodeSaving, setNodeSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const [nextGroups, nextNodes] = await Promise.all([
        apiRequest<NodeGroupRecord[]>("/api/admin/node-groups", { token }),
        apiRequest<NodeRecord[]>("/api/admin/nodes", { token }),
      ]);

      setNodeGroups(nextGroups);
      setNodes(nextNodes);

      if (selectedGroupId && !nextGroups.some((group) => group.id === selectedGroupId)) {
        setSelectedGroupId(null);
        setGroupForm(createEmptyNodeGroup());
      }

      if (selectedNodeId && !nextNodes.some((node) => node.id === selectedNodeId)) {
        setSelectedNodeId(null);
        setNodeForm(createEmptyNode(nextGroups[0]?.id ?? ""));
      }

      return { nextGroups, nextNodes };
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "节点数据加载失败。");
      return null;
    } finally {
      setLoading(false);
    }
  }, [selectedGroupId, selectedNodeId, token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const selectedGroup = useMemo(
    () => nodeGroups.find((group) => group.id === selectedGroupId) ?? null,
    [nodeGroups, selectedGroupId],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const selectedNodeGroup = useMemo(
    () => nodeGroups.find((group) => group.id === nodeForm.nodeGroupId) ?? null,
    [nodeForm.nodeGroupId, nodeGroups],
  );

  const originalGroupForm = useMemo(
    () => (selectedGroup ? createNodeGroupForm(selectedGroup) : createEmptyNodeGroup()),
    [selectedGroup],
  );

  const originalNodeForm = useMemo(
    () => (selectedNode ? createNodeForm(selectedNode) : createEmptyNode(nodeForm.nodeGroupId)),
    [nodeForm.nodeGroupId, selectedNode],
  );

  const groupDirty = !formsMatch(groupForm, originalGroupForm);
  const nodeDirty = !formsMatch(nodeForm, originalNodeForm);

  const groupSubmitDisabled =
    groupSaving ||
    !groupForm.slug.trim() ||
    !groupForm.name.trim() ||
    (selectedGroup ? !groupDirty : false);

  const nodeSubmitDisabled =
    nodeSaving ||
    !nodeForm.nodeGroupId ||
    !nodeForm.label.trim() ||
    !nodeForm.hostname.trim() ||
    nodeForm.port < 1 ||
    nodeForm.speedUpMbps < 1 ||
    nodeForm.speedDownMbps < 1 ||
    (selectedNode ? !nodeDirty : false);

  function beginCreateNodeGroup() {
    setSelectedGroupId(null);
    setGroupForm(createEmptyNodeGroup());
    setFeedback(null);
  }

  function selectNodeGroup(nodeGroup: NodeGroupRecord | null) {
    if (!nodeGroup) {
      beginCreateNodeGroup();
      return;
    }

    setSelectedGroupId(nodeGroup.id);
    setGroupForm(createNodeGroupForm(nodeGroup));
    setNodeForm((current) =>
      selectedNode
        ? current
        : {
            ...current,
            nodeGroupId: current.nodeGroupId || nodeGroup.id,
          },
    );
  }

  function beginCreateNode(prefillGroupId = selectedGroupId || nodeForm.nodeGroupId || nodeGroups[0]?.id || "") {
    setSelectedNodeId(null);
    setNodeForm(createEmptyNode(prefillGroupId));
    setFeedback(null);
  }

  function selectNode(node: NodeRecord | null) {
    if (!node) {
      beginCreateNode();
      return;
    }

    setSelectedNodeId(node.id);
    setNodeForm(createNodeForm(node));

    const group = nodeGroups.find((item) => item.id === node.nodeGroupId) ?? null;
    if (group) {
      setSelectedGroupId(group.id);
      setGroupForm(createNodeGroupForm(group));
    }
  }

  function resetSelectedNodeGroup() {
    setGroupForm(originalGroupForm);
    setFeedback(null);
  }

  function resetSelectedNode() {
    setNodeForm(originalNodeForm);
    setFeedback(null);
  }

  async function handleNodeGroupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setGroupSaving(true);
    setError(null);
    setFeedback(null);

    try {
      const payload = {
        ...groupForm,
        slug: groupForm.slug.trim(),
        name: groupForm.name.trim(),
        description: groupForm.description.trim(),
      };

      const savedGroup = selectedGroup
        ? await apiRequest<NodeGroupRecord>(`/api/admin/node-groups/${selectedGroup.id}`, {
            method: "PATCH",
            token,
            body: payload,
          })
        : await apiRequest<NodeGroupRecord>("/api/admin/node-groups", {
            method: "POST",
            token,
            body: payload,
          });

      setSelectedGroupId(savedGroup.id);
      setGroupForm(createNodeGroupForm(savedGroup));
      setNodeForm((current) =>
        current.nodeGroupId && current.nodeGroupId !== (selectedGroup?.id ?? "")
          ? current
          : {
              ...current,
              nodeGroupId: savedGroup.id,
            },
      );
      setFeedback(selectedGroup ? "节点组已更新。" : "节点组已创建，并已预填到节点表单。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存节点组失败。");
    } finally {
      setGroupSaving(false);
    }
  }

  async function handleNodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setNodeSaving(true);
    setError(null);
    setFeedback(null);

    try {
      const payload = {
        ...nodeForm,
        label: nodeForm.label.trim(),
        hostname: nodeForm.hostname.trim(),
        obfsPassword: nodeForm.obfsPassword.trim(),
        sni: nodeForm.sni.trim(),
        pinSHA256: nodeForm.pinSHA256.trim(),
        trafficApiBaseUrl: nodeForm.trafficApiBaseUrl.trim(),
        trafficApiSecret: nodeForm.trafficApiSecret.trim(),
      };

      const savedNode = selectedNode
        ? await apiRequest<NodeRecord>(`/api/admin/nodes/${selectedNode.id}`, {
            method: "PATCH",
            token,
            body: payload,
          })
        : await apiRequest<NodeRecord>("/api/admin/nodes", {
            method: "POST",
            token,
            body: payload,
          });

      setSelectedNodeId(savedNode.id);
      setNodeForm(createNodeForm(savedNode));
      setFeedback(selectedNode ? "节点已更新。" : "节点已创建。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存节点失败。");
    } finally {
      setNodeSaving(false);
    }
  }

  return (
    <ConsoleShell
      title="节点与节点组"
      subtitle="把节点入口、Hysteria 参数和 Traffic API 信息都集中在一页维护。"
      scope="Operations"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">
          {loading ? "加载中..." : `${nodes.length} 个节点 / ${nodeGroups.length} 个节点组`}
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
          title="节点列表"
          copy="保存后会保留当前节点在编辑态，适合连续微调带宽、SNI 和 Traffic API。"
          action={
            <div className="panel-actions">
              {selectedNode ? (
                <button className="ghost-button compact" type="button" onClick={() => beginCreateNode()}>
                  新建节点
                </button>
              ) : null}
              <span className="fine-print">{loading ? "同步中..." : `${nodes.length} 条`}</span>
            </div>
          }
        >
          {loading && nodes.length === 0 ? (
            <div className="skeleton-rows">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="skeleton skeleton-row" />
              ))}
            </div>
          ) : null}
          <DataTable
            headers={["节点", "节点组", "带宽", "并发", "Traffic API"]}
            rows={nodes.map((node) => [
              <button
                key={node.id}
                type="button"
                className={`link-button${selectedNodeId === node.id ? " active" : ""}`}
                onClick={() => selectNode(node)}
              >
                <span>{node.label}</span>
                <span className="muted">
                  {node.hostname}:{node.port} · {node.active ? "启用中" : "已停用"}
                </span>
              </button>,
              node.groupName,
              `${node.speedUpMbps} / ${node.speedDownMbps} Mbps`,
              `${node.concurrentUsers}`,
              <span className="mono" key={`${node.id}-api`}>
                {node.trafficApiBaseUrl}
              </span>,
            ])}
          />
        </Panel>

        <div className="split">
          <Panel
            title={selectedGroup ? "编辑节点组" : "新建节点组"}
            copy="节点组保存后会继续停留在当前记录，适合先调组，再连着补节点。"
            action={
              <div className="panel-actions">
                {selectedGroup ? (
                  <button className="ghost-button compact" type="button" onClick={beginCreateNodeGroup}>
                    新建节点组
                  </button>
                ) : null}
                {selectedGroup ? (
                  <span className={`badge ${groupDirty ? "warn" : "success"}`}>
                    {groupDirty ? "有未保存改动" : "已同步"}
                  </span>
                ) : (
                  <span className="badge info">{nodeGroups.length} 个节点组</span>
                )}
              </div>
            }
          >
            <div className="usage-grid">
              <article className="metric-card">
                <span className="metric-label">当前组</span>
                <strong>{groupForm.name || "待创建"}</strong>
                <span className="metric-footnote">{groupForm.slug || "Slug 将自动跟随名称"}</span>
              </article>
              <article className="metric-card">
                <span className="metric-label">节点数量</span>
                <strong>{selectedGroup?.nodeCount ?? 0}</strong>
                <span className="metric-footnote">
                  {selectedGroup ? "来自当前节点组统计" : "新建后自动纳入统计"}
                </span>
              </article>
              <article className="metric-card">
                <span className="metric-label">状态</span>
                <strong>{groupForm.active ? "启用中" : "已停用"}</strong>
                <span className="metric-footnote">
                  {selectedGroup ? "停用后不会影响历史订阅记录" : "建议先启用再补节点"}
                </span>
              </article>
            </div>

            <form className="form-grid" onSubmit={handleNodeGroupSubmit}>
              <label className="field">
                <span className="fine-print">Slug</span>
                <input
                  className="control"
                  value={groupForm.slug}
                  onChange={(event) =>
                    setGroupForm((current) => ({ ...current, slug: slugifyValue(event.target.value) }))
                  }
                />
                <span className="field-hint">建议保持简短稳定，方便套餐绑定和节点筛选。</span>
              </label>
              <label className="field">
                <span className="fine-print">名称</span>
                <input
                  className="control"
                  value={groupForm.name}
                  onChange={(event) =>
                    setGroupForm((current) => {
                      const nextName = event.target.value;
                      const derivedSlug = slugifyValue(current.name);
                      const shouldSyncSlug = !current.slug || current.slug === derivedSlug;

                      return {
                        ...current,
                        name: nextName,
                        slug: shouldSyncSlug ? slugifyValue(nextName) : current.slug,
                      };
                    })
                  }
                />
              </label>
              <label className="field">
                <span className="fine-print">描述</span>
                <textarea
                  className="control textarea"
                  value={groupForm.description}
                  onChange={(event) =>
                    setGroupForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </label>
              <label className="field checkbox-row">
                <input
                  type="checkbox"
                  checked={groupForm.active}
                  onChange={(event) =>
                    setGroupForm((current) => ({ ...current, active: event.target.checked }))
                  }
                />
                <span>启用该节点组</span>
              </label>

              <div className="toolbar-actions">
                <button className="action-button" type="submit" disabled={groupSubmitDisabled}>
                  {groupSaving ? "保存中..." : selectedGroup ? "保存节点组" : "创建节点组"}
                </button>
                {selectedGroup ? (
                  <>
                    <button className="ghost-button" type="button" onClick={resetSelectedNodeGroup}>
                      恢复当前记录
                    </button>
                    <button className="ghost-button" type="button" onClick={beginCreateNodeGroup}>
                      切到新建
                    </button>
                  </>
                ) : null}
              </div>
            </form>

            {nodeGroups.length === 0 ? (
              <div className="feedback info">还没有节点组，先创建一个，再往下补具体节点。</div>
            ) : (
              <DataTable
                headers={["节点组", "节点数", "状态", "更新时间"]}
                rows={nodeGroups.map((group) => [
                  <button
                    key={group.id}
                    type="button"
                    className={`link-button${selectedGroupId === group.id ? " active" : ""}`}
                    onClick={() => selectNodeGroup(group)}
                  >
                    <span>{group.name}</span>
                    <span className="muted">{group.slug}</span>
                  </button>,
                  String(group.nodeCount),
                  <span key={`${group.id}-status`} className={`badge ${group.active ? "success" : "danger"}`}>
                    {group.active ? "active" : "inactive"}
                  </span>,
                  group.updatedAt.slice(0, 10),
                ])}
              />
            )}
          </Panel>

          <Panel
            title={selectedNode ? "编辑节点" : "新建节点"}
            copy="主机名、SNI、证书 pin 和 Traffic API 可以在同一页连续微调，不需要切页。"
            action={
              selectedNode ? (
                <span className={`badge ${nodeDirty ? "warn" : "success"}`}>
                  {nodeDirty ? "有未保存改动" : "已同步"}
                </span>
              ) : selectedNodeGroup ? (
                <span className="badge info">默认组：{selectedNodeGroup.name}</span>
              ) : (
                <span className="badge">先创建或选择节点组</span>
              )
            }
          >
            <div className="usage-grid">
              <article className="metric-card">
                <span className="metric-label">监听入口</span>
                <strong>
                  {nodeForm.hostname ? `${nodeForm.hostname}:${nodeForm.port}` : "待填写"}
                </strong>
                <span className="metric-footnote">{selectedNodeGroup?.name ?? "未指定节点组"}</span>
              </article>
              <article className="metric-card">
                <span className="metric-label">速率</span>
                <strong>
                  {nodeForm.speedUpMbps} / {nodeForm.speedDownMbps} Mbps
                </strong>
                <span className="metric-footnote">
                  {selectedNode ? `${selectedNode.concurrentUsers} 个并发在线` : "新节点默认无并发"}
                </span>
              </article>
              <article className="metric-card">
                <span className="metric-label">TLS / Obfs</span>
                <strong>{nodeForm.sni || "未设置 SNI"}</strong>
                <span className="metric-footnote">
                  {nodeForm.obfsPassword ? "已配置 salamander obfs" : "未配置 obfs"}
                </span>
              </article>
            </div>

            <form className="form-grid" onSubmit={handleNodeSubmit}>
              <label className="field">
                <span className="fine-print">节点组</span>
                <select
                  className="control"
                  value={nodeForm.nodeGroupId}
                  onChange={(event) =>
                    setNodeForm((current) => ({ ...current, nodeGroupId: event.target.value }))
                  }
                >
                  <option value="">请选择节点组</option>
                  {nodeGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                {nodeGroups.length === 0 ? (
                  <span className="field-hint">还没有节点组，先在上方创建一个。</span>
                ) : null}
              </label>

              <div className="two-col">
                <label className="field">
                  <span className="fine-print">显示名</span>
                  <input
                    className="control"
                    value={nodeForm.label}
                    onChange={(event) =>
                      setNodeForm((current) => ({ ...current, label: event.target.value }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">主机名</span>
                  <input
                    className="control"
                    value={nodeForm.hostname}
                    onChange={(event) =>
                      setNodeForm((current) => {
                        const nextHostname = event.target.value;
                        const shouldSyncSni = !selectedNode && (!current.sni || current.sni === current.hostname);

                        return {
                          ...current,
                          hostname: nextHostname,
                          sni: shouldSyncSni ? nextHostname : current.sni,
                        };
                      })
                    }
                  />
                  <span className="field-hint">首次创建时，若 SNI 为空会自动跟随主机名。</span>
                </label>
              </div>

              <div className="tri-grid">
                <label className="field">
                  <span className="fine-print">端口</span>
                  <input
                    className="control"
                    type="number"
                    value={nodeForm.port}
                    onChange={(event) =>
                      setNodeForm((current) => ({ ...current, port: Number(event.target.value) }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">上行 Mbps</span>
                  <input
                    className="control"
                    type="number"
                    value={nodeForm.speedUpMbps}
                    onChange={(event) =>
                      setNodeForm((current) => ({
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
                    value={nodeForm.speedDownMbps}
                    onChange={(event) =>
                      setNodeForm((current) => ({
                        ...current,
                        speedDownMbps: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>

              <details className="field-section" open={!!nodeForm.sni || !!nodeForm.obfsPassword || !!nodeForm.pinSHA256 || nodeForm.allowInsecureTls}>
                <summary>TLS / Obfs 进阶配置（可选）</summary>
                <div className="field-section-body">
                  <label className="field">
                    <div className="field-inline-actions">
                      <span className="fine-print">SNI</span>
                      <button
                        className="ghost-button compact"
                        type="button"
                        onClick={() =>
                          setNodeForm((current) => ({
                            ...current,
                            sni: current.hostname,
                          }))
                        }
                        disabled={!nodeForm.hostname}
                      >
                        用主机名填充
                      </button>
                    </div>
                    <input
                      className="control"
                      placeholder="留空则不验证 SNI"
                      value={nodeForm.sni}
                      onChange={(event) =>
                        setNodeForm((current) => ({ ...current, sni: event.target.value }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span className="fine-print">Obfs Password</span>
                    <input
                      className="control"
                      placeholder="salamander 混淆密码，留空则不开启"
                      value={nodeForm.obfsPassword}
                      onChange={(event) =>
                        setNodeForm((current) => ({ ...current, obfsPassword: event.target.value }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span className="fine-print">Pin SHA256</span>
                    <input
                      className="control mono"
                      placeholder="TLS 证书指纹，留空则不固定"
                      value={nodeForm.pinSHA256}
                      onChange={(event) =>
                        setNodeForm((current) => ({ ...current, pinSHA256: event.target.value }))
                      }
                    />
                  </label>

                  <label className="field checkbox-row">
                    <input
                      type="checkbox"
                      checked={nodeForm.allowInsecureTls}
                      onChange={(event) =>
                        setNodeForm((current) => ({
                          ...current,
                          allowInsecureTls: event.target.checked,
                        }))
                      }
                    />
                    <span>允许不安全 TLS（跳过证书验证）</span>
                  </label>
                </div>
              </details>

              <div>
                <div className="field-section-label">Traffic API 接入</div>
                <div className="form-grid" style={{ marginTop: 10 }}>
                  <label className="field">
                    <span className="fine-print">Base URL</span>
                    <input
                      className="control mono"
                      value={nodeForm.trafficApiBaseUrl}
                      onChange={(event) =>
                        setNodeForm((current) => ({
                          ...current,
                          trafficApiBaseUrl: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="field">
                    <span className="fine-print">Secret</span>
                    <input
                      className="control mono"
                      value={nodeForm.trafficApiSecret}
                      onChange={(event) =>
                        setNodeForm((current) => ({
                          ...current,
                          trafficApiSecret: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>

              <label className="field checkbox-row">
                <input
                  type="checkbox"
                  checked={nodeForm.active}
                  onChange={(event) =>
                    setNodeForm((current) => ({ ...current, active: event.target.checked }))
                  }
                />
                <span>启用节点</span>
              </label>

              <div className="toolbar-actions">
                <button className="action-button" type="submit" disabled={nodeSubmitDisabled}>
                  {nodeSaving ? "保存中..." : selectedNode ? "保存节点" : "创建节点"}
                </button>
                {selectedNode ? (
                  <>
                    <button className="ghost-button" type="button" onClick={resetSelectedNode}>
                      恢复当前记录
                    </button>
                    <button className="ghost-button" type="button" onClick={() => beginCreateNode()}>
                      切到新建
                    </button>
                  </>
                ) : null}
              </div>
            </form>
          </Panel>
        </div>
      </section>
    </ConsoleShell>
  );
}
