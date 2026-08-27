"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { AuthShell } from "@/components/auth-shell";
import { Icon } from "@/components/icon";
import { OAuthButtons } from "@/components/oauth-buttons";

export default function RegisterPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const invite = new URLSearchParams(window.location.search)
        .get("invite")
        ?.trim()
        .toUpperCase();
      if (invite) setInviteCode(invite.slice(0, 8));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
          inviteCode: inviteCode || undefined,
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
    <AuthShell active="register">
      <form className="auth2-fields" onSubmit={handleSubmit}>
        <label className="auth2-input">
          <span className="auth2-input-icon"><Icon name="mail" /></span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="邮箱地址"
            autoComplete="username"
          />
          <button
            className="auth2-code-btn"
            type="button"
            disabled={sending || cooldown > 0}
            onClick={() => void sendCode()}
          >
            {cooldown > 0
              ? `${cooldown}s`
              : sending
                ? "发送中"
                : codeSent
                  ? "重新发送"
                  : "获取验证码"}
          </button>
        </label>

        <label className="auth2-input">
          <span className="auth2-input-icon"><Icon name="group_add" /></span>
          <input
            value={inviteCode}
            onChange={(event) =>
              setInviteCode(
                event.target.value
                  .toUpperCase()
                  .replace(/[^A-HJ-NP-Z2-9]/g, "")
                  .slice(0, 8),
              )
            }
            placeholder="邀请码（可选）"
            autoComplete="off"
          />
        </label>

        <label className="auth2-input">
          <span className="auth2-input-icon"><Icon name="hash" /></span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6 位验证码"
            inputMode="numeric"
          />
        </label>

        <label className="auth2-input">
          <span className="auth2-input-icon"><Icon name="account_circle" /></span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="显示名称（可选）"
            autoComplete="nickname"
          />
        </label>

        <label className="auth2-input">
          <span className="auth2-input-icon"><Icon name="lock" /></span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="设置密码（至少 8 位）"
            autoComplete="new-password"
          />
        </label>

        {error ? <div className="feedback error">{error}</div> : null}
        {notice ? <div className="feedback success">{notice}</div> : null}

        <button
          className="auth2-submit"
          type="submit"
          disabled={
            submitting ||
            !codeSent ||
            code.length !== 6 ||
            password.length < 8 ||
            (inviteCode.length > 0 && inviteCode.length !== 8)
          }
        >
          {submitting ? "注册中..." : "注册并登录"}
        </button>
      </form>

      {inviteCode ? null : <OAuthButtons />}

      <div className="auth2-foot">
        已有账号？
        <Link className="auth2-link" href="/login">
          去登录
        </Link>
      </div>
    </AuthShell>
  );
}
