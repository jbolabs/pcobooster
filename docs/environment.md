# Application configuration

Deployed application secrets live in Cloudflare Secrets Store. `alchemy.secrets.ts` is their sole writer; the product stack references them without reading their values at deploy time. Local development (people and agents alike) reads its credentials from Infisical `pcobooster-dev` through Alchemy; `alchemy.secrets.ts` reads the deployed values it writes from Infisical `pcobooster-prod`. Operator-only tools keep their macOS Keychain scopes. GitHub Actions receives deployment credentials from encrypted GitHub environment secrets managed by `alchemy.ci.ts`.

## Environment boundaries

| Use | Credential source | Runtime |
| --- | --- | --- |
| Local development and agents (stage `local`) | Infisical `pcobooster-dev` env `dev`, read by Alchemy through the default profile (`agent-dev`) | Local Workers and persistent local D1 |
| Sandbox verification (`bun run dev`) | Keychain `sandbox` scope, overriding the `pcobooster-dev` PAT | Pinned free Planning Center test organization |
| Non-Alchemy scripts (`secrets:dev`) | Infisical `pcobooster-dev` through the Infisical CLI, allowlisted by the `cloud` scope | The command's own process |
| Pull request previews | Generated stage secrets and `pcobooster-secrets/preview` references; GitHub environment deployment credentials. Never Infisical | Independent Workers and D1; Cloudflare Access |
| Staging | `pcobooster-secrets/preview` references; GitHub environment deployment credentials | Independent Workers and D1; Cloudflare Access |
| Production | `pcobooster-secrets/prod` references; `production` deployment credentials | Retained production Workers and D1 |
| Central secrets stack (`alchemy.secrets.ts`) | Infisical `pcobooster-prod` env `prod` or `preview`, read with the operator's `admin` profile | Cloudflare Secrets Store |
| Local Apple release tools | Keychain `apple` scope | macOS signing and App Store Connect tools |
| iOS update publishing | Keychain `mobile-updates` scope | The update signing key `ios:update` signs with; Cloudflare access comes from the operator's Alchemy login |
| Recovery | Keychain `recovery` scope | Read-only legacy database reconciliation |

## Infisical

Infisical is on the free plan, which has no environment-scoped roles, so each project is the access boundary. `stacks/secrets.ts` names both projects and maps each stage to one.

- `pcobooster-dev`, env `dev`: development `BETTER_AUTH_SECRET`, Planning Center OAuth client ID and secret, `PLANNING_CENTER_CLIENT`, `PLANNING_CENTER_PAT` (the Agape church token: a deliberate grant that acts as its owner on real Planning Center data and shares their rate limit), and `PCOBOOSTER_ADMIN_EMAILS`. Never put preview or production values here.
- `pcobooster-prod`, envs `prod` and `preview`: the inputs to `alchemy.secrets.ts` and the deployment values.
- Stage mapping: `prod` reads `pcobooster-prod` env `prod`; `preview` and `staging` read env `preview`; every other stage, including `pr-*`, maps to `pcobooster-dev`. Only `alchemy.run.ts` stage `local` and `alchemy.secrets.ts` stages `prod` and `preview` declare Infisical; pull request, staging, and production app deploys read nothing from it, so CI needs no Infisical identity today.

Alchemy loads the values into Effect Config (not `process.env`), and the shell outranks them. Credentials resolve in this order: `INFISICAL_TOKEN`; `INFISICAL_IDENTITY_ID` with the platform's OIDC token (GitHub Actions); otherwise the selected Alchemy profile's Infisical machine identity, which mints a fresh token each run.

| Identity | Access | Where it lives |
| --- | --- | --- |
| `agent-dev` (Universal Auth) | Viewer on every `*-dev` project | The default Alchemy profile on agent machines and for everyday development |
| `operator` (Universal Auth) | Viewer on every `*-dev` and `*-prod` project | The operator's `admin` Alchemy profile, alongside its Cloudflare credentials |
| `ci-prod` (GitHub OIDC, subject `repo:jbolabs@305914027/*:environment:production`) | Viewer on every `*-prod` project | The `production` GitHub environment's `INFISICAL_IDENTITY_ID` and `INFISICAL_OIDC_AUDIENCE` variables (`alchemy.ci.ts`); no job reads Infisical yet |

