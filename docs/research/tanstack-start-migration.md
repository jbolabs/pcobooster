# TanStack Start migration research

Research date: September 23, 2026. This document records the recommendations, and their sources, for moving `apps/web`, `apps/admin`, and `apps/marketing` from Next.js 16 to TanStack Start on Cloudflare Workers, deployed by Alchemy `2.0.0-beta.79`.

**Status: implemented.** All three apps run on TanStack Start, and no Next.js, OpenNext, or Vercel code remains. Sections 1 to 9 and the conventions are the pre-implementation research. The implementation notes at the end record what was verified and where the code deviates, and they win wherever the two disagree. The current code differs from the research in these ways:

- **SSR mode.** Product pages are `ssr: "data-only"` under an SSR `_app` shell, not `ssr: false` (web notes).
- **Build-time values.** Public values are Vite `define`s in each `vite.config.ts`, read from unprefixed Infisical keys: `POSTHOG_PROJECT_KEY` becomes `import.meta.env.VITE_POSTHOG_KEY`, and `PLANNING_CENTER_TIME_ZONE` becomes `import.meta.env.VITE_PLANNING_CENTER_TIME_ZONE`. The presentation scope is a `define` too, not a root server function. The People gate, once a `PEOPLE_PAGE_ENABLED` `define`, is now a runtime feature flag ([Feature flags](../environment.md#feature-flags)). No `VITE_*` keys are set on Alchemy resources.
- **Env typing.** Web and admin redeclare `cloudflare:workers` in `src/worker-env.d.ts` with only the bindings they read. They do not augment `Cloudflare.Env`.
- **Custom server entries.** Only marketing has `src/server.ts`, for prerendering. Admin uses Start's default entry: the product forwards `/admin` and `/admin/*` unchanged, and Start redirects `/admin` to `/admin/`.
- **Marketing** prerenders with `crawlLinks: false` and `autoSubfolderIndex: false`.
- **Lint.** The Next.js oxlint presets and the Start-only override are removed.

Source conventions used below:

- **Start docs** means `docs/start/framework/react/…` at tag [`@tanstack/react-start@1.168.58`](https://github.com/TanStack/router/tree/%40tanstack/react-start%401.168.58/docs/start/framework/react). The published site is `https://tanstack.com/start/latest/docs/framework/react/<same path>`. I checked that every Start doc cited here is byte-identical at the tag and on `main` (`ddad69a`, 2026-09-23).
- **Router docs** means `docs/router/…` at tag [`@tanstack/react-router@1.170.39`](https://github.com/TanStack/router/tree/%40tanstack/react-router%401.170.39/docs/router).
- **Source** means the published npm tarball of the named package version. The versions are the exact dependency set of `@tanstack/react-start@1.168.58`: `start-client-core@1.170.32`, `start-server-core@1.169.37`, `start-plugin-core@1.171.47`, `react-router@1.170.39`, and `router-core@1.171.32`.
- **Alchemy** means `node_modules/alchemy/src/…` (`2.0.0-beta.79`) and `node_modules/.bun/@alchemy.run+cloudflare-runtime@2.0.0-beta.79…/src/…`. Both are installed in this repository.

## Recommendation

Migrate each app to a Vite 8 + TanStack Start project. Deploy web and admin with `Cloudflare.Website.Vite`, which replaces `Website.Nextjs`. Build marketing as a prerendered Start app, then stage its static output into web exactly as today. Keep the separate Hono API Worker and the `API`/`ADMIN` service bindings unchanged.

Qualifications, each substantiated below:

1. **Alchemy injects its own Cloudflare Vite plugin.** It is not `@cloudflare/vite-plugin`. It is a separate implementation (`distilled-cloudflare:*`) appended through Vite's inline config. The app's `vite.config.ts` must not also run `@cloudflare/vite-plugin` under Alchemy. Guard it with `ALCHEMY_CLOUDFLARE_VITE_INJECTED`, or omit it.
2. **`@alchemy.run/frontend-frameworks/tanstack-start` is for AWS/Node, not Cloudflare.** Its source says Cloudflare deploys TanStack Start through `Cloudflare.Website.Vite`.
3. **The Start docs and source disagree about validator names, and the source is authoritative.** At the latest release, `.validator()` is the canonical server-function/middleware method and `.inputValidator()` is a `@deprecated` alias. The Cloudflare and Better Auth docs still show `inputValidator`.
4. **Product routes should not be server-rendered.** _(Superseded: product pages use `ssr: "data-only"`; see the web notes.)_ Use Selective SSR: SSR the document shell and public/auth routes, and put product routes under a pathless layout with `ssr: false`. Do not use SPA mode or `defaultSsr: false` globally. Either would prevent `/auth` from doing a server-side session redirect.
5. **Do not enable `prerender` for web or admin.** Start prerenders through `vite.preview({ configFile })`, which does not carry Alchemy's inline-injected plugin. See Pitfalls.

## Versions (npm registry, 2026-09-23)

| Package | Latest | Notes |
| --- | --- | --- |
| `@tanstack/react-start` | `1.168.58` | peer `vite >=7`, React `>=18 \|\| >=19` |
| `@tanstack/react-router` | `1.170.39` | pinned exactly by react-start 1.168.58 |
| `@tanstack/router-plugin` | `1.168.40` | transitive via `start-plugin-core`; not a direct dependency for Start apps |
| `@tanstack/react-router-ssr-query` | `1.167.3` | peers: `@tanstack/react-query >=5.102.0`, `@tanstack/react-router >=1.170.33` |
| `@cloudflare/vite-plugin` | `1.58.0` | peer `vite ^6.1 \|\| ^7 \|\| ^8`, **`wrangler ^4.137.0`** |
| `vite` | `8.3.0` |  |
| `@vitejs/plugin-react` | `6.1.1` | peer **`vite ^8.0.0`** |
| `@tailwindcss/vite` | `4.3.3` | peer `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8` |
| `wrangler` | `4.137.0` | only needed if the standalone Cloudflare plugin is kept |
| `@tanstack/router-cli` | `1.167.38` | optional `tsr generate` for route tree generation without Vite |
| `@tanstack/zod-adapter` | `1.167.0` | peer `zod ^3.23.8`; **do not install**. The repo uses zod 4, which Router accepts directly |
| `@alchemy.run/cloudflare-runtime` | `2.0.0-beta.79` | peer `vite ^7 \|\| ^8`, `rolldown 1.2.5` |

Source: `npm view <pkg> version peerDependencies`. Existing repo pins that stay: React `19.3.0`, `@tanstack/react-query ^5.103.1` (satisfies the ssr-query peer), `better-auth 1.7.5`, `zod ^4.6.5`, and TypeScript `^7.0.2`.

## 1. Project setup

### How Alchemy builds a Vite Worker

`Cloudflare.Website.Vite(id, props)` is a `Cloudflare.Worker` with `props.vite = { main, rootDir, memo, viteEnvironments }` (Alchemy `Cloudflare/Website/Vite.ts`). The source provider (`Cloudflare/Workers/Sources/Vite.ts`) works as follows:

- **Build:** A child process runs with `cwd = rootDir`, inherits `process.env`, and forces `NODE_ENV=production` (`Workers/ViteChild.ts`). It calls `vite.createBuilder({ root, define, plugins: [cloudflare(pluginOptions), outputPlugin], logLevel: "warn" }, null)`, then `builder.buildApp()`. The app's `vite.config.ts` is loaded normally, and the injected plugin comes from `@alchemy.run/cloudflare-runtime/vite`.
- **Dev:** It runs `vite.createServer({ root, define, plugins: [cloudflare({ …, worker: { bindings, assets, … } })], server: { port: 0 } })`. The Worker's bindings, including service bindings, are handed to the local workerd runtime.
- **Entry:** Defaults to `viteEnvironments: { entry: "ssr", children: [] }`. Start's server environment is named `ssr` (`start-plugin-core` `src/constants.ts`: `START_ENVIRONMENT_NAMES.server = 'ssr'`), so no `main` is needed. Set `main: "src/server.ts"` only if the Worker must export extra handlers.
- **Assets:** The `client` environment output is uploaded as Worker static assets. The resolved Vite `base` keys the asset manifest, so `base: "/admin/"` uploads assets under `/admin/…` (see the doc comment in `Website/Vite.ts`). `nodejs_compat` is enabled by default, and an `ASSETS` binding is added when assets exist (`WorkerProvider.ts`).
- **Public env:** Only `env` keys prefixed `VITE_` become `define`s (`import.meta.env.VITE_*`), and `Redacted` values are unwrapped (`getDefine`). They also remain runtime bindings.
- **Memo:** The default hashes all non-gitignored files under `rootDir`, the nearest lockfile, and **auto-detected workspaces**. Every module the build resolved outside `root` and outside `node_modules` is mapped to its `package.json` directory (`Bundle/Vite.ts` `collectExternalWorkspaces`). Unlike `Website.Nextjs`, this covers `packages/*` automatically. It does not hash `process.env`, so stage-dependent config such as the admin `base` still belongs in a hashed file (keep `cloudflare-build-inputs.json`) or must be accepted as a known gap.

Plugin collision guard, quoted from Alchemy `Workers/Sources/Vite.ts`:

> Apps that also build standalone (plain `vite build` in CI, no Alchemy) need the Cloudflare plugin in their `vite.config.ts`. Without a guard, an Alchemy-orchestrated run instantiates that config-file instance _alongside_ the injected one ... in dev: two workerd runtimes, only one of which carries the Worker's bindings.
>
> ```ts
> process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1" ? null : cloudflare({ ... })
> ```

**Order differs from the docs.** The TanStack and Cloudflare docs put `cloudflare({ viteEnvironment: { name: 'ssr' } })` first ([Start hosting](https://github.com/TanStack/router/blob/%40tanstack/react-start%401.168.58/docs/start/framework/react/guide/hosting.md), [Cloudflare TanStack Start guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)). Alchemy's plugin arrives through inline config, after the config-file plugins. Alchemy documents TanStack Start as a supported single call (`Cloudflare.Website.Vite("TanStackStart")`), and its dev plugin exposes `dev.middlewareOrder` for frameworks that need the proxy earlier (`cloudflare-runtime/src/vite/plugin.ts`). Treat the order as **verified in source, unverified at runtime**. Prove SSR, server functions, and HMR under `alchemy dev` in the first spike.

### `vite.config.ts` (web)

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Alchemy dev/deploy injects its own resource-aware Cloudflare plugin.
const alchemyInjected = process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1";

export default defineConfig({
  resolve: { tsconfigPaths: true }, // Vite 8 built-in; replaces vite-tsconfig-paths
  plugins: [
    tailwindcss(),
    alchemyInjected ? null : cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    viteReact(), // must come after tanstackStart()
  ],
});
```

Sources: plugin set and order from the official [`examples/react/start-basic-cloudflare/vite.config.ts`](https://github.com/TanStack/router/blob/%40tanstack/react-start%401.168.58/examples/react/start-basic-cloudflare/vite.config.ts) (`tailwindcss(), cloudflare(...), tanstackStart(), viteReact()`). The "react after start" rule is from Start docs `build-from-scratch.md`, and `resolve.tsconfigPaths` from `guide/path-aliases.md` (Vite 8). The Start docs `guide/tailwind-integration.md` still shows `vite-tsconfig-paths` and puts `tailwindcss()` last. The newer example and path-aliases guide supersede it.

**Decide whether to keep the standalone plugin.** `@cloudflare/vite-plugin` accepts inline Worker config (`EntryWorkerConfig.config?: WorkerConfigCustomizer`, `configPath?`) in `dist/index.d.mts` of 1.58.0, but it has a hard `wrangler ^4.137.0` peer. Keeping it guarded makes `vite build`/`vite preview` produce a workerd-shaped bundle for Turborepo and CI. If it is dropped, a plain `vite build` has no Cloudflare runtime treatment, and `cloudflare:workers` imports have nothing to resolve them. Recommendation: keep it guarded with inline `config` rather than a committed `wrangler.jsonc`. Alchemy remains the only deploy path. The spike must confirm that inline config works with no wrangler file.

### wrangler config

Not needed with Alchemy. The resource supplies name, compatibility, bindings, assets, and entry. The docs' `wrangler.jsonc` (`"main": "@tanstack/react-start/server-entry"`, `nodejs_compat`) is only for `wrangler deploy` ([Cloudflare guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)).

### Alchemy resource (replaces `Website.Nextjs`)

```ts
const web =
  yield *
  Cloudflare.Website.Vite("Web", {
    name: `pcobooster-${stage}-web`,
    rootDir: path.join(import.meta.dirname, "apps/web"),
    compatibility: { date: "2026-09-01", flags: ["nodejs_compat"] },
    dev: { host: "127.0.0.1", port: 3001, strictPort: true },
    memo: { lockfile: true }, // workspaces default to "auto"
    env: {
      API: api,
      ADMIN: admin,
      PRODUCT_ORIGIN: publicOrigin,
    },
  });
```

`ViteProps` extends `WorkerProps` minus `vite | main | assets`, so `dev.host/port/strictPort` are accepted (`Workers/Worker.ts` `dev?:`). `assets` takes `AssetsConfig` (`runWorkerFirst`, `htmlHandling`, `notFoundHandling`, `headers`, `redirects`; see `Workers/Assets.ts`). The Vite dev server itself binds `port: 0`, and the Worker `dev.port` is the fronting local URL. HMR through that path is **unverified**.

### tsconfig

Minimum per Start docs `build-from-scratch.md`: `jsx: react-jsx`, `moduleResolution: Bundler`, `module: ESNext`, `target: ES2022`, `skipLibCheck`, `strictNullChecks`. The docs also warn: "Enabling `verbatimModuleSyntax` can result in server bundles leaking into client bundles. It is recommended to keep this option disabled." Check `packages/config/tsconfig.base.json` for that flag. Add `/// <reference types="vite/client" />` (in `__root.tsx` or an `env.d.ts`) so `?url` imports type-check (Start docs `guide/css-styling.md`). Keep the existing `@/*` path alias, which Vite 8 resolves through `resolve.tsconfigPaths`.

### File layout and generated route tree

```text
apps/web/
  vite.config.ts
  src/
    router.tsx          # export function getRouter()
    start.ts            # createStart(): global middleware, CSRF, defaultSsr
    server.ts           # optional custom Worker entry; omit unless needed
    client.tsx          # optional; default is hydrateRoot(document, <StartClient/>)
    routeTree.gen.ts    # generated, committed
    routes/__root.tsx …
```

- `src/router.tsx` **must export `getRouter`**. The client entry does `import { getRouter } from '#tanstack-router-entry'` (`start-client-core` `src/client/hydrateStart.ts`). Default entry names are `start`, `router`, `client`, `server` under `srcDirectory` (default `src`) (`start-plugin-core` `src/planning.ts`, `src/schema.ts`).
- `routeTree.gen.ts`: **commit it**. The Router FAQ says: "it is essentially part of your application's runtime, not a build artifact … You should commit this file" ([Router docs `faq.md`](https://github.com/TanStack/router/blob/%40tanstack/react-router%401.170.39/docs/router/faq.md)). The official Cloudflare example does not gitignore it. Start appends `declare module '@tanstack/react-start' { interface Register { ssr: true; router: …; config: … } }` to it (`start-plugin-core` `src/start-router-plugin/route-tree-footer.ts`), so `tsc` needs the file present. Lint/format already exclude it: Ultracite's shared ignore list includes `**/*.gen.*` (`node_modules/ultracite/config/shared/ignores.mjs`, ultracite 7.12.0), and the `ultracite/oxlint/tanstack` preset (already extended in `oxlint.config.ts`) disables `unicorn/filename-case` and `no-use-before-define` under `**/routes/**`.
- `src/server.ts` is optional. It is needed only to export Workers handlers such as `scheduled`/`queue`/Durable Objects, or to wrap the fetch handler (Start docs `guide/server-entry-point.md`; [Cloudflare custom entrypoints](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)):

```ts
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
export default createServerEntry({
  fetch: (request) => handler.fetch(request),
});
```

Only marketing ended up needing one, for prerendering (see the marketing notes). Use `src/start.ts` middleware for request logic. Under Alchemy, pointing `main` at a custom entry is done with `Website.Vite({ main: "src/server.ts" })`.

## 2. Cloudflare bindings and env

- Import `env` from `cloudflare:workers` inside server-only code: server function handlers, server route handlers, and middleware `.server()`. This pattern is shown in the official example [`src/routes/index.tsx`](https://github.com/TanStack/router/blob/%40tanstack/react-start%401.168.58/examples/react/start-basic-cloudflare/src/routes/index.tsx) and in the [Cloudflare guide "Bindings"](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/).
- Cloudflare: "Workers do not allow I/O from outside a request context … calling to other Workers will not work" from top-level scope. Only vars and secrets are usable there ([Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)). Call `env.API.fetch` only inside handlers.
- Start docs `guide/environment-variables.md`: "Read env per-request, not at module scope. On Cloudflare Workers … module-level `process.env.X` reads … evaluate to `undefined`". It points to `cloudflare:workers` as the canonical accessor. Replace every `process.env.*` server read (`DEV_AUTH_BYPASS`, `PEOPLE_PAGE_ENABLED`, `PRODUCT_ORIGIN`, …) with `env.*`. `process.env.NODE_ENV` in the server build is replaced statically by default (`server.build.staticNodeEnv: true`, `start-plugin-core` `src/schema.ts`). In client code, prefer `import.meta.env.DEV/PROD`.
- Client-visible values: inline them at build time as `import.meta.env.VITE_*`, and list their sources in `turbo.json` `env`. _(Implemented as `define`s in `vite.config.ts` from `POSTHOG_PROJECT_KEY` and `PLANNING_CENTER_TIME_ZONE`, not as `VITE_*` keys on the Alchemy resource.)_
- Forward requests to a service binding with the original `Request`, e.g. `env.API.fetch(request)`. The URL, method, headers, and streaming body are preserved, and the target sees the product origin ([HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)). This replaces the manual `arrayBuffer()` copy in `apps/web/src/app/api/[[...path]]/route.ts`.

**Typing.** `@cloudflare/workers-types@5.20260923.1` (already a web devDependency) declares `module "cloudflare:workers" { export const env: Cloudflare.Env }` with an empty `interface Env {}` in `declare namespace Cloudflare` (`index.d.ts` lines ~15841 to 16145). Augment it once per app:

```ts
// apps/web/src/worker-env.d.ts
declare global {
  namespace Cloudflare {
    interface Env {
      API: Fetcher;
      ADMIN: Fetcher;
      ASSETS: Fetcher;
      PRODUCT_ORIGIN: string;
      DEV_AUTH_BYPASS?: string;
    }
  }
}
export {};
```

`packages/api/src/cloudflare.d.ts` instead redeclares the whole module (`declare module "cloudflare:workers" { export const env: { DB: D1Database } }`). That works when workers-types is not globally loaded, but it conflicts with the augmentation approach, so pick one per tsconfig. Do not derive types from `alchemy.run.ts` through `Cloudflare.InferEnv`. Alchemy's own comments in `Workers/Worker.ts` note that these mapped types are expensive to check, and it would pull infra into app type graphs. `wrangler types` is not used because there is no wrangler config.

**Tests** already alias `cloudflare:workers` to `scripts/testing/cloudflare-workers.ts` in the root `vitest.config.ts`. Extend that stub with `API`/`ADMIN`/`ASSETS` fakes or inject fetchers explicitly, following the AGENTS.md dependency-injection rule.

**Local dev.** Alchemy passes the Worker's bindings, including the local `Api` Worker, to the dev runtime (`Sources/Vite.ts` `dev`). That should make `/api/*` forwarding through `env.API` work locally and retire the Next dev rewrites to `127.0.0.1:3000/3003`. Verify this in the spike. The fallback is `import.meta.env.DEV ? fetch("http://127.0.0.1:3000"+path) : env.API.fetch(request)`.

## 3. Routing

File conventions (Router docs `routing/file-naming-conventions.md`): `__root.tsx`; `.` nests (`posts.$id.tsx`); `$param`; `$` alone is a splat (`params._splat`); `{-$param}` is optional; `_prefix` is a pathless layout; `suffix_` breaks out of the parent layout; `-prefix` files are excluded (colocation); `(group)` folders don't add a URL segment; `[.]` escapes (`robots[.]txt.ts`); `index`; `route.tsx` is the directory route file.

| Next.js | TanStack Start |
| --- | --- |
| `app/layout.tsx` | `routes/__root.tsx` with `shellComponent` (the `<html>` document, always SSR) + `component` |
| `page.tsx` / `[id]/page.tsx` / `[...x]` / `[[...x]]` | `index.tsx` / `$id.tsx` / `$.tsx` / `$.tsx` plus an index route if the bare path must match |
| `(group)/` | `(group)/` (same semantics) |
| `loading.tsx` | route `pendingComponent` (router `defaultPendingComponent`) |
| `not-found.tsx`, `notFound()` | `notFoundComponent` / router `defaultNotFoundComponent`; `throw notFound()` from `@tanstack/react-router` |
| `redirect()` | `throw redirect({ to, search })` (internal) or `redirect({ href })` (external/absolute) |
| `route.ts` | same file with `server: { handlers: { GET, POST, ANY, … } }` |
| `metadata` / `generateMetadata` / `viewport` | route `head: () => ({ meta, links, scripts })` rendered by `<HeadContent/>` |
| `app/icon.svg`, `favicon.ico`, `manifest.webmanifest`, `apple-icon.png` | move to `public/`, add `head().links` |
| `next/link` | `Link` (`to`, typed `params`, `search`) |
| `useRouter().push/replace/refresh/back` | `useNavigate()({ to, replace })`, `useRouter().invalidate()`, `useRouter().history.back()` / `useCanGoBack()` |
| `usePathname()` | `useLocation({ select: (l) => l.pathname })` |
| `useSearchParams()` | `Route.useSearch()` (validated) or `useSearch({ strict: false })` |
| `useParams()` | `Route.useParams()` |

Sources: Start docs `migrate-from-next-js.md` ("Preserve paths", `Link`, `validateSearch`, `head`); Router docs `guide/navigation.md` (`Link`, `useNavigate`, `Navigate`, `router.navigate`, `useMatchRoute`), `guide/not-found-errors.md` (`notFoundMode: 'fuzzy'` default vs `'root'`, and `NotFoundRoute` is deprecated), and `routing/routing-concepts.md` (splat, optional params). The `useLocation`, `useRouterState`, `useCanGoBack`, and `useBlocker` exports are in the `@tanstack/react-router@1.170.39` source. Server-side redirects must use absolute `to` paths or `href`: "Server side redirects must use absolute paths via the 'href' or 'to' options" (`start-server-core` `src/createStartHandler.ts` `handleRedirectResponse`).

**Search params with zod 4.** Pass the schema directly: `validateSearch: z.object({ page: z.number().catch(1) })`. Router docs `guide/search-params.md`: "`validateSearch` also accepts an object with the `parse` property" and "In Zod v4, schemas may use `catch` instead of the fallback and will retain type inference". Use `.catch()` for resilient URLs. Put search values a loader uses in `loaderDeps` (Start docs `migrate-from-next-js.md`).

**Basepath (admin under `/admin`).** Set Vite `base: "/admin/"`. When `tanstackStart({ router: { basepath } })` is unset, Start derives the router basepath from Vite `base` (`deriveRouterBasepath` in `start-plugin-core` `src/planning.ts`). It injects that value as `TSS_ROUTER_BASEPATH` for both the client (`hydrateStart.ts`) and the server handler (`createStartHandler.ts`), and prefixes the server-function base to `/admin/_serverFn/` (`createServerFnBasePath`). Alchemy uploads the assets under the same base (see section 1). If `base` and `router.basepath` differ, dev installs a URL-rewrite middleware instead of failing (`vite/plugin.ts` `shouldRewriteDevBasepath`). Do not also pass `basepath` to `createRouter`.

## 4. Server functions, middleware, server routes, and auth

**Server functions** (Start docs `guide/server-functions.md`; source `start-client-core` `src/createServerFn.ts`):

```ts
export const getAdminAccounts = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string() })) // Standard Schema, `.parse`, or a function
  .handler(async ({ data }) => {
    /* env.API.fetch … */
  });
```

- Validators accept Standard Schema (`'~standard'`), objects with `.parse`, or functions (`execValidator`). The canonical builder is `.validator()`. `.inputValidator()` is typed `/** @deprecated Use \`validator\` instead. */` and stored under both names (`createServerFn.ts`lines ~88 to 125, 509 to 513, and 670 to 673; the same pattern is in`createMiddleware.ts`). Better Auth and Cloudflare snippets that use `.inputValidator` still work but should not be copied.
- Loaders are isomorphic, meaning they run on the server for the first request and in the browser on navigation. Privileged reads therefore go inside server functions, not loaders (Start docs `guide/execution-model.md`, `migrate-from-next-js.md`).
- Request utilities come from `@tanstack/react-start/server`: `getRequest`, `getRequestHeaders`, `getRequestHeader`, `getRequestUrl`, `getRequestHost`, `getRequestIP`, `getCookies`/`getCookie`/`setCookie`/`deleteCookie`, `setResponseHeader(s)`, `setResponseStatus`, `useSession` (`start-server-core` `src/request-response.ts`).
- CSRF: "If your app does not define `src/start.ts`, Start installs this middleware automatically for server functions. If you define `src/start.ts`, add the middleware explicitly" with `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })` (Start docs `guide/server-functions.md`, `guide/middleware.md`).
- Files: `*.functions.ts` holds `createServerFn` wrappers (safe to import anywhere); `*.server.ts` is server-only and denied in the client build by import protection (`**/*.server.*`, `@tanstack/react-start/server`); `import '@tanstack/react-start/server-only'` is the marker for other files (Start docs `guide/import-protection.md`). Avoid dynamic `import()` of server functions (`guide/server-functions.md`). Drop the `server-only` npm package.

**Middleware** (Start docs `guide/middleware.md`; source `start-server-core` `src/createStartHandler.ts`):

- `createMiddleware()` is request middleware (`.server({ request, pathname, context, next })`). It runs for SSR, server routes, and server functions. `createMiddleware({ type: 'function' })` adds `.client()`, `.validator()`, and `sendContext`.
- Register it globally in `src/start.ts`: `createStart(() => ({ requestMiddleware: [...], functionMiddleware: [...], defaultSsr, serializationAdapters }))` (`start-client-core` `src/createStart.ts`). Route-level middleware goes in `server: { middleware: [...] }`.
- Short-circuiting is supported. Return a `Response`, or throw a `Response`/`redirect()`. `executeMiddleware` accepts `result instanceof Response` and `err instanceof Response`, and `handleRedirectResponse` resolves router redirects. `ctx.handlerType` is `'serverFn' | 'router'`.

**Server routes** (Start docs `guide/server-routes.md`) are `createFileRoute(path)({ server: { middleware?, handlers } })`. Handlers get `{ request, params, context }`. Method keys include `GET POST PUT PATCH DELETE OPTIONS HEAD ANY`; HEAD falls back to `GET` then `ANY` (`start-client-core` `src/serverRoute.ts`; `createStartHandler.ts` line ~970). A route without a `component` is a pure endpoint. Web equivalents:

```ts
// src/routes/api/$.ts: replaces app/api/[[...path]]/route.ts (+ dev rewrite)
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
export const Route = createFileRoute("/api/$")({
  server: { handlers: { ANY: ({ request }) => env.API.fetch(request) } },
});
```

Use the same `ANY` forwarder for `routes/admin/$.ts` to `env.ADMIN`, plus an index route if bare `/admin` must match. `routes/index.ts` and `routes/about.ts` keep today's `env.ASSETS.fetch(new URL("/marketing/…html", request.url))`.

**Replacing `proxy.ts`.** Put one global request middleware in `src/start.ts`. It should return the `www` 308 redirect, pass through public paths, `/api/*`, `/admin/*`, `/auth`, and `handlerType === 'serverFn'` requests, add the `/demo/*` noindex/no-referrer headers with `setResponseHeader` after `await next()`, and otherwise redirect when `getSessionCookie(request)` (Better Auth accepts `Request | Headers`, per `better-auth/dist/cookies/index.d.mts`) and the demo cookie are absent. This keeps today's cheap cookie-presence gate before any HTML is produced. Static assets never reach it. Cloudflare's asset layer is assets-first unless `runWorkerFirst` is set (`Workers/Assets.ts`). As today, the `www` redirect therefore applies to Worker-handled paths only.

**Auth gating best practice.** Both TanStack and Better Auth show `beforeLoad` in a pathless `_authed`/`_protected` layout that calls a `createServerFn` session check and throws `redirect({ to: '/login', search: { redirect: location.href } })` (Start docs `guide/authentication.md`; [Better Auth TanStack integration](https://www.better-auth.com/docs/integrations/tanstack)). Both also state that this is UX only: "`beforeLoad` is useful route UX … It is not the security boundary for the data" (`guide/authentication.md`, `guide/server-functions.md`). Here the boundary is already the API Worker, which authorizes every oRPC call. So:

- Keep the **request-middleware cookie gate** for the server redirect, which matches today's behavior.
- Use `beforeLoad` only where session _validity_ matters: `/auth` (redirect signed-in users away) and admin (401 → product `/auth?next=/admin`, 403/404 → `notFound()`).
- Better Auth's `auth.handler` mount and `tanstackStartCookies()` plugin **do not apply**. Better Auth runs in the Hono API Worker behind `/api/auth/*`, and the web Worker only forwards. Keep `better-auth/react` `createAuthClient()` on the client.
- Set `headers: () => ({ 'Cache-Control': 'private, no-store' })` on session-dependent routes (route `headers` option, `router-core` `src/route.ts`; Start docs `guide/authentication.md`).

## 5. SSR modes and prerendering

- **Full SSR** (default, `ssr: true`): `beforeLoad` and `loader` run on the server, and the component is server-rendered.
- **`ssr: 'data-only'`**: server `beforeLoad`/`loader`, client-only component.
- **`ssr: false`**: nothing runs on the server for that route. The server renders the first such route's `pendingComponent` (or `defaultPendingComponent`) as fallback. Children inherit and may only become _more_ restrictive. There is a functional form `ssr: ({ params, search }) => …`. `shellComponent` on the root is always SSR'd. `createStart(() => ({ defaultSsr: false }))` changes the default (Start docs `guide/selective-ssr.md`).
- **SPA mode** (`tanstackStart({ spa: { enabled: true } })`): prerenders only a root shell to `/_shell.html` at build time. Hosts must rewrite 404s to it while allow-listing `/_serverFn/*` and server-route prefixes (Start docs `guide/spa-mode.md`).

**Recommendation for web.** _(Superseded by `ssr: "data-only"`; see the web notes.)_ Root route: `shellComponent` (document, ScriptOnce theme script, `<HeadContent/>`, `<Scripts/>`) and default SSR. Put a pathless `routes/_app.tsx` around all product routes with `ssr: false`, `pendingComponent` = the existing skeletons, and the AppShell component. Leave `/auth` and `/demo/$key` outside `_app` with SSR (`/auth` does a server-side session check in `beforeLoad`). Rationale: product pages are client components backed by React Query with browser-persisted caches (`lib/query-cache-hydration.ts`, `persistence-schemas.ts`) and viewport hooks, so SSR would add hydration-mismatch risk without data benefit. A global `defaultSsr: false` would make `/auth` client-only because of inheritance. SPA mode needs a build-time prerender, which conflicts with Alchemy's injected plugin (see Pitfalls).

**Recommendation for admin.** Full SSR. Pages are server-data tables today (`export const dynamic = "force-dynamic"`), so use loaders that call server functions.

**Static prerendering** (Start docs `guide/static-prerendering.md`; schema in `start-plugin-core` `src/schema.ts`): `tanstackStart({ prerender: { enabled, autoSubfolderIndex (default true → /about/index.html), autoStaticPathsDiscovery, crawlLinks, concurrency, filter, retryCount, failOnError, onSuccess }, pages: [...] })`. Static non-param, non-layout routes with components are discovered automatically. Implementation: after `buildApp`, Start starts `vite.preview({ configFile, preview: { port: 0 } })` and fetches each page into the client `outDir` (`start-plugin-core` `src/vite/prerender.ts`). Cloudflare notes that prerendering "runs at build time using local environment variables, secrets, and bindings" ([guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)).

**Marketing.** Build it as a Start app with `prerender: { enabled: true, crawlLinks: true, failOnError: true }`, no Cloudflare plugin, and no Alchemy resource. It is a static generator whose `dist/client` is copied by `scripts/stage-marketing.ts` into `apps/web/public/marketing/`, as today. To keep URLs identical, set Vite `base: "/marketing/"` (assets under `/marketing/assets/…`) and `tanstackStart({ router: { basepath: "/" } })` so pages route at `/` and `/about`. Misaligned base/basepath is explicitly supported (`vite/plugin.ts` comment: "base: '/_ui/' for asset URLs while keeping router basepath at '/'"). Either set `prerender.autoSubfolderIndex: false` to keep `about.html`, or update web's `/about` route to `/marketing/about/index.html`. A pure Vite SPA would ship empty HTML to crawlers, and a deployed Start Worker would add an unnecessary service. `@cloudflare/vite-plugin`'s `assetsOnly` option ("using server-side code in development but producing a fully static app for deployment", `dist/index.d.mts`) is an alternative if marketing ever deploys on its own. It needs no server code today. **Verify** that hydration of the product-demo replica works with the misaligned base in a prerendered page.

## 6. TanStack Query and oRPC

Official setup (Start docs `guide/tanstack-query.md`; Router docs `integrations/query.md`):

```tsx
// src/router.tsx
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
  setupRouterSsrQueryIntegration({ router, queryClient }); // options: handleRedirects, wrapQueryClient, dehydrateOptions, hydrateOptions
  return router;
}
```

- "Create the client inside `getRouter`, not at module scope. Start creates a router for each SSR request." Declare `queryClient` via `createRootRouteWithContext<{ queryClient: QueryClient }>()`. "Do not add a second QueryClient or independently dehydrate the same cache." If you own the provider, use `wrapQueryClient: false`. The source wraps `router.options.Wrap` in `QueryClientProvider` unless that flag is set (`@tanstack/react-router-ssr-query@1.167.3` `src/index.tsx`).
- `defaultPreloadStaleTime: 0` lets Query own freshness. Loaders call `context.queryClient.query(opts)` (Query ≥5.102) or `ensureQueryData`, and components use `useSuspenseQuery(opts)` with the same options. "Plain `useQuery` does not execute on the server" (integration doc).
- Invalidate the owning cache: `queryClient.invalidateQueries` for Query data, and `router.invalidate()` for loader data and route context.

**Applied here.** Move the `QueryClient` from `components/providers.tsx` into `getRouter`, keeping `gcTime`, `retry`, `refetchOnWindowFocus`. Replace `ReactQueryDevtools`'s `process.env.NODE_ENV` check with `import.meta.env.DEV`. Two app-specific adaptations:

1. _(Implemented as a build-time `define` instead; see the web notes.)_ `queryKeyHashFn` currently prefixes a **server-derived** `presentationScope`, computed in the RSC layout from `PRESENTATION_MODE`/`PRESENTATION_SEED` via `node:crypto`. Obtain it from a root `beforeLoad` server function and apply it before any query runs, for example with `queryClient.setDefaultOptions`, or keep a keyed remount at the `_app` boundary. This is an implementation decision. Nothing in the TanStack docs covers it.
2. Product routes are `ssr: false`, so the SSR dehydrate path is mostly idle, but the integration is still correct and harmless. Browser persistence (`query-cache-hydration.ts`) continues to run client-side.

**oRPC.** The web app uses a raw `createORPCClient` + `RPCLink` (browser URL `/api/rpc`) with hand-written `queryKeys`. It does not use `@orpc/tanstack-query`, and nothing requires adopting it for this migration. The oRPC TanStack Start adapter ([orpc.dev/docs/adapters/tanstack-start](https://orpc.dev/docs/adapters/tanstack-start)) mounts an oRPC handler in a `/api/rpc/$` server route and uses `createIsomorphicFn` + server-side `createRouterClient`. It does **not** apply, because the oRPC router lives in the API Worker. Server-side calls, such as admin loaders and the `/auth` check, keep `createServerRpcClient`. Swap `next/headers` for `getRequestHeaders()`, `getWorkerEnvironment()` for `env`, `next/navigation` `redirect/notFound` for `throw redirect({ href })` / `throw notFound()`, and route the `fetch` through `env.API.fetch`. If server-prefetched oRPC queries are ever added, the oRPC Query integration requires an `RPCJsonSerializer` in dehydrate/hydrate, and `setupRouterSsrQueryIntegration` accepts `dehydrateOptions.serializeData` / `hydrateOptions.defaultOptions.deserializeData` for that ([orpc.dev/docs/integrations/tanstack-query](https://orpc.dev/docs/integrations/tanstack-query), Router docs `integrations/query.md`).

## 7. Fonts, CSS, theming, analytics

- **Tailwind v4:** use `@tailwindcss/vite` and drop `@tailwindcss/postcss`/`postcss.config.mjs`. Start docs `guide/tailwind-integration.md` uses `@import 'tailwindcss' source('../');` so class detection is scoped. Workspace packages that contain classes need explicit `@source` lines, as they would with PostCSS.
- **Global CSS:** use either `import appCss from "../styles/globals.css?url"` with `head: () => ({ links: [{ rel: "stylesheet", href: appCss }] })` (explicit, discovered only after `head()` runs, not inlined) or a side-effect `import "../styles/globals.css"` in `__root.tsx` (manifest-managed, static Early Hints, eligible for `server.build.inlineCss`) (Start docs `guide/css-styling.md`). Recommendation: side-effect import in `__root.tsx`. `@pcobooster/design-tokens/tokens.css` continues to be `@import`ed from it.
- **Fonts:** `next/font/local` has no equivalent. The migration guide says to replace it with "self-hosted font files, a package such as Fontsource, or another chosen font delivery method … set an appropriate `font-display`" (Start docs `migrate-from-next-js.md`). The apps already depend on `@fontsource-variable/inter` and `@fontsource-variable/geist-mono`. Import their CSS once in the root, define `--font-inter`/`--font-geist-mono` in `globals.css` to the Fontsource family names, and check layout shift. `next/font` generated fallback metrics that this setup does not.
- **Theme without flash:** replace `next-themes` with a small provider plus `ScriptOnce` in the shell, and add `suppressHydrationWarning` on `<html>`. `ScriptOnce` "renders a `<script>` during SSR … executes immediately … before React hydrates … removes itself … On client-side navigation, nothing is rendered" (Router docs `guide/document-head-management.md`, "Inline Scripts with ScriptOnce"; `ScriptOnce.tsx` in the react-router source). Keep the localStorage key `theme` and the `light | dark | system` values, so existing preferences survive; `next-themes@0.4.6` defaults `storageKey` to `"theme"` (`dist/index.mjs`), and the app passes `attribute="class"`.
- **PostHog:** `instrumentation-client.ts` has no Start counterpart. Call `initializeAnalytics(import.meta.env.VITE_POSTHOG_KEY, import.meta.env.PROD)` from a custom `src/client.tsx` before `hydrateRoot(document, <StartClient/>)` (Start docs `guide/client-entry-point.md`), or from a root `useEffect`. The `/auth`-only and demo-exclusion logic stays as-is. PostHog's TanStack Start guide wraps the shell in `<PostHogProvider apiKey options={{ api_host, defaults: '2026-05-30' }}>` from `@posthog/react` ([posthog.com/docs/libraries/tanstack-start](https://posthog.com/docs/libraries/tanstack-start)). The repo's `@pcobooster/analytics` package already encapsulates init, so reuse it rather than adding the provider.

## 8. Testing, typecheck, build

- **Vitest:** the root `vitest.config.ts` is standalone (`vitest/config`, `environment: "node"`, include `apps/*/src/**/*.test.ts`) and does not load app Vite configs. The Start plugin is not needed for these unit tests, which contain no route components. Keep it standalone and extend the `cloudflare:workers` alias stub. Route-level tests, if added later, belong in a separate project config (Router docs `how-to/setup-testing.md`, `how-to/test-file-based-routing.md`).
- **Typecheck:** replace `next typegen && tsc --noEmit` with `tsc --noEmit`. This needs the committed `routeTree.gen.ts`. After adding or renaming routes, regenerate with `vite dev`/`vite build` or `tsr generate` (`@tanstack/router-cli`). The official example's build script is `vite build && tsc --noEmit` ([example `package.json`](https://github.com/TanStack/router/blob/%40tanstack/react-start%401.168.58/examples/react/start-basic-cloudflare/package.json)).
- **Output:** `vite build` writes `<outDir>/client` and `<outDir>/server` with `outDir` default `dist` (`start-plugin-core` `src/vite/output-directory.ts`). Alchemy does **not** consume `dist/` from a separate build step. It runs its own `createBuilder().buildApp()`, captures the client directory and server chunks via its `alchemy:build-output` plugin (`Bundle/Vite.ts`), and uploads them. Turborepo `build` is therefore a validation build, not the deploy artifact. Update `turbo.json` outputs to `dist/**` for web/admin/marketing and drop the `.next/**` entries. Web `build` still depends on marketing being built and staged first.
- **Lint:** `oxlint.config.ts` already extends `ultracite/oxlint/tanstack` and `tanstack/js-plugins` (React Doctor rules such as `tanstack-start-missing-head-content`, `tanstack-start-no-anchor-element`, `tanstack-start-server-fn-validate-input`, `tanstack-start-route-property-order`, `tanstack-start-no-secrets-in-loader`). The `next` and `nextJsPlugins` presets were removed once no Next app remained. The TanStack preset turns off `sort-keys` because "TanStack option objects are order-sensitive" for inference (`config/oxlint/tanstack/index.mjs`).

## 9. Pitfalls and API names at the latest release

Current names, verified against source:

| Older/other name | Current (1.168.58) | Evidence |
| --- | --- | --- |
| `createServerFileRoute`, `createAPIFileRoute` | `createFileRoute(path)({ server: { handlers } })` | no occurrence in any published start/router package source; Start docs `guide/server-routes.md` |
| `getWebRequest()`, `getHeaders()`, `getEvent()` | `getRequest()`, `getRequestHeaders()`; no event API | `start-server-core` `src/request-response.ts` exports |
| `.inputValidator()` | `.validator()` (inputValidator is `@deprecated` alias) | `start-client-core` `src/createServerFn.ts`, `src/createMiddleware.ts` |
| `router.tsx` `createRouter` export | `export function getRouter()` | `hydrateStart.ts` imports `getRouter` |
| `NotFoundRoute` | `notFoundComponent` + `notFound()` | Router docs `guide/not-found-errors.md` (deprecated) |
| `vite-tsconfig-paths` | `resolve.tsconfigPaths: true` (Vite 8) | Start docs `guide/path-aliases.md` |
| `@tanstack/zod-adapter` for zod | pass zod 4 schema directly | adapter peer `zod ^3.23.8`; Router docs search-params |
| Vinxi / `app.config.ts` | `vite.config.ts` + `@tanstack/react-start/plugin/vite` | `@tanstack/react-start` exports `./plugin/vite`, `./plugin/rsbuild`, `./server-entry`, `./server`, `./client`, `./server-only`, `./client-only` |

Pitfalls:

- **Module-scope env and I/O:** read `env` per request, and never call bindings at top level (section 2).
- **Isomorphic loaders:** secrets in a loader leak to navigation-time client execution. Use server functions (Start docs `guide/execution-model.md`; React Doctor `tanstack-start-no-secrets-in-loader`).
- **QueryClient per request**, created in `getRouter` (section 6).
- **Defining `src/start.ts` turns off automatic CSRF.** Add `createCsrfMiddleware` yourself (section 4).
- **`verbatimModuleSyntax`** can leak server code into client bundles (Start docs `build-from-scratch.md`).
- **Prerender under Alchemy:** `prerenderWithVite` calls `vite.preview({ configFile })`. It does not include Alchemy's inline plugin, and `ALCHEMY_CLOUDFLARE_VITE_INJECTED=1` makes a guarded config-file plugin stand down, so a web/admin prerender would run in plain Node without bindings (`start-plugin-core` `src/vite/prerender.ts`; Alchemy `Sources/Vite.ts`). Keep `prerender` and `spa` off for Alchemy-deployed apps. Marketing prerenders outside Alchemy.
- **Private caching:** return `Cache-Control: private, no-store` on session-dependent HTML and server functions. The docs call `public` on identity-dependent responses a "cross-tenant data leak" (Start docs `guide/server-functions.md`).
- **Hydration mismatches** from `Date.now()`, `Intl`, or viewport: `ssr: false` product routes avoid most of them. On SSR routes use `<ClientOnly>` or compute locale/time zone deterministically (Start docs `guide/hydration-errors.md`). This matters for the org-timezone calendar helpers.
- **Next conventions don't carry over:** metadata files, `next/image`, `revalidatePath`, `server-only`, `"use client"` (it becomes a no-op and can be removed), `export const dynamic`, and `next.config` headers. Admin's `X-Robots-Tag`/`Referrer-Policy` headers move to a request middleware (`setResponseHeader`) or route `headers` (Start docs `migrate-from-next-js.md`).
- **Alchemy dev port/HMR and plugin order** are unverified at runtime (section 1).
- **Memo does not hash env.** Admin's `base` depends on `ADMIN_BASE_PATH`, which `alchemy.run.ts` sets on `process.env`. The build child inherits it (`ViteChild.ts`, `extendEnv: true`), but it is absent from the input hash. Keep `prepareCloudflareBuild`'s stamp for admin, or pass the value in a hashed file.

The official migration guide exists at Start docs [`migrate-from-next-js.md`](https://github.com/TanStack/router/blob/%40tanstack/react-start%401.168.58/docs/start/framework/react/migrate-from-next-js.md), with a runnable before/after example at `examples/react/start-next-migration`. Its main themes: inventory paths, redirects, metadata, and status codes first; move privileged reads into server functions; map each cache and invalidation explicitly; keep the old app runnable until contract checks pass.

## Recommended conventions for this repo

1. **Toolchain:** Vite `8.3.x`, `@tanstack/react-start 1.168.58`, `@tanstack/react-router 1.170.39` (exact, matching Start's pin), `@vitejs/plugin-react 6.1.x`, `@tailwindcss/vite 4.3.x`, and `@tanstack/react-router-ssr-query 1.167.3` (web only). No `@tanstack/router-plugin`, `vite-tsconfig-paths`, `@tanstack/zod-adapter`, `server-only`, `next-themes`, or `@opennextjs/cloudflare`.
2. **Deploy:** `Cloudflare.Website.Vite` for web and admin, with `rootDir`, `compatibility`, `dev: { host: "127.0.0.1", port, strictPort: true }`, `memo: { lockfile: true }`, and bindings unchanged. Rename public env to `VITE_*` on the resource's `env`. Do not use `@alchemy.run/frontend-frameworks`.
3. **Vite config:** `tailwindcss()`, a guarded `cloudflare({ viteEnvironment: { name: "ssr" } })` (skipped when `ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1"`), `tanstackStart()`, `viteReact()`, and `resolve.tsconfigPaths: true`. No `wrangler.jsonc`. If the inline-config spike fails, drop the standalone plugin and treat Alchemy as the only build.
4. **Layout per app:** `src/router.tsx` (`getRouter`), `src/start.ts`, `src/routes/**`, `src/styles/globals.css`, and a committed `src/routeTree.gen.ts`. Server-only modules are named `*.server.ts`, server functions `*.functions.ts`. Colocated non-route files in `routes/` use a `-` prefix.
5. **Env access:** `import { env } from "cloudflare:workers"` only inside handlers or middleware, typed by a `cloudflare:workers` module declaration in `src/worker-env.d.ts`. Client code uses `import.meta.env.VITE_*`/`DEV`/`PROD`. No `process.env` reads in app code.
6. **SSR mode:** web has an SSR root shell, a pathless `_app` layout, `ssr: "data-only"` product routes with skeleton `pendingComponent`s, and SSR for `/auth` and `/demo/$key`. Admin uses full SSR with loaders calling server functions. Neither uses `spa`, `prerender`, or global `defaultSsr: false`.
7. **Auth:** a global request middleware in `web/src/start.ts` ports `proxy.ts` exactly (www 308, public paths, `/api`/`/admin`/`/auth`/serverFn passthrough, demo headers, `getSessionCookie` presence redirect to `/auth?next=`), listed after `createCsrfMiddleware({ filter: serverFn })`. `beforeLoad` + server function is used only on `/auth` and admin's root for session validity. The API Worker remains the authorization boundary. Set `Cache-Control: private, no-store` on session-dependent responses.
8. **Proxies:** `routes/api/$.ts` and `routes/admin/$.ts` use `ANY` handlers that call `env.API.fetch(request)` / `env.ADMIN.fetch(request)`. `routes/index.ts` and `routes/about.ts` serve staged marketing HTML through `env.ASSETS`. The Next dev rewrites are removed once `alchemy dev` proves local bindings.
9. **Admin basepath:** `vite.config.ts` sets `base: process.env.ADMIN_BASE_PATH ? \`${process.env.ADMIN_BASE_PATH}/\` : "/"`. `alchemy.run.ts`already sets`/admin`for local and`pr-*`, and `""`for prod. The router basepath and`/admin/_serverFn/`follow automatically. Never set`basepath`in`createRouter`. The 401 redirect goes to `${PRODUCT_ORIGIN}/auth?next=/admin`via`redirect({ href })`.
10. **Marketing:** a Start app with `prerender.enabled`, `crawlLinks: false`, `autoSubfolderIndex: false`, `failOnError`, `base: "/marketing/"`, `router.basepath: "/"`, and no Cloudflare plugin. `bun run build` then `stage-marketing.ts` copies `dist/client` into `apps/web/public/marketing/`. It stays independent of product components and shares only design tokens.
11. **Data:** web creates the `QueryClient` in `getRouter` with `setupRouterSsrQueryIntegration`. Keep the raw oRPC client and `queryKeys`; `presentationScope` is a build-time `define`. Admin calls oRPC server-side through `env.API` inside server functions.
12. **Quality gates:** commit `routeTree.gen.ts`; `typecheck` = `tsc --noEmit`; root Vitest unchanged apart from binding stubs; turbo `build` outputs `dist/**`; drop the `next` lint presets after the last Next app is removed.

## Implementation notes: admin (verified September 23, 2026)

The admin migration tested the recommendations above. The following points were confirmed at runtime or changed from the conventions.

Confirmed at runtime:

- Under `alchemy dev --stage local`, the injected plugin runs Start correctly with the app's plugin order (`tailwindcss`, guarded `cloudflare`, `tanstackStart`, `viteReact`). SSR, server functions, and the `API` service binding to the local `Api` Worker all work. The Worker's `dev.port` (3003) fronts the Vite dev server. The product's Next.js dev rewrite to `127.0.0.1:3003/admin/*` still works. Vite's HMR websocket does not survive that rewrite; open 3003 directly for HMR.
- The standalone `@cloudflare/vite-plugin` works with inline `config` and no wrangler file. With a custom server entry, set `config.main` to it (`./src/server.ts`). `vite build` emits `dist/server/wrangler.json`, which `wrangler dev -c dist/server/wrangler.json` can run to exercise the production bundle.
- `vite preview` with the Cloudflare plugin does not serve client assets under a non-root `base` (`/admin/assets/*` returns 404). Alchemy keys uploads by `base`, so this limitation is local only. Check SSR with `ADMIN_BASE_PATH=""` or with `wrangler dev`.

Deviations from the conventions:

- **Base fallback (convention 9).** `base` is `ADMIN_BASE_PATH` when set; otherwise it is `/admin/` for the dev server and `/` for builds and `vite preview` (`resolveAdminBase` in `apps/admin/src/lib/base-path.ts`). This keeps Next's dev default and does not depend on `alchemy.run.ts`'s `process.env` write reaching Alchemy's dev host.
- **Bare mount path needs a custom server entry.** _(Removed once the product forwarded `/admin` and `/admin/` unchanged: Start's own `/admin` → `/admin/` redirect no longer loops, so admin uses the default entry.)_ Start treats `/admin/` as the canonical index URL and 307-redirects `/admin` to it (`loadServerRoute` in `router-core` `src/load-server.ts`). The product's Next.js route 308-redirects `/admin/` to `/admin`, so every preview would loop. `apps/admin/src/server.ts` rewrites `/admin` to `/admin/` internally. A small Vite plugin does the same for Vite's dev/preview base guard, which otherwise 404s `/admin`. Layer 3 (web) should forward both `/admin` and `/admin/*` without trailing-slash redirects.
- **Env typing (convention 5).** Admin uses the DOM lib, and loading `@cloudflare/workers-types` globally clashes with DOM `Request`/`Response`. `src/worker-env.d.ts` therefore redeclares `cloudflare:workers` with only the bindings admin reads (the `packages/api` pattern). It does not augment `Cloudflare.Env`.
- **Response headers.** `setResponseHeader(s)` in request middleware is not merged into non-2xx responses: h3 `prepareResponse` returns early when `!response.ok`. That drops headers from 404s, 500s, and redirects. Admin's middleware sets headers on `(await next()).response` instead. Start creates those responses, so their headers are mutable.
- **`head()` dedupes meta by `name`** (`headContentUtils.tsx`): only the last `theme-color` survives. Per-scheme `theme-color` tags are rendered directly in the shell's `<head>`.
- **Same-origin external redirects.** `router.resolveRedirect` turns an absolute `href` on the current origin into a path, and client navigation then resolves it inside the basepath. For example, `/auth` became `/admin/auth` in previews. Redirects to product pages from a basepath app need `reloadDocument: true`.
- **Lint.** `throw redirect()`/`throw notFound()` trips `typescript/only-throw-error`. Use `redirect({ …, throw: true })` / `notFound({ throw: true })`. Where narrowing is needed, use a typed `asserts` helper (`apps/admin/src/lib/assert-found.ts`). The Next.js oxlint presets were turned off for Start apps through an `overrides` entry until the last Next app was removed; both are gone now.

## Implementation notes: marketing (verified September 23, 2026)

Marketing follows convention 10: a Start app with `prerender.enabled`, `failOnError`, Vite `base: "/marketing/"`, router `basepath: "/"`, no Cloudflare plugin, and no Alchemy resource. `dist/client` holds `index.html`, `about.html`, `assets/`, and the `public/` files, and `scripts/stage-marketing.ts` copies it into `apps/web/public/marketing/`. The web route handlers are unchanged. The prerendered pages match the Next.js export: identical visible text, the same title, description, canonical, Open Graph, Twitter, and icon tags, and pixel-identical full-page screenshots at 1440px. The product-demo replica hydrates and stays interactive.

Confirmed at runtime:

- The dev server supports the misaligned base and basepath. Start's dev base-rewrite middleware serves `/` and `/about` on 3002, and the product's Next.js dev rewrites (`/`, `/about`, `/marketing/*` to 3002) work unchanged, including `/marketing/@vite/client` and `/marketing/@fs/…` module URLs.

Deviations from the conventions:

- **The preview server does not support the misaligned base, and prerendering depends on it.** Vite's preview base guard 404s `/about` (and 302s `/` to `/marketing/`). Start's preview handler then re-prefixes the base (`joinURL(server.config.base, req.url)` in `preview-server-plugin/plugin.ts`), so the router, whose basepath is `/`, receives `/marketing/about`. Two small shims fix this. A `configurePreviewServer` middleware in `vite.config.ts` prepends the base to page URLs so the guard accepts them. A custom server entry, `src/server.ts`, strips the base before the Start handler. The logic is in `src/lib/base-path.ts`, with tests. The research claim that misalignment is "explicitly supported" holds only for the dev server.
- **`crawlLinks: false`.** Crawling follows every `<a>`, including product links such as `/services`. Those 404 in the marketing app, and `failOnError` fails the build. Hash links (`/#features`) were also written as duplicate pages. Static routes are discovered from the route tree, which covers `/` and `/about`.
- **`autoSubfolderIndex: false`** keeps `about.html` rather than `about/index.html`, so the product's `/about` route handler needs no change.
- **PostHog key.** `vite.config.ts` inlines the shared Infisical secret `POSTHOG_PROJECT_KEY` (formerly `NEXT_PUBLIC_POSTHOG_KEY`) as `import.meta.env.VITE_POSTHOG_KEY` through `define`, as the product does. Analytics starts in a custom `src/client.tsx`, before `hydrateRoot`.
- **Fonts.** Marketing, like admin, imports `@fontsource-variable/inter/wght.css` and preloads the latin file through a `?url` import. `next/font`'s generated size-adjusted fallback face is gone. The screenshots show no layout difference once the font has loaded. In dev only, the preload URL differs from the stylesheet's `@fs` URL, so Chrome warns that the preload was unused.
- **No 404 page is emitted.** The Next export's `404.html` was never served; the product owns every non-marketing URL. A root `notFoundComponent` covers the dev server only.
- **Build hashing.** `scripts/cloudflare/prepare.ts` hashes `apps/marketing`. It now skips `dist` and `.tanstack` instead of `out`, so build outputs never change the Alchemy rebuild key.

For layer 3 (web on Start): keep serving the staged files from `env.ASSETS` at `routes/index.ts` (`/marketing/index.html`) and `routes/about.ts` (`/marketing/about.html`). Web's Vite `base` must stay `/`, and web's own assets must not use `/marketing/`. `public/marketing` is copied into web's client output by Vite's `publicDir`, so Alchemy uploads it with the other assets. `bun run build` must keep staging marketing before web's build (today through `apps/web/package.json` `build` and the OpenNext `buildCommand`). In dev, replace the Next.js rewrites with Vite `server.proxy` entries for `/`, `/about`, and `/marketing` to `127.0.0.1:3002`, or with a dev-only route that fetches from 3002. Marketing is not an Alchemy resource and does not need to become one.

## Implementation notes: web (verified September 23, 2026)

The product follows the conventions above with the deviations below. Signed-out gating, marketing, `/auth`, demo entry, and the `/api` and `/admin` passthroughs were checked in the browser and with `curl` against the Next.js app on `main`. Signed-in routing, navigation, the app shell, theme, hotkeys, and sign-out were checked with a temporary local session.

Confirmed at runtime:

- Under `alchemy dev`, `Cloudflare.Website.Vite` serves the product on 3001 with working `API` and `ADMIN` service bindings, so `/api/*` and `/admin/*` forward through the bindings locally and the Next.js dev rewrites are gone. Vite's `server.proxy` runs before Alchemy's post-order Worker middleware, so it proxies `/`, `/about`, and `/marketing/*` to the marketing dev server on 3002.
- The standalone `@cloudflare/vite-plugin` needs `main: "@tanstack/react-start/server-entry"` in its inline config when the app has no custom server entry. Without `main` the plugin builds an assets-only Worker, and the `ssr` build cannot resolve `cloudflare:workers`.
- The request gate matches `proxy.ts` status for status, header for header, and `Location` for `Location` (relative, as Next.js sent it). The one intended difference is `/admin/`. Next.js 308-redirected it to `/admin`; the product now forwards it unchanged, as layer 1 recommended.
- Route `params.parse` runs on the server even for routes that skip server rendering. An invalid plan view throws `notFound()` from `params.parse` and returns a server 404.

Deviations from the conventions:

- **SSR mode (convention 6).** `_app` renders the app shell on the server, and each product page is `ssr: "data-only"` with its skeleton as `pendingComponent`. With `ssr: false`, `beforeLoad` does not run on the server, so the People gate and the plan index redirect would return 200 and act only after hydration. `data-only` keeps server status codes while components still render in the browser. The first paint matches Next.js: navigation chrome plus the `loading.tsx` skeleton.
- **Not-found inside the shell.** A `notFoundComponent` on a pathless layout replaces that layout's component. Not-found errors from product routes therefore bubble to the root, whose `notFoundComponent` wraps the page in the app shell.
- **Presentation scope and `PEOPLE_PAGE_ENABLED` (sections 6 and 2).** Both are build-time `define`s in `vite.config.ts` instead of a root server function. They were build-time values under Next.js too: the build fingerprint and Alchemy stamp tracked `PEOPLE_PAGE_ENABLED`, and presentation mode exists only on the dev server. As constants, the scope is available synchronously when `getRouter` creates the query client, and no request pays a round trip. `<html data-presentation-scope>` is still rendered, and the browser caches read it as before. _(Later: `PEOPLE_PAGE_ENABLED` was replaced by the Flagship-backed `people` flag, loaded by the `_app` route and checked in the People routes' `beforeLoad`.)_
- **Search serialization.** The router's default `parseSearch` turns `?teamId=12` into the number 12, and its default `stringifySearch` writes the string `"12"` as `%2212%22`. The product passes `URLSearchParams`-based serializers (`src/lib/search-params.ts`), so URLs keep their Next.js shape and zod schemas see strings. Zod's `.catch()` trips the promise lint rules, and the fixer rewrites `.catch(undefined)` to `.catch()`. Repeated keys are therefore handled with `.or(z.array(...).transform(...))`.
- **In-place History API navigation removed.** Next.js needed `history.pushState` to switch plan views and person months without a server round trip. Router navigation to another `$view` or `month` keeps the page mounted and renders from the query cache, so the shortcuts and `usePlanWorkspaceView` were deleted.
- **Theme.** `next-themes` is replaced by `components/theme-provider.tsx` and a `ScriptOnce` script. They use the same `theme` storage key and values. The script is the `toString()` of a function, which a test runs in a VM context. The provider writes the DOM only in response to preference, OS, or cross-tab changes, never in a render effect: `useSyncExternalStore` hydrates with the server snapshot, so an effect would briefly apply the wrong theme.
- **Staging marketing under Alchemy.** Alchemy runs `buildApp` with no pre-build hook, so a `buildApp` (`order: "pre"`) plugin in `vite.config.ts` runs `bun run build:marketing` when `ALCHEMY_CLOUDFLARE_VITE_INJECTED=1`. Standalone builds only copy the marketing output that Turborepo or `build:cloudflare` already built. The web memo excludes `public/marketing/**`; the stamp's hash of `apps/marketing` stands in for it.
- **CI.** Alchemy's Vite source runs its own build and cannot consume `dist/` from `cloudflare-build`. The prebuilt-output tarball, its build fingerprint, and the Next.js compiler cache action were removed. `cloudflare-build` remains a validation build.

Known gap, unchanged from `main`: in the local stage, the API Worker does not see `DEV_AUTH_BYPASS` or `PRESENTATION_MODE` as enabled. `session.status` stays unauthenticated with `DEV_AUTH_BYPASS=1` on both branches. The product side honors both: its gate reads the `DEV_AUTH_BYPASS` binding, and presentation scope comes from the dev server's environment.
