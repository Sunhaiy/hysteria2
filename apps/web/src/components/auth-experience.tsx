"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { AuthShell } from "./auth-shell";
import { Icon } from "./icon";
import { OAuthButtons } from "./oauth-buttons";

type AuthMode = "login" | "register";

export function AuthExperience({ initialMode }: { initialMode: AuthMode }) {
  const { session, login, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [loginNext, setLoginNext] = useState<string | null>(null);

  const [registerEmail, setRegisterEmail] = useState("");
  const [code, setCode] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerNotice, setRegisterNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const invite = params.get("invite")?.trim().toUpperCase();
      if (invite) {
        setInviteCode(invite.slice(0, 8));
        setShowOptional(true);
      }
      setLoginNext(params.get("next"));
      setOauthError(params.get("oauth_error"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setMode(
        window.location.pathname.startsWith("/register") ? "register" : "login",
      );
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!loading && session) {
      router.replace(session.role === "admin" ? "/admin" : "/portal");
    }
  }, [loading, router, session]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) return;
    setMode(nextMode);
    const params = new URLSearchParams();
    if (nextMode === "login" && loginNext) params.set("next", loginNext);
    if (nextMode === "register" && inviteCode) params.set("invite", inviteCode);
    const query = params.toString();
    window.history.pushState(
      null,
      "",
      `${nextMode === "login" ? "/login" : "/register"}${query ? `?${query}` : ""}`,
    );
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginSubmitting(true);
    setLoginError(null);
    try {
      const nextSession = await login(loginEmail, loginPassword);
      router.replace(
        loginNext || (nextSession.role === "admin" ? "/admin" : "/portal"),
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setLoginError("邮箱或密码错误，请检查后重新输入。");
      } else {
        setLoginError(
          cause instanceof ApiError ? cause.message : "登录失败，请稍后重试。",
        );
      }
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function sendCode() {
    if (!registerEmail) {
      setRegisterError("请先填写邮箱");
      return;
    }
    setSending(true);
    setRegisterError(null);
    setRegisterNotice(null);
    try {
      const result = await apiRequest<{
        emailed: boolean;
        cooldownSeconds: number;
      }>("/api/auth/register/request-code", {
        method: "POST",
        body: { email: registerEmail },
      });
      setCodeSent(true);
      setCooldown(result.cooldownSeconds || 60);
      setRegisterNotice(
        result.emailed
          ? "验证码已发送到邮箱，请查收（10 分钟内有效）。"
          : "验证码已生成（当前未配置邮件服务，请联系管理员获取）。",
      );
    } catch (cause) {
      setRegisterError(
        cause instanceof ApiError
          ? cause.message
          : "验证码发送失败，请稍后再试。",
      );
    } finally {
      setSending(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegisterSubmitting(true);
    setRegisterError(null);
    try {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: {
          email: registerEmail,
          code,
          password: registerPassword,
          displayName: displayName || undefined,
          inviteCode: inviteCode || undefined,
        },
      });
      await login(registerEmail, registerPassword);
      router.replace("/portal");
    } catch (cause) {
      setRegisterError(
        cause instanceof ApiError
          ? cause.message
          : "注册失败，请检查信息后重试。",
      );
    } finally {
      setRegisterSubmitting(false);
    }
  }

  return (
    <AuthShell active={mode} onModeChange={switchMode}>
      <div className="auth2-view" key={mode}>
        {mode === "login" ? (
          <form className="auth2-fields" onSubmit={handleLogin}>
            <div className="auth2-field-stack">
              <label className="auth2-input">
                <span className="auth2-input-icon">
                  <Icon name="mail" />
                </span>
                <span className="auth2-field-body">
                  <span className="auth2-field-label">邮箱地址</span>
                  <input
                    aria-describedby={loginError ? "login-error" : undefined}
                    aria-invalid={Boolean(loginError)}
                    type="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder="邮箱地址"
                    autoComplete="username"
                    required
                  />
                </span>
              </label>
              <label className="auth2-input">
                <span className="auth2-input-icon">
                  <Icon name="lock" />
                </span>
                <span className="auth2-field-body">
                  <span className="auth2-field-label">登录密码</span>
                  <input
                    aria-describedby={loginError ? "login-error" : undefined}
                    aria-invalid={Boolean(loginError)}
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder="登录密码"
                    autoComplete="current-password"
                    required
                  />
                </span>
              </label>
            </div>

            {loginError ? (
              <div
                className="feedback error auth2-login-error"
                id="login-error"
                role="alert"
              >
                {loginError}
              </div>
            ) : null}
            {oauthError ? (
              <div className="feedback error" role="alert">
                {oauthError}
              </div>
            ) : null}

            <div className="auth2-row">
              <span />
              <Link
                className="auth2-link"
                href={`/forgot-password?email=${encodeURIComponent(loginEmail)}`}
              >
                忘记密码？
              </Link>
            </div>

            <button
              className="auth2-submit"
              type="submit"
              disabled={loginSubmitting}
            >
              <span>{loginSubmitting ? "登录中..." : "登录"}</span>
              <Icon name="login" />
            </button>
          </form>
        ) : (
          <form className="auth2-fields" onSubmit={handleRegister}>
            <div className="auth2-field-stack">
              <div className="auth2-input">
                <span className="auth2-input-icon">
                  <Icon name="mail" />
                </span>
                <label className="auth2-field-body" htmlFor="register-email">
                  <span className="auth2-field-label">邮箱地址</span>
                  <input
                    id="register-email"
                    type="email"
                    value={registerEmail}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    placeholder="邮箱地址"
                    autoComplete="username"
                    required
                  />
                </label>
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
              </div>
              <label className="auth2-input">
                <span className="auth2-input-icon">
                  <Icon name="hash" />
                </span>
                <span className="auth2-field-body">
                  <span className="auth2-field-label">邮箱验证码</span>
                  <input
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="6 位邮箱验证码"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </span>
              </label>
              <label className="auth2-input">
                <span className="auth2-input-icon">
                  <Icon name="lock" />
                </span>
                <span className="auth2-field-body">
                  <span className="auth2-field-label">设置密码</span>
                  <input
                    type="password"
                    value={registerPassword}
                    onChange={(event) =>
                      setRegisterPassword(event.target.value)
                    }
                    placeholder="设置至少 8 位密码"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </span>
              </label>
            </div>

            <div className="auth2-optional-section">
              <button
                className="auth2-optional-toggle"
                type="button"
                aria-expanded={showOptional}
                aria-controls="register-optional-fields"
                onClick={() => setShowOptional((value) => !value)}
              >
                <Icon name="edit" />
                <span>
                  <strong>选填信息</strong>
                  <small>邀请码与显示名称</small>
                </span>
                <Icon name="arrow_down" className="auth2-optional-chevron" />
              </button>

              <div
                className="auth2-optional-region"
                data-open={showOptional}
                aria-hidden={!showOptional}
                inert={!showOptional}
                id="register-optional-fields"
              >
                <div className="auth2-optional-clip">
                  <div className="auth2-field-stack auth2-optional-fields">
                    <label className="auth2-input">
                      <span className="auth2-input-icon">
                        <Icon name="group_add" />
                      </span>
                      <span className="auth2-field-body">
                        <span className="auth2-field-label">邀请码</span>
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
                          placeholder="邀请码（选填）"
                          autoComplete="off"
                        />
                      </span>
                    </label>
                    <label className="auth2-input">
                      <span className="auth2-input-icon">
                        <Icon name="account_circle" />
                      </span>
                      <span className="auth2-field-body">
                        <span className="auth2-field-label">显示名称</span>
                        <input
                          value={displayName}
                          onChange={(event) =>
                            setDisplayName(event.target.value)
                          }
                          placeholder="显示名称（选填）"
                          autoComplete="nickname"
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {registerError ? (
              <div className="feedback error">{registerError}</div>
            ) : null}
            {registerNotice ? (
              <div className="feedback success">{registerNotice}</div>
            ) : null}

            <button
              className="auth2-submit"
              type="submit"
              disabled={
                registerSubmitting ||
                !codeSent ||
                code.length !== 6 ||
                registerPassword.length < 8 ||
                (inviteCode.length > 0 && inviteCode.length !== 8)
              }
            >
              {registerSubmitting ? "注册中..." : "注册并登录"}
            </button>
          </form>
        )}
      </div>

      {mode === "register" && inviteCode ? null : <OAuthButtons />}

      <div className="auth2-foot">
        {mode === "login" ? "还没有账号？" : "已有账号？"}
        <button
          className="auth2-link auth2-mode-link"
          type="button"
          onClick={() => switchMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "立即注册" : "去登录"}
        </button>
      </div>
    </AuthShell>
  );
}
