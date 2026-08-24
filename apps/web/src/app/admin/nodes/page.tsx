"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";

type Member = { memberId: string; nodeId: string; nodeLabel: string; priority: number; weight: number; lifecycleStatus: string; region?: string | null; provider?: string | null; tags: string[]; capacityUsers?: number | null; onlineUsers: number; capacityPercent?: number | null; healthy?: boolean | null; serviceable: boolean };
type Pool = { id: string; slug: string; name: string; description?: string | null; region?: string | null; active: boolean; profileNames: string[]; serviceableNodes: number; totalNodes: number; onlineUsers: number; members: Member[] };
type NodeItem = { id: string; label: string; protocol: string; lifecycleStatus: string; active: boolean; region?: string | null; provider?: string | null; tags: string[]; capacityUsers?: number | null; pools: string[]; healthy?: boolean | null; syncDelaySeconds?: number | null };
type Overview = { pools: Pool[]; nodes: NodeItem[] };
type PoolForm = { slug: string; name: string; description: string; region: string; active: boolean; members: Array<{ nodeId: string; priority: number; weight: number }> };

const emptyPool = (): PoolForm => ({ slug: "", name: "", description: "", region: "", active: true, members: [] });

export default function NodeResourcesPage() {
  const { token } = useAuth();
  const [data, setData] = useState<Overview>({ pools: [], nodes: [] });
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Pool | null>(null);
  const [form, setForm] = useState<PoolForm>(() => emptyPool());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await apiRequest<Overview>("/api/admin/node-ops", { token })); setError(null); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "节点资源池加载失败。"); }
  }, [token]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function openPool(pool?: Pool) {
    setEditing(pool ?? null);
    setForm(pool ? { slug: pool.slug, name: pool.name, description: pool.description ?? "", region: pool.region ?? "", active: pool.active, members: pool.members.map((member) => ({ nodeId: member.nodeId, priority: member.priority, weight: member.weight })) } : emptyPool());
    setDrawerOpen(true); setError(null);
  }

  function toggleNode(nodeId: string, checked: boolean) {
    setForm((current) => ({ ...current, members: checked ? [...current.members, { nodeId, priority: current.members.length * 10, weight: 100 }] : current.members.filter((member) => member.nodeId !== nodeId) }));
  }

  async function savePool(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await apiRequest(editing ? `/api/admin/node-ops/pools/${editing.id}` : "/api/admin/node-ops/pools", {
        method: editing ? "PUT" : "POST", token,
        body: { ...form, slug: form.slug.trim(), name: form.name.trim(), description: form.description.trim() || undefined, region: form.region.trim() || undefined },
      });
      setDrawerOpen(false); setFeedback(editing ? "资源池已更新。" : "资源池已创建。"); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "资源池保存失败。"); }
    finally { setBusy(false); }
  }

  async function setLifecycle(node: NodeItem, lifecycleStatus: string) {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      await apiRequest(`/api/admin/node-ops/nodes/${node.id}`, { method: "PATCH", token, body: { lifecycleStatus, region: node.region ?? undefined, provider: node.provider ?? undefined, tags: node.tags, capacityUsers: node.capacityUsers ?? undefined } });
      setFeedback(`${node.label} 已切换为 ${lifecycleStatus.toUpperCase()}。`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "节点状态更新失败。"); }
    finally { setBusy(false); }
  }

  const serviceable = data.nodes.filter((node) => node.lifecycleStatus === "active" && node.active).length;
  const draining = data.nodes.filter((node) => node.lifecycleStatus === "draining").length;
  const online = data.pools.reduce((sum, pool) => sum + pool.onlineUsers, 0);

  return (
    <ConsoleShell title="节点资源池" subtitle="节点生命周期、容量与访问策略资源池" scope="Node Ops" navItems={adminNav} requireRole="admin"
      toolbarMeta={<span className="badge info">{data.pools.length} 个资源池 · {data.nodes.length} 个节点</span>}
      toolbarActions={<button className="action-button" type="button" onClick={() => openPool()}><Icon name="add" />新建资源池</button>}>
      {error && !drawerOpen ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard label="可服务节点" value={String(serviceable)} footnote="ACTIVE 且已启用" />
          <MetricCard label="排空中" value={String(draining)} footnote="不承接新连接" />
          <MetricCard label="资源池" value={String(data.pools.length)} footnote="访问策略按池绑定" />
          <MetricCard label="在线人数" value={String(online)} footnote="最新服务检查" />
        </div>
        <Panel title="资源池" copy="访问策略绑定资源池，接入配置按池和成员优先级排序。">
          <DataTable headers={["资源池","策略","地区","节点","在线","状态","操作"]} rows={data.pools.map((pool) => [
            <span className="list" key={pool.id}><strong>{pool.name}</strong><small className="mono">{pool.slug}</small></span>,
            pool.profileNames.join(" · ") || "尚未绑定",
            pool.region ?? "-",
            `${pool.serviceableNodes} / ${pool.totalNodes} 可用`,
            pool.onlineUsers,
            <span className={`badge ${pool.active && pool.serviceableNodes ? "success" : "danger"}`} key={`${pool.id}-status`}>{pool.active ? (pool.serviceableNodes ? "正常" : "无可用节点") : "停用"}</span>,
            <button className="ghost-button compact" type="button" key={`${pool.id}-edit`} onClick={() => openPool(pool)}><Icon name="edit" />编辑</button>,
          ])} />
        </Panel>
        <Panel title="节点生命周期" copy="DRAINING 不再承接新连接，MAINTENANCE 与 DISABLED 不下发接入配置。">
          <DataTable headers={["节点","协议","地区 / 供应商","标签","容量","资源池","健康","生命周期"]} rows={data.nodes.map((node) => [
            node.label,
            node.protocol === "vless_reality" ? "VLESS + REALITY" : "Hysteria 2",
            `${node.region ?? "-"} / ${node.provider ?? "-"}`,
            node.tags.join(" · ") || "-",
            node.capacityUsers ? `${node.capacityUsers} 人` : "未设置",
            node.pools.join(" · ") || "未入池",
            <span className={`badge ${node.healthy === true ? "success" : node.healthy === false ? "danger" : "neutral"}`} key={`${node.id}-health`}>{node.healthy === true ? "正常" : node.healthy === false ? "异常" : "未知"}</span>,
            <CustomSelect key={`${node.id}-lifecycle`} value={node.lifecycleStatus} onChange={(value) => void setLifecycle(node, value)} options={[
              { value: "active", label: "ACTIVE" }, { value: "draining", label: "DRAINING" }, { value: "maintenance", label: "MAINTENANCE" }, { value: "disabled", label: "DISABLED" },
            ]} />,
          ])} />
        </Panel>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? `编辑资源池：${editing.name}` : "新建资源池"}
        footer={<div className="toolbar-actions"><button className="action-button" disabled={busy || !form.name.trim() || !form.slug.trim() || !form.members.length} type="submit" form="pool-form">保存资源池</button><button className="ghost-button" type="button" onClick={() => setDrawerOpen(false)}>取消</button></div>}>
        {drawerOpen && error ? <div className="feedback error">{error}</div> : null}
        <form id="pool-form" className="form-grid" onSubmit={savePool}>
          <label className="field"><span className="fine-print">名称</span><input className="control" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="field"><span className="fine-print">Slug</span><input className="control mono" value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} /></label>
          <label className="field"><span className="fine-print">地区</span><input className="control" value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} /></label>
          <label className="field"><span className="fine-print">说明</span><textarea className="control" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /><span>启用资源池</span></label>
          <div className="list"><strong>成员与优先级</strong>{data.nodes.map((node) => {
            const member = form.members.find((item) => item.nodeId === node.id);
            return <div className="pool-member-editor" key={node.id}>
              <label className="checkbox-field"><input type="checkbox" checked={Boolean(member)} onChange={(event) => toggleNode(node.id, event.target.checked)} /><span>{node.label}</span></label>
              {member ? <input className="control compact-number" aria-label={`${node.label} 优先级`} type="number" min={0} value={member.priority} onChange={(event) => setForm((current) => ({ ...current, members: current.members.map((item) => item.nodeId === node.id ? { ...item, priority: Number(event.target.value) } : item) }))} /> : null}
            </div>;
          })}</div>
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
