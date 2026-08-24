"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { apiRequest, ApiError } from "@/lib/api";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthShell active="reset">
          <span className="fine-print">正在加载...</span>
        </AuthShell>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || password !== confirmation) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "密码重置失败，请重新申请链接。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell active="reset">
      <h1 className="auth2-form-title">设置新密码</h1>
      <p className="auth2-form-sub">重置成功后，其他设备上的旧会话会立即失效。</p>
      {!token ? <div className="feedback error">重置链接缺少令牌。</div> : null}
      {complete ? (
        <div className="form-grid">
          <div className="feedback success">密码已更新，请使用新密码登录。</div>
          <Link className="action-button" href="/login">
            返回登录
          </Link>
        </div>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          {error ? <div className="feedback error">{error}</div> : null}
          <label className="field">
            <span className="fine-print">新密码</span>
            <input
              className="control"
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <label className="field">
            <span className="fine-print">确认新密码</span>
            <input
              className="control"
              type="password"
              minLength={8}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          {confirmation && password !== confirmation ? (
            <div className="feedback error">两次输入的密码不一致。</div>
          ) : null}
          <button
            className="action-button"
            type="submit"
            disabled={!token || submitting || password.length < 8 || password !== confirmation}
          >
            {submitting ? "提交中..." : "更新密码"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
