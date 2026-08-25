"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { apiBaseUrl } from "@/lib/config";
import { adminNav } from "@/lib/copy";

type Platform = "windows" | "macos" | "android" | "ios";
type StepImage = {
  id: string;
  originalName: string;
  width?: number | null;
  height?: number | null;
  url: string;
  thumbnailUrl: string;
};
type Step = {
  id?: string;
  title: string;
  body: string;
  sortOrder: number;
  image?: StepImage | null;
};
type Revision = { id: string; version: number; status: string; steps: Step[] };
type Guide = {
  id: string;
  platform: Platform;
  name: string;
  meta: string;
  clientName: string;
  externalUrl?: string | null;
  active: boolean;
  asset?: {
    originalName: string;
    size: number;
    uploadedAt: string;
    downloadUrl: string;
  } | null;
  revision?: Revision | null;
  draft?: Revision | null;
};

const platformOrder: Record<Platform, number> = {
  windows: 0,
  android: 1,
  macos: 2,
  ios: 3,
};

const absoluteApiUrl = (path: string) =>
  `${apiBaseUrl.replace(/\/$/, "")}${path}`;

export default function AdminTutorialsPage() {
  const { token } = useAuth();
  const [guides, setGuides] = useState<Guide[]>([]);
  const [platform, setPlatform] = useState<Platform>("windows");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [meta, setMeta] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [active, setActive] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      try {
        const result = await apiRequest<{ guides: Guide[] }>(
          "/api/admin/tutorials",
          { token, signal },
        );
        setGuides(
          [...result.guides].sort(
            (left, right) =>
              platformOrder[left.platform] - platformOrder[right.platform],
          ),
        );
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(cause instanceof ApiError ? cause.message : "教程加载失败。");
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

  useEffect(() => {
    if (!token || !guides.length) return;
    const controller = new AbortController();
    const guide =
      guides.find((item) => item.platform === platform) ?? guides[0];
    const timer = window.setTimeout(() => {
      setClientName(guide.clientName);
      setMeta(guide.meta);
      setExternalUrl(guide.externalUrl ?? "");
      setActive(guide.active);
      const prepare = async () => {
        setBusy(true);
        try {
          const draft =
            guide.draft ??
            (await apiRequest<Revision>(
              `/api/admin/tutorials/${guide.platform}/drafts`,
              { method: "POST", token, signal: controller.signal },
            ));
          setDraftId(draft.id);
          setSteps(draft.steps);
          if (!guide.draft) await load(controller.signal);
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === "AbortError")
            return;
          setError(
            cause instanceof ApiError ? cause.message : "教程草稿创建失败。",
          );
        } finally {
          if (!controller.signal.aborted) setBusy(false);
        }
      };
      void prepare();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [guides, load, platform, token]);

  function updateStep(index: number, patch: Partial<Step>) {
    setSteps((current) =>
      current.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    );
  }

  function dropStep(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) return;
    setSteps((current) => {
      const next = [...current];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next.map((step, sortOrder) => ({ ...step, sortOrder }));
    });
    setDragIndex(null);
  }

  async function uploadImage(index: number, file?: File) {
    if (!token || !file) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    try {
      updateStep(index, {
        image: await apiRequest<StepImage>("/api/admin/tutorials/images", {
          method: "POST",
          token,
          body,
        }),
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "图片上传失败。");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPackage(file?: File) {
    if (!token || !file || platform === "ios") return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    try {
      await apiRequest(`/api/admin/tutorial-assets/${platform}`, {
        method: "POST",
        token,
        body,
      });
      setFeedback("客户端安装包已更新，用户端可立即下载。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "安装包上传失败。");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!token || !draftId) return false;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const revision = await apiRequest<Revision>(
        `/api/admin/tutorials/${platform}/drafts/${draftId}`,
        {
          method: "PUT",
          token,
          body: {
            clientName,
            meta,
            externalUrl: externalUrl || undefined,
            active,
            steps: steps.map((step) => ({
              title: step.title,
              body: step.body,
              imageId: step.image?.id,
            })),
          },
        },
      );
      setSteps(revision.steps);
      setFeedback("草稿已保存。");
      return true;
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "草稿保存失败。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!token || !draftId || !(await save())) return;
    setBusy(true);
    try {
      await apiRequest(
        `/api/admin/tutorials/${platform}/drafts/${draftId}/publish`,
        { method: "POST", token },
      );
      setFeedback("教程已原子发布，用户端将在缓存失效后读取新版本。");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "教程发布失败。");
    } finally {
      setBusy(false);
    }
  }

  const activeGuide = guides.find((guide) => guide.platform === platform);

  return (
    <ConsoleShell
      title="教程管理"
      subtitle="四平台图文步骤、草稿预览与原子发布"
      scope="Content"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={<span className="badge info">{steps.length} 个步骤</span>}
      toolbarActions={
        <>
          <button
            className="toolbar-button"
            type="button"
            disabled={busy}
            onClick={() => void save()}
          >
            保存草稿
          </button>
          <button
            className="action-button"
            type="button"
            disabled={busy || !steps.length}
            onClick={() => void publish()}
          >
            发布
          </button>
        </>
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      <div className="page-stack">
        <div className="segmented-control" aria-label="教程平台">
          {guides.map((guide) => (
            <button
              key={guide.platform}
              className={platform === guide.platform ? "active" : ""}
              type="button"
              onClick={() => setPlatform(guide.platform)}
            >
              {guide.name}
            </button>
          ))}
        </div>
        <div className="segmented-control" aria-label="编辑模式">
          <button
            className={mode === "edit" ? "active" : ""}
            type="button"
            onClick={() => setMode("edit")}
          >
            编辑
          </button>
          <button
            className={mode === "preview" ? "active" : ""}
            type="button"
            onClick={() => setMode("preview")}
          >
            预览
          </button>
        </div>
        {mode === "edit" ? (
          <>
            <Panel title="教程信息">
              <div className="form-grid">
                <label className="field">
                  <span className="fine-print">客户端</span>
                  <input
                    className="control"
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="fine-print">平台说明</span>
                  <input
                    className="control"
                    value={meta}
                    onChange={(event) => setMeta(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="fine-print">官方下载地址</span>
                  <input
                    className="control"
                    value={externalUrl}
                    onChange={(event) => setExternalUrl(event.target.value)}
                  />
                </label>
                {platform !== "ios" ? (
                  <label className="field">
                    <span className="fine-print">客户端安装包</span>
                    <input
                      className="control"
                      type="file"
                      accept={
                        platform === "windows"
                          ? ".exe,.msi,.zip"
                          : platform === "android"
                            ? ".apk"
                            : ".dmg,.pkg,.zip"
                      }
                      disabled={busy}
                      onChange={(event) =>
                        void uploadPackage(event.target.files?.[0])
                      }
                    />
                    <span className="fine-print">
                      {activeGuide?.asset
                        ? `当前文件：${activeGuide.asset.originalName} · ${(activeGuide.asset.size / 1024 / 1024).toFixed(1)} MB`
                        : "尚未上传安装包"}
                    </span>
                  </label>
                ) : null}
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(event) => setActive(event.target.checked)}
                  />
                  <span>用户端显示</span>
                </label>
              </div>
            </Panel>
            <Panel
              title="图文步骤"
              action={
                <button
                  className="action-button"
                  type="button"
                  onClick={() =>
                    setSteps((current) => [
                      ...current,
                      {
                        title: `步骤 ${current.length + 1}`,
                        body: "",
                        sortOrder: current.length,
                      },
                    ])
                  }
                >
                  <Icon name="add" />
                  新增步骤
                </button>
              }
            >
              <div className="tutorial-editor-list">
                {steps.map((step, index) => (
                  <article
                    className="tutorial-editor-step"
                    draggable
                    key={step.id ?? index}
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropStep(index)}
                  >
                    <div className="tutorial-editor-step-head">
                      <span className="badge neutral">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <strong>拖动排序</strong>
                      <button
                        className="ghost-button compact"
                        type="button"
                        onClick={() =>
                          setSteps((current) =>
                            current
                              .filter((_, stepIndex) => stepIndex !== index)
                              .map((item, sortOrder) => ({
                                ...item,
                                sortOrder,
                              })),
                          )
                        }
                      >
                        删除
                      </button>
                    </div>
                    <label className="field">
                      <span className="fine-print">标题</span>
                      <input
                        className="control"
                        value={step.title}
                        onChange={(event) =>
                          updateStep(index, { title: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="fine-print">正文</span>
                      <textarea
                        className="control textarea"
                        value={step.body}
                        onChange={(event) =>
                          updateStep(index, { body: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="fine-print">
                        步骤图片（JPEG / PNG / WebP）
                      </span>
                      <input
                        className="control"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) =>
                          void uploadImage(index, event.target.files?.[0])
                        }
                      />
                    </label>
                    {step.image ? (
                      <div className="tutorial-editor-image">
                        <Image
                          src={absoluteApiUrl(step.image.thumbnailUrl)}
                          alt={step.title}
                          width={step.image.width ?? 720}
                          height={step.image.height ?? 480}
                          unoptimized
                        />
                        <button
                          className="ghost-button compact"
                          type="button"
                          onClick={() => updateStep(index, { image: null })}
                        >
                          移除图片
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </Panel>
          </>
        ) : (
          <Panel title={`${platform} · ${clientName}`}>
            <ol className="tutorial-steps">
              {steps.map((step, index) => (
                <li className="tutorial-step" key={step.id ?? index}>
                  <span className="tutorial-step-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="tutorial-step-content">
                    <strong>{step.title}</strong>
                    <p>{step.body}</p>
                    {step.image ? (
                      <Image
                        src={absoluteApiUrl(step.image.thumbnailUrl)}
                        alt={step.title}
                        width={step.image.width ?? 720}
                        height={step.image.height ?? 480}
                        unoptimized
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </div>
    </ConsoleShell>
  );
}
