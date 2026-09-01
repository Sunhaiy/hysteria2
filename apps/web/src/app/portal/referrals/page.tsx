"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { Toast, useToast } from "@/components/toast";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";

interface ReferralSummary {
  code: string | null;
  inviteUrl: string | null;
  total: number;
  pending: number;
  rewarded: number;
  reversed: number;
  cumulativeRewardCents: number;
  currentRewardCents: number;
  nextInviterRewardCents: number;
  inviteeRewardBytes: number;
  enabled: boolean;
}

interface ReferralRecord {
  id: string;
  inviteeEmail: string;
  inviteCode: string;
  status: "pending" | "rewarded" | "reversed";
  inviterRewardCents: number;
  inviteeRewardBytes: number;
  createdAt: string;
  rewardedAt: string | null;
  reversedAt: string | null;
}

const emptyPage: PaginatedResponse<ReferralRecord> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};

const statusLabel = {
  pending: "待首次套餐兑换",
  rewarded: "奖励已到账",
  reversed: "退款已追回",
};

const referralMetrics = [
  {
    key: "total",
    label: "已邀请",
    footnote: "完成邮箱注册",
    icon: "group",
    tone: "info",
  },
  {
    key: "pending",
    label: "待成交",
    footnote: "等待套餐 CDK",
    icon: "schedule",
    tone: "pending",
  },
  {
    key: "rewarded",
    label: "成功奖励",
    footnote: "奖励当前有效",
    icon: "redeem",
    tone: "success",
  },
  {
    key: "reward",
    label: "当前奖励",
    footnote: "可用余额奖励",
    icon: "payments",
    tone: "reward",
  },
] as const;

