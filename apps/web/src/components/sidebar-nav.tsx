"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/copy";
import { Icon } from "./icon";

export function SidebarNav({
  items,
}: {
  items: NavItem[];
}) {
  const pathname = usePathname();
  return (
    <nav className="nav-group">
      <span className="nav-label">Navigation</span>
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className={`nav-link${active ? " active" : ""}`}>
            <Icon name={item.icon} />
            <span className="nav-link-title">{item.label}</span>
            <span className="fine-print mono nav-link-meta">{item.meta}</span>
          </Link>
        );
      })}
    </nav>
  );
}
