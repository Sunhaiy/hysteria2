"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { OAuthButtons } from "@/components/oauth-buttons";

export default function RegisterPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const id = window.setInterval(() => {
      setCooldown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  async function sendCode() {
    if (!email) {
      setError("请先填写邮箱");
      return;
    }
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<{ emailed: boolean; cooldownSeconds: number }>(
        "/api/auth/register/request-code",
        { method: "POST", body: { email } },
      );
      setCodeSent(true);
      setCooldown(result.cooldownSeconds || 60);
      setNotice(
        result.emailed
          ? "验证码已发送到邮箱，请查收（10 分钟内有效）。"
          : "验证码已生成（当前未配置邮件服务，请联系管理员获取）。",
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "验证码发送失败，请稍后再试。");
    } finally {
      setSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: {
          email,
          code,
          password,
          displayName: displayName || undefined,
        },
      });
      // Reuse the tested login path to establish the session in context.
      await login(email, password);
      router.replace("/portal");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "注册失败，请检查信息后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="panel auth-card">
        <div className="panel-header">
          <div className="split">
            <span className="scope-chip">Register</span>
            <h1 className="panel-title">注册 Hysteria 2 账号</h1>
            <span className="panel-copy">
              使用邮箱验证码创建会员账号，注册后可在套餐中心选购或在兑换中心激活。
            </span>
          </div>
        </div>
        <div className="panel-body">
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span className="fine-print">邮箱</span>
              <div className="toolbar-actions" style={{ gap: 8 }}>
                <input
                  className="control"
                  style={{ flex: 1 }}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
                <button
                  className="toolbar-button"
                  type="button"
                  disabled={sending || cooldown > 0}
                  onClick={() => void sendCode()}
                >
                  {cooldown > 0
                    ? `${cooldown}s`
                    : sending
                      ? "发送中..."
                      : codeSent
                        ? "重新发送"
                        : "发送验证码"}
                </button>
              </div>
            </label>

            <label className="field">
              <span className="fine-print">验证码</span>
              <input
                className="control"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6 位数字验证码"
                inputMode="numeric"
              />
            </label>

            <label className="field">
              <span className="fine-print">显示名称（可选）</span>
              <input
                className="control"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="留空则使用邮箱前缀"
                autoComplete="nickname"
              />
            </label>

            <label className="field">
              <span className="fine-print">密码（至少 8 位）</span>
              <input
                className="control"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请设置登录密码"
                autoComplete="new-password"
              />
            </label>

            {error ? <div className="feedback error">{error}</div> : null}
            {notice ? <div className="feedback success">{notice}</div> : null}

            <div className="toolbar-actions" style={{ justifyContent: "space-between" }}>
              <Link className="fine-print" href="/login">
                已有账号？去登录
              </Link>
              <button
                className="action-button"
                type="submit"
                disabled={submitting || !codeSent || code.length !== 6 || password.length < 8}
              >
                {submitting ? "注册中..." : "注册并登录"}
              </button>
            </div>
          </form>
          <OAuthButtons />
        </div>
      </section>
    </main>
  );
}
