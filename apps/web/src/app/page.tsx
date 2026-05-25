import Link from "next/link";
import { homeCopy } from "@/lib/copy";

export default function HomePage() {
  return (
    <main className="landing">
      <section className="landing-hero">
        <span className="eyebrow">Hysteria 2 / Membership / Traffic Control</span>
        <h1 className="hero-title">{homeCopy.title}</h1>
        <p className="hero-copy">{homeCopy.description}</p>
        <div className="route-links">
          <Link className="action-button" href="/login">
            登录控制台
          </Link>
          <Link className="ghost-button" href="/admin">
            打开管理台
          </Link>
          <Link className="ghost-button" href="/portal">
            打开用户中心
          </Link>
        </div>
      </section>

      <section className="landing-grid">
        <article className="landing-grid-card">
          <span className="eyebrow">Typography</span>
          <h2 className="section-title">12px 正文，10px 辅助，16px 行高</h2>
          <p className="subtle-copy">
            主体用 Inter Variable，代码和令牌信息用 Roboto Mono Variable，靠边线、间距和对比度建立层级。
          </p>
        </article>
        <article className="landing-grid-card">
          <span className="eyebrow">Palette</span>
          <h2 className="section-title">中性灰底，少量高饱和语义色</h2>
          <p className="subtle-copy">
            大面积保持克制，强调色只出现在可操作区域、状态和关键动作上，保证高密度但不乱。
          </p>
        </article>
        <article className="landing-grid-card">
          <span className="eyebrow">Local Seed</span>
          <h2 className="section-title">当前内置演示账号</h2>
          <div className="list">
            <span className="fine-print mono">{homeCopy.adminHint}</span>
            <span className="fine-print mono">{homeCopy.memberHint}</span>
          </div>
        </article>
      </section>
    </main>
  );
}
