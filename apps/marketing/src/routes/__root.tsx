import interLatinUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";

import "@fontsource-variable/inter/wght.css";
import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ActionLink, SiteFooter, SiteHeader } from "../components/site";
import { siteHead } from "../lib/site-head";

import "../styles/globals.css";

const RootDocument = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body>
      <a
        href="#main"
        className="bg-primary text-primary-foreground fixed top-3 left-[max(--spacing(3),env(safe-area-inset-left))] z-30 -translate-y-[160%] rounded-lg px-4 py-2.5 text-sm focus:translate-y-[env(safe-area-inset-top,0px)]"
      >
        Skip to content
      </a>
      <SiteHeader />
      {children}
      <SiteFooter />
      <Scripts />
    </body>
  </html>
);

/** Only reachable on the marketing dev server; the product owns every other public URL. */
const NotFound = () => (
  <main
    id="main"
    className="wrap pt-page-top grid max-w-[680px] grid-cols-1 justify-items-center gap-10 text-center"
  >
    <h1 className="text-headline">Page not found.</h1>
    <ActionLink href="/" secondary>
      Back to the home page
    </ActionLink>
  </main>
);

export const Route = createRootRoute({
  head: () => {
    const { meta, links } = siteHead();
    return {
      meta,
      links: [
        {
          rel: "preload",
          href: interLatinUrl,
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
        ...links,
      ],
    };
  },
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
});
