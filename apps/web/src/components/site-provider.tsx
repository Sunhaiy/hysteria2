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
  iconStrokeWidth: number;
}

const defaultSite: SiteInfo = {
  name: "Hysteria 2",
  description: "",
  browserTitle: "Hysteria 2",
  iconUrl: "/favicon.ico",
  fontWeight: 400,
  iconStrokeWidth: 1.5,
};

const fontWeightStorageKey = "site-font-weight";
const iconStrokeWidthStorageKey = "site-icon-stroke-width";

function normalizeFontWeight(value: number | undefined) {
  if (!Number.isFinite(value)) return defaultSite.fontWeight;
  const stepped = Math.round(Number(value) / 50) * 50;
  return Math.min(600, Math.max(350, stepped));
}

function normalizeIconStrokeWidth(value: number | undefined) {
  if (!Number.isFinite(value)) return defaultSite.iconStrokeWidth;
  return Math.min(3, Math.max(1, Math.round(Number(value) * 10) / 10));
}

const SiteContext = createContext<SiteInfo>(defaultSite);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteInfo>(defaultSite);
  const pathname = usePathname();

  useLayoutEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(fontWeightStorageKey));
      if (Number.isFinite(stored) && stored >= 350 && stored <= 600) {
        document.documentElement.style.setProperty(
          "--font-weight-body",
          String(normalizeFontWeight(stored)),
        );
      }
      const storedIconStrokeWidth = Number(
        window.localStorage.getItem(iconStrokeWidthStorageKey),
      );
      if (
        Number.isFinite(storedIconStrokeWidth) &&
        storedIconStrokeWidth >= 1 &&
        storedIconStrokeWidth <= 3
      ) {
        document.documentElement.style.setProperty(
          "--icon-stroke-width",
          String(normalizeIconStrokeWidth(storedIconStrokeWidth)),
        );
      }
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
        iconStrokeWidth: normalizeIconStrokeWidth(info.iconStrokeWidth),
      };
      document.documentElement.style.setProperty(
        "--font-weight-body",
        String(next.fontWeight),
      );
      document.documentElement.style.setProperty(
        "--icon-stroke-width",
        String(next.iconStrokeWidth),
      );
      try {
        window.localStorage.setItem(fontWeightStorageKey, String(next.fontWeight));
        window.localStorage.setItem(
          iconStrokeWidthStorageKey,
          String(next.iconStrokeWidth),
        );
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
