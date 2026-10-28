# pcobooster.com marketing site

The public site is a separate TanStack Start app at `apps/marketing`, prerendered to static HTML at build time. It is a sibling of the product in `apps/web` and the API Worker in `apps/server`; Bun workspaces and Turborepo provide one lockfile and an ordered build graph.

## Development

- `bun run dev`: API on port 3000, product on port 3001, and marketing on port 3002 in the main checkout. Worktrees get their own ports; see [local ports](environment.md#local-ports).
- `bun run dev:present`: the same, with anonymized Planning Center people in the product.
- `bun run dev:marketing`: marketing only, with no database, Keychain, OAuth, or session requirement.

Use the product port (3001 in the main checkout) to test the whole journey, including Open app. In development, the product forwards `/api/*` to the local API Worker through its service binding and proxies `/`, `/about`, and `/marketing/*` to the marketing port (3002). Marketing uses full document navigation so it never asks the product router to load a marketing page (or vice versa).

The marketing dev server is Vite. Its assets are served under `/marketing/` while its pages route at `/` and `/about`; Start rewrites the page requests internally. Vite's HMR websocket may not survive the product's proxy, so open the marketing port directly for hot reload. Styling uses Tailwind and marketing's own shadcn primitives (`src/components/ui`, Base UI, the same `base-luma` style as the product) on the product's design tokens; the interactive replica keeps its CSS modules. The phone menu comes from `@pcobooster/ui/mobile-menu`, which the product's phone header uses too. Marketing does not import other product UI, authentication, or providers.

## Key transition finder

`/key-transitions` is a public, prerendered tool page for search: a visitor picks two keys and gets the product's own rating and advice from `@pcobooster/planning-center-models/key-transition-advice` (`src/lib/key-transition-tool.ts`). It opens on G into Bb so the prerendered HTML carries real advice.

Every pair of the 24 keys also has its own page, such as `/key-transitions/g-to-b-flat` (`src/routes/key-transitions_.$pair.tsx`, slugs in `src/lib/key-transition-pages.ts`), with its own title, description, canonical URL, and links to the reverse change and to every change out of and into its keys. One dynamic route renders all 576, so `vite.config.ts` lists them in Start's `pages` to prerender them into `key-transitions/<slug>.html`. Picking new keys on a pair's page moves to that pair's URL. The product serves `/key-transitions` and `/key-transitions/<slug>` from `public/marketing` through its own server routes.

Start writes `sitemap.xml` from the same page list at build time, and the product serves it at `/sitemap.xml`; add a page to `SITE_PAGES` in `vite.config.ts` to list it.

## Build and deployment

Run `bun run build` from the repository root. It:

1. Builds `apps/marketing` with `vite build`, which prerenders `/` and `/about` to `dist/client/index.html` and `dist/client/about.html` beside their `assets/`.
2. Stages `dist/client` into the ignored, generated `apps/web/public/marketing` directory (`scripts/stage-marketing.ts`).
3. Builds the product.

The product is a TanStack Start app deployed with Alchemy's `Cloudflare.Website.Vite`. Vite copies the staged files into the product's client assets, which Alchemy uploads. Alchemy's build has no pre-build hook, so a plugin in `apps/web/vite.config.ts` runs `bun run build:marketing` first when Alchemy drives the build; standalone builds stage the marketing build Turborepo already ran. The product's `/` and `/about` server routes fetch `/marketing/index.html` and `/marketing/about.html` from the `ASSETS` binding.

Marketing assets use `/marketing` (the Vite `base`), avoiding collisions with the product's `/assets` chunks. Those exact public routes bypass the product's sign-in gate (`apps/web/src/lib/request-gate.ts`); `/services`, `/people`, and product APIs retain their existing authentication behavior. In development the product's Vite server proxies `/`, `/about`, and `/marketing/*` to the marketing dev server on its checkout's marketing port.

Prerendering runs only at build time. Start serves the pages through `vite preview` while it writes them; `src/server.ts` and a preview middleware in `vite.config.ts` reconcile the `/marketing/` asset base with the `/` page paths there. Nothing marketing-specific runs on a server in production. Titles, descriptions, canonical URLs, and the Open Graph/Twitter card come from `src/lib/site-head.ts`.

`bun run ci` checks both apps' types, shared lint/formatting, and the complete test suite. The public-path tests cover the marketing allowlist and near-miss routes.

## Content and screenshots

The working product strategy informed the positioning, but its proposed prices, seats, future features, and older naming are not commitments. Public copy uses pcobooster.com. The site says PCOBooster is free during beta and promises only two things about pricing: users hear about any paid plan before it arrives, and nothing is charged without opting in. It names no notice period, price, or discount. There is no checkout or fabricated waitlist submission.

The home page tells one story: PCOBooster is the workspace ministry leaders use on top of the Planning Center Services they already have, and every change saves back. Sections follow the jobs of a planning week (filling teams, caring for people, songs and charts, then the smaller jobs), each backed by a live piece of the replica rather than a screenshot. Copy only claims behavior the product ships today.

The product visuals are the interactive replica in `src/components/product-demo` (fictional people, original sample songs and charts; no screenshots). It mirrors the product's plan views (Overview, Assign, Lineup, Plan, Times) plus People, Songs, and the chord chart editor, with fit scores, the four-week history bars, slot steppers, team health, and transposition through the product's own `@pcobooster/planning-center-models/chord-chart` rules. The full replica opens on Assign; the page's sections embed showcases (`LineupShowcase`, `HistoryShowcase`, `PeopleShowcase`, `ChordChartShowcase`), and the feature tiles (`src/components/feature-tiles.tsx`, static crops of product UI) jump the full replica to a view with `openInDemo`. The phone and tablet apps are listed as coming soon until they ship. When the product's interface changes, update the replica to match: the fixtures, model (`demo-model.ts`), and CSS modules are marketing's own, built on the shared design tokens. The sample plan uses a fixed date so prerendered HTML is deterministic; format dates with the model's UTC helpers, never `toLocale*`.

The site reuses the product’s rocket logo and Inter typography, without decorative eyebrow labels. Decorative SVG motion lives in `src/components/graphics`: it animates only `transform` and `opacity`, pauses offscreen (`LoopWhenVisible`), stops under `prefers-reduced-motion`, and every graphic's resting frame is complete, so prerendered HTML reads the same without JavaScript. Scroll reveals use CSS scroll-driven animations and leave content visible where unsupported. It states that pcobooster.com is not affiliated with, sponsored by, or endorsed by Planning Center. References: [Planning Center developers](https://www.planningcenter.com/developers) and [branding guidelines](https://www.planningcenter.com/logos). This is compatibility wording, not a claim of directory listing or official partner status.
