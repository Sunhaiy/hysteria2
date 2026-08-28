"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/copy";
import { Icon } from "./icon";

export function SidebarNav({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = items.reduce<Array<{ label: string; items: NavItem[] }>>(
    (groups, item) => {
      const label = item.group ?? "Navigation";
      const current = groups.at(-1);
      if (current?.label === label) current.items.push(item);
      else groups.push({ label, items: [item] });
      return groups;
    },
    [],
  );
  return (
    <nav className="nav-group" aria-label="主导航">
      {sections.map((section) => (
        <div className="nav-section" key={section.label}>
          <span className="nav-label">{section.label}</span>
          <div className="nav-section-links">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${active ? " active" : ""}`}
                  onClick={onNavigate}
                >
                  <Icon name={item.icon} />
                  <span className="nav-link-title">{item.label}</span>
                  <span className="fine-print mono nav-link-meta">
                    {item.meta}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
