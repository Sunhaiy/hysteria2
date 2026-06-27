"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { OAuthButtons } from "@/components/oauth-buttons";
import { useSite } from "@/components/site-provider";
import { homeCopy } from "@/lib/copy";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <section className="panel auth-card">
            <div className="panel-body">
              <span className="fine-print">正在加载登录页...</span>
            </div>
          </section>
        </main>
      }
    >
      <LoginPageBody />
    </Suspense>
  );
}

function LoginPageBody() {
  const { session, login, loading } = useAuth();
  const site = useSite();
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
    <main className="auth-page">
      <section className="panel auth-card">
        <div className="panel-header">
          <div className="split">
            <span className="scope-chip">Login</span>
            <h1 className="panel-title">登录 {site.name} 控制台</h1>
            <span className="panel-copy">{site.description || homeCopy.description}</span>
          </div>
        </div>
        <div className="panel-body">
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span className="fine-print">邮箱</span>
              <input
                className="control"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
              />
            </label>
            <label className="field">
              <span className="fine-print">密码</span>
              <input
                className="control"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                autoComplete="current-password"
              />
            </label>
            {error ? <div className="feedback error">{error}</div> : null}
            {oauthError ? <div className="feedback error">{oauthError}</div> : null}
            <div className="toolbar-actions" style={{ justifyContent: "space-between" }}>
              <Link className="fine-print" href="/register">
                还没有账号？注册
              </Link>
              <button className="action-button" type="submit" disabled={submitting}>
                {submitting ? "登录中..." : "登录"}
              </button>
            </div>
          </form>
          <OAuthButtons />
        </div>
      </section>
    </main>
  );
}
