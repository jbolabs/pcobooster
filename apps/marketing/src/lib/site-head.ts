/** Public URL prefix of every marketing asset, which the product serves from `public/marketing`. */
export const MARKETING_BASE = "/marketing/";

export const SITE_ORIGIN = "https://pcobooster.com";
const SITE_NAME = "PCOBooster";
const DEFAULT_TITLE = "PCOBooster | The Workspace for Planning Center Services";
const SOCIAL_PREVIEWS = {
  "/": {
    title: DEFAULT_TITLE,
    description:
      "Fill teams, look after volunteers, and get songs and chord charts ready, right on top of Planning Center Services.",
    image: "og-home.png",
    alt: "PCOBooster: the workspace ministry leaders use on top of Planning Center Services",
  },
  "/about": {
    title: "Our story | PCOBooster",
    description:
      "Why Jake built a faster way to get Sunday ready in Planning Center Services.",
    image: "og-about.png",
    alt: "PCOBooster was built for the people who bring the team together",
  },
  "/key-transitions": {
    title: "Song Key Transitions | PCOBooster",
    description:
      "Pick two song keys and get chord-by-chord ways to move your band from one song into the next.",
    image: "og-home.png",
    alt: "PCOBooster: the workspace ministry leaders use on top of Planning Center Services",
  },
  "/privacy": {
    title: "Privacy Policy | PCOBooster",
    description:
      "What PCOBooster collects when you sign in with Planning Center, why, and how to have it deleted.",
    image: "og-home.png",
    alt: "PCOBooster: the workspace ministry leaders use on top of Planning Center Services",
  },
  "/terms": {
    title: "Terms of Service | PCOBooster",
    description:
      "The terms for using PCOBooster, an independent workspace for Planning Center Services.",
    image: "og-home.png",
    alt: "PCOBooster: the workspace ministry leaders use on top of Planning Center Services",
  },
} as const;

export type HeadMeta =
  | { title: string }
  | { charSet: "utf-8" }
  | { name: string; content: string }
  | { property: string; content: string };

export interface HeadLink {
  rel: string;
  href: string;
}

export interface PageHead {
  meta: HeadMeta[];
  links: HeadLink[];
}

export const marketingAssetUrl = (assetPath: string): string =>
  `${MARKETING_BASE}${assetPath}`;

/** The home canonical is the bare origin, without a trailing slash. */
export const canonicalUrl = (pathname: string): string =>
  pathname === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${pathname}`;

export const pageTitle = (title?: string): string =>
  title === undefined ? DEFAULT_TITLE : `${title} · ${SITE_NAME}`;

/** Document-wide tags; route-specific search and sharing tags live in `pageHead`. */
export const siteHead = (): PageHead => ({
  meta: [
    { charSet: "utf-8" },
    // Edge to edge under the notch (the header pads itself back out), and the keyboard
    // resizes the layout on Android as it does on iOS. Pinch zoom always stays on.
    {
      name: "viewport",
      content:
        "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
    },
    // No theme-color: Safari tints its bars from the page (see the product's globals.css).
    { name: "color-scheme", content: "light" },
  ],
  links: [{ rel: "icon", href: marketingAssetUrl("icon.svg") }],
});

export interface SocialPreview {
  title: string;
  description: string;
  image: string;
  alt: string;
}

type PageHeadInput = { title?: string; description: string } & (
  | { pathname: keyof typeof SOCIAL_PREVIEWS }
  | { pathname: string; preview: SocialPreview }
);

/**
 * Per-page title, description, canonical URL, and social preview. Generated pages, such as
 * one per key change, pass their own preview.
 */
export const pageHead = (input: PageHeadInput): PageHead => {
  const { title, description, pathname } = input;
  const preview: SocialPreview =
    "preview" in input ? input.preview : SOCIAL_PREVIEWS[input.pathname];
  const imageUrl = `${SITE_ORIGIN}${marketingAssetUrl(preview.image)}`;
  return {
    meta: [
      { title: pageTitle(title) },
      { name: "description", content: description },
      { property: "og:title", content: preview.title },
      { property: "og:description", content: preview.description },
      { property: "og:url", content: canonicalUrl(pathname) },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:image", content: imageUrl },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: preview.alt },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: preview.title },
      { name: "twitter:description", content: preview.description },
      { name: "twitter:image", content: imageUrl },
      { name: "twitter:image:alt", content: preview.alt },
    ],
    links: [{ rel: "canonical", href: canonicalUrl(pathname) }],
  };
};

/** A listed page's social preview, as the base for pages generated beneath it. */
export const socialPreviewOf = (
  pathname: keyof typeof SOCIAL_PREVIEWS
): SocialPreview => SOCIAL_PREVIEWS[pathname];
