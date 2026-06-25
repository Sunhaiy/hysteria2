"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";
import { Toast, useToast } from "@/components/toast";
import type { PortalAccessResponse } from "@/lib/types";

export default function PortalAccessPage() {
  const { token } = useAuth();
  const [access, setAccess] = useState<PortalAccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyState, setEmptyState] = useState(false);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const nextAccess = await apiRequest<PortalAccessResponse>("/api/portal/access", {
        token,
      });
      setAccess(nextAccess);
      setEmptyState(false);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setAccess(null);
        setEmptyState(true);
        return;
      }
      setError(cause instanceof ApiError ? cause.message : "接入信息加载失败。");
    }
  }, [token]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function copyText(value: string) {
    try {
      await copyToClipboard(value);
      showToast("已复制到剪贴板");
    } catch {
      showToast("复制失败，请手动复制", "error");
    }
  }

  return (
    <ConsoleShell
      title="接入信息"
      subtitle="返回可直接导入的 Hysteria 2 URI、二维码和推荐配置片段"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={access ? <span className="badge success">{access.nodeLabel}</span> : null}
      toolbarActions={<button className="toolbar-button" type="button" onClick={() => void load()}>刷新</button>}
    >
      <Toast toast={toast} />
      {error ? <div className="feedback error">{error}</div> : null}

      {access ? (
        <section className="workspace-grid">
          <Panel title="二维码与 URI" copy="URI 只保留连接必需字段，其他建议留在配置片段。">
            <div className="qr-card">
              <Image
                src={access.qrCode}
                alt="Hysteria 2 接入二维码"
                className="qr-image"
                width={240}
                height={240}
                unoptimized
              />
            </div>
            <div className="form-grid">
              <label className="field">
                <span className="fine-print">订阅令牌</span>
                <input className="control mono" value={access.token} readOnly />
              </label>
              <label className="field">
                <span className="fine-print">连接 URI</span>
                <textarea className="control textarea mono" value={access.uri} readOnly />
              </label>
              <div className="toolbar-actions">
                <button className="action-button" type="button" onClick={() => void copyText(access.uri)}>
                  复制 URI
                </button>
                <button className="ghost-button" type="button" onClick={() => void copyText(access.token)}>
                  复制令牌
                </button>
              </div>
            </div>
          </Panel>

          <div className="split">
            <Panel title="当前接入状态" copy="套餐到期或流量耗尽后，新的连接请求会被拒绝。">
              <div className="kpi-list">
                <div className="list-row">
                  <span className="muted">推荐节点</span>
                  <strong>{access.nodeLabel}</strong>
                </div>
                <div className="list-row">
                  <span className="muted">套餐到期</span>
                  <strong>{formatDateTime(access.expiresAt)}</strong>
                </div>
                <div className="list-row">
                  <span className="muted">剩余流量</span>
                  <strong>{formatBytes(access.trafficRemaining)}</strong>
                </div>
              </div>
            </Panel>

            <Panel title="推荐配置片段" copy="带宽建议和本地代理端口放在 YAML 里而不是 URI 里。">
              <div className="code-card">
                <pre>{access.configSnippet}</pre>
              </div>
              <button className="ghost-button" type="button" onClick={() => void copyText(access.configSnippet)}>
                复制配置片段
              </button>
            </Panel>
          </div>
        </section>
      ) : emptyState ? (
        <Panel title="还没有可用接入信息" copy="当前账号还没有生效中的套餐或兑换尚未完成。先去兑换中心使用一张 CDK，系统会自动生成专属接入信息。">
          <div className="toolbar-actions">
            <Link className="action-button" href="/portal/redeem">
              去兑换中心
            </Link>
          </div>
        </Panel>
      ) : null}
    </ConsoleShell>
  );
}
