"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Drawer } from "@/components/drawer";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { Toast, useToast } from "@/components/toast";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { apiBaseUrl } from "@/lib/config";
import { adminNav } from "@/lib/copy";

type BackupSource = "scheduled" | "manual" | "imported" | "pre_restore";
type RestoreStatus = "queued" | "running" | "succeeded" | "failed";

interface BackupItem {
  id: string;
  filename: string;
  createdAt: string;
  source: BackupSource;
  size: number;
  sha256: string;
  appVersion: string;
  restore: {
    status: RestoreStatus;
    requestedAt: string;
    completedAt: string | null;
    error: string | null;
  } | null;
}

interface BackupOverview {
  items: BackupItem[];
  retentionCount: number;
  dailyHour: number;
  timeZone: string;
  restoreEnabled: boolean;
  maintenance: boolean;
}

const sourceLabels: Record<BackupSource, string> = {
  scheduled: "每日自动",
  manual: "手动导出",
  imported: "导入文件",
  pre_restore: "恢复前保护",
};

const restoreLabels: Record<RestoreStatus, string> = {
  queued: "等待恢复",
  running: "正在恢复",
  succeeded: "恢复完成",
  failed: "恢复失败",
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(value));
}

function downloadBackup(item: BackupItem) {
  const anchor = document.createElement("a");
  anchor.href = `${apiBaseUrl}/api/admin/backups/${item.id}/download`;
  anchor.download = item.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function AdminBackupsPage() {
  const { token } = useAuth();
  const { toast, showToast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupItem | null>(null);
  const [confirmation, setConfirmation] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setOverview(
        await apiRequest<BackupOverview>("/api/admin/backups", { token }),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "备份列表加载失败。",
      );
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (
      !overview?.items.some(
        (item) =>
          item.restore?.status === "queued" ||
          item.restore?.status === "running",
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [overview, load]);

  async function createBackup() {
    if (!token) return;
    setBusy("create");
    try {
      await apiRequest("/api/admin/backups", { method: "POST", token });
      showToast("整站备份已生成");
      await load();
    } catch (cause) {
      showToast(
        cause instanceof ApiError ? cause.message : "备份生成失败。",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  async function importBackup(file?: File) {
    if (!token || !file) return;
    setBusy("import");
    try {
      const body = new FormData();
      body.append("file", file);
      await apiRequest("/api/admin/backups/import", {
        method: "POST",
        token,
        body,
      });
      showToast("备份已导入并通过完整性校验");
      await load();
    } catch (cause) {
      showToast(
        cause instanceof ApiError ? cause.message : "备份导入失败。",
        "error",
      );
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setBusy(null);
    }
  }

  async function removeBackup(item: BackupItem) {
    if (!token || !window.confirm(`确认删除备份“${item.filename}”？`)) return;
    setBusy(item.id);
    try {
      await apiRequest(`/api/admin/backups/${item.id}`, {
        method: "DELETE",
        token,
      });
      showToast("备份已删除");
      await load();
    } catch (cause) {
      showToast(
        cause instanceof ApiError ? cause.message : "删除失败。",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  async function restoreBackup() {
    if (!token || !restoreTarget || confirmation !== "RESTORE") return;
    setBusy(restoreTarget.id);
    try {
      await apiRequest(`/api/admin/backups/${restoreTarget.id}/restore`, {
        method: "POST",
        token,
        body: { confirmation },
      });
      showToast("恢复任务已提交，系统会先创建保护备份");
      setRestoreTarget(null);
      setConfirmation("");
      await load();
    } catch (cause) {
      showToast(
        cause instanceof ApiError ? cause.message : "恢复任务提交失败。",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <ConsoleShell
      title="数据备份"
      subtitle="数据库、教程图片与客户端安装包"
      scope="System"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        overview ? (
          <span
            className={`badge ${overview.maintenance ? "warn" : "success"}`}
          >
            {overview.maintenance ? "维护中" : "备份正常"}
          </span>
        ) : null
      }
      toolbarActions={
        <button
          className="toolbar-button"
          type="button"
          onClick={() => void load()}
        >
          <Icon name="refresh" />
          刷新
        </button>
      }
    >
      <Toast toast={toast} />
      {error ? <div className="feedback error">{error}</div> : null}
      {!overview ? (
        <PageSkeleton variant="table" />
      ) : (
        <div className="page-stack">
          <div className="backup-status-band">
            <div>
              <span className="fine-print">自动备份</span>
              <strong>
                每天 {String(overview.dailyHour).padStart(2, "0")}:00
              </strong>
            </div>
            <div>
              <span className="fine-print">时区</span>
              <strong>{overview.timeZone}</strong>
            </div>
            <div>
              <span className="fine-print">自动保留</span>
              <strong>最新 {overview.retentionCount} 份</strong>
            </div>
            <div>
              <span className="fine-print">整站内容</span>
              <strong>数据库 + 文件</strong>
            </div>
          </div>

          <Panel
            title="备份记录"
            copy="手动备份和导入文件不会被每日保留策略自动删除。"
            action={
              <div className="toolbar-actions">
                <input
                  ref={fileInput}
                  className="visually-hidden"
                  type="file"
                  accept=".h2backup,application/gzip"
                  onChange={(event) =>
                    void importBackup(event.target.files?.[0])
                  }
                />
                <button
                  className="toolbar-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="upload" />
                  {busy === "import" ? "校验中..." : "导入备份"}
                </button>
                <button
                  className="action-button"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void createBackup()}
                >
                  <Icon name="database" />
                  {busy === "create" ? "备份中..." : "立即备份"}
                </button>
              </div>
            }
          >
            {overview.items.length === 0 ? (
              <div className="empty-state">暂无备份</div>
            ) : (
              <div className="table-shell">
                <table className="data-table backup-table">
                  <thead>
                    <tr>
                      <th>创建时间</th>
                      <th>来源</th>
                      <th>大小</th>
                      <th>版本 / 校验</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{formatTime(item.createdAt)}</strong>
                          <span className="fine-print backup-filename">
                            {item.filename}
                          </span>
                        </td>
                        <td>{sourceLabels[item.source]}</td>
                        <td>{formatBytes(item.size)}</td>
                        <td>
                          <span>{item.appVersion}</span>
                          <span className="fine-print mono backup-checksum">
                            {item.sha256.slice(0, 12)}
                          </span>
                        </td>
                        <td>
                          {item.restore ? (
                            <span
                              className={`badge ${item.restore.status === "failed" ? "danger" : item.restore.status === "succeeded" ? "success" : "warn"}`}
                            >
                              {restoreLabels[item.restore.status]}
                            </span>
                          ) : (
                            <span className="badge info">可用</span>
                          )}
                          {item.restore?.error ? (
                            <span
                              className="fine-print backup-error"
                              title={item.restore.error}
                            >
                              {item.restore.error}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="ghost-button compact"
                              type="button"
                              onClick={() => downloadBackup(item)}
                            >
                              <Icon name="download" />
                              导出
                            </button>
                            <button
                              className="ghost-button compact"
                              type="button"
                              disabled={
                                !overview.restoreEnabled ||
                                busy !== null ||
                                item.restore?.status === "queued" ||
                                item.restore?.status === "running"
                              }
                              onClick={() => {
                                setConfirmation("");
                                setRestoreTarget(item);
                              }}
                            >
                              恢复
                            </button>
                            <button
                              className="danger-button compact"
                              type="button"
                              aria-label={`删除 ${item.filename}`}
                              disabled={
                                busy !== null ||
                                item.restore?.status === "queued" ||
                                item.restore?.status === "running"
                              }
                              onClick={() => void removeBackup(item)}
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      <Drawer
        open={Boolean(restoreTarget)}
        onClose={() => {
          if (busy) return;
          setRestoreTarget(null);
          setConfirmation("");
        }}
        title="恢复整站数据"
        subtitle={restoreTarget?.filename}
        footer={
          <div className="drawer-footer-split">
            <button
              className="ghost-button"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => setRestoreTarget(null)}
            >
              取消
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={confirmation !== "RESTORE" || Boolean(busy)}
              onClick={() => void restoreBackup()}
            >
              确认恢复
            </button>
          </div>
        }
      >
        <div className="feedback error">
          恢复期间网站会短暂进入维护状态。系统会先自动创建一份恢复前保护备份，数据库恢复失败时不会提交变更。
        </div>
        <label className="field">
          <span className="fine-print">输入 RESTORE 确认</span>
          <input
            className="control mono"
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      </Drawer>
    </ConsoleShell>
  );
}
