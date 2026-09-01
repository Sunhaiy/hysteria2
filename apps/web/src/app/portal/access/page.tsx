"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Icon } from "@/components/icon";
import { Panel } from "@/components/panel";
import { PageSkeleton } from "@/components/skeleton";
import { Toast, useToast } from "@/components/toast";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import type { PortalAccessResponse } from "@/lib/types";

export default function PortalAccessPage() {
  const { token } = useAuth();
  const [access, setAccess] = useState<PortalAccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast, showToast } = useToast();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        setAccess(
          await apiRequest<PortalAccessResponse>("/api/portal/access", {
            token,
            signal,
          }),
        );
        setEmptyState(false);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        if (cause instanceof ApiError && cause.status === 404) {
          setAccess(null);
          setEmptyState(true);
        } else {
          setError(
            cause instanceof ApiError ? cause.message : "订阅信息加载失败。",
          );
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
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

  async function copySubscription(value: string, label: string) {
    try {
      await copyToClipboard(value);
      showToast(`${label}已复制`);
    } catch {
      showToast("复制失败，请手动复制", "error");
    }
  }

  return (
    <ConsoleShell
      title="接入信息"
      subtitle="复制订阅链接，在客户端中同步套餐内全部节点"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={
        access ? (
          <span className="badge success">
            {access.nodes.length} 个可用节点
          </span>
        ) : null
      }
      toolbarActions={
        <button
          className="toolbar-button"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          <Icon name="refresh" />
          刷新
        </button>
      }
    >
      <Toast toast={toast} />
      {error ? <div className="feedback error">{error}</div> : null}
      {loading && !access ? (
        <PageSkeleton variant="detail" />
      ) : null}
      {access ? (
        <section className="portal-access-layout">
          <div className="portal-access-main">
            <div className="portal-access-subscriptions">
              <Panel
                title="订阅链接"
                copy="按客户端选择对应格式，两种订阅都会在刷新时同步后台节点变化。"
              >
                <div className="subscription-method-grid">
                  <section className="subscription-method">
                    <div className="subscription-method-heading">
                      <h4>Clash / Mihomo</h4>
                      <span className="badge info">YAML</span>
                    </div>
                    <p className="fine-print">
                      适用于 Clash Verge Rev、FlClash 和 Stash，包含自动故障转移。
                    </p>
                    <label className="field">
                      <span className="fine-print">Mihomo YAML 订阅链接</span>
                      <div className="subscription-link-row">
                        <input
                          className="control mono"
                          value={access.mihomoSubscriptionUrl}
                          readOnly
                        />
                        <button
                          className="action-button"
                          type="button"
                          onClick={() =>
                            void copySubscription(
                              access.mihomoSubscriptionUrl,
                              "Clash 订阅链接",
                            )
                          }
                        >
                          复制
                        </button>
                      </div>
                    </label>
                  </section>
                  <section className="subscription-method">
                    <div className="subscription-method-heading">
                      <h4>v2rayN / Hiddify</h4>
                      <span className="badge neutral">通用订阅</span>
                    </div>
                    <p className="fine-print">
                      适用于 v2rayN 和 Hiddify，刷新订阅即可同步节点。
                    </p>
                    <label className="field">
                      <span className="fine-print">专属订阅链接</span>
                      <div className="subscription-link-row">
                        <input
                          className="control mono"
                          value={access.subscriptionUrl}
                          readOnly
                        />
                        <button
                          className="action-button"
                          type="button"
                          onClick={() =>
                            void copySubscription(
                              access.subscriptionUrl,
                              "v2rayN / Hiddify 订阅链接",
                            )
                          }
                        >
                          复制
                        </button>
                      </div>
                    </label>
                  </section>
                </div>
                <p className="fine-print subscription-security-note">
                  订阅链接包含接入凭据，请勿转发给他人。
                </p>
              </Panel>
            </div>
            <div className="portal-access-status">
              <Panel title="订阅状态">
                <div className="kpi-list">
                  <div className="list-row">
                    <span className="muted">状态</span>
                    <strong>
                      <span className="badge success">可用</span>
                    </strong>
                  </div>
                  <div className="list-row">
                    <span className="muted">套餐到期</span>
                    <strong>{formatDateTime(access.expiresAt)}</strong>
                  </div>
                  <div className="list-row">
                    <span className="muted">剩余流量</span>
                    <strong>{formatBytes(access.trafficRemaining)}</strong>
                  </div>
                  <div className="list-row">
                    <span className="muted">节点数量</span>
                    <strong>{access.nodes.length}</strong>
                  </div>
                </div>
              </Panel>
              <div className="toolbar-actions">
                <Link className="action-button" href="/portal/tutorial">
                  <Icon name="book" />
                  查看使用教程
                </Link>
              </div>
            </div>
          </div>
          <div className="portal-access-qr">
            <Panel
              title="订阅二维码"
              copy="二维码对应 v2rayN / Hiddify 通用订阅链接。"
            >
              <div className="qr-card">
                <Image
                  src={access.subscriptionQrCode}
                  alt="v2rayN 和 Hiddify 订阅二维码"
                  className="qr-image"
                  width={256}
                  height={256}
                  unoptimized
                />
              </div>
            </Panel>
          </div>
        </section>
      ) : emptyState && !loading ? (
        <Panel
          title="订阅暂不可用"
          copy="当前账号没有生效中的套餐或可用流量。完成套餐开通后，订阅链接会自动生成。"
        >
          <Link className="action-button" href="/portal/plans">
            查看套餐
          </Link>
        </Panel>
      ) : null}
    </ConsoleShell>
  );
}
