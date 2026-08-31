"use client";

import Link from "next/link";
import { useEffect } from "react";
import { HeroGlobe } from "@/components/hero-globe";
import { Icon } from "@/components/icon";
import { useSite } from "@/components/site-provider";
import { ThemeToggle } from "@/components/theme-toggle";

const PILLS = [
  { icon: "bolt", title: "高速稳定", copy: "优质线路，极速体验" },
  { icon: "shield", title: "隐私安全", copy: "强加密保护，安全无忧" },
  { icon: "globe", title: "全球节点", copy: "多地区线路自由选择" },
];

const TRUST = ["AES-256 加密", "无日志政策", "多平台支持", "7×24 自助"];

const FEATURES = [
  {
    icon: "bolt",
    title: "秒级自助开通",
    copy: "余额钱包 + CDK 兑换，付款即到账，套餐立即生效。",
  },
  {
    icon: "plug",
    title: "多协议原生接入",
    copy: "支持 Hysteria 2 与 VLESS + REALITY，一键复制 URI、扫码或订阅导入。",
  },
  {
    icon: "puzzle",
    title: "灵活套餐组合",
    copy: "限速/不限速、周期流量自由搭配，多设备直接接入。",
  },
  {
    icon: "lock",
    title: "安全鉴权",
    copy: "会话可即时吊销、登录限流防撞库，账号更安心。",
  },
  {
    icon: "key",
    title: "多种登录方式",
    copy: "邮箱验证码注册，支持 Google、GitHub 一键登录。",
  },
  {
    icon: "monitoring",
    title: "实时流量统计",
    copy: "用量日志、活跃连接、到期与余额一目了然。",
  },
];

const STEPS = [
  { n: "01", title: "注册账号", copy: "邮箱验证码或第三方账号，30 秒完成。" },
  {
    n: "02",
    title: "充值 / 兑换",
    copy: "余额充值或输入 CDK 卡密，立即到账。",
  },
  { n: "03", title: "选择套餐", copy: "挑选合适套餐自助开通，立即生效。" },
  { n: "04", title: "连接即用", copy: "复制接入信息导入客户端，畅享高速。" },
];

export default function HomePage() {
  const site = useSite();

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <main className="lp">
      <header className="lp-nav">
        <div className="lp-brand">
          <span className="lp-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M4 5h4l4 9 4-9h4l-6 14h-4z" fill="var(--accent-500)" />
            </svg>
          </span>
          <span>{site.name}</span>
          <span className="lp-brand-tag">VPN</span>
        </div>
        <nav className="lp-nav-links">
          <Link className="lp-nav-login" href="/login">
            <Icon name="login" />
            <span>登录</span>
          </Link>
          <ThemeToggle className="lp-icon-btn" />
          <Link className="lp-btn lp-btn-primary" href="/register">
            立即使用
          </Link>
        </nav>
      </header>

      <section id="top" className="lp-hero">
        <div className="lp-hero-text">
          <h1 className="lp-hero-title reveal">
            自由连接
            <br />
            全球无限可能
          </h1>
          <p className="lp-hero-sub reveal">
            稳定、安全、快速的 {site.name} 服务，保护你的隐私，畅享全球网络。
          </p>
          <div className="lp-hero-cta reveal">
            <Link className="lp-btn lp-btn-primary lp-btn-lg" href="/register">
              立即体验 <span aria-hidden="true">›</span>
            </Link>
            <Link className="lp-btn lp-btn-ghost lp-btn-lg" href="/portal">
              查看套餐
            </Link>
          </div>
          <div className="lp-pills reveal">
            {PILLS.map((pill) => (
              <div key={pill.title} className="lp-pill">
                <span className="lp-pill-icon">
                  <Icon name={pill.icon} />
                </span>
                <div>
                  <div className="lp-pill-title">{pill.title}</div>
                  <div className="lp-pill-copy">{pill.copy}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lp-hero-visual reveal">
          <HeroGlobe />
          <div className="lp-card lp-card-status">
            <div className="lp-card-row">
              <span className="lp-card-label">已连接</span>
              <span className="lp-dot-online" />
            </div>
            <div className="lp-card-time">00:12:36</div>
            <div className="lp-bars">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="lp-card lp-card-speed">
            <div className="lp-card-label">连接速度</div>
            <div className="lp-card-speed-value">120 Mbps</div>
            <svg
              className="lp-spark"
              viewBox="0 0 100 28"
              preserveAspectRatio="none"
            >
              <polyline
                points="0,22 18,18 34,20 52,9 70,13 86,5 100,7"
                fill="none"
                stroke="var(--accent-500)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="lp-card lp-card-node">
            <div className="lp-card-label">节点位置</div>
            <div className="lp-card-node-row">
              <span>📍 美国 · cn2</span>
              <span className="lp-chev">⌄</span>
            </div>
          </div>
        </div>
      </section>

      <div className="lp-trust">
        <span className="lp-trust-lead">值得信赖的 {site.name} 服务</span>
        {TRUST.map((item) => (
          <span key={item} className="lp-trust-item">
            {item}
          </span>
        ))}
      </div>

      <section id="features" className="lp-section">
        <span className="lp-eyebrow reveal">为什么选择 {site.name}</span>
        <h2 className="lp-section-title reveal">一站式会员与流量管理</h2>
        <div className="lp-feature-grid">
          {FEATURES.map((feature, index) => (
            <article
              key={feature.title}
              className="lp-feature reveal"
              style={{ transitionDelay: `${(index % 3) * 80}ms` }}
            >
              <div className="lp-feature-icon">
                <Icon name={feature.icon} />
              </div>
              <h3 className="lp-feature-title">{feature.title}</h3>
              <p className="lp-feature-copy">{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="lp-section">
        <span className="lp-eyebrow reveal">使用流程</span>
        <h2 className="lp-section-title reveal">四步开始畅连</h2>
        <div className="lp-steps">
          {STEPS.map((step, index) => (
            <div
              key={step.n}
              className="lp-step reveal"
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <div className="lp-step-n">{step.n}</div>
              <h3 className="lp-step-title">{step.title}</h3>
              <p className="lp-step-copy">{step.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-cta reveal">
        <h2 className="lp-cta-title">准备好开始了吗？</h2>
        <p className="lp-cta-copy">
          现在注册，几分钟内即可拥有属于你的高速连接。
        </p>
        <div className="lp-hero-cta">
          <Link className="lp-btn lp-btn-primary lp-btn-lg" href="/register">
            免费注册
          </Link>
          <Link className="lp-btn lp-btn-ghost lp-btn-lg" href="/portal">
            进入用户中心
          </Link>
        </div>
      </section>

      <footer className="lp-footer">
        <span className="lp-brand">{site.name}</span>
        <div className="lp-footer-links">
          <Link href="/login">登录</Link>
          <Link href="/register">注册</Link>
          <Link href="/portal">用户中心</Link>
        </div>
        <span className="lp-footer-note">
          © {new Date().getFullYear()} {site.name} · Powered by Hysteria 2
        </span>
      </footer>
    </main>
  );
}
