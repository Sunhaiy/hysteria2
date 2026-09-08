"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { CustomerLink } from "@/components/customer-link";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { adminNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { PaginatedResponse } from "@/lib/types";

interface CheckInSettings {
  enabled: boolean;
  rewardGiB: number;
  todayClaims: number;
  todayRewardBytes: number;
  monthClaims: number;
  monthRewardBytes: number;
}

interface CheckInRecord {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  productName: string;
  businessDate: string;
  rewardBytes: number;
  claimedAt: string;
}

interface CampaignSettings {
  requiredMembers: number;
  durationMinutes: number;
  discountPercent: number;
  bonusTrafficGiB: number;
  bonusTrafficBytes: number;
  offers: Array<{
    offerId: string;
    productName: string;
    offerName: string;
    billingPeriod: string;
    originalPriceCents: number;
    priceCents: number;
    trafficBytes: number;
    enabled: boolean;
    campaignId: string | null;
  }>;
}

interface AdminGroupBuyRecord {
  id: string;
  shareCode: string;
  status: string;
  productName: string;
  offerName: string;
  priceCents: number;
  originalPriceCents: number;
  settlementMode: string;
  openedAt: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  members: Array<{
    id: string;
    userId: string;
    userEmail: string;
    userDisplayName: string;
    isCreator: boolean;
    status: string;
    amountCents: number | null;
    merchantOrderNo: string | null;
    refundAttemptId: string | null;
    refundStatus: string | null;
    refundError: string | null;
    refundGatewayMessage: string | null;
    fallbackAllowed: boolean;
    orderId: string | null;
    rebateCents: number;
    rebateRecoveredCents: number;
    rebateUnrecoveredCents: number;
  }>;
}

const emptyCheckIns: PaginatedResponse<CheckInRecord> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};
const emptyGroups: PaginatedResponse<AdminGroupBuyRecord> = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};

const statusNames: Record<string, string> = {
  pending_payment: "待创建者付款",
  open: "等待成员",
  fulfilling: "发放中",
  succeeded: "已成团",
  refunding: "退款中",
  refunded: "已退款",
  fallback_fulfilled: "已兜底发放",
  exception: "异常",
  canceled: "已取消",
};

function discountLabel(percent: number) {
  return `${Number((percent / 10).toFixed(2))} 折`;
}

function discountedPriceCents(priceCents: number, percent: number) {
  return Math.max(1, Math.round((priceCents * percent) / 100));
}

