"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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

  useEffect(() => {
    const applySite = (info: SiteInfo) => {
      if (!info?.name) return;
      setSite(info);
      document.title = info.browserTitle || info.name;

      let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!icon) {
        icon = document.createElement("link");
        icon.rel = "icon";
        document.head.appendChild(icon);
      }
      icon.href = info.iconUrl || "/favicon.ico";
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

  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite() {
  return useContext(SiteContext);
}
