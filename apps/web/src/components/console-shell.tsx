"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem } from "@/lib/copy";
import { useAuth } from "./auth-provider";
import { Icon } from "./icon";
import { SidebarNav } from "./sidebar-nav";

export function ConsoleShell({
  title,
  subtitle,
  scope,
  navItems,
  requireRole,
  toolbarMeta,
  toolbarActions,
  children,
}: {
  title: string;
  subtitle: string;
  scope: string;
  navItems: NavItem[];
  requireRole: "admin" | "member";
  toolbarMeta?: ReactNode;
  toolbarActions?: ReactNode;
  children: ReactNode;
}) {
  const { session, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (session.role !== requireRole) {
      router.replace(session.role === "admin" ? "/admin" : "/portal");
    }
  }, [loading, pathname, requireRole, router, session]);

  if (loading || !session || session.role !== requireRole) {
    return (
      <div className="loading-screen">
        <div className="panel loading-card">
          <div className="panel-body">
            <span className="scope-chip">Boot</span>
            <h1 className="brand-title">正在加载控制台</h1>
            <span className="brand-subtitle">校验登录状态并同步面板数据。</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNavOpen ? " open" : ""}`}>
        <div className="sidebar-header">
          <button
            type="button"
            className="toolbar-button mobile-nav-toggle"
            onClick={() => setMobileNavOpen((value) => !value)}
          >
            <Icon name="menu" />
            <span>{mobileNavOpen ? "收起导航" : "打开导航"}</span>
          </button>
          <div className="brand-lockup">
            <span className="scope-chip">{scope}</span>
            <h1 className="brand-title">Hysteria 2 Control Plane</h1>
            <span className="brand-subtitle">
              单节点多套餐映射、多用户流量治理、会员订阅与 Hysteria 2 接入面板
            </span>
          </div>
        </div>

        <div className="panel sidebar-meta">
          <div className="panel-body">
            <div className="list-row">
              <span className="fine-print">Theme</span>
              <span className="badge success">dark / green</span>
            </div>
            <div className="list-row">
              <span className="fine-print">Density</span>
              <span className="badge info">12px / 16px rhythm</span>
            </div>
            <div className="list-row">
              <span className="fine-print">当前身份</span>
              <span className="badge">{session.user.displayName}</span>
            </div>
          </div>
        </div>

        <SidebarNav items={navItems} />

        <div className="sidebar-footer">
          <Link href="/" className="ghost-button">
            <Icon name="home" />
            <span>返回入口</span>
          </Link>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
          >
            <Icon name="logout" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h2 className="topbar-title">{title}</h2>
            <div className="topbar-subtitle">{subtitle}</div>
          </div>
          <div className="toolbar-actions">
            <span className="badge success">{session.user.displayName}</span>
            <span className="badge info mono">{session.user.email}</span>
          </div>
        </header>
        <div className="toolbar">
          <div className="toolbar-meta">{toolbarMeta}</div>
          <div className="toolbar-actions">{toolbarActions}</div>
        </div>
        <div className="workspace-body">{children}</div>
      </main>
    </div>
  );
}
