"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useSite } from "@/components/site-provider";

const FEATURES = [
  {
    icon: "⚡",
    title: "秒级自助开通",
    copy: "余额钱包 + CDK 兑换，付款即到账，套餐立即生效，无需等待人工审核。",
  },
  {
    icon: "🔌",
    title: "Hysteria 2 原生接入",
    copy: "一键复制连接 URI、扫码导入或拷贝推荐配置片段，主流客户端开箱即用。",
  },
  {
    icon: "🧩",
    title: "灵活套餐组合",
    copy: "限速 / 不限速、设备数、周期流量自由搭配，按需选择，随时升级切换。",
  },
  {
    icon: "🛡️",
    title: "安全鉴权",
    copy: "会话可即时吊销、登录限流防撞库、全站安全响应头，账号更稳更安心。",
  },
  {
    icon: "🔑",
    title: "多种登录方式",
    copy: "邮箱验证码注册，支持 Google、GitHub 一键登录，告别繁琐密码。",
  },
  {
    icon: "📊",
    title: "实时流量统计",
    copy: "用量日志、在线设备数、到期与剩余流量一目了然，余额一键查看。",
  },
];

const STEPS = [
  { n: "01", title: "注册账号", copy: "邮箱验证码或第三方账号，30 秒完成注册。" },
  { n: "02", title: "充值 / 兑换", copy: "余额充值或输入 CDK 卡密，立即到账。" },
  { n: "03", title: "选择套餐", copy: "挑选合适套餐自助开通，立即生效。" },
  { n: "04", title: "连接即用", copy: "复制接入信息导入客户端，畅享高速连接。" },
];

const STATS = [
  { value: "多节点", label: "覆盖优质线路" },
  { value: "秒级", label: "自助开通到账" },
  { value: "不限速", label: "高端套餐可选" },
  { value: "7×24", label: "全程自助" },
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
        <div className="lp-brand">{site.name}</div>
        <nav className="lp-nav-links">
          <a href="#features">功能</a>
          <a href="#how">使用流程</a>
          <Link href="/login">登录</Link>
          <Link className="lp-btn lp-btn-primary" href="/register">
            免费注册
          </Link>
        </nav>
      </header>

      <section className="lp-hero">
        <div className="lp-orb lp-orb-a" />
        <div className="lp-orb lp-orb-b" />
        <span className="lp-eyebrow reveal">基于 Hysteria 2 · 高速 · 稳定 · 抗封锁</span>
        <h1 className="lp-hero-title reveal">
          更快更稳的
          <span className="lp-grad"> {site.name} </span>
          连接体验
        </h1>
        <p className="lp-hero-sub reveal">
          自助开通、即时到账、原生 Hysteria 2 接入。从注册到连接，全程几分钟搞定，
          把网络体验交还到你自己手里。
        </p>
        <div className="lp-hero-cta reveal">
          <Link className="lp-btn lp-btn-primary lp-btn-lg" href="/register">
            立即注册
          </Link>
          <Link className="lp-btn lp-btn-ghost lp-btn-lg" href="/login">
            登录控制台
          </Link>
        </div>

        <div className="lp-stats reveal">
          {STATS.map((s) => (
            <div key={s.label} className="lp-stat">
              <div className="lp-stat-value">{s.value}</div>
              <div className="lp-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="lp-section">
        <span className="lp-eyebrow reveal">为什么选择 {site.name}</span>
        <h2 className="lp-section-title reveal">一站式会员与流量管理</h2>
        <div className="lp-feature-grid">
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className="lp-feature reveal"
              style={{ transitionDelay: `${(i % 3) * 80}ms` }}
            >
              <div className="lp-feature-icon">{f.icon}</div>
              <h3 className="lp-feature-title">{f.title}</h3>
              <p className="lp-feature-copy">{f.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="lp-section">
        <span className="lp-eyebrow reveal">使用流程</span>
        <h2 className="lp-section-title reveal">四步开始畅连</h2>
        <div className="lp-steps">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className="lp-step reveal"
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <div className="lp-step-n">{s.n}</div>
              <h3 className="lp-step-title">{s.title}</h3>
              <p className="lp-step-copy">{s.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-cta reveal">
        <h2 className="lp-cta-title">准备好开始了吗？</h2>
        <p className="lp-cta-copy">现在注册，几分钟内即可拥有属于你的高速连接。</p>
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
        <span className="lp-footer-note">© {new Date().getFullYear()} {site.name} · Powered by Hysteria 2</span>
      </footer>
    </main>
  );
}
