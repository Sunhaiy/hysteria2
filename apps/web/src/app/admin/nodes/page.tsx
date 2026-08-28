"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";

type Endpoint = {
  id: string;
  label: string;
  protocol: "hysteria2" | "vless_reality";
  hostname: string;
  port: number;
  portHoppingEnabled: boolean;
  portHoppingStart?: number | null;
  portHoppingEnd?: number | null;
  portHoppingIntervalSeconds: number;
  lifecycleStatus: "active" | "draining" | "maintenance" | "disabled";
  active: boolean;
  tags: string[];
  capacityUsers?: number | null;
  onlineUsers: number;
  capacityPercent?: number | null;
  priority?: number | null;
  accessProfiles: Array<{ id: string; name: string; priority: number }>;
  healthy?: boolean | null;
  latencyMs?: number | null;
  lastCheckedAt?: string | null;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  obfsPassword?: string | null;
  sni?: string | null;
  allowInsecureTls: boolean;
  realityPublicKey?: string | null;
  realityShortId?: string | null;
  trafficApiBaseUrl: string;
  trafficApiSecretSet: boolean;
  controlApiBaseUrl?: string | null;
  controlApiSecretSet: boolean;
  runtimeControlConfigured: boolean;
  runtimeState:
    | "unknown"
    | "active"
    | "inactive"
    | "activating"
    | "deactivating"
    | "failed";
  runtimeStateObservedAt?: string | null;
  runtimeError?: string | null;
  speedUpMbps: number;
  speedDownMbps: number;
  trafficGuard?: {
    enabled: boolean;
    configured: boolean;
    limitGiB?: number | null;
    limitBytes?: number | null;
    resetDay: number;
    usedBytes: number;
    remainingBytes?: number | null;
    usagePercent: number;
    thresholdReached: boolean;
    cycleStart: string;
    cycleEnd: string;
    nextResetAt: string;
    stopCommandStatus?: string | null;
    status:
      | "disabled"
      | "unavailable"
      | "monitoring"
      | "limit_reached"
      | "stop_queued"
      | "stopped";
  };
  latestRuntimeCommand?: {
    id: string;
    action: "start" | "stop" | "status";
    status: "queued" | "running" | "succeeded" | "failed";
    resultState?: Endpoint["runtimeState"] | null;
    error?: string | null;
    requestedAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
  } | null;
};
type Server = {
  id: string;
  slug: string;
  name: string;
  hostname: string;
  region?: string | null;
  provider?: string | null;
  active: boolean;
  onlineUsers: number;
  healthyEndpoints: number;
  endpoints: Endpoint[];
};
type Overview = { servers: Server[]; nodes: Endpoint[] };
type ServerForm = {
  slug: string;
  name: string;
  hostname: string;
  region: string;
  provider: string;
};
type NodeForm = {
  serverId: string;
  protocol: Endpoint["protocol"];
  label: string;
  hostname: string;
  port: number;
  portHoppingEnabled: boolean;
  portHoppingStart: number;
  portHoppingEnd: number;
  portHoppingIntervalSeconds: number;
  obfsPassword: string;
  sni: string;
  realityPublicKey: string;
  realityShortId: string;
  trafficApiBaseUrl: string;
  trafficApiSecret: string;
  controlApiBaseUrl: string;
  controlApiSecret: string;
  allowInsecureTls: boolean;
  speedUpMbps: number;
  speedDownMbps: number;
};
type TrafficLimitForm = {
  enabled: boolean;
  monthlyLimitGiB: string;
  resetDay: number;
};

const emptyServerForm: ServerForm = {
  slug: "",
  name: "",
  hostname: "",
  region: "",
  provider: "",
};
const emptyNodeForm: NodeForm = {
  serverId: "",
  protocol: "vless_reality",
  label: "",
  hostname: "",
  port: 443,
  portHoppingEnabled: false,
  portHoppingStart: 20000,
  portHoppingEnd: 29999,
  portHoppingIntervalSeconds: 30,
  obfsPassword: "",
  sni: "",
  realityPublicKey: "",
  realityShortId: "",
  trafficApiBaseUrl: "",
  trafficApiSecret: "",
  controlApiBaseUrl: "",
  controlApiSecret: "",
  allowInsecureTls: false,
  speedUpMbps: 0,
  speedDownMbps: 0,
};
const emptyTrafficLimitForm: TrafficLimitForm = {
  enabled: false,
  monthlyLimitGiB: "1000",
  resetDay: 1,
};

const protocolName = (protocol: Endpoint["protocol"]) =>
  protocol === "vless_reality" ? "VLESS + Reality" : "Hysteria2";
const lifecycleName = (status: Endpoint["lifecycleStatus"]) =>
  ({
    active: "启用",
    draining: "排空中",
    maintenance: "维护中",
    disabled: "已停用",
  })[status];
