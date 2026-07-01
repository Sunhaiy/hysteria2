"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type ProgressPhase = "idle" | "loading" | "finishing";

export function NavigationProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<ProgressPhase>("idle");

  useEffect(() => {
    function beginForLink(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const next = new URL(target.href, window.location.href);
      if (next.origin !== window.location.origin || next.href === window.location.href) return;
      if (next.pathname === window.location.pathname && next.search === window.location.search) return;
      setPhase("loading");
    }

    function beginForHistory() {
      setPhase("loading");
    }

    document.addEventListener("click", beginForLink, true);
    window.addEventListener("popstate", beginForHistory);
    return () => {
      document.removeEventListener("click", beginForLink, true);
      window.removeEventListener("popstate", beginForHistory);
    };
  }, []);

  useEffect(() => {
    const finishTimeoutId = window.setTimeout(() => {
      setPhase((current) => current === "loading" ? "finishing" : current);
    }, 0);
    const hideTimeoutId = window.setTimeout(() => setPhase("idle"), 240);
    return () => {
      window.clearTimeout(finishTimeoutId);
      window.clearTimeout(hideTimeoutId);
    };
  }, [pathname]);

  useEffect(() => {
    if (phase !== "loading") return;
    const timeoutId = window.setTimeout(() => setPhase("idle"), 10000);
    return () => window.clearTimeout(timeoutId);
  }, [phase]);

  return <div className={`route-progress ${phase}`} aria-hidden="true"><span /></div>;
}
