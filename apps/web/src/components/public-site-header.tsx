"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSite } from "@/components/site-provider";

export function PublicSiteHeader({ siteName }: { siteName?: string }) {
  const site = useSite();
  const name = siteName || site.name;

  return (
    <header className="ppanel-header public-site-header">
      <div className="ppanel-container ppanel-header-inner">
        <Link className="ppanel-brand" href="/" aria-label={`${name} 首页`}>
          <span className="ppanel-brand-mark" aria-hidden="true">
            <Icon name="brand_logo" />
          </span>
          <strong>{name}</strong>
        </Link>
        <nav className="public-site-nav" aria-label="主导航">
          <Link href="/">首页</Link>
          <Link href="/blog">使用指南</Link>
        </nav>
        <div className="ppanel-header-actions">
          <ThemeToggle className="ppanel-theme-toggle" />
          <Link className="ppanel-login-link" href="/login">
            登录 / 注册
          </Link>
        </div>
      </div>
    </header>
  );
}
