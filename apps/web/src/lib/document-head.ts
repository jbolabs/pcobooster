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
