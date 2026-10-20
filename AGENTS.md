# Repository Guidelines

## Product Naming

- Public/product naming should use `pcobooster.com`.
- Avoid introducing old product names in new docs, UI copy, or PR descriptions unless referring to historical context.

## Project Structure & Module Organization

- `apps/web/`: TanStack Start product UI on Cloudflare Workers. File routes live in `apps/web/src/routes` (`src/routeTree.gen.ts` is generated and committed); the sign-in gate and other request middleware in `src/start.ts`; components, hooks, and public assets under `apps/web/src` and `apps/web/public`.
- `apps/server/`: the API Worker, an Alchemy Effect-native `Cloudflare.Worker` (`src/worker.ts`) that reads its settings with `Config` at startup, binds D1, the Planning Center cache KV namespace, and the read-only iOS update bucket (`src/mobile-update-bucket.ts`), builds one Effect `HttpRouter` (`src/http-app.ts`: the product API under `/api/v1`, Better Auth, the iOS app's over-the-air update routes, liveness, CORS, the cache policy, and disconnect handling) once per isolate in its constructor, and hands each request the isolate's server dependencies. `src/database.ts` declares the D1 database and its `Drizzle.Schema`; `src/stage.ts` derives per-stage origins for both the Worker and `alchemy.run.ts`.
- `apps/marketing/`: independent marketing site, a TanStack Start app prerendered to static files. Its interactive product replica lives in `apps/marketing/src/components/product-demo/` with fictional fixtures; it shares design tokens and shared UI from `packages/ui` (currently the phone menu) with the product; its own primitives stay in `apps/marketing/src/components/ui`.
- `apps/admin/`: private full-stack TanStack Start admin app for `admin.pcobooster.com`, deployed as its own Cloudflare Worker behind Cloudflare Access. Its server functions read D1 through the Worker's own binding using `packages/api` modules; the public API has no admin procedures. See `docs/admin.md`.
- `apps/video/`: the Remotion launch video (15s, 30s, and ~64s cuts, each in 16:9 and 9:16). It drives the marketing replica frame by frame through scripted beats; `bun run --cwd apps/video render` writes MP4s to its ignored `out/`. See `apps/video/README.md`.
- `packages/design-tokens/`: product color and radius tokens (`tokens.css`, light on `:root`, dark under `.dark`) shared by `apps/web` and the marketing replica.
- `packages/ui/`: UI shared by `apps/web` and `apps/marketing`, one export per component (`@pcobooster/ui/mobile-menu`). Components are primitive-free (each app supplies its own buttons and headers) and styled with Tailwind utilities that exist in both apps; each app `@source`s `packages/ui/src` and imports a component's CSS (`@pcobooster/ui/mobile-menu.css`) when it has one.
- `packages/contracts/`: browser-safe Effect HttpApi contracts (`src/http/`: every endpoint is declared once with `read`, `read.post`, or a `write.<method>` inside `planningCenterGroup` or `plainGroup`, composed into `ProductApi`, `ProductWireApi`, and the `procedureRoutes` table), and product fault classes (`src/faults/`). The HttpApi Effect schemas are the one definition of every shape: the server, the client, and browser and Expo caches all decode with them.
- `packages/planning-center-models/`: browser-safe Planning Center shapes and pure calendar/scheduling rules.
- `packages/presentation-mode/`: server-side presentation-mode guard, seed, and cache namespace.
- `packages/api/src/application/`: Effect programs and typed application faults.
- `packages/api/src/modules/`: server business behavior grouped by the external capability it implements.
- `packages/api/src/http/`: the API server: `ProcedureScope` and `PlanningCenterSession` middleware, one outcome line per procedure, the unknown-path answer, and `handlers/` (one `handle` line per endpoint, delegating to an application program).
- `packages/client/`: the one product client (`makeProductClient`, over Effect's `HttpApiClient`) for web, SSR, Expo, and the deploy check, plus `failureStatus`, the request scheduler, and the TanStack Query helpers.
- `packages/api/src/planning-center/services/`: Planning Center API service wrappers (raw API access only).
- `packages/api/src/db/` and `packages/api/migrations/`: Drizzle client, schema, and migrations.
- `packages/config/`: shared TypeScript configuration.
- Tests stay colocated beside source (`packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts`).

## Build, Test, and Development Commands

- Use Bun for dependency management and scripts. `bun.lock` is the only committed lockfile; do not add `package-lock.json` or run npm-based install workflows for this repo.
- `bun run dev`: start API, product, and admin through Alchemy, plus the marketing dev server, signed in with the pinned free Planning Center sandbox PAT from Keychain (`sandbox` scope; see `docs/planning-center-sandbox.md`). The main checkout uses ports 3000 to 3003 (API, product, marketing, admin); each linked worktree gets its own block from its path, so worktrees can run dev at once. `DEV_PORT_BASE=<port>` overrides the block. The command prints the product URL.
- `bun run dev:church`: inspect the pinned Agape account with provider writes blocked. `dev:church:write` enables real church writes and requires explicit user authorization for the specific mutation.
- `bun run dev:auth`: the same with real Planning Center OAuth, on the main ports (the OAuth callback is registered for `127.0.0.1:3001`). Use it only to test sign-in.
- `bun run build`: build the Vite apps through Turborepo. Alchemy bundles the API Worker itself on `dev`/deploy.
- `bun run check` (also `lint`): run Ultracite formatting and type-aware lint checks; warnings fail the check. All selected presets in `oxlint.config.ts` remain strict.
- `bun run lint:ci`: same as `lint` with `--format github` for Action annotations (used by CI).
- `bun run fix` (also `lint:fix`): apply Ultracite fixes and formatting. Review fixes and run validation afterward.
- `bun run ci`: run the strict local CI gate: check, typecheck, and the complete test suite.
- `bun run typecheck`: run TypeScript checks (`tsc --noEmit`).
- `bun run test`: run Vitest test suite once.
- `bun run test:watch`: run Vitest in watch mode.
- `bun run db:generate`: generate SQLite migrations from the Drizzle schema interactively. `Drizzle.Schema` (`apps/server/src/database.ts`) also generates them on `bun run dev`/deploy; commit every generated migration (a test enforces it). Name new migrations with `bun run --cwd packages/api db:generate --name <what_changed>`. Alchemy applies them at startup/deploy. Migrations must keep the deployed code working (expand, then contract); see [docs/database.md](docs/database.md#migrations-must-keep-the-running-app-online).
- Stages: `local`, per-PR `pr-<number>` previews, `staging` (persistent, deployed from `main` before production, behind Cloudflare Access; flags use the preview tier), and `prod`. See [docs/ci-cd.md](docs/ci-cd.md#staging).
- Deployment and rollback changes: read [docs/ci-cd.md](docs/ci-cd.md) and [docs/database.md](docs/database.md). Merges to `main` deploy production automatically through CI. Confirm any deployment you run yourself (`deploy:*`, `infra:deploy`) with the user before executing it.
- `bun run ios:update`: publish an over-the-air JavaScript update to the iOS builds it fits (or `--rollback` them to their build's own JavaScript), signed on this Mac with the Keychain `mobile-updates` key; `--stage local` rehearses against `bun run dev`. It ships code to users' phones: confirm with the user before publishing to production. `bun run ios:update:status` shows what production serves. See [docs/ci-cd.md](docs/ci-cd.md#ios-updates-over-the-air).
- `bun run infra:plan`: dry-run the CI/deploy control plane (`alchemy.ci.ts`: GitHub ruleset, environments, Cloudflare deploy tokens and encrypted GitHub environment secrets) with drift detection. Apply only with `bun run infra:deploy` after the user confirms.

### Codex cloud sessions

- Setup/maintenance scripts live under `scripts/codex-cloud/`; see [docs/codex-cloud.md](docs/codex-cloud.md).
- `bun run ci` is secretless. Local D1 belongs to the checkout; no Neon branch setup or teardown is required.
- Cloud app commands accept only their dedicated development credentials through the `cloud` allowlist; macOS reads Keychain, Linux reads host-injected secrets. Agents get dev credentials (including the Planning Center PAT, a deliberate choice: it acts as the owner on real Planning Center data and shares its rate limit) from Infisical `pcobooster-dev`; preview/prod and deployment secrets never reach agent sessions.

## Agent secrets (Infisical)

- Each repo has two Infisical projects. `pcobooster-dev` (env `dev`, id `0d496fd4-544e-448a-b685-978847676ec0`) holds development credentials; `pcobooster-prod` (envs `preview`, `prod`, id `a27bbce0-b9f7-41b3-a7a0-c5ae9e004a2f`) holds deployed-tier values.
- Identities are trust tiers: `agent-dev` (Universal Auth; `INFISICAL_CLIENT_ID`/`INFISICAL_CLIENT_SECRET` in the agent environment) is Viewer on every `*-dev` project only. `ci-prod` (GitHub OIDC, `main` of any jbolabs repo) is Viewer on every `*-prod` project. Agents never get `*-prod` access.
- The free plan has no environment-scoped roles: the project is the access boundary. Never put prod or preview values in a `*-dev` project, or add a non-`dev` environment to one.
- Deploy jobs load `pcobooster-prod` through `ci-prod` and Alchemy writes the values into Cloudflare.
- Agent run: `bun run agent:run <cmd>` (`scripts/secrets/agent.ts`). It uses `INFISICAL_TOKEN` or logs in with `INFISICAL_CLIENT_ID`/`INFISICAL_CLIENT_SECRET`, loads `pcobooster-dev` with `infisical run`, and gives `<cmd>` only the `cloud` allowlist, never the token. For example `bun run agent:run bun run scripts/cloudflare/dev.ts --oauth`.
- On a Mac, `secrets:run` still reads Keychain; operator-only scopes (`apple`, `mobile-updates`, `recovery`) stay in Keychain.

## Coding Style & Naming Conventions

- TypeScript throughout; prefer explicit types at module boundaries.
- Use `camelCase` for variables/functions, `PascalCase` for components/types.
- Keep endpoint handlers as transport layers. Put behavior in explicit feature modules and raw external API calls in services.
- Use `oxlint.config.ts` and `oxfmt.config.ts` as the standards source of truth. Keep all selected presets enabled and fix the underlying cause of findings. Prefer runtime validation and type narrowing to assertions; comments should explain verified invariants.
- Shared UI primitives own appearance through variants; compose layout at call sites and use semantic color tokens. Reuse existing variants. Add a variant only for an intentional, reusable design treatment, never solely to relocate forbidden caller styles.

## Testing Guidelines

- Framework: Vitest, with tests colocated beside API and web source.
- `apps/server/src/worker.stack.test.ts` runs the real API Worker through Alchemy's test harness (`alchemy/Test/Vitest`, local workerd, in-memory state, the `test` stage on port 3010). Extend it when a change adds a binding or startup wiring that unit tests of the router cannot reach. `src/transport-stack.fixture.ts` serves both transports over a fake Planning Center for it.
- Prioritize tests for transforms/matching/sorting logic and Planning Center edge cases.
- Test behavior, not implementation. Call the code the way its users do and assert a literal expected value from an independent source (a worked example or the spec), never one recomputed the way the code computes it. Keep a test only if it would fail when every function it imports returned `undefined`: rewrite or delete tests whose only assertions are calls made (`toHaveBeenCalled*`), absence (`toBeUndefined`, `toEqual([])`), a restated constant, or data the test built itself. `lint/oxlint-plugin-test-quality.mjs` enforces the mechanical cases (weak-only assertions, expected values computed with the module under test, tests that run no code); disable one only with a `-- reason` for a genuine source guard or relation.
- Fake only real system boundaries (Planning Center, time, randomness, platform APIs) and pass them in; never mock the project's own modules. Freeze the clock (`vi.setSystemTime`) in any test whose result depends on today's date.
- Inject narrow typed service dependencies into feature modules and pass fresh test implementations explicitly. Request paths must not rely on process-global credentials or implicit async context. Preserve exact assertions on optional flags so missing values cannot pass as `false`.
- Prefer test-driven fixes for regressions: reproduce the bug or edge case with a focused failing test, then implement the smallest code change that makes it pass.
- Run `bun run ci` and `bun run build` before opening a PR.

## Commit & Pull Request Guidelines

- For dependent changes, use GitHub native stacks with the official `gh-stack` extension; follow the workflow in [README.md](README.md#stacked-pull-requests). Validate each layer and merge through the stack after its checks pass.
- Commit messages: short, imperative, scoped to a change (e.g., `Refactor data flow and harden scheduling foundations`).
- Prefer small commits for follow-up cleanup instead of amend-heavy history.
- PRs should include: summary, behavior changes, test coverage notes, and screenshots for UI changes.
- For visible or high-risk changes, use the repo-local `proofed-pr` workflow in `docs/proofed-delivery.md`; proof must match the current PR head and base.

## Request Budget

Read-only account verification on 2026-10-06 confirmed Workers Paid with Standard usage; the zone's Free plan is unrelated. The API Worker declares an explicit limit of 80 total subrequests per invocation in source; deployment and live enforcement must be verified separately. Planning Center allows 100 requests per 20 seconds per user. See the dated ledger in `docs/research/planning-center-rate-limits.md`.

- Transport and standalone budgeted programs cap Planning Center API attempts at `PLANNING_CENTER_REQUEST_CAP` (40), retries included. This is independent product policy; progressive procedures plan against `PROGRESSIVE_REQUEST_BUDGET` (36) with real counts (`packages/api/src/planning-center/request-budget.ts`). Review the overhead ledger when adding auth, D1, KV, flag, telemetry, or service-binding work; never raise the provider cap simply because the platform ceiling is higher.
- Keep each procedure well under the cap. Split heavy screens into several small procedures the browser calls progressively (for example, list first, then details in batches) instead of one call that fans out.
- Treat the budget as explicit: when a procedure cannot finish within it, return partial data with a continuation cursor. Never swallow a subrequest or rate-limit failure into empty data.
- Fetch less per call: prefer Planning Center `include`, filters (such as future-only blockouts), sparse fieldsets for heavy reads (`packages/api/src/planning-center/sparse-fields.ts`; Planning Center computes every attribute otherwise), and a person's own records over scanning every roster. Cache slow-changing data (past plans, service types) longer.
- Prefetch only on clear intent (click, or a debounced hover); never run Planning Center fan-out on incidental pointer movement.
- Load what the user is waiting on first. Anything not on screen yet (hover prefetches, other tabs' data, warm-ups) is speculative: queue it with `requestScheduler.runSpeculative` (or `useIntentPrefetch`), mark its queries with `speculativeQuery`, and call the product client from query functions through `callForQuery`. See [Request priority](docs/api-architecture.md#request-priority).
- Log per-procedure request counts, rate-limit pauses, and 429s at `info` so Workers Logs shows which screens approach the limits.

## Architecture Notes

- Preferred flow: `apps/web` -> `productClient.run((api) => api.people.search({ query }))` -> `apps/server` `/api/v1/...` -> `packages/api/src/http/handlers/*` -> Effect application program -> `packages/api/src/modules/*` -> service adapter.
- Better Auth is mounted on the API Worker's Effect router at `/api/auth/*`. The product Worker's `/api/*` and `/admin/*` server routes forward through service bindings (locally too), so browser requests stay on the web origin.
- Product operations use Effect HttpApi under `/api/v1`: reads are `GET` (or `POST` when the input can outgrow a URL), writes use `POST`, `PUT`, `PATCH`, or `DELETE`, and callers use the native typed `api.<group>.<endpoint>({ params, query, payload })` methods. The query helper supplies the abort signal and read priority. Better Auth, liveness health, and the iOS over-the-air update routes (`/api/updates/*`, whose requests and multipart answers the Expo Updates protocol fixes) are the intentional surfaces outside it. Callers catch failures with `instanceof` on the fault class or `failureStatus(error)`. The client header is `x-pcobooster-client: <name>;api=<N>` (`formatClientHeader`).
- Native clients sign in through `/api/auth/native/start` and `/api/auth/native/exchange`, then send `Authorization: Bearer <token>` plus `x-pcobooster-account` (and `x-pcobooster-demo`) headers instead of cookies; keep the web cookie flow and these header reads in step. See [docs/native-auth.md](docs/native-auth.md).
- Database access uses Drizzle through `packages/api/src/db`; migrations include Better Auth tables.
- The API Worker builds `ServerDependencies` (`packages/api/src/server.ts`: typed `ServerConfig`, Drizzle database, Better Auth, feature flags, Planning Center read caches) once per isolate and passes them explicitly: to each request as `IsolateServer`, and to Effect programs as the `Server` service. `packages/api` never reads `process.env` or `cloudflare:workers`; add new settings to `ServerConfig` and read them in `apps/server/src/worker.ts`.
- Browser query keys, persistence schemas, and cache hydration live in `apps/web/src/lib`. The web app may import contracts and Planning Center models, never `packages/api`. The admin app's server functions may import `packages/api` modules (they run in the admin Worker); its components may not.
- Backward compatibility is not a priority during the current dev phase; prefer cleaner APIs/URLs/UX over temporary compatibility shims unless explicitly requested.

## Learned User Preferences

- When replacing behavior, remove legacy or unused code paths instead of keeping parallel implementations.
- Prefer shadcn HoverCard for hover-revealed UI labels/help. Use the default tight `HoverCardContent` (`variant="label"`) or `HoverLabel` for short text; use `variant="panel"` for richer previews. Do not introduce Tooltip-based hover UI; replace existing tooltips with HoverCard when touching nearby code.
- For People detail pages, prefer app-shell breadcrumb navigation over in-page back buttons.
- Prefer lightweight inline and popover edits that persist on close (click outside, Escape, Enter, or field blur where appropriate) instead of explicit Done/Save/Cancel footers. Skip success toasts for these autosaves; keep error toasts. Reuse `apps/web/src/hooks/use-persist-on-close-popover.ts` (`usePersistOnClosePopover`, `useDraftPopover`). Opt into Enter-to-close via `enterToClose` (TanStack Hotkeys, scoped to `contentRef`); do not use Enter-to-close for Command/list popovers where Enter selects rows.
- Keep hover, active, and selection color changes instant. Do not use `transition-colors` or `transition-plan-item`; `local/no-transition-colors` enforces this.

## Learned Workspace Facts

- People availability and blockouts: compare the plan `sort_date` instant to blockouts using each blockout’s Planning Center `time_zone` (calendar-day logic); pass the full ISO `date` through the `people.planWindowHistory` and `people.candidateDetails` inputs. Naive UTC-midnight or date-only string overlap checks can mislabel people near timezone boundaries.
- Congregation-local business dates (plan windows, schedule history frequency, calendar-day deltas) use the org IANA zone from Planning Center, falling back to `PLANNING_CENTER_TIME_ZONE` (inlined into the product build as `import.meta.env.VITE_PLANNING_CENTER_TIME_ZONE`), with shared helpers in `packages/planning-center-models/src/calendar.ts`.
- Date formatters must pass an explicit time zone. Workers and CI run in UTC and browsers in the viewer's zone, so host-zone formatting puts late-evening services on the wrong day. Label congregation dates with `formatCalendarDateLabel(instant, orgTimeZone, style)` (server code takes the zone from `resolveTimeZone`, browser code from `useOrganizationTimeZone`); format UTC-noon civil-date carriers in `"UTC"`. `lint/time-zone-formatting.test.ts` rejects `Intl.DateTimeFormat` without `timeZone`, `toLocale*String`, and local getters such as `getDate()` outside its allow-list. Vitest forces `TZ=UTC` so tests match Workers on every machine; cover zone logic with an org zone such as `America/Los_Angeles` and an instant whose UTC day differs.
- Person card frequency labels should align with recommendation scoring: distinct calendar service/rehearsal days in org TZ, not raw plan-time row counts or grouped-card counts.
- Phones: `@pcobooster/ui/mobile-native.css` gates Tailwind `hover:` (and `group-hover:`, `peer-hover:`) to `(hover: hover) and (pointer: fine)`, so touch press feedback comes from instant `active:` colors; use `can-hover:` for hover-only affordances. Text fields stay 16px on touch (`md:pointer-fine:text-sm`, never a width-only `md:text-sm`), scroll containers declare an `overscroll-*` class, and pinned UI pads with `pt-safe`/`pb-safe-*`. `lint/mobile-native.test.ts` and the `local/no-small-field-text`, `local/scroll-container-overscroll`, and `local/field-keyboard-hints` rules enforce this; see [docs/mobile-native-audit.md](docs/mobile-native-audit.md).
- Feature flags are Cloudflare Flagship flags managed by Alchemy, not environment settings or build-time `define`s. Name a flag in `packages/contracts/src/features.ts`, add its registry entry in `packages/api/src/config/feature-flags.ts` (key and per-tier value), and put targeting rules in `apps/server/src/feature-flags.ts`. The API gates procedures with `requireFeatureFlag`; the browser asks the API once through `features.status` and uses `featureGuard` and `useFeatureEnabled`. Dashboard edits are overwritten on deploy, and the local stage serves registry values without Flagship. See [docs/environment.md](docs/environment.md#feature-flags).

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Fix and format code**: `bun run fix`
- **Check for issues**: `bun run check`
- **Diagnose setup**: `bun x ultracite doctor`

Oxlint + Oxfmt (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Give images explicit `width` and `height` and serve them as static assets from `public/`

### Framework-Specific Guidance

**TanStack Start (web, admin, marketing):**

- Add pages as file routes under `src/routes`, and commit the regenerated `src/routeTree.gen.ts` (`vite dev` or `vite build` rewrites it).
- Keep server functions (`*.functions.ts`) as SSR glue; product operations go through the product API client to the API Worker.
- Read Worker bindings with `import { env } from "cloudflare:workers"` inside handlers and middleware; browser code reads build-time `import.meta.env.VITE_*` values defined in `vite.config.ts`.
- Put request-wide behavior (sign-in gate, response headers) in request middleware registered in `src/start.ts`, after the explicit CSRF middleware.
- Set document metadata with route `head()`.
- Throw router control flow as `redirect({ ..., throw: true })` and `notFound({ throw: true })`.

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Oxlint + Oxfmt Can't Help

Oxlint + Oxfmt's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Oxlint + Oxfmt can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Oxlint + Oxfmt. Run `bun x ultracite fix` before committing to ensure compliance.
