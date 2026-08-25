"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { Icon } from "@/components/icon";
import { apiRequest, ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthShell active="reset">
          <span className="fine-print">正在加载...</span>
        </AuthShell>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}

function ForgotPasswordForm() {
  const initialEmail = useSearchParams().get("email") ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("/api/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
      setComplete(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "提交失败，请检查网络后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell active="reset">
      <h1 className="auth2-form-title">找回密码</h1>
      <p className="auth2-form-sub">输入注册邮箱，我们会发送一条 30 分钟内有效的重置链接。</p>
      {complete ? (
        <div className="form-grid">
          <div className="feedback success" role="status">
            如果该邮箱已注册，重置链接将在几分钟内发送，请同时检查垃圾邮件。
          </div>
          <Link className="action-button" href="/login">
            返回登录
          </Link>
        </div>
      ) : (
        <form className="auth2-fields" onSubmit={submit}>
          <label className="auth2-input">
            <span className="auth2-input-icon"><Icon name="mail" /></span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="注册邮箱"
              autoComplete="email"
              required
            />
          </label>
          {error ? <div className="feedback error" role="alert">{error}</div> : null}
          <button className="auth2-submit" type="submit" disabled={submitting}>
            {submitting ? "发送中..." : "发送重置链接"}
          </button>
          <div className="auth2-foot">
            想起密码了？<Link className="auth2-link" href="/login">返回登录</Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
