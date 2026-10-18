import { THEME_COLORS } from "@/lib/theme";

/** Document-wide meta tags for every product page, read by the root route's `head()`. */
export const productHeadMeta = () => [
  { charSet: "utf-8" },
  {
    name: "viewport",
    // Edge to edge under the notch (pinned chrome pads itself with the safe-area insets),
    // and the keyboard resizes the layout on Android as it does on iOS. Pinch zoom stays on.
    content:
      "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
  },
  { name: "color-scheme", content: "light dark" },
];

/**
 * The browser bars take the phone header's color in each system scheme. `head()` keeps one
 * meta per name, so the root document renders these itself. After hydration the theme
 * provider points both at the theme shown when a saved theme overrides the system's.
 */
export const themeColorMeta = () => [
  {
    name: "theme-color",
    media: "(prefers-color-scheme: light)",
    content: THEME_COLORS.light,
  },
  {
    name: "theme-color",
    media: "(prefers-color-scheme: dark)",
    content: THEME_COLORS.dark,
  },
];
