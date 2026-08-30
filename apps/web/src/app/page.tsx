"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { HeroGlobe } from "@/components/hero-globe";
import { Icon } from "@/components/icon";
import { useSite } from "@/components/site-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest } from "@/lib/api";
import { sortCatalogProductsByPrice } from "@/lib/catalog-sort";
import { formatSpeedLimit, formatTrafficLimit } from "@/lib/format";

type PublicOffer = {
  id: string;
  name: string;
  billingPeriod: "monthly" | "quarterly" | "yearly" | "legacy";
  intervalMonths: number | null;
  legacyDurationDays: number | null;
  trafficBytes: number;
  priceCents: number;
  currency: string;
  active: boolean;
  isDefault: boolean;
  archivedAt: string | null;
};

type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  accent?: string | null;
  featured: boolean;
  purchaseLimitPerUser?: number | null;
  trafficReset: "monthly" | "never";
  access: {
    speedUpMbps: number;
    speedDownMbps: number;
    deviceLimit: number;
    availableServerCount: number;
  };
  offers: PublicOffer[];
};

type PublicCatalog = { products: PublicProduct[] };

const CAPABILITIES = [
  {
    icon: "shield",
    title: "稳定接入",
    copy: "多线路自动切换，连接状态持续可用",
  },
  {
    icon: "plug",
    title: "双订阅支持",
    copy: "Clash 与 v2rayN 订阅同步更新",
  },
  {
    icon: "globe",
    title: "全球线路",
    copy: "多地区节点按优先级灵活选择",
  },
];

function primaryOffer(product: PublicProduct) {
  return (
    product.offers.find((offer) => offer.billingPeriod === "monthly") ??
    product.offers.find((offer) => offer.isDefault) ??
    product.offers[0]
  );
}

function offerPeriod(offer: PublicOffer) {
  if (offer.billingPeriod === "legacy") {
    return `${offer.legacyDurationDays ?? "-"} 天`;
  }
  if (offer.billingPeriod === "monthly") return "月";
  return `${offer.intervalMonths ?? "-"} 个月`;
}

function priceParts(priceCents: number) {
  const [whole, fraction] = (priceCents / 100).toFixed(2).split(".");
  return { whole, fraction };
}