const runtimeStateName = (state: Endpoint["runtimeState"]) =>
  ({
    unknown: "未知",
    active: "运行中",
    inactive: "已停止",
    activating: "启动中",
    deactivating: "停止中",
    failed: "服务异常",
  })[state];
const runtimeStateBadge = (state: Endpoint["runtimeState"]) =>
  state === "active"
    ? "success"
    : state === "inactive" || state === "unknown"
      ? "neutral"
      : state === "failed"
        ? "danger"
        : "warn";
const runtimeStateDetail = (node: Endpoint) =>
  node.latestRuntimeCommand?.status === "queued"
    ? "命令排队中"
    : node.latestRuntimeCommand?.status === "running"
      ? "命令执行中"
      : node.latestRuntimeCommand?.status === "failed"
        ? (node.latestRuntimeCommand.error ?? "最近命令失败")
        : node.runtimeError
          ? node.runtimeError
          : node.runtimeStateObservedAt
            ? formatDateTime(node.runtimeStateObservedAt)
            : node.runtimeControlConfigured
              ? "等待状态采集"
              : "未配置服务管理";
const trafficGuardStatusName = (
  status: NonNullable<Endpoint["trafficGuard"]>["status"],
) =>
  ({
    disabled: "未启用",
    unavailable: "服务管理未配置",
    monitoring: "监控中",
    limit_reached: "已达上限",
    stop_queued: "正在自动停止",
    stopped: "已自动停止",
  })[status];

