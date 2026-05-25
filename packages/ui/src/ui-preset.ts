export type SurfaceTheme = "light" | "dark" | "black";
export type AccentTheme =
  | "blue"
  | "green"
  | "teal"
  | "indigo"
  | "purple"
  | "orange"
  | "pink"
  | "red"
  | "yellow";

export interface UiPreset {
  surface: SurfaceTheme;
  accent: AccentTheme;
  density: "compact";
  typography: {
    body: string;
    tiny: string;
    mono: string;
    lineHeight: string;
  };
  layout: {
    headerHeight: number;
    toolbarHeight: number;
    sidebarWidth: number;
    panelRadius: number;
    controlHeight: number;
  };
}

export const uiPreset: UiPreset = {
  surface: "dark",
  accent: "green",
  density: "compact",
  typography: {
    body: "12px",
    tiny: "10px",
    mono: "\"Roboto Mono Variable\", monospace",
    lineHeight: "16px"
  },
  layout: {
    headerHeight: 44,
    toolbarHeight: 36,
    sidebarWidth: 248,
    panelRadius: 12,
    controlHeight: 32
  }
};

export const semanticMethodColors = {
  get: "var(--semantic-get)",
  post: "var(--semantic-post)",
  put: "var(--semantic-put)",
  patch: "var(--semantic-patch)",
  delete: "var(--semantic-delete)",
  head: "var(--semantic-head)",
  options: "var(--semantic-options)"
} as const;

export const semanticStatusColors = {
  info: "var(--status-info)",
  success: "var(--status-success)",
  redirect: "var(--status-redirect)",
  critical: "var(--status-critical)",
  server: "var(--status-server)",
  missing: "var(--status-missing)"
} as const;
