"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem } from "@/lib/copy";
import { useAuth } from "./auth-provider";
import { Icon } from "./icon";
import { SidebarNav } from "./sidebar-nav";
import { useSite } from "./site-provider";
import { ThemeToggle } from "./theme-toggle";

export function ConsoleShell({
  title,
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
  const site = useSite();
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
      <header className="mobile-console-header">
        <h1>{title}</h1>
        <button
          type="button"
          className="mobile-nav-toggle"
          aria-label="打开导航"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
        >
          <Icon name="menu" />
        </button>
      </header>

      {mobileNavOpen && (
        <div
          className="mobile-nav-backdrop"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside className={`sidebar${mobileNavOpen ? " open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand-row">
            <div className="brand-lockup">
              <h1 className="brand-title">{site.name}</h1>
            </div>
            <button
              type="button"
              className="mobile-nav-toggle"
              aria-label="关闭导航"
              onClick={() => setMobileNavOpen(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="sidebar-user">
            <div>
              <div className="sidebar-user-name">{session.user.displayName}</div>
              <div className="fine-print">{session.user.email}</div>
            </div>
          </div>
        </div>

        <SidebarNav items={navItems} onNavigate={() => setMobileNavOpen(false)} />

        <div className="sidebar-footer">
          <Link href="/" className="ghost-button" onClick={() => setMobileNavOpen(false)}>
            <Icon name="home" />
            <span>返回入口</span>
          </Link>
          <ThemeToggle className="ghost-button" />
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
        <div className="workspace-body">
          {toolbarMeta || toolbarActions ? (
            <div className="page-utility-bar">
              {toolbarMeta ? <div className="topbar-meta">{toolbarMeta}</div> : null}
              {toolbarActions ? <div className="topbar-actions">{toolbarActions}</div> : null}
            </div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