Bootstrap the default profile without putting the secret in arguments or history (`INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` must be set; use `--reconfigure Infisical` instead of `--add` to replace an existing identity):

```sh
bun run setup:infisical
# = bun alchemy profile edit --add Infisical --method universal-auth --set clientId=env:INFISICAL_CLIENT_ID --set clientSecret=env:INFISICAL_CLIENT_SECRET --no-input
```

The operator adds the `operator` identity to the `admin` profile the same way, with `--profile admin`. `secrets:plan:*` and `secrets:deploy:*` run `alchemy.secrets.ts` with `--profile admin` (deployment commands still need Jake's confirmation). The shell outranks Infisical, so do not run them with application keys exported.

`bun run secrets:dev <command>` (`scripts/secrets/dev-run.ts`) serves scripts that read `process.env` instead of running under Alchemy, such as `pc:check-contracts`. It uses `INFISICAL_TOKEN`, else logs in with `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET` (never printing the token), else the Infisical CLI's own login; runs `infisical run` against `pcobooster-dev`; and passes the values through `secrets:run --host-env cloud`, so the command sees only the `cloud` allowlist and no `INFISICAL_*` variable.

The Keychain `local`, `cloud`, `preview`, and `production` scopes are legacy. `deploy:staging`, `deploy:production`, `infra:plan`, `infra:deploy`, and `alchemy.load.ts` still read `preview`/`production`; keep those values in sync with `pcobooster-prod` until those commands move. The operator-only scopes `apple`, `mobile-updates`, `analytics-erasure`, `recovery`, and `posthog`, and the `sandbox` scope, are unchanged.

The old projects `pcobooster-preview`, `pcobooster-production`, and `worshipadmin.com` are recovery copies, read only by the one-time `bun run secrets:migrate` importer. Deleting them is a separate action. See [migration and cutover](secrets-migration.md).

## Stored application secrets

Global names use `pcobooster__<tier>__<purpose>__<KEY>`; bindings keep their familiar key names. Namespace components cannot contain the separator. `scripts/secrets/manifest.ts` defines the keys and command allowlists.

- Production: `BETTER_AUTH_SECRET`, `OAUTH_PROXY_SECRET`, Planning Center OAuth client ID and secret, the three demo credentials, and `POSTHOG_ERASURE_API_KEY` (a PostHog `person:write` key for the [analytics erasure cron](analytics.md#schedule)). Each comes from Infisical `pcobooster-prod` env `prod` (preview tier: env `preview`) through `bun run secrets:deploy:production` (or `:preview`); see [rollout](ci-cd.md#analytics-erasure-cron).
- Preview tier: only `OAUTH_PROXY_SECRET` and Planning Center OAuth client ID and secret. Persistent staging consumes this tier too.
- Each preview or staging signing secret remains an independent `Alchemy.Random` resource, destroyed with its stage. Neither reads the production signing secret.
- Every centrally owned secret has a retain policy. Product deployments and preview teardown never own its lifecycle.

The API reads a complete secret snapshot on its first request and at most once per minute per isolate. Unchanged snapshots reuse the existing server dependencies; a changed snapshot rebuilds them in the requesting context. Failed reads serve a generic 503 and retry on the next request, without using expired values. The native Promise cache lets concurrent requests resume in their own workerd I/O contexts. Provider propagation is additional to this one-minute application cache. Rotating the authentication signing key still invalidates existing sessions; relocating its unchanged value does not.

Local Workers use ordinary `Config.Redacted` bindings from Infisical `pcobooster-dev` (or a sandbox override). They do not access the remote store. Alchemy's ignored local state can contain deployment inputs; Infisical and Keychain prevent plaintext credential source files, not all tool-generated local copies.

## Configuration that is not secret

`packages/config/src/public-environment.ts` owns the public PostHog ingestion key and fallback time zone. The stack serves analytics only in production, stamps those build inputs, and rebuilds the frontend when they change. `PCOBOOSTER_ADMIN_EMAILS` and `STAGING_ACCESS_SERVICE_TOKEN_ID` are GitHub environment variables, not application secrets.

Alchemy derives stage origins, `BETTER_AUTH_URL`, CORS, the OAuth receiver allowlist, `NODE_ENV`, and service bindings. Do not override derived values. Feature flags remain in Flagship.

## Feature flags

Feature flags are typed infrastructure, not secret settings. `packages/contracts/src/features.ts` names every flag, and `packages/api/src/config/feature-flags.ts` is the registry, with exactly one entry per name (the types reject a missing or extra one): each flag's Flagship key, description, and the value each tier serves (`local`, `preview` for `pr-<number>`, `production`). Staging uses the `preview` tier, so it always serves the same flags as previews. Today the registry holds two flags, each on in every tier (locally, in previews and staging, and in production): `people` (key `people-page`) and `chordCharts` (key `chord-charts`, which also gates the Songs library). Keep them as kill switches: setting a tier's value to `false` hides the pages and refuses their procedures.

- **Deployed stages.** `apps/server/src/feature-flags.ts` declares one [Cloudflare Flagship](https://developers.cloudflare.com/flagship/) app per stage (`pcobooster-<stage>-flags`) and one boolean flag per registry entry, with the tier's value as the default variation plus any targeting rules listed there. The API Worker binds the app with `Cloudflare.Flagship.ReadFlags` and evaluates flags per request through `ServerDependencies.featureFlags`, with the user ID (`userId`, also the rollout `targetingKey`) and the Planning Center organization ID (`organizationId`, recorded at sign-in) when known. An evaluation error, including a missing flag, serves off and logs `Feature flag evaluation failed; serving off`.
- **Alchemy owns the rules.** Every deploy writes each flag's variations, default, enabled state, and rules. Edits in the Cloudflare dashboard take effect within seconds (Flagship propagates globally in up to 30 seconds) but are overwritten by the next deploy, so change `apps/server/src/feature-flags.ts` instead. Deleting a registry entry deletes the flag on the next deploy; remove its evaluations first.
- **Local stage.** `alchemy dev` has no local Flagship: Alchemy proxies the binding to a live app, which would need Cloudflare credentials and create cloud resources for every checkout. The local stage therefore declares no Flagship resources and serves the registry's `local` values (People on). To try other local values, edit the registry; the API reloads.
- **API.** Each flagged procedure calls `requireFeatureFlag(access, name)` (`packages/api/src/application/feature-flags.ts`), which answers not found while the flag is off, so a hidden feature looks like it doesn't exist.
- **Browser.** The product never inlines flags. One call, `features.status`, answers every flag for the visitor. The app layout loads it on the server (`featuresQueryOptions` in `apps/web/src/lib/features.ts`) so the navigation renders with the answers; routes guard with `beforeLoad: featureGuard(name)`, and components read a flag with `useFeatureEnabled(name)`.
- **Adding a flag.** Add its name to `featureFlagNames`, then follow the type errors: a registry entry, a not-found answer in `requireFeatureFlag`, and, if it hides a feature the access review lists, its `AppFeature` in `apps/web/src/lib/planning-center-access.ts`. Removing a flag is the reverse; Alchemy deletes it from Flagship on the next deploy.

Deploying Flagship resources needs Flagship access: the deploy tokens need Flagship Write (see [CI/CD](ci-cd.md#deployment-credentials-and-token-scope)), and a local Alchemy OAuth profile needs the `flagship.read` and `flagship.write` scopes (`bun alchemy profile edit`, then sign in again). Flagship is in public beta; Cloudflare has not announced pricing.

## Developer credentials

Every stage `local` command reads app and OAuth settings from Infisical `pcobooster-dev`. Normal `bun run dev` and `dev:present` override its PAT with the Keychain `sandbox` scope's and verify the pinned test organization before startup; they need a Mac with that scope. `dev:church` uses the `pcobooster-dev` church PAT with provider writes blocked; `dev:church:write` explicitly enables real church writes. Each profile pins its organization in `DEV_PLANNING_CENTER_ORGANIZATION`, and the stack refuses to start when the resolved token belongs to another one (`scripts/cloudflare/dev-organization.ts`). `bun run dev:auth` signs in through Planning Center OAuth. See [Planning Center sandbox](planning-center-sandbox.md).

The Keychain `sandbox` scope contains the test organization’s `PLANNING_CENTER_CLIENT` and `PLANNING_CENTER_PAT`. Agents without it use `dev:church` or `dev:auth`. Optional `PRESENTATION_SEED` can be added to `pcobooster-dev`. The launchers remove stale shell credentials (the shell outranks Infisical) and give stage `local` placeholder Cloudflare credentials, so it starts without a Cloudflare login. Alchemy binds these development keys only in stage `local`.

`DEV_AUTH_BYPASS` is process-owned, like `PRESENTATION_MODE`: `scripts/cloudflare/dev.ts` sets it. `bun run dev`, `dev:present`, and `dev:church` turn it on, signing every request in as the token's owner (`packages/api/src/auth/dev-bypass.ts`); the stack refuses to start without the token. `bun run dev:auth` turns it off for real Planning Center OAuth. The product Worker also receives `DEV_AUTH_BYPASS` in stage `local`; its sign-in gate honors it only in the development server, never in a production build. The bypass synthesizes its session on the server and sets no session cookie, so checkouts running side by side on `127.0.0.1` (cookies ignore the port) do not sign each other out; only UI preferences such as `sidebar_state` are shared.

All checkouts share the one token and therefore Planning Center's 100 requests per 20 seconds per user. Each API Worker's pacer (`packages/api/src/planning-center/rate-pacer.ts`) sees only its own requests, so several busy checkouts together can hit 429s.

## Local ports

`DEV_PORT_BASE` places the local stack: the API on the base, then the product, marketing, and admin on the next three ports (`packages/config/src/dev-ports.ts`). `scripts/cloudflare/dev.ts` chooses it, in order: an explicit `DEV_PORT_BASE`; 3000 for `bun run dev:auth`, whose OAuth callback is registered on 3001; the product port the desktop preview tool assigns in `PORT` (`.claude/launch.json` uses `autoPort`); a stable block for a linked worktree, derived from its path (4000 to 4993, in steps of 10); otherwise 3000. It checks the four ports are free before starting and passes the base to every dev server. Stage `local` derives its product origin, `BETTER_AUTH_URL`, CORS origin, and trusted origins from it; the API stack test keeps its own port, 3010. Standalone `vite dev` runs read `DEV_PORT_BASE` too and default to the main ports.

`PRESENTATION_MODE` is process-owned: `bun run dev:present` enables it. Every deployed Worker uses production mode, which disables presentation mode and local authentication bypass.

## Deployment credentials

Local deployment uses the saved Alchemy profile. Use `bun alchemy profile edit` to sign in or adjust it; credentials do not belong in shell history or repo files.

GitHub Actions receives a separate preview or production Cloudflare token through its declared environment. Preview deployment still requires the preview label and excludes forks; production environments accept only `main`. Tokens never become app Worker bindings. Account and Access identifiers are variables. See [CI/CD](ci-cd.md).

`DATABASE_URL` is retained in the Keychain `recovery` scope for read-only migration/reconciliation. The deployed app cannot connect to Neon.

## Server logs

Every Worker writes to Cloudflare Workers Logs and Workers Traces (`apps/server/src/observability.ts`). The API Worker's traces come from `Cloudflare.Telemetry()`, which also mirrors its Effect spans: each procedure is a span named `api.<procedure>`, so a trace shows where the procedure spends its time. A trace shows each invocation's Planning Center, D1, and KV subrequests, so it is the quickest way to see how much of the API Worker's source-configured 80-subrequest ceiling a procedure uses (live settings must be verified after deployment); previews and staging trace every request and production samples 20%. The API's structured Effect logs (one object per line: message, level, and annotations such as `module`, `procedure`, and `requestId`; see `packages/api/src/logging.ts`) and each request's invocation log (request and response metadata, including client IP and user agent) appear in the Cloudflare dashboard under Workers & Pages, Observability. Read-only account verification on 2026-10-06 confirmed Workers Paid and Standard Worker usage, with no deployed explicit limit at that time. The API now declares `limits.subrequests: 80` in `worker.ts`; web and admin retain their existing platform limits. Local workerd does not prove enforcement of that declaration. The provider cap remains 40 and the progressive planning target 36; see the [request ledger](research/planning-center-rate-limits.md#2026-10-07-request-accounting-correction).

Log IDs, not content: log lines should carry request, user, and plan IDs rather than message text or tokens. Exporting logs to PostHog (OTLP) requires Workers Paid; revisit it after upgrading.
