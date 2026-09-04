"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AuthShaderBackground } from "./auth-shader-background";
import { Icon } from "./icon";
import { ThemeToggle } from "./theme-toggle";
import { useSite } from "./site-provider";

export function AuthShell({
  active,
  onModeChange,
  children,
}: {
  active: "login" | "register" | "reset";
  onModeChange?: (mode: "login" | "register") => void;
  children: ReactNode;
}) {
  const site = useSite();

  return (
    <main className="auth2">
      <div className="auth2-card">
        <section className="auth2-left">
          <AuthShaderBackground />
          <div className="auth2-shader-scrim" aria-hidden="true" />
          <Link className="auth2-brand" href="/">
            <span className="lp-logo" aria-hidden="true">
              <Icon name="brand_logo" />
            </span>
            <span>{site.name}</span>
          </Link>

          <div className="auth2-left-copy">
            <span className="auth2-eyebrow">SUXIN NETWORK</span>
            <h1 className="auth2-title">
              自由连接
              <br />
              抵达更远的地方
            </h1>
            <p className="auth2-sub">安全 · 稳定 · 高速</p>
          </div>
          <span className="auth2-left-index">EST. 2026</span>
        </section>

        <section className="auth2-right">
          <div className="auth2-right-top">
            <Link className="auth2-back" href="/">
              <Icon name="home" />
              <span>返回首页</span>
            </Link>
            <ThemeToggle className="lp-icon-btn" />
          </div>

          <div className="auth2-panel">
            {active !== "reset" ? (
              <div className="auth2-intro">
                <span>{active === "login" ? "WELCOME BACK" : "JOIN SUXIN"}</span>
                <h2>{active === "login" ? "欢迎回来" : "创建您的账户"}</h2>
                <p>
                  {active === "login"
                    ? "登录后继续管理您的订阅与连接。"
                    : "完成邮箱验证后即可开始使用。"}
                </p>
              </div>
            ) : null}

            <div className="auth2-tabs" role="tablist" aria-label="账户入口">
              {onModeChange ? (
                <>
                  <button
                    className={`auth2-tab${active === "login" ? " active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={active === "login"}
                    onClick={() => onModeChange("login")}
                  >
                    登录
                  </button>
                  <button
                    className={`auth2-tab${active === "register" ? " active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={active === "register"}
                    onClick={() => onModeChange("register")}
                  >
                    注册
                  </button>
                </>
              ) : (
                <>
                  <Link
                    className={`auth2-tab${active === "login" ? " active" : ""}`}
                    href="/login"
                  >
                    登录
                  </Link>
                  <Link
                    className={`auth2-tab${active === "register" ? " active" : ""}`}
                    href="/register"
                  >
                    注册
                  </Link>
                </>
              )}
            </div>

            <div className="auth2-form">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
