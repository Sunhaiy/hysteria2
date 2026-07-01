"use client";

import { Icon } from "./icon";
import { useTheme } from "./theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, apply } = useTheme();
  const nextTheme = theme === "light" ? "dark" : "light";
  const label = nextTheme === "dark" ? "切换深色模式" : "切换明亮模式";

  return (
    <button
      type="button"
      className={className ?? "theme-toggle"}
      onClick={() => apply(nextTheme)}
      aria-label={label}
      title={label}
    >
      <Icon name={theme === "light" ? "moon" : "sun"} />
      {className?.includes("ghost-button") ? <span>{nextTheme === "dark" ? "深色模式" : "明亮模式"}</span> : null}
    </button>
  );
}
