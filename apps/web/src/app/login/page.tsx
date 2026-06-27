"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { AuthShell } from "@/components/auth-shell";
import { Icon } from "@/components/icon";
import { OAuthButtons } from "@/components/oauth-buttons";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthShell active="login">
          <span className="fine-print">正在加载...</span>
        </AuthShell>
      }
    >
      <LoginPageBody />
    </Suspense>
  );
}

function LoginPageBody() {
  const { session, login, loading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oauthError = searchParams.get("oauth_error");

  useEffect(() => {
    if (!loading && session) {
      router.replace(session.role === "admin" ? "/admin" : "/portal");
    }
  }, [loading, router, session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const nextSession = await login(email, password);
      router.replace(
        searchParams.get("next") ||
          (nextSession.role === "admin" ? "/admin" : "/portal"),
      );
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "登录失败，请检查 API 是否已启动。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell active="login">
      <form className="auth2-fields" onSubmit={handleSubmit}>
        <label className="auth2-input">
          <span className="auth2-input-icon"><Icon name="mail" /></span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="邮箱地址"
            autoComplete="username"
          />
        </label>
        <label className="auth2-input">
          <span className="auth2-input-icon"><Icon name="lock" /></span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="密码"
            autoComplete="current-password"
          />
        </label>

        <div className="auth2-row">
          <label className="auth2-check">
            <input type="checkbox" />
            <span>记住我</span>
          </label>
        </div>

        {error ? <div className="feedback error">{error}</div> : null}
        {oauthError ? <div className="feedback error">{oauthError}</div> : null}

        <button className="auth2-submit" type="submit" disabled={submitting}>
          {submitting ? "登录中..." : "登录"}
        </button>
      </form>

      <OAuthButtons />

      <div className="auth2-foot">
        还没有账号？
        <Link className="auth2-link" href="/register">
          立即注册
        </Link>
      </div>
    </AuthShell>
  );
}
