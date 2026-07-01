"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "midnight" | "dusk" | "black";

const THEMES: Theme[] = ["light", "dark", "midnight", "dusk", "black"];

const ThemeContext = createContext<{ theme: Theme; apply: (theme: Theme) => void }>({
  theme: "light",
  apply: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  // Sync from whatever the pre-hydration inline script already applied. This
  // must run after mount (not in the initializer) to keep SSR/CSR markup
  // identical and avoid a hydration mismatch.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(THEMES.includes(current as Theme) ? (current as Theme) : "light");
  }, []);

  const apply = useCallback((next: Theme) => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, apply }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