export default function PortalReferralsPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [records, setRecords] = useState(emptyPage);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      try {
        const [nextSummary, nextRecords] = await Promise.all([
          apiRequest<ReferralSummary>("/api/portal/referrals/summary", {
            token,
            signal,
          }),
          apiRequest<PaginatedResponse<ReferralRecord>>(
            `/api/portal/referrals?page=${page}&pageSize=20`,
            { token, signal },
          ),
        ]);
        setSummary(nextSummary);
        setRecords(nextRecords);
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof ApiError ? cause.message : "邀请记录加载失败。",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function createCode() {
    if (!token) return;
    setBusy(true);
    try {
      await apiRequest("/api/portal/referrals/code", { method: "POST", token });
      await load();
      showToast("邀请码已生成");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "邀请码生成失败。");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await copyToClipboard(value);
      showToast(`${label}已复制`);
    } catch {
      showToast("复制失败", "error");
    }
  }

  if (loading && !summary && !error) {
    return (
      <ConsoleShell
        title="邀请奖励"
        subtitle="邀请新会员完成首次套餐 CDK 兑换"
        scope="Referral"
        navItems={portalNav}
        requireRole="member"
      >
        <PageSkeleton variant="dashboard" />
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      title="邀请奖励"
      subtitle="邀请新会员完成首次套餐 CDK 兑换"
      scope="Referral"
      navItems={portalNav}
      requireRole="member"
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="referral-page-heading">
        <div>
          <span className="referral-page-kicker">邀请奖励</span>
          <h2>分享邀请，双方都有奖励</h2>
          <p>好友完成邮箱注册并首次兑换套餐 CDK 后，奖励自动到账。</p>
        </div>
        <span className={`badge ${summary?.enabled ? "success" : "warn"}`}>
          {summary?.enabled ? "活动进行中" : "活动已暂停"}
        </span>
      </div>

      <section className="referral-metric-grid" aria-label="邀请数据概览">
        {referralMetrics.map((metric) => {
          const value =
            !summary && loading
              ? "-"
              : metric.key === "reward"
                ? formatMoney(summary?.currentRewardCents ?? 0)
                : String(summary?.[metric.key] ?? 0);
          const footnote =
            metric.key === "reward" && summary
              ? `累计发放 ${formatMoney(summary.cumulativeRewardCents)}`
              : metric.footnote;
          return (
            <article
              className={`referral-metric ${metric.tone}`}
              key={metric.key}
            >
              <div className="referral-metric-head">
                <span>{metric.label}</span>
                <Icon name={metric.icon} />
              </div>
              <strong>{value}</strong>
              <small>{footnote}</small>
            </article>
          );
        })}
      </section>

      <Panel title="我的邀请入口" copy="邀请码长期有效，无需重复生成。">
        {summary?.code && summary.inviteUrl ? (
          <div className="referral-invite-layout">
            <div className="referral-invite-primary">
              <div className="referral-code-row">
                <div>
                  <span className="fine-print">我的邀请码</span>
                  <strong className="referral-code-value mono">
                    {summary.code}
                  </strong>
                </div>
                <button
                  className="ghost-button referral-copy-button"
                  type="button"
                  disabled={!summary.enabled}
                  onClick={() => void copy(summary.code!, "邀请码")}
                >
                  <Icon name="content_copy" />
                  复制邀请码
                </button>
              </div>
              <label className="referral-link-field">
                <span className="fine-print">专属邀请链接</span>
                <div className="referral-link-row">
                  <input
                    className="control mono"
                    aria-label="专属邀请链接"
                    readOnly
                    value={summary.inviteUrl}
                  />
                  <button
                    className="action-button referral-copy-button"
                    type="button"
                    disabled={!summary.enabled}
                    onClick={() => void copy(summary.inviteUrl!, "邀请链接")}
                  >
                    <Icon name="content_copy" />
                    复制链接
                  </button>
                </div>
              </label>
              <div className="referral-settlement-note">
                <Icon name="shield" />
                <span>奖励在好友首次兑换套餐 CDK 后自动结算。</span>
              </div>
            </div>
            <aside
              className="referral-reward-summary"
              aria-label="邀请奖励规则"
            >
              <span className="fine-print">本次邀请奖励</span>
              <div className="referral-reward-row">
                <span>你获得</span>
                <strong>{formatMoney(summary.nextInviterRewardCents)}</strong>
                <small>平台余额</small>
              </div>
              <div className="referral-reward-row">
                <span>好友获得</span>
                <strong>{formatBytes(summary.inviteeRewardBytes)}</strong>
                <small>额外流量</small>
              </div>
            </aside>
            {!summary.enabled ? (
              <div className="feedback warn referral-status-note">
                邀请活动当前已暂停，已有待成交邀请仍会正常结算。
              </div>
            ) : null}
          </div>
        ) : (
          <div className="referral-generate-state">
            <Icon name="group" />
            <div>
              <strong>生成你的专属邀请入口</strong>
              <span>邀请码生成后将长期保持不变。</span>
            </div>
            <button
              className="action-button"
              type="button"
              disabled={busy || loading}
              onClick={() => void createCode()}
            >
              {busy ? "生成中..." : "生成邀请码"}
            </button>
          </div>
        )}
      </Panel>

      <Panel title="邀请记录">
        {!loading && !error && records.items.length === 0 ? (
          <div className="referral-empty-state">
            <span className="referral-empty-icon">
              <Icon name="group" />
            </span>
            <strong>还没有邀请记录</strong>
            <span>好友通过你的链接完成邮箱注册后，记录会显示在这里。</span>
          </div>
        ) : (
          <DataTable
            loading={loading}
            error={error}
            onRetry={() => void load()}
            emptyText="还没有邀请记录"
            headers={[
              "好友",
              "邀请码",
              "状态",
              "双方奖励",
              "注册时间",
              "结算时间",
            ]}
            rows={records.items.map((record) => [
              record.inviteeEmail,
              <span className="mono" key={`${record.id}-code`}>
                {record.inviteCode}
              </span>,
              <span
                className={`badge ${record.status === "rewarded" ? "success" : record.status === "reversed" ? "warn" : "neutral"}`}
                key={`${record.id}-status`}
              >
                {statusLabel[record.status]}
              </span>,
              `${formatMoney(record.inviterRewardCents)} / ${formatBytes(record.inviteeRewardBytes)}`,
              formatDateTime(record.createdAt),
              record.rewardedAt ? formatDateTime(record.rewardedAt) : "-",
            ])}
            pagination={{ ...records, onPageChange: setPage }}
          />
        )}
      </Panel>
      <Toast toast={toast} />
    </ConsoleShell>
  );
}
