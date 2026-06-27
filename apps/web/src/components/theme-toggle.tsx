"use client";

import { Icon } from "./icon";
import { useTheme } from "./theme-provider";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className={className ?? "theme-toggle"}
      onClick={toggle}
      aria-label={theme === "dark" ? "切换到白天模式" : "切换到夜间模式"}
      title={theme === "dark" ? "白天模式" : "夜间模式"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
