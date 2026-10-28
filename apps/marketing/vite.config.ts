import { readDevPorts } from "@pcobooster/config/dev-ports";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

import { withPublicBase } from "./src/lib/base-path.ts";
import {
  KEY_PAIRS,
  isSameKey,
  pairPath,
} from "./src/lib/key-transition-pages.ts";
import { MARKETING_BASE, SITE_ORIGIN } from "./src/lib/site-head.ts";

/**
 * Every public page, in sitemap order. Start discovers static routes on its own, but the key
 * change pages share one dynamic route, so each is listed. Same-key pages are still built,
 * since the finder can land on one, but stay out of the sitemap (they are `noindex`).
 */
const SITE_PAGES = [
  { path: "/" },
  { path: "/about" },
  { path: "/key-transitions" },
  ...KEY_PAIRS.map((pair) => ({
    path: pairPath(pair),
    sitemap: { exclude: isSameKey(pair) },
  })),
  { path: "/privacy" },
  { path: "/terms" },
];

/** Lets prerendering fetch every page (`/`, `/about`, `/key-transitions/...`) through the preview server's base guard. */
const previewPagesOutsideBase = (): Plugin => ({
  name: "pcobooster:marketing-preview-pages",
  configurePreviewServer: (server) => {
    server.middlewares.use((request, _response, next) => {
      if (request.url !== undefined) {
        request.url = withPublicBase(request.url, MARKETING_BASE);
      }
      next();
    });
  },
});

const marketingDevPort = (): number => {
  const assigned = Number(process.env.PORT);
  return Number.isInteger(assigned) && assigned > 0
    ? assigned
    : readDevPorts(process.env).marketing;
};

/**
 * A static site generator: `vite build` prerenders every page into `dist/client`, which
 * `scripts/stage-marketing.ts` copies into the product's `public/marketing`. Assets live under
 * `/marketing/` so they never collide with the product's, while pages route at `/` and `/about`.
 */
export default defineConfig({
  base: MARKETING_BASE,
  define: {
    // The same public ingestion key as the product's.
    "import.meta.env.VITE_POSTHOG_KEY": JSON.stringify(
      process.env.POSTHOG_PROJECT_KEY ?? ""
    ),
  },
  resolve: { tsconfigPaths: true },
  // `DEV_PORT_BASE` places marketing beside its checkout's product (`scripts/cloudflare/dev.ts`);
  // run alone, it takes the port the desktop preview tool assigns in `PORT`.
  server: {
    host: "127.0.0.1",
    port: marketingDevPort(),
    strictPort: true,
  },
  plugins: [
    tailwindcss(),
    previewPagesOutsideBase(),
    tanstackStart({
      router: { basepath: "/" },
      pages: SITE_PAGES,
      // Written to `sitemap.xml` beside the pages; the product serves it at `/sitemap.xml`.
      sitemap: { enabled: true, host: SITE_ORIGIN },
      prerender: {
        enabled: true,
        // Static routes are discovered from the route tree. Crawling would follow product
        // links such as `/services`, which only exist in the product app.
        crawlLinks: false,
        failOnError: true,
        // `about.html`, not `about/index.html`: the product serves these exact files.
        autoSubfolderIndex: false,
      },
    }),
    // Must follow tanstackStart().
    viteReact(),
  ],
});
