"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { PortalAccessResponse } from "@/lib/types";

export default function PortalAccessPage() {
  const { token } = useAuth();
  const [access, setAccess] = useState<PortalAccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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
    } catch (cause) {
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
      await navigator.clipboard.writeText(value);
      setFeedback("已复制到剪贴板。");
    } catch {
      setFeedback("复制失败，请手动复制。");
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
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}

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
      ) : null}
    </ConsoleShell>
  );
}
