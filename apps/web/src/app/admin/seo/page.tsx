"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/react";
import { ConsoleShell } from "@/components/console-shell";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { Toast, useToast } from "@/components/toast";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";

const SimpleEditor = dynamic(
  () =>
    import("@/components/tiptap-templates/simple/simple-editor").then(
      (module) => module.SimpleEditor,
    ),
  { ssr: false },
);

type View = "articles" | "keywords" | "jobs" | "analytics" | "settings";
type ArticleStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";

type QualityReport = {
  passed: boolean;
  score: number;
  blockers: string[];
  warnings: string[];
  metrics: {
    plainTextLength: number;
    headingCount: number;
    internalLinkCount: number;
    maximumSimilarity: number;
  };
};

type Revision = {
  id: string;
  version: number;
  source: "AI" | "MANUAL";
  slug: string;
  title: string;
  excerpt: string;
  contentJson: JSONContent;
  contentHtml: string;
  primaryKeyword: string;
  relatedKeywords: string[];
  tags: string[];
  seoTitle: string;
  metaDescription: string;
  coverImageId: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
  qualityScore: number;
  qualityReport: QualityReport;
  createdAt: string;
};

type AdminArticle = {
  id: string;
  slug: string;
  category: string;
  status: ArticleStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  currentRevision: Revision | null;
  draftRevision: Revision | null;
  publishedRevision: Revision | null;
  revisions?: Revision[];
};

type Keyword = {
  id: string;
  keyword: string;
  category: string;
  searchIntent: string | null;
  priority: number;
  status: "ACTIVE" | "PAUSED" | "USED";
  article: { slug: string; status: ArticleStatus } | null;
};

type SeoSettings = {
  enabled: boolean;
  aiBaseUrl: string;
  textModel: string;
  imageModel: string;
  timeoutMs: number;
  scheduleDays: number[];
  scheduleHour: number;
  aiConfigured: boolean;
  indexNowEnabled: boolean;
  indexNowKey: string;
  googleEnabled: boolean;
  googleProperty: string;
  googleConfigured: boolean;
  timezone: string;
};

type GenerationJob = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
  keyword: Keyword | null;
  article: { slug: string } | null;
  usage: { inputTokens?: number; outputTokens?: number } | null;
};

type IndexJob = {
  id: string;
  engine: "BING_INDEXNOW" | "GOOGLE_SITEMAP";
  operation: "PUBLISH" | "UPDATE" | "ARCHIVE";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  attempts: number;
  url: string;
  lastError: string | null;
  createdAt: string;
};

type Analytics = {
  current: MetricSummary;
  previous: MetricSummary;
  topQueries: MetricItem[];
  topPages: MetricItem[];
  highImpressionQueries: MetricItem[];
  lowCtrPages: MetricItem[];
};

type MetricSummary = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

type MetricItem = MetricSummary & { value: string };
type PageResponse<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ArticleDraft = {
  slug: string;
  category: string;
  title: string;
  excerpt: string;
  contentJson: JSONContent;
  primaryKeyword: string;
  relatedKeywords: string;
  tags: string;
  seoTitle: string;
  metaDescription: string;
  coverImageId: string;
  coverUrl: string;
  coverAlt: string;
};

const EMPTY_DOCUMENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const EMPTY_ARTICLE: ArticleDraft = {
  slug: "",
  category: "教程",
  title: "",
  excerpt: "",
  contentJson: EMPTY_DOCUMENT,
  primaryKeyword: "",
  relatedKeywords: "",
  tags: "",
  seoTitle: "",
  metaDescription: "",
  coverImageId: "",
  coverUrl: "",
  coverAlt: "",
};

const VIEW_LABELS: Array<{ value: View; label: string }> = [
  { value: "articles", label: "文章" },
  { value: "keywords", label: "关键词" },
  { value: "jobs", label: "任务" },
  { value: "analytics", label: "数据" },
  { value: "settings", label: "设置" },
];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  SCHEDULED: "待发布",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
  ACTIVE: "启用",
  PAUSED: "暂停",
  USED: "已分配",
  QUEUED: "排队中",
  RUNNING: "处理中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  PENDING: "待提交",
};

function messageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function badgeKind(status: string) {
  if (["PUBLISHED", "SUCCEEDED", "ACTIVE"].includes(status)) return "success";
  if (["FAILED", "ARCHIVED"].includes(status)) return "error";
  return "info";
}

function draftFromArticle(article: AdminArticle): ArticleDraft {
  const revision = article.draftRevision ?? article.publishedRevision;
  if (!revision) return { ...EMPTY_ARTICLE, category: article.category };
  return {
    slug: revision.slug,
    category: article.category,
    title: revision.title,
    excerpt: revision.excerpt,
    contentJson: revision.contentJson,
    primaryKeyword: revision.primaryKeyword,
    relatedKeywords: revision.relatedKeywords.join("，"),
    tags: revision.tags.join("，"),
    seoTitle: revision.seoTitle,
    metaDescription: revision.metaDescription,
    coverImageId: revision.coverImageId ?? "",
    coverUrl: revision.coverUrl ?? "",
    coverAlt: revision.coverAlt ?? "",
  };
}