export default function AdminActivitiesPage() {
  const { token } = useAuth();
  const [view, setView] = useState<"check-in" | "group-buy">("check-in");
  const [checkInSettings, setCheckInSettings] =
    useState<CheckInSettings | null>(null);
  const [checkIns, setCheckIns] = useState(emptyCheckIns);
  const [campaigns, setCampaigns] = useState<CampaignSettings | null>(null);
  const [selectedOfferIds, setSelectedOfferIds] = useState<string[]>([]);
  const [groups, setGroups] = useState(emptyGroups);
  const [checkInPage, setCheckInPage] = useState(1);
  const [groupPage, setGroupPage] = useState(1);
  const [groupExceptionsOnly, setGroupExceptionsOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      try {
        const [nextSettings, nextCheckIns, nextCampaigns, nextGroups] =
          await Promise.all([
            apiRequest<CheckInSettings>("/api/admin/check-ins/settings", {
              token,
              signal,
            }),
            apiRequest<PaginatedResponse<CheckInRecord>>(
              `/api/admin/check-ins?page=${checkInPage}&pageSize=20`,
              { token, signal },
            ),
            apiRequest<CampaignSettings>("/api/admin/group-buys/campaigns", {
              token,
              signal,
            }),
            apiRequest<PaginatedResponse<AdminGroupBuyRecord>>(
              `/api/admin/group-buys?page=${groupPage}&pageSize=20${groupExceptionsOnly ? "&exceptionsOnly=true" : ""}`,
              { token, signal },
            ),
          ]);
        setCheckInSettings(nextSettings);
        setCheckIns(nextCheckIns);
        setCampaigns(nextCampaigns);
        setSelectedOfferIds(
          nextCampaigns.offers
            .filter((offer) => offer.enabled)
            .map((offer) => offer.offerId),
        );
        setGroups(nextGroups);
        setError(null);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof ApiError ? cause.message : "活动数据加载失败。",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [checkInPage, groupExceptionsOnly, groupPage, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [load]);

  async function saveCheckIn() {
    if (!token || !checkInSettings) return;
    setSaving(true);
    try {
      const next = await apiRequest<CheckInSettings>(
        "/api/admin/check-ins/settings",
        {
          method: "PATCH",
          token,
          body: {
            enabled: checkInSettings.enabled,
            rewardGiB: checkInSettings.rewardGiB,
          },
        },
      );
      setCheckInSettings(next);
      setFeedback("签到设置已保存，新奖励从下一次领取开始生效。");
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "签到设置保存失败。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveCampaigns() {
    if (!token || !campaigns) return;
    setSaving(true);
    try {
      const next = await apiRequest<CampaignSettings>(
        "/api/admin/group-buys/campaigns",
        {
          method: "PUT",
          token,
          body: {
            offerIds: selectedOfferIds,
            discountPercent: campaigns.discountPercent,
            bonusTrafficGiB: campaigns.bonusTrafficGiB,
          },
        },
      );
      setCampaigns(next);
      setSelectedOfferIds(
        next.offers
          .filter((offer) => offer.enabled)
          .map((offer) => offer.offerId),
      );
      setFeedback(
        "拼团折扣、赠送流量及可售规格已更新，已有拼团仍按创建时快照执行。",
      );
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "拼团设置保存失败。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function retry(path: string, success: string) {
    if (!token) return;
    setSaving(true);
    try {
      await apiRequest(path, { method: "POST", token });
      setFeedback(success);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "重试失败。");
    } finally {
      setSaving(false);
    }
  }

  const groupRows = useMemo(
    () =>
      groups.items.flatMap((group) =>
        group.members.map((member) => ({ group, member })),
      ),
    [groups.items],
  );

  return (
    <ConsoleShell
      title="活动中心"
      subtitle="管理每日签到与双人拼团"
      scope="EVENT"
      navItems={adminNav}
      requireRole="admin"
      dataViewport
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}
      <div className="admin-data-page activity-admin-page">
        <div className="activity-view-switch segmented-control">
          <button
            type="button"
            className={view === "check-in" ? "active" : ""}
            onClick={() => setView("check-in")}
          >
            <Icon name="gift" />
            每日签到
          </button>
          <button
            type="button"
            className={view === "group-buy" ? "active" : ""}
            onClick={() => setView("group-buy")}
          >
            <Icon name="group_add" />
            双人拼团
          </button>
        </div>

        {view === "check-in" ? (
          <>
            <div className="activity-metric-grid admin-data-metrics">
              <article>
                <span>今日签到</span>
                <strong>{checkInSettings?.todayClaims ?? 0}</strong>
                <small>
                  {formatBytes(checkInSettings?.todayRewardBytes ?? 0)} 已发放
                </small>
              </article>
              <article>
                <span>本月签到</span>
                <strong>{checkInSettings?.monthClaims ?? 0}</strong>
                <small>
                  {formatBytes(checkInSettings?.monthRewardBytes ?? 0)} 已发放
                </small>
              </article>
            </div>
            <Panel
              title="签到设置"
              copy="有效普通套餐或 Ultra 用户可领取，奖励加入当前周期并随周期到期。"
            >
              {checkInSettings ? (
                <div className="activity-settings-row">
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={checkInSettings.enabled}
                      onChange={(event) =>
                        setCheckInSettings({
                          ...checkInSettings,
                          enabled: event.target.checked,
                        })
                      }
                    />
                    <span className="toggle-track">
                      <span />
                    </span>
                    <span className="toggle-label">
                      {checkInSettings.enabled ? "已开启" : "已关闭"}
                    </span>
                  </label>
                  <label className="field">
                    <span className="fine-print">每日固定奖励（GiB）</span>
                    <input
                      className="control"
                      type="number"
                      min={0.01}
                      max={100}
                      step={0.01}
                      value={checkInSettings.rewardGiB}
                      onChange={(event) =>
                        setCheckInSettings({
                          ...checkInSettings,
                          rewardGiB: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <button
                    className="action-button"
                    type="button"
                    disabled={saving}
                    onClick={() => void saveCheckIn()}
                  >
                    {saving ? "保存中..." : "保存签到设置"}
                  </button>
                </div>
              ) : null}
            </Panel>
            <Panel
              className="admin-data-panel activity-record-panel"
              title="签到记录"
            >
              <DataTable
                loading={loading}
                emptyText="暂无签到记录"
                headers={["用户", "套餐", "业务日期", "奖励", "领取时间"]}
                rows={checkIns.items.map((record) => [
                  <CustomerLink
                    key={`${record.id}-user`}
                    id={record.userId}
                    displayName={record.userDisplayName}
                    email={record.userEmail}
                  />,
                  record.productName,
                  record.businessDate,
                  formatBytes(record.rewardBytes),
                  formatDateTime(record.claimedAt),
                ])}
                pagination={{ ...checkIns, onPageChange: setCheckInPage }}
              />
            </Panel>
          </>
        ) : (
          <>
            <Panel
              title="拼团商品"
              copy="仅支持 Start 及以上普通套餐；关闭规格不影响已经付款或进行中的拼团。"
            >
              <div className="activity-campaign-settings">
                <div className="activity-rule-strip">
                  <span>
                    <strong>{campaigns?.requiredMembers ?? 2}</strong> 人成团
                  </span>
                  <span>
                    <strong>{(campaigns?.durationMinutes ?? 1440) / 60}</strong>{" "}
                    小时
                  </span>
                  <span>
                    <strong>
                      {discountLabel(campaigns?.discountPercent ?? 100)}
                    </strong>{" "}
                    成团后成本
                  </span>
                  <span>
                    <strong>
                      +{formatBytes(campaigns?.bonusTrafficBytes ?? 0)}
                    </strong>{" "}
                    / 人
                  </span>
                </div>
                {campaigns ? (
                  <div className="activity-group-buy-controls">
                    <label className="field">
                      <span className="fine-print">拼团折扣（90 = 9 折）</span>
                      <input
                        className="control"
                        type="number"
                        min={1}
                        max={100}
                        step={0.01}
                        value={campaigns.discountPercent}
                        onChange={(event) =>
                          setCampaigns({
                            ...campaigns,
                            discountPercent: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="fine-print">成团每人赠送（GiB）</span>
                      <input
                        className="control"
                        type="number"
                        min={0}
                        max={1024}
                        step={0.01}
                        value={campaigns.bonusTrafficGiB}
                        onChange={(event) =>
                          setCampaigns({
                            ...campaigns,
                            bonusTrafficGiB: Number(event.target.value),
                            bonusTrafficBytes:
                              Number(event.target.value) * 1024 ** 3,
                          })
                        }
                      />
                    </label>
                    <p>
                      用户按原价付款并立即开通；成团后按折扣差额返余额并赠送流量。仅影响保存后新建的拼团。
                    </p>
                  </div>
                ) : null}
                <div className="activity-offer-grid">
                  {campaigns?.offers.map((offer) => (
                    <label
                      className={`activity-offer-option${selectedOfferIds.includes(offer.offerId) ? " selected" : ""}`}
                      key={offer.offerId}
                    >
                      <input
                        type="checkbox"
                        checked={selectedOfferIds.includes(offer.offerId)}
                        onChange={(event) =>
                          setSelectedOfferIds((current) =>
                            event.target.checked
                              ? [...current, offer.offerId]
                              : current.filter((id) => id !== offer.offerId),
                          )
                        }
                      />
                      <span>
                        <strong>{offer.productName}</strong>
                        <small>
                          {offer.offerName} ·{" "}
                          {campaigns && campaigns.discountPercent < 100 ? (
                            <>
                              原价 {formatMoney(offer.originalPriceCents)} ·
                              成团后{" "}
                              {formatMoney(
                                discountedPriceCents(
                                  offer.originalPriceCents,
                                  campaigns.discountPercent,
                                ),
                              )}
                            </>
                          ) : (
                            formatMoney(offer.originalPriceCents)
                          )}{" "}
                          · {formatBytes(offer.trafficBytes)}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  className="action-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void saveCampaigns()}
                >
                  {saving ? "保存中..." : "保存拼团规格"}
                </button>
              </div>
            </Panel>
            <Panel
              className="admin-data-panel activity-record-panel"
              title="拼团结算状态"
            >
              <div className="activity-record-filter segmented-control">
                <button
                  type="button"
                  className={!groupExceptionsOnly ? "active" : ""}
                  onClick={() => {
                    setGroupExceptionsOnly(false);
                    setGroupPage(1);
                  }}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={groupExceptionsOnly ? "active" : ""}
                  onClick={() => {
                    setGroupExceptionsOnly(true);
                    setGroupPage(1);
                  }}
                >
                  仅看异常
                </button>
              </div>
              <DataTable
                loading={loading}
                emptyText="暂无拼团记录"
                headers={[
                  "拼团 / 用户",
                  "套餐",
                  "付款",
                  "拼团状态",
                  "返现 / 旧团退款",
                  "操作",
                ]}
                rows={groupRows.map(({ group, member }) => [
                  <div
                    className="activity-group-user"
                    key={`${member.id}-user`}
                  >
                    <span className="mono">{group.shareCode}</span>
                    <CustomerLink
                      id={member.userId}
                      displayName={member.userDisplayName}
                      email={member.userEmail}
                    />
                  </div>,
                  `${group.productName} · ${group.offerName}`,
                  member.amountCents == null
                    ? "-"
                    : `${formatMoney(member.amountCents)} · ${member.merchantOrderNo ?? "-"}`,
                  <span
                    className={`badge ${group.status === "exception" ? "danger" : group.status === "succeeded" ? "success" : "neutral"}`}
                    key={`${member.id}-group-status`}
                  >
                    {statusNames[group.status] ?? group.status}
                  </span>,
                  <div
                    className="activity-refund-state"
                    key={`${member.id}-refund`}
                  >
                    <strong>
                      {member.rebateUnrecoveredCents > 0
                        ? `待追缴 ${formatMoney(member.rebateUnrecoveredCents)}`
                        : member.rebateCents > 0
                        ? `已返 ${formatMoney(member.rebateCents)}`
                        : (member.refundStatus ?? "-")}
                    </strong>
                    <small>
                      {member.rebateUnrecoveredCents > 0
                        ? `已追回 ${formatMoney(member.rebateRecoveredCents)}`
                        : (member.refundError ?? member.refundGatewayMessage ?? "")}
                    </small>
                  </div>,
                  <div className="table-actions" key={`${member.id}-actions`}>
                    {member.refundAttemptId &&
                    member.refundStatus !== "confirmed" ? (
                      <button
                        className="ghost-button compact"
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void retry(
                            `/api/admin/group-buys/refunds/${member.refundAttemptId}/retry`,
                            "退款状态已重新核对。",
                          )
                        }
                      >
                        重试退款
                      </button>
                    ) : null}
                    {member.fallbackAllowed && !member.orderId ? (
                      <button
                        className="ghost-button compact"
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void retry(
                            `/api/admin/group-buys/members/${member.id}/retry-fulfillment`,
                            "原套餐已完成兜底发放。",
                          )
                        }
                      >
                        重试发放
                      </button>
                    ) : null}
                  </div>,
                ])}
                pagination={{ ...groups, onPageChange: setGroupPage }}
              />
            </Panel>
          </>
        )}
      </div>
    </ConsoleShell>
  );
}
