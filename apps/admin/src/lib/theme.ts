const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs as an inline script before the document paints: the shared design tokens key dark
 * mode off a `.dark` class, and the admin app simply follows the operating system. It is
 * serialized with `toString()`, so it may only use its argument and browser globals.
 */
const followSystemTheme = (darkQuery: string): void => {
  const query = matchMedia(darkQuery);
  const apply = (): void => {
    const root = document.documentElement;
    root.classList.toggle("dark", query.matches);
    root.style.colorScheme = query.matches ? "dark" : "light";
  };
  apply();
  query.addEventListener("change", apply);
};

export const themeInitScript = `(${followSystemTheme.toString()})(${JSON.stringify(
  DARK_SCHEME_QUERY
)})`;
