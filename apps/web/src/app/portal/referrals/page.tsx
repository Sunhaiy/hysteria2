"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { DataTable } from "@/components/data-table";
import { MetricCard } from "@/components/metric-card";
import { Panel } from "@/components/panel";
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

export default function PortalReferralsPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [records, setRecords] = useState(emptyPage);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextSummary, nextRecords] = await Promise.all([
        apiRequest<ReferralSummary>("/api/portal/referrals/summary", { token, signal }),
        apiRequest<PaginatedResponse<ReferralRecord>>(
          `/api/portal/referrals?page=${page}&pageSize=20`,
          { token, signal },
        ),
      ]);
      setSummary(nextSummary);
      setRecords(nextRecords);
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof ApiError ? cause.message : "邀请记录加载失败。");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [page, token]);

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

  return (
    <ConsoleShell
      title="邀请奖励"
      subtitle="邀请新会员完成首次套餐 CDK 兑换"
      scope="Referral"
      navItems={portalNav}
      requireRole="member"
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="metric-grid">
        <MetricCard label="已邀请" value={String(summary?.total ?? 0)} footnote="邮箱注册归因" />
        <MetricCard label="待成交" value={String(summary?.pending ?? 0)} footnote="等待套餐 CDK" />
        <MetricCard label="成功奖励" value={String(summary?.rewarded ?? 0)} footnote="当前有效" />
        <MetricCard label="累计余额奖励" value={formatMoney(summary?.cumulativeRewardCents ?? 0)} footnote="退款追回另行记录" />
      </div>

      <Panel title="我的邀请入口" copy="邀请码长期有效，不能自行重置。">
        {summary?.code && summary.inviteUrl ? (
          <div className="referral-code-layout">
            <div className="referral-code-value mono">{summary.code}</div>
            <div className="subscription-link-row">
              <input className="control mono" readOnly value={summary.inviteUrl} />
              <button className="ghost-button" type="button" disabled={!summary.enabled} onClick={() => void copy(summary.code!, "邀请码")}>复制邀请码</button>
              <button className="action-button" type="button" disabled={!summary.enabled} onClick={() => void copy(summary.inviteUrl!, "邀请链接")}>复制链接</button>
            </div>
            <span className="fine-print">好友通过邮箱验证码注册，并首次兑换套餐 CDK 后，你获得 {formatMoney(summary.nextInviterRewardCents)}；好友获得 {formatBytes(summary.inviteeRewardBytes)} 流量。</span>
            {!summary.enabled ? <div className="feedback warn">邀请活动当前已暂停，已有待成交邀请仍会正常结算。</div> : null}
          </div>
        ) : (
          <button className="action-button" type="button" disabled={busy || loading} onClick={() => void createCode()}>
            {busy ? "生成中..." : "生成邀请码"}
          </button>
        )}
      </Panel>

      <Panel title="邀请记录">
        <DataTable
          loading={loading}
          error={error}
          onRetry={() => void load()}
          emptyText="还没有邀请记录"
          headers={["好友", "邀请码", "状态", "双方奖励", "注册时间", "结算时间"]}
          rows={records.items.map((record) => [
            record.inviteeEmail,
            <span className="mono" key={`${record.id}-code`}>{record.inviteCode}</span>,
            <span className={`badge ${record.status === "rewarded" ? "success" : record.status === "reversed" ? "warn" : "neutral"}`} key={`${record.id}-status`}>{statusLabel[record.status]}</span>,
            `${formatMoney(record.inviterRewardCents)} / ${formatBytes(record.inviteeRewardBytes)}`,
            formatDateTime(record.createdAt),
            record.rewardedAt ? formatDateTime(record.rewardedAt) : "-",
          ])}
          pagination={{ ...records, onPageChange: setPage }}
        />
      </Panel>
      <Toast toast={toast} />
    </ConsoleShell>
  );
}