export default function HomePage() {
  const site = useSite();
  const [catalog, setCatalog] = useState<PublicCatalog>({ products: [] });
  const [catalogState, setCatalogState] = useState<
    "loading" | "ready" | "error"
  >("loading");

  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<PublicCatalog>("/api/catalog", {
      signal: controller.signal,
    })
      .then((result) => {
        setCatalog(result);
        setCatalogState("ready");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setCatalogState("error");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(".home-reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [catalogState]);

  const products = useMemo(
    () => sortCatalogProductsByPrice(catalog.products).slice(0, 6),
    [catalog.products],
  );

  return (
    <main className="home">
      <header className="home-header">
        <Link
          className="home-header-brand"
          href="/"
          aria-label={`${site.name} 首页`}
        >
          <BrandLogo />
        </Link>
        <nav className="home-nav" aria-label="首页导航">
          <a href="#top">首页</a>
          <a href="#capabilities">服务能力</a>
          <a href="#plans">套餐</a>
        </nav>
        <div className="home-header-actions">
          <ThemeToggle className="home-icon-button" />
          <Link className="home-login" href="/login">
            登录
          </Link>
          <Link
            className="home-button home-button-primary home-header-cta"
            href="/register"
          >
            注册
          </Link>
        </div>
      </header>

      <section id="top" className="home-hero">
        <div className="home-hero-scene" aria-hidden="true">
          <HeroGlobe className="home-globe-art" />
          <span className="home-orbit-label home-orbit-label-one">US</span>
          <span className="home-orbit-label home-orbit-label-two">JP</span>
          <span className="home-orbit-label home-orbit-label-three">HK</span>
        </div>
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <div className="home-live-label home-reveal">
              <span aria-hidden="true" />
              全球网络服务中
            </div>
            <h1 className="home-hero-title home-reveal">
              欢迎来到
              <br />
              <strong>{site.name}</strong>
            </h1>
            <p className="home-hero-description home-reveal">
              为日常浏览、学习与工作提供稳定、安全的全球网络连接，
              在不同设备之间保持一致体验。
            </p>
            <div className="home-hero-actions home-reveal">
              <Link
                className="home-button home-button-primary home-button-large"
                href="/register"
              >
                开始使用
                <Icon name="arrow_forward" />
              </Link>
              <a
                className="home-button home-button-secondary home-button-large"
                href="#plans"
              >
                查看套餐
              </a>
            </div>
            <div
              className="home-protocols home-reveal"
              aria-label="支持的协议与客户端"
            >
              <span>Hysteria 2</span>
              <span>VLESS Reality</span>
              <span>Clash</span>
              <span>v2rayN</span>
            </div>
          </div>
        </div>
      </section>

      <section
        id="capabilities"
        className="home-capabilities"
        aria-label="服务能力"
      >
        <div className="home-capabilities-inner">
          {CAPABILITIES.map((item) => (
            <article className="home-capability home-reveal" key={item.title}>
              <span className="home-capability-icon">
                <Icon name={item.icon} />
              </span>
              <div>
                <h2>{item.title}</h2>
                <p>{item.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="plans" className="home-plans">
        <div className="home-section-heading home-reveal">
          <span>灵活选择</span>
          <h2>选择适合你的套餐</h2>
          <p>从轻量体验到高流量需求，每个档位都保持清晰透明。</p>
        </div>

        {catalogState === "loading" ? (
          <div className="home-plan-grid" aria-label="套餐加载中">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="home-plan-card home-plan-skeleton" key={index} />
            ))}
          </div>
        ) : null}

        {catalogState === "error" ? (
          <div className="home-catalog-state">
            <Icon name="warning" />
            <span>套餐暂时无法加载，请登录后在用户中心查看。</span>
            <Link href="/login">进入用户中心</Link>
          </div>
        ) : null}

        {catalogState === "ready" && products.length ? (
          <div className="home-plan-grid">
            {products.map((product, index) => {
              const offer = primaryOffer(product);
              if (!offer) return null;
              const price = priceParts(offer.priceCents);
              const highlighted =
                product.featured || product.name.toLowerCase() === "pro";
              return (
                <article
                  className={`home-plan-card home-reveal${highlighted ? " is-featured" : ""}`}
                  key={product.id}
                  style={{ transitionDelay: `${(index % 3) * 70}ms` }}
                >
                  <div className="home-plan-head">
                    <div className="home-plan-labels">
                      <span className="home-plan-index">0{index + 1}</span>
                      {highlighted ? (
                        <span className="home-plan-badge">推荐</span>
                      ) : null}
                      {product.purchaseLimitPerUser ? (
                        <span className="home-plan-limit">每账号限购一次</span>
                      ) : null}
                    </div>
                    <h3>{product.name}</h3>
                    <p>{product.description || "稳定线路与实时订阅更新"}</p>
                  </div>
                  <div className="home-plan-specs">
                    <span>
                      <small>每月流量</small>
                      <strong>{formatTrafficLimit(offer.trafficBytes)}</strong>
                    </span>
                    <span>
                      <small>连接速率</small>
                      <strong>
                        {formatSpeedLimit(
                          Math.max(
                            product.access.speedUpMbps,
                            product.access.speedDownMbps,
                          ),
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>可用线路</small>
                      <strong>
                        {product.access.availableServerCount || "多"} 台
                      </strong>
                    </span>
                  </div>
                  <div className="home-plan-price">
                    <span className="home-plan-currency">¥</span>
                    <strong>{price.whole}</strong>
                    <span className="home-plan-fraction">
                      .{price.fraction}
                    </span>
                    <small>/ {offerPeriod(offer)}</small>
                  </div>
                  <Link className="home-plan-action" href="/register">
                    选择此套餐
                    <Icon name="arrow_forward" />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="home-connect">
        <div className="home-connect-visual" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="home-connect-content home-reveal">
          <span className="home-connect-kicker">保持连接</span>
          <h2>一次订阅，随处使用</h2>
          <p>订阅持续更新可用线路，在电脑和手机之间保持相同的连接入口。</p>
          <Link
            className="home-button home-button-light home-button-large"
            href="/register"
          >
            创建账户
            <Icon name="arrow_forward" />
          </Link>
        </div>
      </section>

      <footer className="home-footer">
        <BrandLogo />
        <div className="home-footer-links">
          <Link href="/login">登录</Link>
          <Link href="/register">注册</Link>
          <Link href="/portal">用户中心</Link>
        </div>
        <span>
          © {new Date().getFullYear()} {site.name}
        </span>
      </footer>
    </main>
  );
}
