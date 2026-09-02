"use client";

import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomSelect } from "@/components/custom-select";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";

interface AdminReferralSummary {
  total: number;
  pending: number;
  rewarded: number;
  reversed: number;
  issuedRewardCents: number;
  issuedTrafficBytes: number;
  recoveredCents: number;
  unrecoveredCents: number;
}

interface ReferralSettings {
  enabled: boolean;
  inviterRewardBasisPoints: number;
  inviteeRewardBytes: number;
}

interface AdminReferralRecord {
  id: string;
  inviterEmail: string;
  inviterDisplayName: string;
  inviteeEmail: string;
  inviteeDisplayName: string;
  inviteCode: string;
  status: "pending" | "rewarded" | "reversed";
  inviterRewardCents: number;
  inviterRewardBasisPoints: number | null;
  inviteeRewardBytes: number;
  qualifyingOrderId: string | null;
  recoveredCents: number;
  unrecoveredCents: number;
  createdAt: string;
}

const emptyPage: PaginatedResponse<AdminReferralRecord> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};

function formatPercent(basisPoints: number) {
  return `${Number((basisPoints / 100).toFixed(2))}%`;
}

function formatReferralReward(record: AdminReferralRecord) {
  return record.status === "pending" && record.inviterRewardBasisPoints !== null
    ? formatPercent(record.inviterRewardBasisPoints)
    : formatMoney(record.inviterRewardCents);
}

