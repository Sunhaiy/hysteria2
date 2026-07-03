"use client";

import {
  createContext,
  useContext,
  useEffect,
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
}

const defaultSite: SiteInfo = {
  name: "Hysteria 2",
  description: "",
  browserTitle: "Hysteria 2",
  iconUrl: "/favicon.ico",
};

const SiteContext = createContext<SiteInfo>(defaultSite);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteInfo>(defaultSite);
  const pathname = usePathname();

  useEffect(() => {
    const applySite = (info: SiteInfo) => {
      if (!info?.name) return;
      setSite(info);
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
