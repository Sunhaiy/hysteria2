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
}

const defaultSite: SiteInfo = { name: "Hysteria 2", description: "" };

const SiteContext = createContext<SiteInfo>(defaultSite);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteInfo>(defaultSite);

  useEffect(() => {
    void apiRequest<SiteInfo>("/api/site")
      .then((info) => {
        if (info?.name) setSite(info);
      })
      .catch(() => undefined);
  }, []);

  return <SiteContext.Provider value={site}>{children}</SiteContext.Provider>;
}

export function useSite() {
  return useContext(SiteContext);
}