export default function AdminReferralsPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<AdminReferralSummary | null>(null);
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [records, setRecords] = useState(emptyPage);
  const [page, setPage] = useState(1);
  const [inviter, setInviter] = useState("");
  const [invitee, setInvitee] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [status, setStatus] = useState("all");
  const [debouncedFilters, setDebouncedFilters] = useState({
    inviter: "",
    invitee: "",
    inviteCode: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedFilters({
        inviter: inviter.trim(),
        invitee: invitee.trim(),
        inviteCode: inviteCode.trim(),
      });
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [inviteCode, invitee, inviter]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      const query = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (debouncedFilters.inviter)
        query.set("inviter", debouncedFilters.inviter);
      if (debouncedFilters.invitee)
        query.set("invitee", debouncedFilters.invitee);
      if (debouncedFilters.inviteCode)
        query.set("inviteCode", debouncedFilters.inviteCode);
      if (status !== "all") query.set("status", status);
      try {
        const [nextSummary, nextSettings, nextRecords] = await Promise.all([
          apiRequest<AdminReferralSummary>("/api/admin/referrals/summary", {
            token,
            signal,
          }),
          apiRequest<ReferralSettings>("/api/admin/referrals/settings", {
            token,
            signal,
          }),
          apiRequest<PaginatedResponse<AdminReferralRecord>>(
            `/api/admin/referrals?${query}`,
            { token, signal },
          ),
        ]);
        setSummary(nextSummary);
        setSettings(nextSettings);
        setRecords(nextRecords);
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof ApiError ? cause.message : "拉新数据加载失败。",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [debouncedFilters, page, status, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function saveSettings() {
    if (!token || !settings) return;
    setSaving(true);
    try {
      setSettings(
        await apiRequest<ReferralSettings>("/api/admin/referrals/settings", {
          method: "PATCH",
          token,
          body: {
            enabled: settings.enabled,
            inviterRewardBasisPoints: settings.inviterRewardBasisPoints,
          },
        }),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "设置保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConsoleShell
      title="拉新管理"
      subtitle="管理邀请归因、奖励结算与退款追回"
      scope="Growth"
      navItems={adminNav}
      requireRole="admin"
    >
      {error ? <div className="feedback error">{error}</div> : null}
      <div className="referral-metric-grid">
        {[
          {
            label: "邀请总数",
            value: String(summary?.total ?? 0),
            footnote: `${summary?.pending ?? 0} 待成交`,
            icon: "group",
          },
          {
            label: "奖励成功",
            value: String(summary?.rewarded ?? 0),
            footnote: `${summary?.reversed ?? 0} 已追回`,
            icon: "schedule",
          },
          {
            label: "余额奖励",
            value: formatMoney(summary?.issuedRewardCents ?? 0),
            footnote: `已追回 ${formatMoney(summary?.recoveredCents ?? 0)}`,
            icon: "payments",
          },
          {
            label: "未追回余额",
            value: formatMoney(summary?.unrecoveredCents ?? 0),
            footnote: `流量已发 ${formatBytes(summary?.issuedTrafficBytes ?? 0)}`,
            icon: "warning",
          },
        ].map((metric) => (
          <article className="referral-metric success" key={metric.label}>
            <div className="referral-metric-head">
              <span>{metric.label}</span>
              <Icon name={metric.icon} />
            </div>
            <strong>{metric.value}</strong>
            <small>{metric.footnote}</small>
          </article>
        ))}
      </div>

      <Panel title="活动设置" copy="修改比例只影响此后注册的新邀请关系。">
        {settings ? (
          <div className="referral-admin-settings">
            <div className="setting-toggle-row">
              <div className="setting-toggle-copy">
                <strong>邀请活动</strong>
                <span>关闭后不接受新邀请，已有待成交关系仍可结算。</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(event) =>
                    setSettings({ ...settings, enabled: event.target.checked })
                  }
                />
                <span className="toggle-track">
                  <span />
                </span>
                <span className="toggle-label">
                  {settings.enabled ? "开启" : "关闭"}
                </span>
              </label>
            </div>
            <label className="field">
              <span className="fine-print">邀请人返现比例（%）</span>
              <input
                className="control"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={settings.inviterRewardBasisPoints / 100}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    inviterRewardBasisPoints: Math.round(
                      Number(event.target.value) * 100,
                    ),
                  })
                }
              />
              <small>按好友首次套餐 CDK 对应套餐金额返现。</small>
            </label>
            <label className="field referral-fixed-reward">
              <span className="fine-print">被邀请人奖励</span>
              <input
                className="control"
                readOnly
                value={formatBytes(settings.inviteeRewardBytes)}
              />
            </label>
            <button
              className="action-button"
              type="button"
              disabled={saving}
              onClick={() => void saveSettings()}
            >
              {saving ? "保存中..." : "保存设置"}
            </button>
          </div>
        ) : null}
      </Panel>

      <Panel
        className="referral-records-panel"
        title="邀请记录"
        action={
          <div className="inline-form compact referral-record-filters">
            <input
              className="control"
              placeholder="邀请人邮箱"
              value={inviter}
              onChange={(event) => setInviter(event.target.value)}
            />
            <input
              className="control"
              placeholder="被邀请人邮箱"
              value={invitee}
              onChange={(event) => setInvitee(event.target.value)}
            />
            <input
              className="control mono"
              placeholder="邀请码"
              value={inviteCode}
              onChange={(event) =>
                setInviteCode(event.target.value.toUpperCase().slice(0, 8))
              }
            />
            <CustomSelect
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={[
                { value: "all", label: "全部状态" },
                { value: "pending", label: "待成交" },
                { value: "rewarded", label: "已奖励" },
                { value: "reversed", label: "已追回" },
              ]}
            />
          </div>
        }
      >
        <DataTable
          loading={loading}
          emptyText="没有匹配的邀请记录"
          headers={[
            "邀请人",
            "被邀请人",
            "邀请码",
            "状态",
            "奖励",
            "订单 / 追回",
            "注册时间",
          ]}
          rows={records.items.map((record) => [
            <span className="list" key={`${record.id}-inviter`}>
              <strong>{record.inviterDisplayName}</strong>
              <small>{record.inviterEmail}</small>
            </span>,
            <span className="list" key={`${record.id}-invitee`}>
              <strong>{record.inviteeDisplayName}</strong>
              <small>{record.inviteeEmail}</small>
            </span>,
            <span className="mono" key={`${record.id}-code`}>
              {record.inviteCode}
            </span>,
            <span
              className={`badge ${record.status === "rewarded" ? "success" : record.status === "reversed" ? "warn" : "neutral"}`}
              key={`${record.id}-status`}
            >
              {record.status}
            </span>,
            `${formatReferralReward(record)} / ${formatBytes(record.inviteeRewardBytes)}`,
            record.status === "reversed"
              ? `追回 ${formatMoney(record.recoveredCents)} · 未追回 ${formatMoney(record.unrecoveredCents)}`
              : (record.qualifyingOrderId ?? "-"),
            formatDateTime(record.createdAt),
          ])}
          pagination={{ ...records, onPageChange: setPage }}
        />
      </Panel>
    </ConsoleShell>
  );
}
