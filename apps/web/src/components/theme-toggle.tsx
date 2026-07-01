"use client";

import { Icon } from "./icon";
import { useTheme, type Theme } from "./theme-provider";

const THEME_OPTIONS: Array<{ value: Theme; label: string; description: string }> = [
  { value: "light", label: "明亮白", description: "清爽通透" },
  { value: "dark", label: "石墨夜", description: "冷静中性" },
  { value: "midnight", label: "深海蓝", description: "低饱和蓝黑" },
  { value: "dusk", label: "暮色棕", description: "温暖柔和" },
  { value: "black", label: "纯黑", description: "高对比 OLED" },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, apply } = useTheme();
  const expanded = className?.includes("ghost-button") ?? false;

  return (
    <details className={`theme-picker ${expanded ? "expanded" : "compact"}`}>
      <summary
        className={className ?? "theme-toggle"}
        aria-label="选择外观主题"
        title="外观主题"
      >
        <Icon name={theme === "light" ? "sun" : "moon"} />
        {expanded ? <span>外观主题</span> : null}
      </summary>
      <div className="theme-picker-menu" role="menu" aria-label="外观主题">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            data-theme-option={option.value}
            className={theme === option.value ? "selected" : ""}
            onClick={(event) => {
              apply(option.value);
              const details = event.currentTarget.closest("details");
              if (details) details.open = false;
            }}
            role="menuitem"
          >
            <span className={`theme-preview ${option.value}`} aria-hidden="true" />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
            {theme === option.value ? <b>✓</b> : null}
          </button>
        ))}
      </div>
    </details>
  );
}
