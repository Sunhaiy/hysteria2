"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { HeroGlobe } from "./hero-globe";
import { Icon } from "./icon";
import { ThemeToggle } from "./theme-toggle";
import { useSite } from "./site-provider";

const FEATURES = [
  { icon: "lock", title: "隐私安全", copy: "保护你的数据" },
  { icon: "bolt", title: "高速稳定", copy: "优质线路体验" },
  { icon: "globe", title: "全球覆盖", copy: "多地区线路" },
];

export function AuthShell({
  active,
  children,
}: {
  active: "login" | "register" | "reset";
  children: ReactNode;
}) {
  const site = useSite();

  return (
    <main className="auth2">
      <div className="auth2-card">
        <section className="auth2-left">
          <Link className="auth2-brand" href="/">
            <span className="lp-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M4 5h4l4 9 4-9h4l-6 14h-4z" fill="var(--accent-500)" />
              </svg>
            </span>
            <span>{site.name}</span>
            <span className="lp-brand-tag">VPN</span>
          </Link>

          <h1 className="auth2-title">
            自由连接
            <br />
            全球<span className="auth2-grad">无限</span>可能
          </h1>
          <p className="auth2-sub">安全 · 稳定 · 高速的全球网络加速服务</p>

          <div className="auth2-globe">
            <HeroGlobe className="auth2-globe-svg" />
          </div>

          <div className="auth2-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="auth2-feature">
                <span className="auth2-feature-icon">
                  <Icon name={f.icon} />
                </span>
                <div>
                  <div className="auth2-feature-title">{f.title}</div>
                  <div className="auth2-feature-copy">{f.copy}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="auth2-right">
          <div className="auth2-right-top">
            <Link className="auth2-back" href="/">
              <Icon name="home" />
              <span>返回首页</span>
            </Link>
            <ThemeToggle className="lp-icon-btn" />
          </div>

          <div className="auth2-tabs">
            <Link className={`auth2-tab${active === "login" ? " active" : ""}`} href="/login">
              登录
            </Link>
            <Link
              className={`auth2-tab${active === "register" ? " active" : ""}`}
              href="/register"
            >
              注册
            </Link>
          </div>

          <div className="auth2-form">{children}</div>
        </section>
      </div>
    </main>
  );
}