function splitList(value: string) {
  return value
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function AdminSeoPage() {
  const { token } = useAuth();
  const { toast, showToast } = useToast();
  const [view, setView] = useState<View>("articles");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [articles, setArticles] = useState<AdminArticle[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [jobs, setJobs] = useState<{
    generation: GenerationJob[];
    indexing: IndexJob[];
  }>({ generation: [], indexing: [] });
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [settings, setSettings] = useState<SeoSettings | null>(null);
  const [settingsSecrets, setSettingsSecrets] = useState({
    aiApiKey: "",
    googleServiceAccountJson: "",
  });
  const [selected, setSelected] = useState<AdminArticle | null>(null);
  const [draft, setDraft] = useState<ArticleDraft>(EMPTY_ARTICLE);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [scheduleAt, setScheduleAt] = useState("");
  const [keywordForm, setKeywordForm] = useState({
    keyword: "",
    category: "教程",
    searchIntent: "",
    priority: "0",
  });

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [articlePage, keywordPage, nextJobs, nextAnalytics, nextSettings] =
        await Promise.all([
          apiRequest<PageResponse<AdminArticle>>(
            "/api/admin/seo/articles?pageSize=100",
            { token },
          ),
          apiRequest<PageResponse<Keyword>>(
            "/api/admin/seo/keywords?pageSize=100",
            { token },
          ),
          apiRequest<{ generation: GenerationJob[]; indexing: IndexJob[] }>(
            "/api/admin/seo/jobs",
            { token },
          ),
          apiRequest<Analytics>("/api/admin/seo/analytics", { token }),
          apiRequest<SeoSettings>("/api/admin/seo/settings", { token }),
        ]);
      setArticles(articlePage.items);
      setKeywords(keywordPage.items);
      setJobs(nextJobs);
      setAnalytics(nextAnalytics);
      setSettings(nextSettings);
    } catch (error) {
      showToast(messageOf(error, "SEO 数据加载失败。"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAll(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAll]);

  async function openArticle(id: string) {
    if (!token) return;
    setBusy(true);
    try {
      const article = await apiRequest<AdminArticle>(
        `/api/admin/seo/articles/${id}`,
        { token },
      );
      setSelected(article);
      setDraft(draftFromArticle(article));
      setEditorMode("edit");
    } catch (error) {
      showToast(messageOf(error, "文章加载失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  function newArticle() {
    setSelected(null);
    setDraft({ ...EMPTY_ARTICLE, contentJson: { ...EMPTY_DOCUMENT } });
    setEditorMode("edit");
  }

  const articlePayload = useMemo(
    () => ({
      slug: draft.slug,
      category: draft.category,
      title: draft.title,
      excerpt: draft.excerpt,
      contentJson: draft.contentJson as Record<string, unknown>,
      primaryKeyword: draft.primaryKeyword,
      relatedKeywords: splitList(draft.relatedKeywords),
      tags: splitList(draft.tags),
      seoTitle: draft.seoTitle,
      metaDescription: draft.metaDescription,
      coverImageId: draft.coverImageId || undefined,
      coverAlt: draft.coverAlt || undefined,
    }),
    [draft],
  );

  async function saveArticle() {
    if (!token) return null;
    setBusy(true);
    try {
      const article = await apiRequest<AdminArticle>(
        selected
          ? `/api/admin/seo/articles/${selected.id}`
          : "/api/admin/seo/articles",
        { method: selected ? "PUT" : "POST", token, body: articlePayload },
      );
      const complete = await apiRequest<AdminArticle>(
        `/api/admin/seo/articles/${article.id}`,
        { token },
      );
      setSelected(complete);
      setDraft(draftFromArticle(complete));
      showToast("草稿已保存，并完成质量复检。");
      await refreshArticles();
      return complete;
    } catch (error) {
      showToast(messageOf(error, "草稿保存失败。"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function refreshArticles() {
    if (!token) return;
    const page = await apiRequest<PageResponse<AdminArticle>>(
      "/api/admin/seo/articles?pageSize=100",
      { token },
    );
    setArticles(page.items);
  }

  async function mutateArticle(action: "publish" | "archive" | "schedule") {
    if (!token || !selected) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/seo/articles/${selected.id}/${action}`, {
        method: "POST",
        token,
        body:
          action === "schedule"
            ? { scheduledAt: new Date(scheduleAt).toISOString() }
            : undefined,
      });
      showToast(
        action === "publish"
          ? "文章已发布。"
          : action === "archive"
            ? "文章已归档。"
            : "文章已安排定时发布。",
      );
      await refreshArticles();
      await openArticle(selected.id);
    } catch (error) {
      showToast(messageOf(error, "文章操作失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function restoreRevision(revisionId: string) {
    if (!token || !selected) return;
    setBusy(true);
    try {
      const article = await apiRequest<AdminArticle>(
        `/api/admin/seo/articles/${selected.id}/revisions/${revisionId}/restore`,
        { method: "POST", token },
      );
      setSelected(article);
      setDraft(draftFromArticle(article));
      showToast("已恢复为新的草稿版本，线上文章未变化。");
    } catch (error) {
      showToast(messageOf(error, "版本恢复失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(file: File) {
    if (!token) throw new Error("登录状态已失效");
    const body = new FormData();
    body.append("file", file);
    const image = await apiRequest<{ id: string; url: string }>(
      "/api/admin/seo/images",
      { method: "POST", token, body },
    );
    return image;
  }

  async function regenerateCover() {
    if (!token || !selected) return;
    setBusy(true);
    try {
      await apiRequest(
        `/api/admin/seo/articles/${selected.id}/cover/regenerate`,
        { method: "POST", token },
      );
      await openArticle(selected.id);
      showToast("封面已重新生成，正文草稿仍然保留。");
    } catch (error) {
      showToast(messageOf(error, "封面生成失败，正文草稿没有丢失。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function createKeyword() {
    if (!token) return;
    setBusy(true);
    try {
      await apiRequest("/api/admin/seo/keywords", {
        method: "POST",
        token,
        body: { ...keywordForm, priority: Number(keywordForm.priority) || 0 },
      });
      setKeywordForm({
        keyword: "",
        category: "教程",
        searchIntent: "",
        priority: "0",
      });
      const page = await apiRequest<PageResponse<Keyword>>(
        "/api/admin/seo/keywords?pageSize=100",
        { token },
      );
      setKeywords(page.items);
      showToast("关键词已加入内容池。");
    } catch (error) {
      showToast(messageOf(error, "关键词保存失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function updateKeyword(
    keyword: Keyword,
    body: Record<string, unknown>,
  ) {
    if (!token) return;
    try {
      await apiRequest(`/api/admin/seo/keywords/${keyword.id}`, {
        method: "PATCH",
        token,
        body,
      });
      const page = await apiRequest<PageResponse<Keyword>>(
        "/api/admin/seo/keywords?pageSize=100",
        { token },
      );
      setKeywords(page.items);
    } catch (error) {
      showToast(messageOf(error, "关键词更新失败。"), "error");
    }
  }

  async function queueGeneration(keywordId?: string) {
    if (!token) return;
    setBusy(true);
    try {
      await apiRequest("/api/admin/seo/generate", {
        method: "POST",
        token,
        body: { keywordId },
      });
      setJobs(
        await apiRequest<{
          generation: GenerationJob[];
          indexing: IndexJob[];
        }>("/api/admin/seo/jobs", { token }),
      );
      showToast("生成任务已进入队列，完成后会出现在草稿列表。");
    } catch (error) {
      showToast(messageOf(error, "生成任务创建失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function retryJob(
    kind: "generation-jobs" | "index-submissions",
    id: string,
  ) {
    if (!token) return;
    try {
      await apiRequest(`/api/admin/seo/${kind}/${id}/retry`, {
        method: "POST",
        token,
      });
      setJobs(
        await apiRequest<{
          generation: GenerationJob[];
          indexing: IndexJob[];
        }>("/api/admin/seo/jobs", { token }),
      );
      showToast("任务已重新进入队列。");
    } catch (error) {
      showToast(messageOf(error, "任务重试失败。"), "error");
    }
  }

  async function saveSettings() {
    if (!token || !settings) return;
    setBusy(true);
    try {
      const next = await apiRequest<SeoSettings>("/api/admin/seo/settings", {
        method: "PUT",
        token,
        body: {
          enabled: settings.enabled,
          aiBaseUrl: settings.aiBaseUrl,
          textModel: settings.textModel,
          imageModel: settings.imageModel,
          timeoutMs: settings.timeoutMs,
          scheduleDays: settings.scheduleDays,
          scheduleHour: settings.scheduleHour,
          indexNowEnabled: settings.indexNowEnabled,
          googleEnabled: settings.googleEnabled,
          googleProperty: settings.googleProperty,
          aiApiKey: settingsSecrets.aiApiKey || undefined,
          googleServiceAccountJson:
            settingsSecrets.googleServiceAccountJson || undefined,
        },
      });
      setSettings(next);
      setSettingsSecrets({ aiApiKey: "", googleServiceAccountJson: "" });
      showToast("SEO 设置已保存，密钥不会在页面回显。");
    } catch (error) {
      showToast(messageOf(error, "SEO 设置保存失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(kind: "ai" | "google") {
    if (!token) return;
    setBusy(true);
    try {
      await apiRequest(`/api/admin/seo/settings/test-${kind}`, {
        method: "POST",
        token,
      });
      showToast(
        kind === "ai" ? "AI 文本接口连接正常。" : "Search Console 连接正常。",
      );
    } catch (error) {
      showToast(messageOf(error, "连接测试失败。"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <ConsoleShell
        title="内容与 SEO"
        subtitle="文章、索引与搜索表现"
        scope="Content"
        navItems={adminNav}
        requireRole="admin"
      >
        <PageSkeleton variant="detail" />
      </ConsoleShell>
    );
  }

  const currentRevision =
    selected?.draftRevision ?? selected?.publishedRevision ?? null;
  const quality = currentRevision?.qualityReport ?? null;

  return (
    <ConsoleShell
      title="内容与 SEO"
      subtitle="人工审核发布，自动生成仅进入草稿"
      scope="Content"
      navItems={adminNav}
      requireRole="admin"
      toolbarMeta={
        <span className="badge info">每周一、三、五 10:00 · Asia/Shanghai</span>
      }
      toolbarActions={
        <button
          className="toolbar-button"
          type="button"
          disabled={busy}
          onClick={() => void loadAll()}
        >
          <Icon name="refresh" />
          刷新
        </button>
      }
    >
      <Toast toast={toast} />
      <div className="page-stack seo-admin-page">
        <div
          className="segmented-control seo-admin-tabs"
          aria-label="SEO 工作区"
        >
          {VIEW_LABELS.map((item) => (
            <button
              key={item.value}
              className={view === item.value ? "active" : ""}
              type="button"
              onClick={() => setView(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {view === "articles" ? (
          selected || draft.title || draft.contentJson !== EMPTY_DOCUMENT ? (
            <div className="seo-editor-page">
              <div className="seo-editor-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setDraft(EMPTY_ARTICLE);
                  }}
                >
                  <Icon name="arrow_back" />
                  返回文章
                </button>
                <div
                  className="segmented-control compact"
                  aria-label="文章编辑模式"
                >
                  <button
                    className={editorMode === "edit" ? "active" : ""}
                    type="button"
                    onClick={() => setEditorMode("edit")}
                  >
                    编辑
                  </button>
                  <button
                    className={editorMode === "preview" ? "active" : ""}
                    type="button"
                    onClick={() => setEditorMode("preview")}
                  >
                    预览
                  </button>
                </div>
                <button
                  className="toolbar-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void saveArticle()}
                >
                  <Icon name="edit" />
                  保存草稿
                </button>
                {selected ? (
                  <button
                    className="action-button"
                    disabled={
                      busy || !selected.draftRevision || !quality?.passed
                    }
                    type="button"
                    onClick={() => void mutateArticle("publish")}
                  >
                    <Icon name="upload" />
                    发布
                  </button>
                ) : null}
              </div>

              {editorMode === "edit" ? (
                <>
                  <Panel
                    title="文章信息"
                    copy="公开标题与摘要不写入容易过期的具体套餐价格"
                  >
                    <div className="form-grid seo-article-fields">
                      <label className="field">
                        <span className="fine-print">文章标题</span>
                        <input
                          className="control"
                          maxLength={80}
                          value={draft.title}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              title: event.target.value,
                              seoTitle: draft.seoTitle || event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="fine-print">地址 slug</span>
                        <input
                          className="control"
                          maxLength={100}
                          placeholder="留空时根据标题生成拼音"
                          value={draft.slug}
                          onChange={(event) =>
                            setDraft({ ...draft, slug: event.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="fine-print">栏目</span>
                        <input
                          className="control"
                          maxLength={80}
                          value={draft.category}
                          onChange={(event) =>
                            setDraft({ ...draft, category: event.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="fine-print">主关键词</span>
                        <input
                          className="control"
                          maxLength={120}
                          value={draft.primaryKeyword}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              primaryKeyword: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field span-2">
                        <span className="fine-print">摘要</span>
                        <textarea
                          className="control"
                          maxLength={300}
                          rows={3}
                          value={draft.excerpt}
                          onChange={(event) =>
                            setDraft({ ...draft, excerpt: event.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="fine-print">相关关键词</span>
                        <input
                          className="control"
                          placeholder="用逗号分隔"
                          value={draft.relatedKeywords}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              relatedKeywords: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="fine-print">标签</span>
                        <input
                          className="control"
                          placeholder="用逗号分隔"
                          value={draft.tags}
                          onChange={(event) =>
                            setDraft({ ...draft, tags: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  </Panel>
                  <Panel
                    title="正文"
                    copy="标题层级限制为 H2-H4，图片文件名会作为默认替代文本"
                  >
                    <SimpleEditor
                      content={draft.contentJson}
                      documentKey={
                        selected?.draftRevision?.id ??
                        selected?.publishedRevision?.id ??
                        "new"
                      }
                      onChange={(content) =>
                        setDraft((current) => ({
                          ...current,
                          contentJson: content,
                        }))
                      }
                      uploadImage={async (file) =>
                        (await uploadImage(file)).url
                      }
                      onUploadError={(error) =>
                        showToast(error.message, "error")
                      }
                    />
                  </Panel>
                  <Panel
                    title="搜索摘要"
                    copy="用于搜索结果、分享卡片与索引页面"
                  >
                    <div className="form-grid seo-article-fields">
                      <label className="field">
                        <span className="fine-print">SEO 标题（8-70 字）</span>
                        <input
                          className="control"
                          maxLength={70}
                          value={draft.seoTitle}
                          onChange={(event) =>
                            setDraft({ ...draft, seoTitle: event.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="fine-print">
                          SEO 描述（40-180 字）
                        </span>
                        <textarea
                          className="control"
                          maxLength={180}
                          rows={3}
                          value={draft.metaDescription}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              metaDescription: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="fine-print">封面替代文本</span>
                        <input
                          className="control"
                          maxLength={180}
                          value={draft.coverAlt}
                          onChange={(event) =>
                            setDraft({ ...draft, coverAlt: event.target.value })
                          }
                        />
                      </label>
                      <div className="field seo-cover-actions">
                        <span className="fine-print">1600×900 WebP 封面</span>
                        <div>
                          <label className="toolbar-button">
                            <Icon name="upload" />
                            上传
                            <input
                              hidden
                              accept="image/*"
                              type="file"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file)
                                  void uploadImage(file)
                                    .then((image) =>
                                      setDraft((current) => ({
                                        ...current,
                                        coverImageId: image.id,
                                        coverUrl: image.url,
                                      })),
                                    )
                                    .catch((error) =>
                                      showToast(
                                        messageOf(error, "封面上传失败。"),
                                        "error",
                                      ),
                                    );
                              }}
                            />
                          </label>
                          {selected ? (
                            <button
                              className="toolbar-button"
                              disabled={busy}
                              type="button"
                              onClick={() => void regenerateCover()}
                            >
                              <Icon name="refresh" />
                              AI 重新生成
                            </button>
                          ) : null}
                          {draft.coverImageId ? (
                            <button
                              className="ghost-button"
                              type="button"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  coverImageId: "",
                                  coverUrl: "",
                                  coverAlt: "",
                                })
                              }
                            >
                              <Icon name="trash" />
                              移除
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {draft.coverUrl ? (
                        <div className="seo-cover-preview span-2">
                          <Image
                            src={draft.coverUrl}
                            alt={draft.coverAlt || "文章封面预览"}
                            height={315}
                            unoptimized
                            width={560}
                          />
                        </div>
                      ) : null}
                    </div>
                  </Panel>
                </>
              ) : (
                <Panel
                  title="文章预览"
                  copy="预览使用上一次服务端清洗后的 HTML，保存后更新"
                >
                  {currentRevision ? (
                    <article className="seo-admin-preview">
                      <span>{draft.category}</span>
                      <h1>{draft.title}</h1>
                      <p>{draft.excerpt}</p>
                      <div
                        className="seo-prose"
                        dangerouslySetInnerHTML={{
                          __html: currentRevision.contentHtml,
                        }}
                      />
                    </article>
                  ) : (
                    <div className="empty-state">请先保存草稿再预览。</div>
                  )}
                </Panel>
              )}

              {selected ? (
                <div className="seo-review-grid">
                  <Panel
                    title="发布检查"
                    copy={`质量分 ${quality?.score ?? 0}`}
                  >
                    <div
                      className={`seo-quality-summary ${quality?.passed ? "passed" : "blocked"}`}
                    >
                      <strong>
                        {quality?.passed
                          ? selected.draftRevision
                            ? "可以发布"
                            : "当前线上版本已通过检查"
                          : "尚不能发布"}
                      </strong>
                      <span>
                        {quality?.metrics.plainTextLength ?? 0} 字 ·{" "}
                        {quality?.metrics.headingCount ?? 0} 个 H2 ·{" "}
                        {quality?.metrics.internalLinkCount ?? 0} 个站内链接
                      </span>
                    </div>
                    {[
                      ...(quality?.blockers ?? []),
                      ...(quality?.warnings ?? []),
                    ].map((item) => (
                      <div className="seo-check-item" key={item}>
                        {item}
                      </div>
                    ))}
                  </Panel>
                  <Panel
                    title="发布安排"
                    copy={
                      selected.publishedAt
                        ? `首次发布 ${dateTime(selected.publishedAt)}`
                        : "发布后才会通知搜索引擎"
                    }
                  >
                    <div className="seo-schedule-row">
                      <input
                        className="control"
                        type="datetime-local"
                        value={scheduleAt}
                        onChange={(event) => setScheduleAt(event.target.value)}
                      />
                      <button
                        className="toolbar-button"
                        disabled={
                          !scheduleAt ||
                          busy ||
                          !selected.draftRevision ||
                          !quality?.passed
                        }
                        type="button"
                        onClick={() => void mutateArticle("schedule")}
                      >
                        <Icon name="schedule" />
                        定时发布
                      </button>
                      {selected.publishedRevision ? (
                        <Link
                          className="ghost-button"
                          href={`/blog/${selected.slug}`}
                          target="_blank"
                        >
                          查看线上
                        </Link>
                      ) : null}
                      <button
                        className="ghost-button"
                        disabled={busy}
                        type="button"
                        onClick={() => void mutateArticle("archive")}
                      >
                        <Icon name="trash" />
                        归档
                      </button>
                    </div>
                  </Panel>
                </div>
              ) : null}

              {selected?.revisions?.length ? (
                <Panel
                  title="版本历史"
                  copy="恢复会创建新草稿，不直接覆盖线上文章"
                >
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>版本</th>
                          <th>来源</th>
                          <th>创建时间</th>
                          <th>质量分</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {selected.revisions.map((revision) => (
                          <tr key={revision.id}>
                            <td>v{revision.version}</td>
                            <td>
                              {revision.source === "AI"
                                ? "AI 草稿"
                                : "人工编辑"}
                            </td>
                            <td>{dateTime(revision.createdAt)}</td>
                            <td>{revision.qualityScore}</td>
                            <td>
                              <button
                                className="table-action"
                                disabled={
                                  revision.id === selected.draftRevision?.id ||
                                  busy
                                }
                                type="button"
                                onClick={() =>
                                  void restoreRevision(revision.id)
                                }
                              >
                                恢复
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              ) : null}
            </div>
          ) : (
            <Panel
              title="文章"
              copy={`${articles.length} 篇内容，线上版本与草稿版本彼此隔离`}
              action={
                <button
                  className="action-button"
                  type="button"
                  onClick={newArticle}
                >
                  <Icon name="add" />
                  新建文章
                </button>
              }
            >
              <div className="seo-article-list">
                {articles.length ? (
                  articles.map((article) => (
                    <button
                      className="seo-article-row"
                      key={article.id}
                      type="button"
                      onClick={() => void openArticle(article.id)}
                    >
                      <div>
                        <span className={`badge ${badgeKind(article.status)}`}>
                          {STATUS_LABEL[article.status]}
                        </span>
                        <strong>
                          {article.currentRevision?.title || article.slug}
                        </strong>
                        <small>
                          {article.category} · 更新于{" "}
                          {dateTime(article.updatedAt)}
                        </small>
                      </div>
                      <span>编辑</span>
                    </button>
                  ))
                ) : (
                  <div className="empty-state">
                    暂无文章。先手动新建，或在关键词池中创建 AI 草稿。
                  </div>
                )}
              </div>
            </Panel>
          )
        ) : null}

        {view === "keywords" ? (
          <>
            <Panel
              title="新增关键词"
              copy="一个主要搜索意图只分配给一篇核心文章"
            >
              <div className="seo-keyword-form">
                <input
                  className="control"
                  placeholder="关键词"
                  value={keywordForm.keyword}
                  onChange={(event) =>
                    setKeywordForm({
                      ...keywordForm,
                      keyword: event.target.value,
                    })
                  }
                />
                <input
                  className="control"
                  placeholder="栏目"
                  value={keywordForm.category}
                  onChange={(event) =>
                    setKeywordForm({
                      ...keywordForm,
                      category: event.target.value,
                    })
                  }
                />
                <input
                  className="control"
                  placeholder="搜索意图"
                  value={keywordForm.searchIntent}
                  onChange={(event) =>
                    setKeywordForm({
                      ...keywordForm,
                      searchIntent: event.target.value,
                    })
                  }
                />
                <input
                  className="control"
                  min={-100}
                  max={100}
                  type="number"
                  value={keywordForm.priority}
                  onChange={(event) =>
                    setKeywordForm({
                      ...keywordForm,
                      priority: event.target.value,
                    })
                  }
                />
                <button
                  className="action-button"
                  disabled={busy || !keywordForm.keyword.trim()}
                  type="button"
                  onClick={() => void createKeyword()}
                >
                  <Icon name="add" />
                  加入词库
                </button>
              </div>
            </Panel>
            <Panel title="关键词池" copy="AI 只会读取公开站点资料与已发布文章">
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>关键词</th>
                      <th>栏目 / 意图</th>
                      <th>优先级</th>
                      <th>状态</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {keywords.map((keyword) => (
                      <tr key={keyword.id}>
                        <td>
                          <strong>{keyword.keyword}</strong>
                        </td>
                        <td>
                          {keyword.category}
                          <small className="table-secondary">
                            {keyword.searchIntent || "未填写"}
                          </small>
                        </td>
                        <td>{keyword.priority}</td>
                        <td>
                          <span
                            className={`badge ${badgeKind(keyword.status)}`}
                          >
                            {STATUS_LABEL[keyword.status]}
                          </span>
                        </td>
                        <td>
                          <div className="table-actions">
                            {keyword.status !== "USED" ? (
                              <>
                                <button
                                  className="table-action"
                                  type="button"
                                  onClick={() =>
                                    void updateKeyword(keyword, {
                                      status:
                                        keyword.status === "ACTIVE"
                                          ? "PAUSED"
                                          : "ACTIVE",
                                    })
                                  }
                                >
                                  {keyword.status === "ACTIVE"
                                    ? "暂停"
                                    : "启用"}
                                </button>
                                <button
                                  className="table-action"
                                  disabled={busy || keyword.status !== "ACTIVE"}
                                  type="button"
                                  onClick={() =>
                                    void queueGeneration(keyword.id)
                                  }
                                >
                                  生成草稿
                                </button>
                              </>
                            ) : keyword.article ? (
                              <Link
                                className="table-action"
                                href={`/blog/${keyword.article.slug}`}
                              >
                                文章
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        ) : null}

        {view === "jobs" ? (
          <div className="seo-review-grid">
            <Panel
              title="AI 生成任务"
              copy="正文失败与封面失败都会保留明确原因"
            >
              <div className="seo-job-list">
                {jobs.generation.map((job) => (
                  <div className="seo-job-row" key={job.id}>
                    <div>
                      <span className={`badge ${badgeKind(job.status)}`}>
                        {STATUS_LABEL[job.status]}
                      </span>
                      <strong>{job.keyword?.keyword || "关键词已删除"}</strong>
                      <small>
                        {dateTime(job.createdAt)} · 尝试 {job.attempts} 次
                        {job.usage
                          ? ` · ${job.usage.inputTokens ?? 0}/${job.usage.outputTokens ?? 0} tokens`
                          : ""}
                      </small>
                      {job.lastError ? <em>{job.lastError}</em> : null}
                    </div>
                    {job.status === "FAILED" ? (
                      <button
                        className="table-action"
                        type="button"
                        onClick={() => void retryJob("generation-jobs", job.id)}
                      >
                        重试
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>
            <Panel
              title="索引提交"
              copy="IndexNow 与 Google Sitemap 最多重试 6 次"
            >
              <div className="seo-job-list">
                {jobs.indexing.map((job) => (
                  <div className="seo-job-row" key={job.id}>
                    <div>
                      <span className={`badge ${badgeKind(job.status)}`}>
                        {STATUS_LABEL[job.status]}
                      </span>
                      <strong>
                        {job.engine === "BING_INDEXNOW"
                          ? "Bing IndexNow"
                          : "Google Sitemap"}{" "}
                        · {job.operation}
                      </strong>
                      <small>
                        {job.url} · 尝试 {job.attempts} 次
                      </small>
                      {job.lastError ? <em>{job.lastError}</em> : null}
                    </div>
                    {job.status === "FAILED" ? (
                      <button
                        className="table-action"
                        type="button"
                        onClick={() =>
                          void retryJob("index-submissions", job.id)
                        }
                      >
                        重试
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        ) : null}

        {view === "analytics" && analytics ? (
          <>
            <div className="metric-grid seo-metric-grid">
              {[
                {
                  label: "近 28 天曝光",
                  value: analytics.current.impressions.toLocaleString("zh-CN"),
                },
                {
                  label: "近 28 天点击",
                  value: analytics.current.clicks.toLocaleString("zh-CN"),
                },
                {
                  label: "点击率",
                  value: `${(analytics.current.ctr * 100).toFixed(1)}%`,
                },
                {
                  label: "平均排名",
                  value: analytics.current.position
                    ? analytics.current.position.toFixed(1)
                    : "-",
                },
              ].map((item) => (
                <div className="metric-card" key={item.label}>
                  <span className="metric-label">{item.label}</span>
                  <strong className="metric-value">{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="seo-review-grid">
              <Panel
                title="高曝光关键词"
                copy="优先判断搜索意图，再优化标题与正文"
              >
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>查询词</th>
                        <th>曝光</th>
                        <th>点击</th>
                        <th>CTR</th>
                        <th>排名</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.highImpressionQueries.map((item) => (
                        <tr key={item.value}>
                          <td>{item.value || "（无查询词）"}</td>
                          <td>{item.impressions}</td>
                          <td>{item.clicks}</td>
                          <td>{(item.ctr * 100).toFixed(1)}%</td>
                          <td>{item.position.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <Panel title="低 CTR 页面" copy="曝光至少 100 且点击率低于 3%">
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>页面</th>
                        <th>曝光</th>
                        <th>点击</th>
                        <th>CTR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.lowCtrPages.map((item) => (
                        <tr key={item.value}>
                          <td className="seo-url-cell">{item.value}</td>
                          <td>{item.impressions}</td>
                          <td>{item.clicks}</td>
                          <td>{(item.ctr * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!analytics.lowCtrPages.length ? (
                    <div className="empty-state compact">
                      暂无达到阈值的低点击率页面
                    </div>
                  ) : null}
                </div>
              </Panel>
              <Panel title="页面表现" copy="Search Console 最近 28 天聚合">
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>页面</th>
                        <th>曝光</th>
                        <th>点击</th>
                        <th>排名</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.topPages.map((item) => (
                        <tr key={item.value}>
                          <td className="seo-url-cell">{item.value}</td>
                          <td>{item.impressions}</td>
                          <td>{item.clicks}</td>
                          <td>{item.position.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          </>
        ) : null}

        {view === "settings" && settings ? (
          <>
            <Panel
              title="AI 内容生成"
              copy="默认关闭；自动任务只创建草稿，不自动发布"
            >
              <div className="form-grid seo-settings-grid">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  <span>启用每周自动生成</span>
                </label>
                <label className="field">
                  <span className="fine-print">Base URL</span>
                  <input
                    className="control"
                    placeholder="https://api.openai.com/v1"
                    value={settings.aiBaseUrl}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        aiBaseUrl: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">文本模型</span>
                  <input
                    className="control"
                    value={settings.textModel}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        textModel: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">图片模型（可选）</span>
                  <input
                    className="control"
                    value={settings.imageModel}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        imageModel: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">
                    API Key {settings.aiConfigured ? "（已配置）" : ""}
                  </span>
                  <input
                    className="control"
                    type="password"
                    autoComplete="new-password"
                    value={settingsSecrets.aiApiKey}
                    onChange={(event) =>
                      setSettingsSecrets({
                        ...settingsSecrets,
                        aiApiKey: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">超时（毫秒）</span>
                  <input
                    className="control"
                    min={5000}
                    max={180000}
                    type="number"
                    value={settings.timeoutMs}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        timeoutMs: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span className="fine-print">
                    生成小时（{settings.timezone}）
                  </span>
                  <input
                    className="control"
                    min={0}
                    max={23}
                    type="number"
                    value={settings.scheduleHour}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        scheduleHour: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <div className="field span-2">
                  <span className="fine-print">生成日期</span>
                  <div className="seo-day-picker">
                    {[
                      { day: 1, label: "周一" },
                      { day: 3, label: "周三" },
                      { day: 5, label: "周五" },
                    ].map((item) => (
                      <label key={item.day}>
                        <input
                          type="checkbox"
                          checked={settings.scheduleDays.includes(item.day)}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              scheduleDays: event.target.checked
                                ? [...settings.scheduleDays, item.day]
                                : settings.scheduleDays.filter(
                                    (day) => day !== item.day,
                                  ),
                            })
                          }
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="panel-actions">
                <button
                  className="toolbar-button"
                  disabled={busy || !settings.aiConfigured}
                  type="button"
                  onClick={() => void testConnection("ai")}
                >
                  测试 AI
                </button>
              </div>
            </Panel>
            <div className="seo-review-grid">
              <Panel
                title="Bing IndexNow"
                copy="文章发布、更新或归档后进入幂等提交队列"
              >
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.indexNowEnabled}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        indexNowEnabled: event.target.checked,
                      })
                    }
                  />
                  <span>启用 IndexNow 推送</span>
                </label>
                {settings.indexNowKey ? (
                  <div className="seo-setting-note">
                    验证密钥已生成，公开地址为{" "}
                    <code>/api/seo/indexnow-key</code>
                  </div>
                ) : null}
              </Panel>
              <Panel
                title="Google Search Console"
                copy="普通文章只使用 sitemap，不调用不适用的 Indexing API"
              >
                <div className="form-stack">
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={settings.googleEnabled}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          googleEnabled: event.target.checked,
                        })
                      }
                    />
                    <span>启用 Sitemap 提交与每日数据同步</span>
                  </label>
                  <label className="field">
                    <span className="fine-print">站点属性</span>
                    <input
                      className="control"
                      placeholder="sc-domain:example.com"
                      value={settings.googleProperty}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          googleProperty: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="fine-print">
                      服务账号 JSON{" "}
                      {settings.googleConfigured ? "（已配置）" : ""}
                    </span>
                    <textarea
                      className="control"
                      rows={5}
                      value={settingsSecrets.googleServiceAccountJson}
                      onChange={(event) =>
                        setSettingsSecrets({
                          ...settingsSecrets,
                          googleServiceAccountJson: event.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    className="toolbar-button"
                    disabled={busy || !settings.googleConfigured}
                    type="button"
                    onClick={() => void testConnection("google")}
                  >
                    测试 Search Console
                  </button>
                </div>
              </Panel>
            </div>
            <div className="seo-settings-submit">
              <button
                className="action-button"
                disabled={busy}
                type="button"
                onClick={() => void saveSettings()}
              >
                <Icon name="check" />
                保存全部设置
              </button>
            </div>
          </>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
