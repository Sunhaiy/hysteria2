"use client";

import { useEffect, useRef } from "react";

/** HTML must be the server-sanitized published or preview snapshot. SSR keeps the full article. */
export function SeoArticleContent({ html }: { html: string }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    root.current?.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      if (!code) return;
      const frame = document.createElement("div");
      frame.className = "seo-code-frame";
      const bar = document.createElement("div");
      bar.className = "seo-code-toolbar";
      const language = document.createElement("span");
      language.textContent = pre.dataset.language || "代码";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "复制代码";
      button.setAttribute("aria-live", "polite");
      let disposed = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(code.textContent || "");
          if (!disposed) button.textContent = "已复制";
        } catch {
          if (!disposed) button.textContent = "复制失败，请手动选择代码";
        }
        if (!disposed) {
          clearTimeout(timer);
          timer = setTimeout(() => { button.textContent = "复制代码"; }, 2500);
        }
      };
      button.addEventListener("click", copy);
      bar.append(language, button);
      pre.before(frame);
      frame.append(bar, pre);
      cleanups.push(() => {
        disposed = true;
        clearTimeout(timer);
        button.removeEventListener("click", copy);
        frame.replaceWith(pre);
      });
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [html]);

  return <div ref={root} className="seo-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
