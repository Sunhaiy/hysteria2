"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";

type Release = {
  id: string;
  version: string;
  architecture: string;
  sha256: string;
  size: number;
};
type Installation = {
  id: string;
  serviceUnit: string;
  architecture: string;
  currentVersion: string;
  lastSeenAt: string | null;
  enabled: boolean;
  server: { name: string };
};
type UpdateJob = {
  id: string;
  installationId: string;
  status: string;
  message: string;
  position: number;
};
type Overview = {
  releases: Release[];
  installations: Installation[];
  servers: { id: string; name: string }[];
  rollouts: {
    id: string;
    status: string;
    release: Release;
    jobs: UpdateJob[];
  }[];
};
const states: Record<string, string> = {
  QUEUED: "等待前一台成功",
  DOWNLOADING: "下载中",
  VERIFYING: "验证中",
  INSTALLING: "安装中",
  CHECKING: "健康检查中",
  ROLLING_BACK: "正在恢复旧版",
  SUCCEEDED: "成功",
  ROLLED_BACK: "已回滚",
  FAILED: "失败",
  CANCELED: "已停止",
  PAUSED: "因失败暂停",
  RUNNING: "逐台发布中",
};
const endpoint = "/api/admin/agent-updates";

export default function AgentUpdatesPage() {
  const { token } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const loading = useRef(false);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const refresh = useCallback(async () => {
    if (!token || loading.current) return;
    loading.current = true;
    try {
      setData(await apiRequest<Overview>(endpoint, { token }));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "更新状态获取失败");
    } finally {
      loading.current = false;
    }
  }, [token]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  const release = data?.releases.find((item) => item.id === releaseId);
  const available = (item: Installation) =>
    item.enabled &&
    item.architecture === release?.architecture &&
    !!item.lastSeenAt &&
    Date.now() - Date.parse(item.lastSeenAt) < 120000;
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    void action(async () => {
      const result = await apiRequest<Release>(`${endpoint}/releases`, {
        method: "POST",
        token,
        body,
      });
      setReleaseId(result.id);
      setSelected([]);
      form.reset();
      setNotice("版本已签名保存，可以选择节点发布。");
    });
  }
  function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    void action(async () => {
      const config = await apiRequest<{ id: string }>(
        `${endpoint}/installations`,
        { method: "POST", token, body },
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(config, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `agent-enrollment-${config.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "登记配置已下载，含一次性凭据。请按安装说明在对应节点安装更新器，连接后即可下发版本。",
      );
    });
  }
  function publish() {
    if (!release || !selected.length) return;
    const first = data?.installations.find((item) => item.id === selected[0]);
    if (
      !window.confirm(
        `先更新 ${first?.server.name}（${first?.serviceUnit}），健康检查成功后逐台更新其余 ${selected.length - 1} 个 Agent。失败自动回滚并停止后续发布。确认发布 ${release.version}？`,
      )
    )
      return;
    void action(async () => {
      const fingerprint = JSON.stringify([releaseId, selected]);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, key: crypto.randomUUID() };
      await apiRequest(`${endpoint}/rollouts`, {
        method: "POST",
        token,
        body: {
          releaseId,
          installationIds: selected,
          idempotencyKey: pending.current.key,
        },
      });
      pending.current = null;
      setSelected([]);
      setNotice("任务已创建，节点将主动领取。首台成功后自动逐台推进。");
    });
  }
  return (
    <ConsoleShell
      title="Agent 更新"
      subtitle="先试一台，健康检查通过后逐台推进"
      scope="Nodes"
      navItems={adminNav}
      requireRole="admin"
    >
      <div className="page-stack">
        {notice && (
          <p role="status" className="panel-copy">
            {notice}
          </p>
        )}
        <Panel
          title="上传版本"
          copy="Linux Agent 可执行文件 · 最大 64 MiB · 自动生成 SHA-256 和 Ed25519 签名"
        >
          <form onSubmit={upload} className="inline-form">
            <label className="field">
              版本号
              <input
                className="control"
                name="version"
                required
                maxLength={40}
                pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,39}"
                placeholder="例如 2026.09.15"
              />
            </label>
            <label className="field">
              CPU 架构
              <select className="control" name="architecture">
                <option value="amd64">amd64 / x86_64</option>
                <option value="arm64">arm64 / aarch64</option>
              </select>
            </label>
            <label className="field">
              安装包
              <input className="control" type="file" name="file" required />
            </label>
            <button className="action-button" disabled={busy}>
              上传并签名
            </button>
          </form>
        </Panel>
        <Panel
          title="选择节点发布"
          copy="勾选顺序即发布顺序，第一台为试运行节点。断网保留任务，取消只停止尚未执行的节点。"
        >
          <label className="field">
            目标版本
            <select
              className="control"
              value={releaseId}
              onChange={(e) => {
                setReleaseId(e.target.value);
                setSelected([]);
              }}
            >
              <option value="">请选择版本</option>
              {data?.releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.version} · {r.architecture}
                </option>
              ))}
            </select>
          </label>
          {release && (
            <p className="panel-copy" style={{ overflowWrap: "anywhere" }}>
              SHA-256：{release.sha256} · {(release.size / 1048576).toFixed(2)}{" "}
              MiB
            </p>
          )}
          <div className="toolbar-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={busy || !release}
              onClick={() =>
                setSelected(
                  data?.installations.filter(available).map((i) => i.id) ?? [],
                )
              }
            >
              选择全部兼容在线节点
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setSelected([])}
            >
              清空选择
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>选择</th>
                  <th>节点 / 服务</th>
                  <th>架构</th>
                  <th>当前版本</th>
                  <th>最近连接</th>
                </tr>
              </thead>
              <tbody>
                {data?.installations.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        aria-label={`选择 ${item.server.name} ${item.serviceUnit}`}
                        type="checkbox"
                        disabled={busy || !available(item)}
                        checked={selected.includes(item.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, item.id]
                              : ids.filter((id) => id !== item.id),
                          )
                        }
                      />{" "}
                      {selected.indexOf(item.id) >= 0
                        ? selected.indexOf(item.id) === 0
                          ? "首台"
                          : `第 ${selected.indexOf(item.id) + 1} 台`
                        : ""}
                    </td>
                    <td>
                      {item.server.name}
                      <br />
                      <small>{item.serviceUnit}</small>
                    </td>
                    <td>{item.architecture}</td>
                    <td>{item.currentVersion}</td>
                    <td>
                      {item.lastSeenAt
                        ? formatDateTime(item.lastSeenAt)
                        : "等待首次安装"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data?.installations.length && (
            <p className="panel-copy">
              还没有登记的更新器，请先完成下方的一次性登记。
            </p>
          )}
          <button
            className="action-button"
            type="button"
            disabled={busy || !release || !selected.length}
            onClick={publish}
          >
            确认发布至 {selected.length} 个 Agent
          </button>
        </Panel>
        <Panel
          title="发布进度"
          copy="每 5 秒刷新；状态为节点最后一次确认的结果。离线节点恢复连接后继续原任务。"
        >
          {!data?.rollouts.length && <p className="panel-copy">暂无发布记录</p>}
          {data?.rollouts.map((rollout) => (
            <section key={rollout.id} style={{ marginBottom: 24 }}>
              <div className="split">
                <strong>
                  {rollout.release.version} · {rollout.release.architecture} ·{" "}
                  {states[rollout.status] ?? rollout.status}
                </strong>
                {rollout.status === "RUNNING" && (
                  <button
                    type="button"
                    className="ghost-button compact"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "停止尚未执行的节点？正在更新的节点会继续完成或回滚。",
                        )
                      )
                        void action(async () => {
                          await apiRequest(
                            `${endpoint}/rollouts/${rollout.id}/cancel`,
                            { method: "POST", token },
                          );
                        });
                    }}
                  >
                    停止后续发布
                  </button>
                )}
              </div>
              <ul>
                {rollout.jobs.map((job) => (
                  <li key={job.id}>
                    {job.position + 1}.{" "}
                    {data.installations.find((i) => i.id === job.installationId)
                      ?.server.name ?? job.installationId}{" "}
                    → {rollout.release.version} ·{" "}
                    {states[job.status] ?? job.status}
                    {job.message && <p className="panel-copy">{job.message}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Panel>
        <Panel
          title="首次登记更新器"
          copy="每个 Agent 只需安装一次独立更新器。此操作仅生成配置，不会重启节点服务。"
        >
          <form onSubmit={enroll} className="inline-form">
            <label className="field">
              服务器
              <select className="control" name="serverId" required>
                <option value="">请选择服务器</option>
                {data?.servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Agent 服务名
              <input
                className="control"
                name="serviceUnit"
                placeholder="hysteria2-xray-agent.service"
                required
              />
            </label>
            <label className="field">
              CPU 架构
              <select className="control" name="architecture">
                <option value="amd64">amd64</option>
                <option value="arm64">arm64</option>
              </select>
            </label>
            <button className="action-button" disabled={busy}>
              登记并下载配置
            </button>
          </form>
          <p className="panel-copy">
            将配置和对应架构的更新器传到节点，执行安装器：
            <code>
              sudo python3 install.py enrollment.json ./agent-updater-linux
            </code>
            。安装说明位于项目 ops/agent-updater/README.md。
          </p>
        </Panel>
      </div>
    </ConsoleShell>
  );
}
