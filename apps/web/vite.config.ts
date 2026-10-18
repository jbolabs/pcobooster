import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import { devOrigin, readDevPorts } from "@pcobooster/config/dev-ports";
import { getPresentationCacheScope } from "@pcobooster/presentation-mode";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { Schema } from "effect";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

// `alchemy dev`/`deploy` inject their own resource-aware Cloudflare plugin with the Worker's bindings.
const alchemyInjected = process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1";

/** `bun run dev` picks the ports (`scripts/cloudflare/dev.ts`); alone, the product uses the defaults. */
const ports = readDevPorts(process.env);
const marketingDevOrigin = devOrigin(ports.marketing);

const runBunScript = async (args: readonly string[]): Promise<void> => {
  const child = spawn("bun", args, { cwd: repositoryRoot, stdio: "inherit" });
  const [code] = Schema.decodeUnknownSync(
    Schema.Tuple([Schema.NullOr(Schema.Number), Schema.NullOr(Schema.String)])
  )(await once(child, "exit"));
  if (code !== 0) {
    throw new Error(`\`bun ${args.join(" ")}\` exited with ${String(code)}`);
  }
};

/**
 * `/`, `/about`, `/privacy`, `/terms`, `/key-transitions`, and its per-change pages serve the prerendered marketing site from `public/marketing`, which Vite
 * copies into the uploaded client assets. Turborepo builds marketing before a standalone
 * product build; Alchemy has no pre-build hook, so its builds run the marketing build first.
 */
const stageMarketingSite = (): Plugin => ({
  name: "pcobooster:stage-marketing",
  apply: "build",
  buildApp: {
    order: "pre",
    handler: async () => {
      if (alchemyInjected) {
        await runBunScript(["run", "build:marketing"]);
      }
      await runBunScript(["run", "scripts/stage-marketing.ts"]);
    },
  },
});

/** `/icon.svg` in production; unknown stages (a plain `vite build`) count as local. */
const faviconForStage = (stage: string | undefined): string => {
  if (stage === "prod") {
    return "/icon.svg";
  }
  if (stage === "staging") {
    return "/icon-staging.svg";
  }
  if (stage?.startsWith("pr-") === true) {
    return "/icon-preview.svg";
  }
  return "/icon-local.svg";
};

/** Public values inlined into both the server and browser bundles. */
const publicDefines = (devServer: boolean) => ({
  "import.meta.env.VITE_DEVELOPMENT_PROFILE": JSON.stringify(
    devServer ? (process.env.DEV_DATA_PROFILE ?? "Live data · read-only") : ""
  ),
  // The stack binds the same public configuration to the API.
  "import.meta.env.VITE_POSTHOG_KEY": JSON.stringify(
    process.env.POSTHOG_PROJECT_KEY ?? ""
  ),
  "import.meta.env.VITE_PLANNING_CENTER_TIME_ZONE": JSON.stringify(
    process.env.PLANNING_CENTER_TIME_ZONE ?? ""
  ),
  // Each non-production stage gets its own favicon so tabs are easy to tell apart.
  "import.meta.env.VITE_FAVICON": JSON.stringify(
    faviconForStage(process.env.PCOBOOSTER_STAGE)
  ),
  // `bun run dev:present` sets presentation mode for the dev server; deployed builds are
  // always live.
  "import.meta.env.VITE_PRESENTATION_SCOPE": JSON.stringify(
    devServer ? getPresentationCacheScope(process.env) : "live"
  ),
});

export default defineConfig(({ command, isPreview }) => {
  const devServer = command === "serve" && isPreview !== true;
  return {
    define: publicDefines(devServer),
    resolve: { tsconfigPaths: true },
    server: {
      // `alchemy dev` passes the same port; these apply to a standalone `vite dev`.
      host: "127.0.0.1",
      port: ports.web,
      strictPort: true,
      // The marketing dev server owns these pages locally; builds stage them instead.
      proxy: {
        "^/(?:(?:about|privacy|terms|key-transitions(?:/[a-z0-9-]+)?)/?)?(?:\\?.*)?$":
          marketingDevOrigin,
        "^/marketing/": marketingDevOrigin,
      },
    },
    plugins: [
      stageMarketingSite(),
      tailwindcss(),
      alchemyInjected
        ? null
        : cloudflare({
            viteEnvironment: { name: "ssr" },
            // Standalone builds (CI, `vite preview`) only; Alchemy owns the deployed Worker config.
            config: {
              name: "pcobooster-web",
              main: "@tanstack/react-start/server-entry",
              compatibility_date: "2026-09-01",
              compatibility_flags: ["nodejs_compat"],
              assets: { binding: "ASSETS" },
              vars: { PRODUCT_ORIGIN: devOrigin(ports.web) },
            },
          }),
      tanstackStart(),
      // Must follow tanstackStart().
      viteReact(),
    ],
  };
});
