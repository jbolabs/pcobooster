/** Saved preferences use this key and these values; changing them resets every visitor's theme. */
export const THEME_STORAGE_KEY = "theme";

const themePreferences = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof themePreferences)[number];

export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** The parts of `document.documentElement` the theme writes. */
export interface ThemeRoot {
  classList: Pick<DOMTokenList, "add" | "remove">;
  style: Pick<CSSStyleDeclaration, "colorScheme">;
}

export const parseThemePreference = (value: string | null): ThemePreference =>
  themePreferences.find((preference) => preference === value) ?? "system";

export const resolveTheme = (
  preference: ThemePreference,
  systemDark: boolean
): ResolvedTheme => {
  if (preference === "system") {
    return systemDark ? "dark" : "light";
  }
  return preference;
};

/** Applies a theme to the document. */
export const applyResolvedTheme = (
  root: ThemeRoot,
  theme: ResolvedTheme
): void => {
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
};

/**
 * Runs as an inline script before the document paints, so the saved theme never flashes.
 * It is serialized with `toString()`, so it may only use its arguments and browser globals;
 * the tests run it in an isolated context to keep it in step with the functions above.
 */
const initializeTheme = (storageKey: string, darkQuery: string): void => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(storageKey);
  } catch {
    // Blocked storage falls back to the system theme.
  }
  const theme =
    stored === "dark" || (stored !== "light" && matchMedia(darkQuery).matches)
      ? "dark"
      : "light";
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
};

export const themeInitScript = `(${initializeTheme.toString()})(${JSON.stringify(
  THEME_STORAGE_KEY
)}, ${JSON.stringify(DARK_SCHEME_QUERY)})`;
