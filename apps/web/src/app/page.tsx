"use client";

// Homepage composition adapted from perfect-panel/frontend (GPL-3.0).
// See /public/vendor/perfect-panel/LICENSE and THIRD_PARTY_NOTICES.md.
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DeferredDotLottie } from "@/components/deferred-dot-lottie";
import { HoverBorderGradient } from "@/components/hover-border-gradient";
import { Icon } from "@/components/icon";
import { useSite } from "@/components/site-provider";
import { TextGenerateEffect } from "@/components/text-generate-effect";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest } from "@/lib/api";
import { formatMoney, formatSpeedLimit, formatTrafficLimit } from "@/lib/format";
import { selectHomepagePlans } from "@/lib/homepage-plans";

type PublicOffer = {
  id: string;
  name: string;
  billingPeriod: "monthly" | "quarterly" | "yearly" | "one_time" | "legacy";
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
  featured: boolean;
  access: {
    speedUpMbps: number;
    speedDownMbps: number;
    deviceLimit: number;
    availableServerCount: number;
  };
  offers: PublicOffer[];
};

type PublicCatalog = { products: PublicProduct[] };

const PERIOD_LABEL: Record<PublicOffer["billingPeriod"], string> = {
  monthly: "/月",
  quarterly: "/季",
  yearly: "/年",
  one_time: "/永久",
  legacy: "/周期",
};

const STATS = [
  {
    lottie: "/assets/lotties/users.json",
    name: "用户",
    description: "受到全球用户的信赖",
  },
  {
    lottie: "/assets/lotties/servers.json",
    name: "服务器",
    description: "全球高性能服务器",
  },
  {
    lottie: "/assets/lotties/locations.json",
    name: "节点位置",
    description: "覆盖多个地区",
  },
] as const;

function primaryOffer(product: PublicProduct) {
  return (
    product.offers.find((offer) => offer.billingPeriod === "monthly") ??
    product.offers.find((offer) => offer.isDefault) ??
    product.offers[0]
  );
}

