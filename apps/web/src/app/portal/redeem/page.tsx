"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { Panel } from "@/components/panel";
import { useAuth } from "@/components/auth-provider";
import { apiRequest, ApiError } from "@/lib/api";
import { portalNav } from "@/lib/copy";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/format";
import type { PortalRedeemResponse } from "@/lib/types";
import { humanizeOrderKind, humanizeRedemptionKind } from "@/lib/ui";

export default function PortalRedeemPage() {
  const { token } = useAuth();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [result, setResult] = useState<PortalRedeemResponse | null>(null);

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("已复制到剪贴板。");
    } catch {
      setFeedback("复制失败，请手动复制。");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setFeedback(null);

    try {
      const nextResult = await apiRequest<PortalRedeemResponse>("/api/portal/redeem", {
        method: "POST",
        token,
        body: {
          code,
        },
      });
      setResult(nextResult);
      setFeedback("兑换成功，套餐与接入信息已同步更新。");
      setCode("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "兑换失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ConsoleShell
      title="兑换中心"
      subtitle="输入管理员发放的 CDK，自动开通套餐或叠加流量包"
      scope="Member"
      navItems={portalNav}
      requireRole="member"
      toolbarMeta={result ? <span className="badge success">{result.code.label}</span> : null}
      toolbarActions={
        result ? (
          <Link className="toolbar-button" href="/portal/access">
            查看接入信息
          </Link>
        ) : null
      }
    >
      {error ? <div className="feedback error">{error}</div> : null}
      {feedback ? <div className="feedback success">{feedback}</div> : null}

      <section className="workspace-grid">
        <Panel title="兑换 CDK" copy="支持套餐开通码和流量包兑换码，兑换成功后会自动写入订单记录。">
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span className="fine-print">兑换码</span>
              <input
                className="control mono"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="HY2-XXXX-XXXX-XXXX"
              />
            </label>
            <div className="toolbar-actions">
              <button className="action-button" type="submit" disabled={submitting || !code.trim()}>
                {submitting ? "兑换中..." : "立即兑换"}
              </button>
              <Link className="ghost-button" href="/portal/orders">
                查看订单记录
              </Link>
            </div>
          </form>
        </Panel>

        <Panel title="兑换说明" copy="这条路径就是会员自助开通入口。管理员后台生成 CDK，会员中心负责兑换和交付。">
          <div className="kpi-list">
            <div className="list-row">
              <span className="muted">套餐开通码</span>
              <strong>自动开通或续加套餐额度</strong>
            </div>
            <div className="list-row">
              <span className="muted">流量包兑换码</span>
              <strong>叠加到当前生效订阅</strong>
            </div>
            <div className="list-row">
              <span className="muted">兑换完成后</span>
              <strong>可直接去接入信息页复制链接</strong>
            </div>
          </div>
        </Panel>
      </section>

      {result ? (
        <section className="workspace-grid">
          <Panel title="兑换结果" copy="成功后会同步更新订单、套餐状态和接入信息。">
            <div className="kpi-list">
              <div className="list-row">
                <span className="muted">权益类型</span>
                <strong>{humanizeRedemptionKind(result.code.kind)}</strong>
              </div>
              <div className="list-row">
                <span className="muted">兑换标签</span>
                <strong>{result.code.label}</strong>
              </div>
              <div className="list-row">
                <span className="muted">订单类型</span>
                <strong>{humanizeOrderKind(result.order.kind)}</strong>
              </div>
              <div className="list-row">
                <span className="muted">订单金额</span>
                <strong>{formatMoney(result.order.amountCents)}</strong>
              </div>
              <div className="list-row">
                <span className="muted">当前套餐</span>
                <strong>{result.overview.subscription.planName}</strong>
              </div>
              <div className="list-row">
                <span className="muted">套餐到期</span>
                <strong>{formatDateTime(result.access.expiresAt)}</strong>
              </div>
              <div className="list-row">
                <span className="muted">剩余流量</span>
                <strong>{formatBytes(result.access.trafficRemaining)}</strong>
              </div>
            </div>
          </Panel>

          <Panel title="直接交付" copy="兑换成功后，专属 URI 和令牌已经准备好，可以直接复制。">
            <label className="field">
              <span className="fine-print">访问令牌</span>
              <input className="control mono" value={result.access.token} readOnly />
            </label>
            <label className="field">
              <span className="fine-print">连接 URI</span>
              <textarea className="control textarea mono" value={result.access.uri} readOnly />
            </label>
            <div className="toolbar-actions">
              <button className="action-button" type="button" onClick={() => void copyText(result.access.uri)}>
                复制 URI
              </button>
              <button className="ghost-button" type="button" onClick={() => void copyText(result.access.configSnippet)}>
                复制配置片段
              </button>
            </div>
          </Panel>
        </section>
      ) : null}
    </ConsoleShell>
  );
}
