import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import type { ReactNode } from "react";

import { useBrowserStorage } from "@/hooks/use-browser-storage";
import {
  readBrowserStorage,
  subscribeBrowserStorage,
  writeBrowserStorage,
} from "@/lib/browser-storage";
import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  parseThemePreference,
  resolveTheme,
} from "@/lib/theme";
import type { ThemePreference } from "@/lib/theme";

interface ThemeContextValue {
  /** The saved preference; `system` follows the operating system. */
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const NO_TRANSITIONS_CSS =
  "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}";

/** Swaps the theme without animating every color that depends on it. */
const withoutTransitions = (update: () => void): void => {
  const style = document.createElement("style");
  style.append(document.createTextNode(NO_TRANSITIONS_CSS));
  document.head.append(style);
  update();
  // Reading computed style flushes the change before transitions come back.
  window.getComputedStyle(document.body);
  setTimeout(() => {
    style.remove();
  }, 1);
};

const syncDocumentTheme = (): void => {
  const root = document.documentElement;
  const theme = resolveTheme(
    parseThemePreference(readBrowserStorage(THEME_STORAGE_KEY)),
    window.matchMedia(DARK_SCHEME_QUERY).matches
  );
  if (root.classList.contains(theme)) {
    return;
  }
  withoutTransitions(() => {
    applyResolvedTheme(root, theme);
  });
};

/**
 * Light, dark, or system theme on `<html>`. The root route's inline script applies the saved
 * theme before the first paint; this keeps it current when the preference, the operating
 * system, or another tab changes it.
 */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [storedTheme] = useBrowserStorage(THEME_STORAGE_KEY);
  const theme = parseThemePreference(storedTheme);

  useEffect(() => {
    const systemScheme = window.matchMedia(DARK_SCHEME_QUERY);
    systemScheme.addEventListener("change", syncDocumentTheme);
    const unsubscribe = subscribeBrowserStorage(syncDocumentTheme);
    return () => {
      systemScheme.removeEventListener("change", syncDocumentTheme);
      unsubscribe();
    };
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    writeBrowserStorage(THEME_STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
};
