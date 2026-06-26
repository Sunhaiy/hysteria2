"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import type { LoginResponse } from "@/lib/types";

function OAuthCallbackBody() {
  const { adoptSession } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) {
      return;
    }
    handled.current = true;

    const code = searchParams.get("code");
    if (!code) {
      setError("缺少登录凭证，请重新登录。");
      return;
    }

    void (async () => {
      try {
        const response = await apiRequest<LoginResponse>("/api/auth/oauth/exchange", {
          method: "POST",
          body: { code },
        });
        const session = adoptSession(response);
        router.replace(session.role === "admin" ? "/admin" : "/portal");
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "第三方登录失败，请重试。");
      }
    })();
  }, [adoptSession, router, searchParams]);

  return (
    <main className="auth-page">
      <section className="panel auth-card">
        <div className="panel-body">
          {error ? (
            <div className="split">
              <div className="feedback error">{error}</div>
              <button
                className="action-button"
                type="button"
                onClick={() => router.replace("/login")}
              >
                返回登录
              </button>
            </div>
          ) : (
            <span className="fine-print">正在完成第三方登录...</span>
          )}
        </div>
      </section>
    </main>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <section className="panel auth-card">
            <div className="panel-body">
              <span className="fine-print">正在完成第三方登录...</span>
            </div>
          </section>
        </main>
      }
    >
      <OAuthCallbackBody />
    </Suspense>
  );
}
