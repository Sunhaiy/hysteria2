"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
type MailJob = {
  id: string;
  subject: string;
  body: string;
  audience: string;
  status: string;
  createdAt: string;
  counts: Record<string, number>;
  recipients: { email: string }[];
  issues: { email: string; status: string; error: string | null }[];
  activityUrl: string;
};
const labels: Record<string, string> = {
  DRAFT: "待确认",
  QUEUED: "发送中",
  COMPLETED: "已处理",
  CANCELED: "已取消",
  PENDING: "待发送",
  SENDING: "正在发送",
  SENT: "邮件服务已接受",
  UNKNOWN: "结果待核实",
  FAILED: "失败",
  SKIPPED: "已跳过",
};
export function CampaignMailPanel({ token }: { token: string | null }) {
  const [subject, setSubject] = useState("素心 Network · 中秋国庆活动");
  const [body, setBody] = useState(
    "中秋国庆活动现已上线，欢迎前往活动页面查看充值赠额、套餐优惠及抽奖规则。具体优惠、参加资格与截止时间以活动页面为准。",
  );
  const [audience, setAudience] = useState("selected"),
    [emails, setEmails] = useState("");
  const [jobs, setJobs] = useState<MailJob[]>([]),
    [preview, setPreview] = useState<MailJob | null>(null);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    if (token)
      setJobs(
        await apiRequest<MailJob[]>("/api/admin/campaign-mail", { token }),
      );
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void apiRequest<MailJob[]>("/api/admin/campaign-mail", {
      token,
      signal: controller.signal,
    })
      .then(setJobs)
      .catch((e) => {
        if (!controller.signal.aborted)
          setMessage(e instanceof Error ? e.message : "加载失败");
      });
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    if (!jobs.some((j) => j.status === "QUEUED")) return;
    const timer = setInterval(
      () => void load().catch(() => setMessage("状态暂时无法刷新，请稍后重试")),
      5000,
    );
    return () => clearInterval(timer);
  }, [jobs, load]);
  function change() {
    setPreview(null);
    setConfirmed(false);
  }
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="holiday-card campaign-mail-panel">
      <h2>活动邮件</h2>
      <p>
        先预览，再确认发送。请核对活动已经开启、优惠与截止时间正确。每封单独发送，不向其他收件人公开邮箱；已退订用户会被排除。
      </p>
      <label className="field">
        收件范围
        <select
          className="control"
          value={audience}
          disabled={busy}
          onChange={(e) => {
            setAudience(e.target.value);
            change();
          }}
        >
          <option value="selected">指定已注册用户</option>
          <option value="expired">套餐已到期的用户</option>
          <option value="all">全部正常用户</option>
        </select>
      </label>
      {audience === "selected" && (
        <label className="field">
          用户邮箱（用逗号或换行分隔）
          <textarea
            className="control"
            value={emails}
            disabled={busy}
            onChange={(e) => {
              setEmails(e.target.value);
              change();
            }}
            rows={3}
          />
        </label>
      )}
      <label className="field">
        邮件标题
        <input
          className="control"
          maxLength={120}
          value={subject}
          disabled={busy}
          onChange={(e) => {
            setSubject(e.target.value);
            change();
          }}
        />
      </label>
      <label className="field">
        正文
        <textarea
          className="control"
          maxLength={12000}
          rows={6}
          value={body}
          disabled={busy}
          onChange={(e) => {
            setBody(e.target.value);
            change();
          }}
        />
      </label>
      <button
        className="action-button secondary"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            setConfirmed(false);
            setPreview(
              await apiRequest<MailJob>("/api/admin/campaign-mail/preview", {
                token,
                method: "POST",
                headers: { "Idempotency-Key": crypto.randomUUID() },
                body: { subject, body, audience, emails },
              }),
            );
            await load();
          })
        }
      >
        预览收件人与邮件
      </button>
      {preview && (
        <div className="campaign-mail-preview">
          <h3>{preview.subject}</h3>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {preview.body}
          </p>
          <p>
            自动附加：
            <a href={preview.activityUrl} target="_blank" rel="noreferrer">
              查看活动详情
            </a>
            、退订活动邮件
          </p>
          <strong>
            实际收件人{" "}
            {Object.values(preview.counts).reduce((a, b) => a + b, 0)} 位
          </strong>
          <p style={{ overflowWrap: "anywhere" }}>
            {preview.recipients.map((r) => r.email).join("、")}
            {preview.recipients.length === 20 ? "（仅展示前20位）" : ""}
          </p>
          {preview.status === "DRAFT" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                我已核对以上收件范围、活动状态和文案，确认发送
              </label>
              <button
                className="action-button"
                disabled={busy || !confirmed}
                onClick={() =>
                  void action(async () => {
                    setPreview(
                      await apiRequest<MailJob>(
                        `/api/admin/campaign-mail/${preview.id}/send`,
                        { token, method: "POST", body: { confirmed: true } },
                      ),
                    );
                    setConfirmed(false);
                    setMessage(
                      "已加入发送队列，可在下方查看进度或取消待发邮件。",
                    );
                    await load();
                  })
                }
              >
                确认发送{" "}
                {Object.values(preview.counts).reduce((a, b) => a + b, 0)} 封
              </button>
            </>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <h3>最近发送记录</h3>
      <p>
        “邮件服务已接受”不代表已进入收件箱。结果待核实的邮件不自动重发，避免重复打扰；取消不撤回已发出或正在发送的邮件。
      </p>
      {jobs.length ? (
        jobs.map((job) => (
          <details key={job.id}>
            <summary>
              {job.subject} · {labels[job.status] ?? job.status} ·{" "}
              {Object.entries(job.counts)
                .map(([k, n]) => `${labels[k] ?? k} ${n}`)
                .join(" / ")}
            </summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{job.body}</p>
            {job.issues.map((i) => (
              <p key={i.email}>
                {i.email}：{i.error}
              </p>
            ))}
            {["DRAFT", "QUEUED"].includes(job.status) && (
              <button
                className="action-button secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await apiRequest(
                      `/api/admin/campaign-mail/${job.id}/cancel`,
                      { token, method: "POST" },
                    );
                    if (preview?.id === job.id) setPreview(null);
                    await load();
                  })
                }
              >
                取消待发邮件
              </button>
            )}
          </details>
        ))
      ) : (
        <p>暂无邮件任务。</p>
      )}
    </section>
  );
}