export default function NodesPage() {
  const { token } = useAuth();
  const [data, setData] = useState<Overview>({ servers: [], nodes: [] });
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"server" | "node" | "traffic" | null>(
    null,
  );
  const [serverForm, setServerForm] = useState<ServerForm>(emptyServerForm);
  const [nodeForm, setNodeForm] = useState<NodeForm>(emptyNodeForm);
  const [trafficLimitForm, setTrafficLimitForm] = useState<TrafficLimitForm>(
    emptyTrafficLimitForm,
  );
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [editingNode, setEditingNode] = useState<Endpoint | null>(null);
  const [editingTrafficNode, setEditingTrafficNode] = useState<Endpoint | null>(
    null,
  );

  const load = useCallback(
    async (signal?: AbortSignal, showLoading = true) => {
      if (!token) return;
      if (showLoading) setLoading(true);
      try {
        setData(
          await apiRequest<Overview>("/api/admin/node-ops", { token, signal }),
        );
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof ApiError ? cause.message : "节点数据加载失败。",
        );
      } finally {
        if (!signal?.aborted && showLoading) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const hasPendingRuntimeCommand = data.nodes.some(
    (node) =>
      node.latestRuntimeCommand?.status === "queued" ||
      node.latestRuntimeCommand?.status === "running",
  );

  useEffect(() => {
    if (!hasPendingRuntimeCommand) return;
    const timer = window.setInterval(() => void load(undefined, false), 2000);
    return () => window.clearInterval(timer);
  }, [hasPendingRuntimeCommand, load]);

  async function setLifecycle(
    node: Endpoint,
    lifecycleStatus: Endpoint["lifecycleStatus"],
  ) {
    if (!token) return;
    setBusyId(node.id);
    setError(null);
    try {
      await apiRequest(`/api/admin/node-ops/nodes/${node.id}`, {
        method: "PATCH",
        token,
        body: {
          lifecycleStatus,
          tags: node.tags,
          capacityUsers: node.capacityUsers ?? undefined,
        },
      });
      setFeedback(
        lifecycleStatus === "active"
          ? `${node.label} 已恢复接入，新订阅和鉴权会重新使用该节点。`
          : `${node.label} 已停止接入，新订阅和鉴权不再使用该节点，已有连接保持不变。`,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "节点状态更新失败。",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function requestRuntimeCommand(
    node: Endpoint,
    action: "start" | "stop" | "status",
  ) {
    if (!token) return;
    if (
      action === "stop" &&
      !window.confirm(`确认停止“${node.label}”的运行服务？当前连接会立即断开。`)
    )
      return;
    setBusyId(node.id);
    setError(null);
    try {
      await apiRequest(
        `/api/admin/node-ops/nodes/${node.id}/runtime-commands`,
        {
          method: "POST",
          token,
          body: { action, idempotencyKey: crypto.randomUUID() },
        },
      );
      setFeedback(
        `${node.label} 的${action === "start" ? "启动" : action === "stop" ? "停止" : "状态查询"}命令已进入执行队列。`,
      );
      await load(undefined, false);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "运行服务命令提交失败。",
      );
    } finally {
      setBusyId(null);
    }
  }

  function openServerDrawer(server?: Server) {
    setEditingServer(server ?? null);
    setServerForm(
      server
        ? {
            slug: server.slug,
            name: server.name,
            hostname: server.hostname,
            region: server.region ?? "",
            provider: server.provider ?? "",
          }
        : emptyServerForm,
    );
    setDrawer("server");
    setError(null);
  }

  function openNodeDrawer(server?: Server, node?: Endpoint) {
    const availableServers = data.servers.filter(
      (item) => item.id !== "unassigned",
    );
    setEditingNode(node ?? null);
    setNodeForm(
      node
        ? {
            serverId: server?.id ?? "",
            protocol: node.protocol,
            label: node.label,
            hostname: node.hostname,
            port: node.port,
            portHoppingEnabled: node.portHoppingEnabled,
            portHoppingStart: node.portHoppingStart ?? 20000,
            portHoppingEnd: node.portHoppingEnd ?? 29999,
            portHoppingIntervalSeconds: node.portHoppingIntervalSeconds ?? 30,
            obfsPassword: node.obfsPassword ?? "",
            sni: node.sni ?? "",
            realityPublicKey: node.realityPublicKey ?? "",
            realityShortId: node.realityShortId ?? "",
            trafficApiBaseUrl: node.trafficApiBaseUrl,
            trafficApiSecret: "",
            controlApiBaseUrl: node.controlApiBaseUrl ?? "",
            controlApiSecret: "",
            allowInsecureTls: node.allowInsecureTls,
            speedUpMbps: node.speedUpMbps,
            speedDownMbps: node.speedDownMbps,
          }
        : {
            ...emptyNodeForm,
            serverId: server?.id ?? availableServers[0]?.id ?? "",
            hostname: server?.hostname ?? availableServers[0]?.hostname ?? "",
          },
    );
    setDrawer("node");
    setError(null);
  }

  function openTrafficLimitDrawer(node: Endpoint) {
    setEditingTrafficNode(node);
    setTrafficLimitForm({
      enabled: node.trafficGuard?.enabled ?? false,
      monthlyLimitGiB: String(node.trafficGuard?.limitGiB ?? 1000),
      resetDay: node.trafficGuard?.resetDay ?? 1,
    });
    setDrawer("traffic");
    setError(null);
  }

  async function saveServer(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusyId(editingServer?.id ?? "new-server");
    setError(null);
    try {
      await apiRequest(
        editingServer
          ? `/api/admin/node-ops/servers/${editingServer.id}`
          : "/api/admin/node-ops/servers",
        {
          method: editingServer ? "PUT" : "POST",
          token,
          body: {
            ...serverForm,
            slug: serverForm.slug.trim(),
            name: serverForm.name.trim(),
            hostname: serverForm.hostname.trim(),
            region: serverForm.region.trim() || undefined,
            provider: serverForm.provider.trim() || undefined,
            active: editingServer?.active ?? true,
          },
        },
      );
      setDrawer(null);
      setEditingServer(null);
      setFeedback(
        editingServer
          ? "服务器信息已更新。"
          : "服务器已新增，可继续登记协议节点。",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "服务器新增失败。");
    } finally {
      setBusyId(null);
    }
  }

  async function saveNode(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setBusyId(editingNode?.id ?? "new-node");
    setError(null);
    try {
      await apiRequest(
        editingNode ? `/api/admin/nodes/${editingNode.id}` : "/api/admin/nodes",
        {
          method: editingNode ? "PATCH" : "POST",
          token,
          body: {
            serverId: nodeForm.serverId,
            protocol: nodeForm.protocol,
            label: nodeForm.label.trim(),
            hostname: nodeForm.hostname.trim(),
            port: nodeForm.port,
            portHoppingEnabled:
              nodeForm.protocol === "hysteria2" && nodeForm.portHoppingEnabled,
            portHoppingStart:
              nodeForm.protocol === "hysteria2"
                ? nodeForm.portHoppingStart
                : undefined,
            portHoppingEnd:
              nodeForm.protocol === "hysteria2"
                ? nodeForm.portHoppingEnd
                : undefined,
            portHoppingIntervalSeconds:
              nodeForm.protocol === "hysteria2"
                ? nodeForm.portHoppingIntervalSeconds
                : undefined,
            obfsPassword:
              nodeForm.protocol === "hysteria2"
                ? nodeForm.obfsPassword.trim() || undefined
                : undefined,
            sni: nodeForm.sni.trim() || undefined,
            allowInsecureTls: nodeForm.allowInsecureTls,
            realityPublicKey:
              nodeForm.protocol === "vless_reality"
                ? nodeForm.realityPublicKey.trim()
                : undefined,
            realityShortId:
              nodeForm.protocol === "vless_reality"
                ? nodeForm.realityShortId.trim() || undefined
                : undefined,
            realityFingerprint:
              nodeForm.protocol === "vless_reality" ? "chrome" : undefined,
            realitySpiderX:
              nodeForm.protocol === "vless_reality" ? "/" : undefined,
            vlessFlow:
              nodeForm.protocol === "vless_reality"
                ? "xtls-rprx-vision"
                : undefined,
            trafficApiBaseUrl: nodeForm.trafficApiBaseUrl.trim(),
            trafficApiSecret:
              nodeForm.trafficApiSecret || (editingNode ? undefined : ""),
            controlApiBaseUrl: nodeForm.controlApiBaseUrl.trim(),
            controlApiSecret: nodeForm.controlApiSecret || undefined,
            active: editingNode ? undefined : true,
            speedUpMbps: nodeForm.speedUpMbps,
            speedDownMbps: nodeForm.speedDownMbps,
          },
        },
      );
      setDrawer(null);
      setEditingNode(null);
      setFeedback(editingNode ? "节点配置已更新。" : "节点已新增并启用。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "节点新增失败。");
    } finally {
      setBusyId(null);
    }
  }

  async function saveTrafficLimit(event: FormEvent) {
    event.preventDefault();
    if (!token || !editingTrafficNode) return;
    const monthlyLimitGiB = Number(trafficLimitForm.monthlyLimitGiB);
    if (!Number.isFinite(monthlyLimitGiB) || monthlyLimitGiB < 1) {
      setError("月度流量上限至少为 1 GiB。");
      return;
    }
    const busyKey = `traffic-${editingTrafficNode.id}`;
    setBusyId(busyKey);
    setError(null);
    try {
      await apiRequest(
        `/api/admin/node-ops/nodes/${editingTrafficNode.id}/traffic-limit`,
        {
          method: "PUT",
          token,
          body: {
            enabled: trafficLimitForm.enabled,
            monthlyLimitGiB,
            resetDay: trafficLimitForm.resetDay,
          },
        },
      );
      setDrawer(null);
      setEditingTrafficNode(null);
      setFeedback(`${editingTrafficNode.label} 的流量保护策略已更新。`);
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "流量保护策略保存失败。",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteNode(node: Endpoint) {
    if (!token || !window.confirm(`确认删除节点“${node.label}”？`)) return;
    setBusyId(node.id);
    setError(null);
    try {
      await apiRequest(`/api/admin/nodes/${node.id}`, {
        method: "DELETE",
        token,
      });
      setFeedback(`${node.label} 已删除。`);
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "节点仍有关联记录，无法删除。",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteServer(server: Server) {
    if (
      !token ||
      !window.confirm(
        `确认删除服务器“${server.name}”及其已停用节点？历史流量和审计记录会保留。`,
      )
    )
      return;
    setBusyId(server.id);
    setError(null);
    try {
      await apiRequest(`/api/admin/node-ops/servers/${server.id}`, {
        method: "DELETE",
        token,
      });
      setFeedback(`${server.name} 已删除。`);
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "请先移动或删除服务器下的全部节点。",
      );
    } finally {
      setBusyId(null);
    }
  }

  const activeEndpoints = data.nodes.filter(
    (node) => node.lifecycleStatus === "active" && node.active,
  ).length;
  const healthyEndpoints = data.nodes.filter(
    (node) => node.healthy === true,
  ).length;
  const onlineUsers = data.servers.reduce(
    (total, server) => total + server.onlineUsers,
    0,
  );
  const managedServers = data.servers.filter(
    (server) => server.id !== "unassigned",
  );

  return (
    <ConsoleShell
      title="服务器与协议端点"
      subtitle="按物理服务器管理 Hysteria2 与 VLESS + Reality"
      scope="Node Ops"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">
          {data.servers.length} 台服务器 · {data.nodes.length} 个端点
        </span>
      }
      toolbarActions={
        <>
          <button
            className="ghost-button"
            type="button"
            onClick={() => openServerDrawer()}
          >
            <Icon name="add" />
            新增服务器
          </button>
          <button
            className="action-button"
            type="button"
            onClick={() => openNodeDrawer()}
            disabled={!managedServers.length}
          >
            <Icon name="add" />
            新增节点
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => void load()}
          >
            <Icon name="refresh" />
            刷新
          </button>
        </>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      <div className="page-stack">
        <div className="metric-grid">
          <MetricCard
            label="物理服务器"
            value={String(data.servers.length)}
            footnote="按主机归组"
          />
          <MetricCard
            label="可服务端点"
            value={String(activeEndpoints)}
            footnote="ACTIVE 且启用"
          />
          <MetricCard
            label="健康端点"
            value={`${healthyEndpoints} / ${data.nodes.length}`}
            footnote="最近一次协议探测"
          />
          <MetricCard
            label="在线连接"
            value={String(onlineUsers)}
            footnote="45 秒内当前投影"
          />
        </div>
        {loading && data.servers.length === 0 ? (
          <div className="skeleton" style={{ height: 320 }} />
        ) : null}
        {data.servers.map((server) => (
          <Panel
            key={server.id}
            title={server.name}
            copy={
              [server.hostname, server.region, server.provider]
                .filter(Boolean)
                .join(" · ") || "未填写服务器信息"
            }
            action={
              <div className="toolbar-actions">
                <span
                  className={`badge ${server.active ? "success" : "neutral"}`}
                >
                  {server.healthyEndpoints} / {server.endpoints.length} 健康 ·{" "}
                  {server.onlineUsers} 在线
                </span>
                {server.id !== "unassigned" ? (
                  <>
                    <button
                      className="ghost-button compact"
                      type="button"
                      onClick={() => openServerDrawer(server)}
                    >
                      <Icon name="edit" />
                      编辑服务器
                    </button>
                    <button
                      className="ghost-button compact"
                      type="button"
                      onClick={() => openNodeDrawer(server)}
                    >
                      <Icon name="add" />
                      新增节点
                    </button>
                    <button
                      className="danger-button compact"
                      disabled={
                        busyId === server.id ||
                        server.endpoints.some(
                          (node) =>
                            node.active ||
                            node.lifecycleStatus !== "disabled" ||
                            node.onlineUsers > 0 ||
                            ["active", "activating", "deactivating"].includes(
                              node.runtimeState,
                            ),
                        )
                      }
                      type="button"
                      title={
                        server.endpoints.some(
                          (node) =>
                            node.active ||
                            node.lifecycleStatus !== "disabled" ||
                            node.onlineUsers > 0 ||
                            ["active", "activating", "deactivating"].includes(
                              node.runtimeState,
                            ),
                        )
                          ? "请先停用节点、停止运行服务并确认没有在线连接"
                          : "安全删除服务器并保留历史记录"
                      }
                      onClick={() => void deleteServer(server)}
                    >
                      删除服务器
                    </button>
                  </>
                ) : null}
              </div>
            }
          >
            <div className="node-endpoint-list">
              {server.endpoints.length ? (
                server.endpoints.map((node) => (
                  <article className="node-endpoint-row" key={node.id}>
                    <div className="node-endpoint-main">
                      <div className="node-endpoint-heading">
                        <strong>{node.label}</strong>
                        <span className="badge neutral">
                          {protocolName(node.protocol)}
                        </span>
                      </div>
                      <span className="mono">
                        {node.hostname}:{node.port}
                      </span>
                      {node.portHoppingEnabled &&
                      node.portHoppingStart &&
                      node.portHoppingEnd ? (
                        <span className="badge success">
                          端口跳跃 {node.portHoppingStart}-{node.portHoppingEnd}
                        </span>
                      ) : null}
                      <span className="fine-print">
                        {node.accessProfiles.length
                          ? node.accessProfiles
                              .map(
                                (profile) =>
                                  `${profile.name.replace(/\s*访问策略/g, "")} · 优先级 ${profile.priority + 1}`,
                              )
                              .join(" / ")
                          : "尚未分配给套餐"}
                      </span>
                    </div>
                    <div className="node-endpoint-telemetry">
                      <div className="node-endpoint-fact">
                        <span className="fine-print">在线 / 容量</span>
                        <strong>
                          {node.capacityUsers
                            ? `${node.onlineUsers} / ${node.capacityUsers}（${node.capacityPercent ?? 0}%）`
                            : `${node.onlineUsers} / 未设置`}
                        </strong>
                      </div>
                      <div className="node-endpoint-fact">
                        <span className="fine-print">健康 / 同步</span>
                        <div className="inline-stack">
                          <span
                            className={`badge ${node.healthy === true ? "success" : node.healthy === false ? "danger" : "neutral"}`}
                            title={node.lastSyncError ?? undefined}
                          >
                            {node.healthy === true
                              ? `${node.latencyMs ?? 0} ms`
                              : node.healthy === false
                                ? "异常"
                                : "未知"}
                          </span>
                          <small>
                            {node.lastSyncAt
                              ? formatDateTime(node.lastSyncAt)
                              : "尚未同步"}
                          </small>
                        </div>
                      </div>
                      <div className="node-traffic-guard">
                        <div className="node-traffic-guard-heading">
                          <span className="fine-print">本周期双向流量</span>
                          <span
                            className={`badge ${node.trafficGuard?.status === "monitoring" ? "success" : node.trafficGuard?.thresholdReached ? "danger" : "neutral"}`}
                          >
                            {node.trafficGuard
                              ? trafficGuardStatusName(node.trafficGuard.status)
                              : "未配置"}
                          </span>
                        </div>
                        {node.trafficGuard?.limitBytes ? (
                          <>
                            <strong>
                              {formatBytes(node.trafficGuard.usedBytes)} /{" "}
                              {formatBytes(node.trafficGuard.limitBytes)}
                            </strong>
                            <div
                              className="node-traffic-progress"
                              role="progressbar"
                              aria-label={`${node.label} 月度流量`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.min(
                                100,
                                Math.round(node.trafficGuard.usagePercent),
                              )}
                            >
                              <span
                                style={{
                                  width: `${Math.min(100, node.trafficGuard.usagePercent)}%`,
                                }}
                              />
                            </div>
                            <small>
                              每月 {node.trafficGuard.resetDay} 日重置 ·{" "}
                              {node.trafficGuard.usagePercent.toFixed(2)}%
                            </small>
                          </>
                        ) : (
                          <small>尚未设置月度上限</small>
                        )}
                      </div>
                    </div>
                    <div className="node-endpoint-states">
                      <div className="node-state-block">
                        <span className="fine-print">接入状态</span>
                        <span
                          className={`badge ${node.lifecycleStatus === "active" ? "success" : node.lifecycleStatus === "disabled" ? "neutral" : "warn"}`}
                        >
                          {lifecycleName(node.lifecycleStatus)}
                        </span>
                      </div>
                      <div className="node-state-block">
                        <span className="fine-print">运行状态</span>
                        <span
                          className={`badge ${runtimeStateBadge(node.runtimeState)}`}
                          title={node.runtimeError ?? undefined}
                        >
                          {runtimeStateName(node.runtimeState)}
                        </span>
                        <small title={runtimeStateDetail(node)}>
                          {runtimeStateDetail(node)}
                        </small>
                      </div>
                    </div>
                    <div className="node-endpoint-actions">
                      <button
                        className="ghost-button compact"
                        disabled={busyId === node.id}
                        type="button"
                        onClick={() =>
                          void setLifecycle(
                            node,
                            node.lifecycleStatus === "active"
                              ? "disabled"
                              : "active",
                          )
                        }
                      >
                        {node.lifecycleStatus === "active"
                          ? "停止接入"
                          : "恢复接入"}
                      </button>
                      {node.runtimeControlConfigured ? (
                        node.latestRuntimeCommand?.status === "queued" ||
                        node.latestRuntimeCommand?.status === "running" ? (
                          <button
                            className="ghost-button compact"
                            type="button"
                            disabled
                          >
                            <Icon name="schedule" />
                            执行中
                          </button>
                        ) : node.runtimeState === "active" ? (
                          <button
                            className="danger-button compact"
                            disabled={busyId === node.id}
                            type="button"
                            onClick={() =>
                              void requestRuntimeCommand(node, "stop")
                            }
                          >
                            <Icon name="bolt" />
                            停止服务
                          </button>
                        ) : node.runtimeState === "unknown" ? (
                          <button
                            className="ghost-button compact"
                            disabled={busyId === node.id}
                            type="button"
                            onClick={() =>
                              void requestRuntimeCommand(node, "status")
                            }
                          >
                            <Icon name="refresh" />
                            查询状态
                          </button>
                        ) : (
                          <button
                            className="action-button compact"
                            disabled={busyId === node.id}
                            type="button"
                            onClick={() =>
                              void requestRuntimeCommand(node, "start")
                            }
                          >
                            <Icon name="bolt" />
                            启动服务
                          </button>
                        )
                      ) : (
                        <button
                          className="ghost-button compact"
                          type="button"
                          onClick={() => openNodeDrawer(server, node)}
                        >
                          配置服务管理
                        </button>
                      )}
                      <button
                        className="ghost-button compact"
                        disabled={busyId === node.id}
                        type="button"
                        onClick={() => openNodeDrawer(server, node)}
                      >
                        <Icon name="edit" />
                        编辑节点
                      </button>
                      <button
                        className="ghost-button compact"
                        disabled={busyId === `traffic-${node.id}`}
                        type="button"
                        onClick={() => openTrafficLimitDrawer(node)}
                      >
                        <Icon name="data_usage" />
                        流量保护
                      </button>
                      <button
                        className="danger-button compact"
                        disabled={busyId === node.id}
                        type="button"
                        onClick={() => void deleteNode(node)}
                      >
                        删除节点
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">该服务器还没有协议端点</div>
              )}
            </div>
          </Panel>
        ))}
      </div>
      <Drawer
        open={drawer === "server"}
        onClose={() => setDrawer(null)}
        title={editingServer ? "编辑服务器" : "新增服务器"}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="server-form"
              disabled={busyId === (editingServer?.id ?? "new-server")}
            >
              保存服务器
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setDrawer(null)}
            >
              取消
            </button>
          </div>
        }
      >
        {drawer === "server" && error ? (
          <div className="feedback error">{error}</div>
        ) : null}
        <form id="server-form" className="form-grid" onSubmit={saveServer}>
          <label className="field">
            <span className="fine-print">服务器名称</span>
            <input
              className="control"
              required
              value={serverForm.name}
              onChange={(event) =>
                setServerForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">服务器标识</span>
            <input
              className="control mono"
              required
              value={serverForm.slug}
              onChange={(event) =>
                setServerForm((current) => ({
                  ...current,
                  slug: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">主机名或 IP</span>
            <input
              className="control mono"
              required
              value={serverForm.hostname}
              onChange={(event) =>
                setServerForm((current) => ({
                  ...current,
                  hostname: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">地区</span>
            <input
              className="control"
              value={serverForm.region}
              onChange={(event) =>
                setServerForm((current) => ({
                  ...current,
                  region: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">服务商</span>
            <input
              className="control"
              value={serverForm.provider}
              onChange={(event) =>
                setServerForm((current) => ({
                  ...current,
                  provider: event.target.value,
                }))
              }
            />
          </label>
        </form>
      </Drawer>
      <Drawer
        open={drawer === "node"}
        onClose={() => setDrawer(null)}
        title={editingNode ? "编辑节点" : "新增节点"}
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="node-form"
              disabled={busyId === (editingNode?.id ?? "new-node")}
            >
              保存节点
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setDrawer(null)}
            >
              取消
            </button>
          </div>
        }
      >
        {drawer === "node" && error ? (
          <div className="feedback error">{error}</div>
        ) : null}
        <form id="node-form" className="form-grid" onSubmit={saveNode}>
          <label className="field">
            <span className="fine-print">所属服务器</span>
            <CustomSelect
              value={nodeForm.serverId}
              onChange={(value) => {
                const server = managedServers.find((item) => item.id === value);
                setNodeForm((current) => ({
                  ...current,
                  serverId: value,
                  hostname: server?.hostname ?? current.hostname,
                }));
              }}
              options={managedServers.map((server) => ({
                value: server.id,
                label: server.name,
              }))}
            />
          </label>
          <label className="field">
            <span className="fine-print">协议</span>
            <CustomSelect
              value={nodeForm.protocol}
              onChange={(value) =>
                setNodeForm((current) => ({
                  ...current,
                  protocol: value as Endpoint["protocol"],
                }))
              }
              options={[
                { value: "vless_reality", label: "VLESS + Reality" },
                { value: "hysteria2", label: "Hysteria2" },
              ]}
            />
          </label>
          <label className="field">
            <span className="fine-print">节点名称</span>
            <input
              className="control"
              required
              value={nodeForm.label}
              onChange={(event) =>
                setNodeForm((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">公网主机名或 IP</span>
            <input
              className="control mono"
              required
              value={nodeForm.hostname}
              onChange={(event) =>
                setNodeForm((current) => ({
                  ...current,
                  hostname: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">端口</span>
            <input
              className="control"
              type="number"
              min={1}
              max={65535}
              required
              value={nodeForm.port}
              onChange={(event) =>
                setNodeForm((current) => ({
                  ...current,
                  port: Number(event.target.value),
                }))
              }
            />
          </label>
          {nodeForm.protocol === "hysteria2" ? (
            <>
              <label className="field checkbox-row span-2">
                <input
                  type="checkbox"
                  checked={nodeForm.portHoppingEnabled}
                  onChange={(event) =>
                    setNodeForm((current) => ({
                      ...current,
                      portHoppingEnabled: event.target.checked,
                    }))
                  }
                />
                <span>启用 UDP 端口跳跃</span>
              </label>
              <label className="field">
                <span className="fine-print">起始端口</span>
                <input
                  className="control"
                  type="number"
                  min={1}
                  max={65534}
                  disabled={!nodeForm.portHoppingEnabled}
                  value={nodeForm.portHoppingStart}
                  onChange={(event) =>
                    setNodeForm((current) => ({
                      ...current,
                      portHoppingStart: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span className="fine-print">结束端口</span>
                <input
                  className="control"
                  type="number"
                  min={2}
                  max={65535}
                  disabled={!nodeForm.portHoppingEnabled}
                  value={nodeForm.portHoppingEnd}
                  onChange={(event) =>
                    setNodeForm((current) => ({
                      ...current,
                      portHoppingEnd: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label className="field span-2">
                <span className="fine-print">跳跃间隔（秒）</span>
                <input
                  className="control"
                  type="number"
                  min={5}
                  max={300}
                  disabled={!nodeForm.portHoppingEnabled}
                  value={nodeForm.portHoppingIntervalSeconds}
                  onChange={(event) =>
                    setNodeForm((current) => ({
                      ...current,
                      portHoppingIntervalSeconds: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </>
          ) : null}
          <label className="field">
            <span className="fine-print">SNI</span>
            <input
              className="control mono"
              required={nodeForm.protocol === "vless_reality"}
              value={nodeForm.sni}
              onChange={(event) =>
                setNodeForm((current) => ({
                  ...current,
                  sni: event.target.value,
                }))
              }
            />
          </label>
          {nodeForm.protocol === "vless_reality" ? (
            <>
              <label className="field">
                <span className="fine-print">Reality 公钥</span>
                <input
                  className="control mono"
                  required
                  value={nodeForm.realityPublicKey}
                  onChange={(event) =>
                    setNodeForm((current) => ({
                      ...current,
                      realityPublicKey: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span className="fine-print">Reality Short ID</span>
                <input
                  className="control mono"
                  value={nodeForm.realityShortId}
                  onChange={(event) =>
                    setNodeForm((current) => ({
                      ...current,
                      realityShortId: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          ) : (
            <label className="field">
              <span className="fine-print">混淆密码</span>
              <input
                className="control mono"
                value={nodeForm.obfsPassword}
                onChange={(event) =>
                  setNodeForm((current) => ({
                    ...current,
                    obfsPassword: event.target.value,
                  }))
                }
              />
            </label>
          )}
          <label className="field">
            <span className="fine-print">流量采集地址</span>
            <input
              className="control mono"
              required
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
            <span className="fine-print">流量采集密钥</span>
            <input
              className="control mono"
              type="password"
              required={!editingNode}
              placeholder={
                editingNode?.trafficApiSecretSet ? "已配置，留空保持不变" : ""
              }
              value={nodeForm.trafficApiSecret}
              onChange={(event) =>
                setNodeForm((current) => ({
                  ...current,
                  trafficApiSecret: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">节点管理地址</span>
            <input
              className="control mono"
              value={nodeForm.controlApiBaseUrl}
              onChange={(event) =>
                setNodeForm((current) => ({
                  ...current,
                  controlApiBaseUrl: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">节点管理密钥</span>
            <input
              className="control mono"
              type="password"
              required={
                Boolean(nodeForm.controlApiBaseUrl.trim()) &&
                !editingNode?.controlApiSecretSet
              }
              placeholder={
                editingNode?.controlApiSecretSet ? "已配置，留空保持不变" : ""
              }
              value={nodeForm.controlApiSecret}
              onChange={(event) =>
                setNodeForm((current) => ({
                  ...current,
                  controlApiSecret: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span className="fine-print">上行限速（Mbps，0 为不限）</span>
            <input
              className="control"
              type="number"
              min={0}
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
            <span className="fine-print">下行限速（Mbps，0 为不限）</span>
            <input
              className="control"
              type="number"
              min={0}
              value={nodeForm.speedDownMbps}
              onChange={(event) =>
                setNodeForm((current) => ({
                  ...current,
                  speedDownMbps: Number(event.target.value),
                }))
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
            <span>允许不安全 TLS</span>
          </label>
        </form>
      </Drawer>
      <Drawer
        open={drawer === "traffic"}
        onClose={() => setDrawer(null)}
        title={
          editingTrafficNode
            ? `流量保护 · ${editingTrafficNode.label}`
            : "流量保护"
        }
        footer={
          <div className="toolbar-actions">
            <button
              className="action-button"
              type="submit"
              form="traffic-limit-form"
              disabled={
                !editingTrafficNode ||
                busyId === `traffic-${editingTrafficNode.id}` ||
                (trafficLimitForm.enabled &&
                  !editingTrafficNode.runtimeControlConfigured)
              }
            >
              保存策略
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setDrawer(null)}
            >
              取消
            </button>
          </div>
        }
      >
        {drawer === "traffic" && error ? (
          <div className="feedback error">{error}</div>
        ) : null}
        <form
          id="traffic-limit-form"
          className="form-grid"
          onSubmit={saveTrafficLimit}
        >
          <label className="field span-2">
            <span className="fine-print">月度双向流量上限（GiB）</span>
            <input
              className="control"
              type="number"
              min={1}
              max={1_000_000}
              step={0.01}
              required
              value={trafficLimitForm.monthlyLimitGiB}
              onChange={(event) =>
                setTrafficLimitForm((current) => ({
                  ...current,
                  monthlyLimitGiB: event.target.value,
                }))
              }
            />
          </label>
          <label className="field span-2">
            <span className="fine-print">每月重置日</span>
            <input
              className="control"
              type="number"
              min={1}
              max={28}
              required
              value={trafficLimitForm.resetDay}
              onChange={(event) =>
                setTrafficLimitForm((current) => ({
                  ...current,
                  resetDay: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="field checkbox-row span-2">
            <input
              type="checkbox"
              disabled={!editingTrafficNode?.runtimeControlConfigured}
              checked={trafficLimitForm.enabled}
              onChange={(event) =>
                setTrafficLimitForm((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
            />
            <span>达到上限时自动停止运行服务</span>
          </label>
          <div className="feedback span-2">
            {editingTrafficNode?.runtimeControlConfigured
              ? "按上传与下载物理流量合计。达限后只停止运行服务，不删除节点或订阅；新周期不会自动启动。"
              : "当前节点尚未配置服务管理，可以保存上限，但暂不能启用自动停服。"}
          </div>
        </form>
      </Drawer>
    </ConsoleShell>
  );
}
