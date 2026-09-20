"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Panel } from "@/components/panel";

type Research = {
  status: "supported" | "unsupported" | "error";
  warnings: string[];
  missingInformation?: string[];
  sources: Array<{ title: string; url: string; accessedAt: string }>;
};
type Job = {
  id: string;
  status: string;
  progress?: string;
  lastError?: string;
  articleId?: string;
  research?: Research;
};
const stages = ["整理资料", "补充来源", "撰写正文", "优化 SEO", "质量检查"];
const capabilityLabels = {
  supported: "支持联网，已核验搜索来源",
  unsupported: "不支持联网，将使用提供的资料",
  error: "暂时检测失败，可使用提供的资料继续",
};

export function SeoMaterialGeneration({
  token,
  onOpen,
}: {
  token: string | null;
  onOpen: (id: string) => void;
}) {
  const [form, setForm] = useState({
    material: "",
    referenceUrls: "",
    audience: "",
    problem: "",
    mustInclude: "",
  });
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [capability, setCapability] = useState<Research | null>(null);
  const request = useRef<{ input: string; key: string } | null>(null);
  const opened = useRef<string | null>(null);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  const running = job?.status === "QUEUED" || job?.status === "RUNNING";

  useEffect(() => {
    if (!token || !job?.id || !running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await apiRequest<Job>(
          `/api/admin/seo/generation-jobs/${job.id}`,
          { token },
        );
        if (stopped) return;
        setJob(next);
        setError("");
        if (next.status === "SUCCEEDED" || next.status === "FAILED") {
          if (next.articleId && opened.current !== next.id) {
            opened.current = next.id;
            onOpenRef.current(next.articleId);
          }
          return;
        }
      } catch {
        if (!stopped) setError("暂时无法获取进度，正在重试；请勿重复提交。");
      }
      if (!stopped) timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token, job?.id, running]);

  async function generate() {
    if (!token || busy || running) return;
    const referenceUrls = form.referenceUrls
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean);
    if (!form.material.trim() && !referenceUrls.length) {
      setError("请粘贴文字资料或填写参考链接。");
      return;
    }
    if (referenceUrls.length > 5) {
      setError("最多填写 5 个参考链接，每行一个。");
      return;
    }
    const input = { ...form, referenceUrls };
    const serialized = JSON.stringify(input);
    if (request.current?.input !== serialized)
      request.current = { input: serialized, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const next = await apiRequest<Job>("/api/admin/seo/generate", {
        method: "POST",
        token,
        body: { ...input, idempotencyKey: request.current.key },
      });
      setJob(next);
      if (next.articleId) onOpenRef.current(next.articleId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function detect() {
    if (!token || busy) return;
    setBusy(true);
    setError("");
    try {
      setCapability(
        await apiRequest<Research>("/api/admin/seo/settings/test-research", {
          method: "POST",
          token,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "检测失败");
    } finally {
      setBusy(false);
    }
  }

  const research = job?.research ?? capability;
  const currentStage =
    job?.status === "SUCCEEDED"
      ? stages.length
      : stages.findIndex((stage) => job?.progress?.startsWith(stage));
  return (
    <Panel
      title="资料生成文章"
      copy="粘贴资料或参考链接，AI 补充来源、撰写并自动修订；质量检查通过后自动发布，无法核实的内容保留草稿。"
    >
      <div className="form-grid seo-article-fields">
        <label className="field span-2">
          <span className="fine-print">文字资料</span>
          <textarea
            className="control"
            rows={8}
            maxLength={30000}
            value={form.material}
            onChange={(event) =>
              setForm({ ...form, material: event.target.value })
            }
            placeholder="产品说明、操作步骤、排查记录或写作素材，请勿填写用户隐私或密钥。"
            disabled={running}
          />
        </label>
        <label className="field span-2">
          <span className="fine-print">参考链接（与文字资料至少填写一项）</span>
          <textarea
            className="control"
            rows={3}
            value={form.referenceUrls}
            onChange={(event) =>
              setForm({ ...form, referenceUrls: event.target.value })
            }
            placeholder="每行一个公开 HTTP/HTTPS 链接，最多 5 个，优先官方文档。"
            disabled={running}
          />
        </label>
        {(
          [
            ["audience", "目标读者", 500],
            ["problem", "希望解决的问题", 2000],
            ["mustInclude", "必须包含的信息", 3000],
          ] as const
        ).map(([key, label, maxLength]) => (
          <label
            className={`field ${key === "mustInclude" ? "span-2" : ""}`}
            key={key}
          >
            <span className="fine-print">{label}（可选）</span>
            <textarea
              className="control"
              rows={2}
              value={form[key]}
              maxLength={maxLength}
              onChange={(event) =>
                setForm({ ...form, [key]: event.target.value })
              }
              disabled={running}
            />
          </label>
        ))}
      </div>
      <div className="seo-editor-actions">
        <button
          className="action-button"
          type="button"
          disabled={busy || running}
          onClick={() => void generate()}
        >
          {running ? "正在生成与检查…" : busy ? "处理中…" : "生成并自动发布"}
        </button>
        <button
          className="ghost-button"
          type="button"
          disabled={busy || running}
          onClick={() => void detect()}
        >
          检测已保存模型的联网能力
        </button>
      </div>
      <p className="fine-print">
        每次生成都会重新检查当前上游。未能联网时使用已有资料，不会伪造来源。质量评分不代表排名或收录保证。
      </p>
      {error && <p role="alert">{error}</p>}
      {job && (
        <div role="status" aria-live="polite">
          <ol className="seo-generation-stages">
            {stages.map((stage, index) => (
              <li
                key={stage}
                aria-current={index === currentStage ? "step" : undefined}
              >
                {index < currentStage ? "✓ " : ""}
                {stage}
              </li>
            ))}
          </ol>
          <p>{job.progress || "等待处理"}</p>
          {job.lastError && <p>{job.lastError}</p>}
          {job.articleId && (
            <button
              className="ghost-button"
              type="button"
              onClick={() => onOpen(job.articleId!)}
            >
              查看文章与检查结果
            </button>
          )}
          {job.status === "FAILED" && !job.articleId && (
            <button
              className="ghost-button"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const next = await apiRequest<Job>(
                    `/api/admin/seo/generation-jobs/${job.id}/retry`,
                    { token, method: "POST" },
                  );
                  setJob(next);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "重试失败");
                } finally {
                  setBusy(false);
                }
              }}
            >
              从已完成阶段重试
            </button>
          )}
        </div>
      )}
      {research && (
        <div className="seo-research-summary">
          <p>{capabilityLabels[research.status]}</p>
          {research.warnings?.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
          {Boolean(research.missingInformation?.length) && (
            <>
              <strong>待补充或确认</strong>
              <ul>
                {research.missingInformation?.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary>已读取来源（{research.sources?.length ?? 0}）</summary>
            <ul>
              {research.sources?.map((source, index) => (
                <li key={index}>
                  {source.url ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.title}
                    </a>
                  ) : (
                    source.title
                  )}{" "}
                  · {new Date(source.accessedAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Panel>
  );
}
