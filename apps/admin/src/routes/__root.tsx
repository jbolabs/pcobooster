/// <reference types="vite/client" />
import interLatinUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";

import "@fontsource-variable/inter/wght.css";
import {
  HeadContent,
  Link,
  ScriptOnce,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AdminNotFound } from "@/components/admin/not-found";
import { themeInitScript } from "@/lib/theme";

import "@/styles/globals.css";

const RootDocument = ({ children }: { children: ReactNode }) => (
  // The theme script sets the class and color scheme before hydration.
  <html lang="en" suppressHydrationWarning>
    <head>
      <ScriptOnce>{themeInitScript}</ScriptOnce>
      <HeadContent />
      {/* `head()` keeps one meta per name, so the per-scheme theme colors live here. */}
      <meta
        name="theme-color"
        media="(prefers-color-scheme: light)"
        content="#eff2ee"
      />
      <meta
        name="theme-color"
        media="(prefers-color-scheme: dark)"
        content="#1b1e18"
      />
    </head>
    <body className="flex min-h-dvh flex-col antialiased">
      <header className="border-border/50 border-b">
        <div className="mx-auto flex h-12 w-full max-w-7xl items-center px-4 md:px-6">
          <Link to="/" className="text-sm font-semibold">
            PCOBooster Admin
          </Link>
        </div>
      </header>
      {children}
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "PCOBooster Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      {
        rel: "preload",
        href: interLatinUrl,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: AdminNotFound,
});