export default function HomePage() {
  const site = useSite();
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<PublicCatalog>("/api/catalog")
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch(() => {
        if (active) setCatalog({ products: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  const plans = useMemo(
    () => selectHomepagePlans(catalog?.products ?? [], 4),
    [catalog],
  );
  const description =
    site.description.trim() ||
    "稳定、简单的网络服务，让每一次连接都清晰、顺畅。";

  return (
    <main className="ppanel-home" id="top">
      <header className="ppanel-header">
        <div className="ppanel-container ppanel-header-inner">
          <Link className="ppanel-brand" href="/" aria-label={`${site.name} 首页`}>
            <span className="ppanel-brand-mark" aria-hidden="true">
              <Icon name="brand_logo" />
            </span>
            <strong>{site.name}</strong>
          </Link>

          <div className="ppanel-header-actions">
            <ThemeToggle className="ppanel-theme-toggle" />
            <Link className="ppanel-login-link" href="/login">
              登录 / 注册
            </Link>
          </div>
        </div>
      </header>

      <div className="ppanel-container ppanel-main">
        <motion.section
          animate={{ opacity: 1, y: 0 }}
          className="ppanel-hero"
          initial={{ opacity: 0, y: -50 }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
        >
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="ppanel-hero-copy"
            initial={{ opacity: 0, y: 50 }}
            transition={{
              type: "spring",
              stiffness: 80,
              damping: 15,
              delay: 0.3,
            }}
          >
            <h1>欢迎来到 {site.name}</h1>
            <TextGenerateEffect
              className="ppanel-hero-description"
              words={description}
            />
            <Link className="ppanel-start-link" href="/register">
              <HoverBorderGradient
                as="span"
                containerClassName="ppanel-start-button"
              >
                <span>开始使用</span>
                <Icon name="arrow_forward" />
              </HoverBorderGradient>
            </Link>
          </motion.div>

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="ppanel-hero-visual"
            initial={{ opacity: 0, y: 50 }}
            transition={{
              type: "spring",
              stiffness: 80,
              damping: 15,
              delay: 0.5,
            }}
          >
            <DeferredDotLottie
              autoplay
              className="ppanel-hero-lottie"
              loop
              src="/assets/lotties/network-security.json"
            />
          </motion.div>
        </motion.section>

        <motion.section
          className="ppanel-stats"
          initial={{ opacity: 0, y: 50 }}
          transition={{ duration: 1, ease: "easeOut" }}
          viewport={{ once: true, amount: 0.8 }}
          whileInView={{ opacity: 1, y: 0 }}
          aria-label="服务能力"
        >
          {STATS.map((item, index) => (
            <motion.article
              initial={{ opacity: 0, scale: 0.8 }}
              key={item.name}
              transition={{
                duration: 0.8,
                delay: index * 0.3,
                ease: "easeOut",
              }}
              viewport={{ once: true, amount: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
            >
              <DeferredDotLottie
                autoplay
                className="ppanel-stat-lottie"
                loop
                src={item.lottie}
              />
              <div>
                <h2>{item.name}</h2>
                <p>{item.description}</p>
              </div>
            </motion.article>
          ))}
        </motion.section>

        <motion.section
          className="ppanel-plans"
          id="plans"
          initial={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1 }}
        >
          <motion.header
            className="ppanel-section-heading"
            initial={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, y: 0 }}
          >
            <h2>选择您的套餐</h2>
            <p>让我们帮助您选择最适合您的套餐，享受探索的乐趣。</p>
          </motion.header>

          {catalog === null ? (
            <div className="ppanel-plan-grid" aria-label="套餐加载中">
              {[0, 1, 2, 3].map((item) => (
                <div className="ppanel-plan-card ppanel-plan-skeleton" key={item} />
              ))}
            </div>
          ) : plans.length ? (
            <div className="ppanel-plan-grid">
              {plans.map((product, index) => {
                const offer = primaryOffer(product);
                return (
                  <motion.article
                    className="ppanel-plan-card"
                    initial={{ opacity: 0, y: 50 }}
                    key={product.id}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    viewport={{ once: true, amount: 0.5 }}
                    whileInView={{ opacity: 1, y: 0 }}
                  >
                    <header>
                      <h3>{product.name}</h3>
                      {product.featured ? <span>推荐</span> : null}
                    </header>
                    <div className="ppanel-plan-content">
                      <p>{product.description || "稳定线路，购买后即可使用。"}</p>
                      <ul>
                        <li>
                          <Icon name="check" />
                          <span>每周期 {formatTrafficLimit(offer.trafficBytes)} 流量</span>
                        </li>
                        <li>
                          <Icon name="check" />
                          <span>最高 {formatSpeedLimit(product.access.speedDownMbps)}</span>
                        </li>
                        <li>
                          <Icon name="check" />
                          <span>
                            {product.access.deviceLimit >= 99
                              ? "不限设备"
                              : `${product.access.deviceLimit} 台设备`}
                          </span>
                        </li>
                        <li>
                          <Icon name="check" />
                          <span>{product.access.availableServerCount} 个可用节点</span>
                        </li>
                      </ul>
                    </div>
                    <footer>
                      <div className="ppanel-plan-price">
                        <strong>{formatMoney(offer.priceCents)}</strong>
                        <span>{PERIOD_LABEL[offer.billingPeriod]}</span>
                      </div>
                      <motion.div className="ppanel-plan-action">
                        <Link href="/portal/plans">订阅</Link>
                      </motion.div>
                    </footer>
                  </motion.article>
                );
              })}
            </div>
          ) : (
            <div className="ppanel-plan-empty">
              <strong>套餐正在准备中</strong>
              <span>请稍后再来查看。</span>
            </div>
          )}
        </motion.section>

        <motion.section
          className="ppanel-global"
          initial={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          whileInView={{ opacity: 1 }}
        >
          <motion.header
            className="ppanel-section-heading"
            initial={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            whileInView={{ opacity: 1, y: 0 }}
          >
            <h2>全球连接，轻松无忧</h2>
            <p>探索无缝的全球连接。选择适合您需求的网络服务，随时随地保持连接。</p>
          </motion.header>
          <motion.div
            animate={{ scale: 1, opacity: 1 }}
            className="ppanel-global-visual"
            initial={{ scale: 0.9, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 100,
              damping: 15,
              delay: 0.4,
            }}
          >
            <DeferredDotLottie
              autoplay
              className="ppanel-global-lottie"
              loop
              src="/assets/lotties/global-map.json"
            />
          </motion.div>
        </motion.section>
      </div>

      <footer className="ppanel-footer">
        <div className="ppanel-container ppanel-footer-inner">
          <div />
          <div className="ppanel-footer-copy">
            <strong>{site.name}</strong> © {new Date().getFullYear()} 版权所有。
          </div>
        </div>
      </footer>
    </main>
  );
}
