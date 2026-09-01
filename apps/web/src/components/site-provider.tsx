"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { apiRequest } from "@/lib/api";

interface SiteInfo {
  name: string;
  description: string;
  browserTitle: string;
  iconUrl: string;
  fontWeight: number;
}

const defaultSite: SiteInfo = {
  name: "Hysteria 2",
  description: "",
  browserTitle: "Hysteria 2",
  iconUrl: "/favicon.ico",
  fontWeight: 400,
};

const fontWeightStorageKey = "site-font-weight";

function normalizeFontWeight(value: number | undefined) {
  if (!Number.isFinite(value)) return defaultSite.fontWeight;
  const stepped = Math.round(Number(value) / 50) * 50;
  return Math.min(600, Math.max(350, stepped));
}

const SiteContext = createContext<SiteInfo>(defaultSite);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteInfo>(defaultSite);
  const pathname = usePathname();

  useLayoutEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(fontWeightStorageKey));
      if (!Number.isFinite(stored) || stored < 350 || stored > 600) return;
      document.documentElement.style.setProperty(
        "--font-weight-body",
        String(normalizeFontWeight(stored)),
      );
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
  }, []);

  useEffect(() => {
    const applySite = (info: SiteInfo) => {
      if (!info?.name) return;
      const next = {
        ...info,
        fontWeight: normalizeFontWeight(info.fontWeight),
      };
      document.documentElement.style.setProperty(
        "--font-weight-body",
        String(next.fontWeight),
      );
      try {
        window.localStorage.setItem(fontWeightStorageKey, String(next.fontWeight));
      } catch {
        // Applying the live setting does not depend on persistent storage.
      }
      setSite(next);
    };

    void apiRequest<SiteInfo>("/api/site")
      .then(applySite)
      .catch(() => undefined);

    const handleUpdate = (event: Event) => {
      applySite((event as CustomEvent<SiteInfo>).detail);
    };
    window.addEventListener("site-info-updated", handleUpdate);
    return () => window.removeEventListener("site-info-updated", handleUpdate);
  }, []);

  useEffect(() => {
    document.title = site.browserTitle || site.name;

    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = site.iconUrl || "/favicon.ico";
  }, [pathname, site]);

  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite() {
  return useContext(SiteContext);
}
