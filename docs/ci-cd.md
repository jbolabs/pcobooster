# CI/CD

The Cloudflare workflow separates secretless validation from deployment: labeled pull requests deploy previews, and merges to `main` deploy staging and then production. `quality` runs dependency review, strict linting, and typechecks alongside three test lanes: application, Worker integration, and repository guards. The required `ci` gate succeeds only when quality and every test lane succeed. `cloudflare-build` runs the product's Vite Worker build (with the prerendered marketing site staged into the product) without credentials. Both run for pull requests and again on the merged commit on `main`, where they gate the production deploy. On `main`, the staging deploy runs alongside them, so a revision that fails validation there can reach staging but never production.

Run the local gates before opening a pull request:

```sh
bun run ci
bun run build
bun run build:cloudflare
```

Use Node 24 and the pinned Bun version. Actions are pinned to immutable commits and installs use the frozen Bun lockfile. CI has no Turborepo remote-cache credential.

During development, use `bun run ci:affected --base origin/main` for lint, affected typechecks and tests, and repository guards. `--dry-run` shows the selected tasks without executing checks. The base is resolved to its merge base with `HEAD`; committed, staged, unstaged, and untracked changes are included. For a stacked PR, use its preceding branch. An unavailable base fails instead of narrowing validation. Shared toolchain, TypeScript, test-fixture, workflow, or scope-selection changes run all packages. Final PR proof still requires the full local gates above.

PR validation restores `.turbo/cache` through GitHub Actions' cache service, partitioned by job and test lane, OS, architecture, toolchain/configuration, and revision. The cache action runs only in the secretless quality, test, and `cloudflare-build` jobs; deployments build from source. GitHub's branch/ref cache boundaries keep PR-written entries out of `main`. On `main` and manual runs, `TURBO_FORCE` bypasses restored results so every gate executes afresh before deployment and seeds the next PR's cache.

Test execution does not depend on upstream test execution: source-only `test:inputs` tasks carry transitive hashes without running another suite. The lane selector partitions the conservative affected Turbo plan, with root guards always selected; empty lanes explicitly exit instead of passing an empty filter to Turbo. Local tests run repository guards first, then two concurrent packages with two Vitest workers per package; other Turbo commands default to half the available cores. Worker integration runs select available TCP ports and distinct Worker registry names rather than sharing ports 3010/3011 across checkouts. Independent review can run alongside validation; avoid starting a second full CI/build/proof run for the same revision.

The Bun package cache lives in a fresh runner directory keyed by the exact lockfile, platform, and Bun version, without a fallback to older locks. This prevents unrelated historical packages from accumulating in a shared cache. Frozen installs and the uncached patch check remain required.

Root tests and typechecks hash all repository inputs: these gates inspect and import files across workspace boundaries. Root scripts, shared TypeScript configuration, and toolchain configuration participate in every task hash, since packages import script types and fixtures; package tests also hash Vitest configuration. Mobile declares its build-time design-token dependency so token edits select and invalidate its checks. `test:install` checks the installed dependency patches outside Turbo on every `bun run test`, since a source cache key cannot establish the state of `node_modules`.

Shared steps live in composite actions:

- `.github/actions/setup` pins Node and Bun, restores the Bun package cache, and installs. Change toolchain versions there only.
- `.github/actions/turbo-cache` restores and saves content-addressed validation results. Bump its cache namespace when changing the cache trust policy; rollback is to remove its two workflow uses, leaving all validation commands and merge gates in place.
- Deployment jobs receive encrypted secrets from their declared GitHub environment; app secret values stay in Cloudflare.

The `quality` job also runs checksum-verified `actionlint`. Run it locally when you edit workflows.

Concurrency is set per job. A new push to a pull request cancels that PR's older quality, test, and `cloudflare-build` jobs. Deploy and cleanup jobs share a per-stage group that never cancels, so an Alchemy state update is never interrupted.

`scripts/check-patches.test.ts` runs in `bun run test`. It fails if any installed copy of a patched dependency is missing a line the patch adds, for example after a stale Bun cache.

## Alchemy beta.82 rollout

The root and API Worker pin `alchemy@2.0.0-beta.83` (its only breaking change, to Cloudflare Containers, does not affect these stacks); all workspace Effect dependencies and the platform/test peers use `4.0.4`, satisfying Alchemy's `^4.0.0` peers. The lockfile aligns Alchemy's runtime, node utilities, and floci at the same beta (the optional frontend-frameworks peer is unused by Cloudflare Vite). The CLI script runs the published `bin/cli.js` launcher with Bun. CI and developers use Bun 1.4.2; Node users need at least 24.11.1, also pinned in `.node-version`.

[Beta.82's release notes](https://alchemy.run/blog/2026-10-12-beta-82/) describe a one-way Durable Object migration from `migrations` to declarative `exports`. Upgrade every developer and CI deploy, cleanup, drift, and control-plane path together before the first cloud-backed operation: these stacks share `Cloudflare.state()`, whose state Worker and Durable Object are part of this boundary. Even a plan/dry-run or state read can bootstrap or update the shared state backend. Use secretless CI, standalone Vite builds, and the in-memory/local workerd test harness for upgrade validation; do not run cloud-backed Alchemy commands as an offline check.

The first deployment of each affected Worker must use 100% traffic (omit `version.traffic`, as these stacks currently do). Once exports are deployed, do not deploy an older Alchemy release, including from an older checkout or CI run. Application rollback must retain beta.82 or later and compatible Effect peers. Bundles now default to `.alchemy/bundles`; changed sourcemap paths cause a one-time Worker redeploy. Pre-merge validation performs no state migration or deployment; merging to `main` starts staging and production deployment through CI.

Workers Issues is enabled for the API and product Workers through the shared observability helpers. Invocation logs remain enabled, and existing trace sampling and API telemetry remain in place. Cloudflare Access, classic KV, and the custom PostHog and Infisical providers keep their existing declarations.

## Preview lifecycle

Previews deploy only on request. Add the `preview` label to a same-repository pull request; adding the label, and every later push while it is present, requests a deployment once validation passes. The label is the approval: while it is present, every push to the PR deploys without further review, so only label a PR whose incoming commits you trust. Pull requests without the label get checks only, with no waiting deployment. Adding the label reruns nothing: the `labeled` run skips `ci` and `cloudflare-build` and its `preview-gate` job waits for those checks to pass on the current head. Opening a PR with the label already on it (`gh pr create --label preview`) sends `opened` and `labeled` together, and both runs would deploy the same head. So the gate (`scripts/cloudflare/preview-gate.ts`) leaves the deploy to another run whose `preview` job for this head appeared after the `labeled` run started. Earlier preview jobs don't count, so labeling again still recreates a preview the nightly sweep removed, and re-running a skipped `preview` job always deploys.

Deploys build from source: Alchemy runs each Vite app's build itself and skips an app whose inputs are unchanged, so `cloudflare-build` outputs are validation only. Feature flags are evaluated at runtime, so every stage builds the same product bundle. Fork PRs receive secretless checks only. A labeled revision gets preview app secrets and an account-scoped Cloudflare token, so review workflow/dependency changes before they land on a labeled PR.

A preview job receives its environment's Cloudflare deployment token, checks the PR is still open at the expected head, and runs `bun alchemy deploy --stage pr-<number>`. Alchemy owns a separate D1 database, Planning Center cache KV namespace, iOS update bucket, API and web Workers, and Cloudflare Access application for each PR, so opening a preview asks for the same one-time-code sign-in as staging (see [Staging](#staging)). The preview URL is exposed in GitHub's deployment environment. Production data is never copied into these databases.

Every deploy then runs `scripts/cloudflare/verify-deployment.ts`. Both the web and API Workers carry the deployed `GITHUB_SHA` as a `PCOBOOSTER_VERSION` env prop, so every commit redeploys both even when only one app changed. The script polls the web Worker's `GET /version` and the API's `health` procedure (through the web Worker, with `makeProductClient` as the `deploy` client at `GET /api/v1/health`, so the whole API answers) until both report the commit, then checks that `/` returns 200. A deploy that finishes without the new code live in either Worker, or with a broken web → API binding, fails the job.

Every stage verifies through its product Worker's `workers.dev` origin, production included (`https://pcobooster-prod-web.jakebodea.workers.dev`), never through pcobooster.com. The zone's Bot Fight Mode ([`protectZoneEdge`](../scripts/cloudflare/zones.ts)) answers scripted clients on datacenter networks with a managed challenge, and the Free plan cannot exempt them with a WAF skip rule. It began challenging every GitHub runner request on 2026-10-13, with no change to the zone or the check: Cloudflare's detection changed, so the check must not depend on it. A challenged check fails at once (Cloudflare marks challenge pages `cf-mitigated: challenge`) instead of polling until its deadline. A custom domain routes to the Worker script rather than a version, so the workers.dev check covers the code pcobooster.com serves. Production then runs `scripts/cloudflare/verify-custom-domains.ts`, which reads the Worker custom domains from the Cloudflare API (no edge challenge) with the deploy token and fails unless `pcobooster.com` and `www.pcobooster.com` are enabled custom domains of `pcobooster-prod-web`. That catches the domain coming detached, for example if `CLOUDFLARE_CUSTOM_DOMAINS` stops being `1`.

Pass a value a Worker must redeploy for as an `env` prop, not a `Config` read inside an Effect-native Worker's init (`apps/server/src/worker.ts`): Alchemy's change detection hashes `env` props and file inputs but not init-time `Config` reads, so changing only such a value (including rotating a secret) plans as a noop. Force a redeploy with `bun alchemy deploy --force` after rotating one.

Teardown uses `alchemy.cleanup.ts`. It has the application stack's name and state but declares no resources. That lets `alchemy destroy alchemy.cleanup.ts --stage pr-<number>` remove everything a stage recorded, without app secrets, a build, or configuration that `main` added after the PR opened. It refuses any stage that isn't `pr-<number>`.

Cleanup runs in the `cloudflare-preview-cleanup` environment. That environment is restricted to `main` and needs no approval, because it only ever runs trusted `main` code:

- Closing a same-repository PR triggers `pull_request_target`, which checks out `main` (never PR code), confirms the PR is still closed, and destroys its stage.
- A nightly sweep (`scripts/cloudflare/sweep-previews.ts`, also available through `workflow_dispatch`) lists `pcobooster-pr-*` Workers and D1 databases, then destroys every stage whose PR is no longer open. It also destroys an open PR's stage once it has gone 3 days without a deploy, measured by the newest Worker upload; the next push to a labeled PR recreates it. Previews therefore expire even when a PR stays open. Use `--dry-run` locally to see what it would destroy.

Deployment and cleanup share a per-stage concurrency group. Reopening the PR creates a fresh deployment request.

## Staging

`staging` is a persistent pre-production stage at <https://pcobooster-staging-web.jakebodea.workers.dev>. Every push to `main` (and a manual run with `deploy_production`) deploys it first, in the `cloudflare-staging` environment (`main` only, no reviewers), concurrently with validation of the merged commit; production waits for it and for validation, so a failing deploy, migration, or check stops before production. Its D1 database is retained and its data persists across deploys. It runs the preview tier: preview secrets from the `pcobooster-secrets` stack’s `preview` stage, preview feature flag values, host-only cookies, and Planning Center sign-in through production's OAuth proxy (its origin matches the preview pattern). Deploy it yourself with `bun run deploy:staging`.

Cloudflare Access protects it, and every pull request preview the same way. `alchemy.run.ts` gives each non-production stage's product Worker a dedicated Access application (the Worker's `access` prop) whose policies admit `PCOBOOSTER_ADMIN_EMAILS`, plus the deploy-check service token. It covers the `workers.dev` URL and version preview URLs; the API Worker has no public URL outside production. Access needs a Zero Trust organization on the account, with the One-time PIN login method (or another identity provider) enabled.

`alchemy.ci.ts` owns the service token (`pcobooster-staging-deploy-check`) and writes `STAGING_ACCESS_SERVICE_TOKEN_ID` as a GitHub environment variable and `CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET` as encrypted secrets in the preview and staging GitHub environments. Staging and preview deploys read the id to admit the token; `verify-deployment.ts` sends the client credentials. The preview identity can already overwrite staging's Workers, so the token adds no reach. Both deploy tokens carry the account-level **Access: Apps and Policies Write** (`ACCESS_APPS_WRITE` in `alchemy.ci.ts`, referenced by id because a zone-level group shares its name and Alchemy resolves names to the first match): the preview token so staging and preview deploys (and preview cleanup) can manage their Access applications, and the production token so production's deploy can delete the former admin Worker's. `alchemy.cleanup.ts` and the preview sweep never touch `staging`.

## Production

Merge equals deploy. A push to `main` deploys production after `ci`, `cloudflare-build`, and the `staging` deploy pass. So does a manual CI run on `main` with `deploy_production`. `production` accepts only the `main` branch and has no approval gate. When newer `main` has superseded the revision, the job ends green without reading production secrets or deploying; the newer revision's own run deploys it. Staging and labeled previews skip superseded (or closed) revisions the same way. Post-deploy verification then fails the run unless production's Workers serve the merged commit and pcobooster.com routes to them ([deploy verification](#preview-lifecycle)). The required checks on the pull request, then the same checks on the merged commit, are the only gates before production, so keep them strict.

After verification, the job tells IndexNow (Bing, Yandex, and the search tools built on Bing's index) which public pages the deploy changed. Before the deploy, `scripts/search/indexnow.ts snapshot` digests every sitemap page through the workers.dev origin; afterwards `submit` digests them again and submits the new and changed URLs under the key file `apps/web/public/<key>.txt`. The first deploy that serves the key submits every page. Failures warn and never fail the job. Google does not use IndexNow; it reads the sitemap submitted in Search Console.

The job then marks the release on PostHog charts. It skips with a warning when `POSTHOG_ANNOTATION_API_KEY` is absent; see [analytics](analytics.md#deploy-annotations). PostHog dashboards are applied separately with `bun run posthog:deploy`, never by CI.

The production GitHub environment accepts only `main` and supplies its own Cloudflare token. Runtime app secrets live in the account store, referenced from the production secrets stack; local PATs and migration-only `DATABASE_URL` are never injected.

`CLOUDFLARE_CUSTOM_DOMAINS=1` in the production GitHub environment attaches pcobooster.com and www to the production product Worker.

A nightly `Cloudflare drift` workflow (also available through `workflow_dispatch`) runs `scripts/cloudflare/check-drift.ts` for `staging` and `prod`, each in its own GitHub environment. It compares every resource Alchemy manages in that stage with its live Cloudflare state and fails, listing them in the job summary, when any were changed outside a deploy, such as a Flagship flag, DNS record, or Access policy edited in the dashboard. It only reads. The next deploy would overwrite those edits, so either copy the change into code or restore it with `bun alchemy drift --stage <stage> --repair`. Each check shares its stage's deploy concurrency group, so it never observes a half-applied deploy.

The repository check compares equivalent provider representations before deciding whether to fail. For Alchemy beta.79, a Worker read reconstructs serving hostnames without the deployment-only `domain.zone` selector; an absent D1 replication declaration means `disabled`. The check also excludes the Flagship app's `updatedAt` and the zone's `activatedOn`/`modifiedOn` timestamps. These rules are scoped to their resource types; domain attachments, replication mode changes, zone `status`, and other configuration still fail, as do missing resources and unclassified drift. This changes only the read-only check, not Alchemy state, resource configuration, or the upstream CLI's drift comparison. A zone status change still requires review even when its only other differences are timestamps.

To roll back, revert the change on `main`; the revert deploys like any other merge. Schema changes follow [database migrations](database.md#migrations-must-keep-the-running-app-online), so the previous code stays compatible with the migrated database.

A deploy you run yourself (`bun run deploy:production`, `bun run infra:deploy`) is still a manual production change: confirm it with Jake first.

### Analytics erasure cron

The production API Worker carries the hourly [analytics erasure](analytics.md#schedule) Cron Trigger (`17 * * * *`, `ANALYTICS_ERASURE_CRON` in `apps/server/src/analytics-erasure-schedule.ts`). Its deploy references `pcobooster__prod__analytics__POSTHOG_ERASURE_API_KEY` in the `pcobooster-secrets` stack's `prod` stage. Alchemy fails the deploy at plan time (`Reference to … in stack 'pcobooster-secrets' and stage 'prod' not found`) only when that stack's state has no such secret; it does not check the value. A stored secret that is empty or unreadable deploys fine, and every hourly run then reports `ANALYTICS_ERASURE_NOT_CONFIGURED` instead of erasing. To store or rotate the key:

1. Create a PostHog personal API key with only the `person:write` scope, limited to project 614621. Add it as `POSTHOG_ERASURE_API_KEY` in Infisical project `pcobooster-prod`, environment `prod` (the source `alchemy.secrets.ts` reads for stage `prod`; see `stacks/secrets.ts`).
2. Plan the secrets stack: `bun run secrets:plan:production` (it runs `bun alchemy deploy alchemy.secrets.ts --stage prod --profile admin --dry-run --no-input`). It fails if Infisical lacks the key. Expect only `pcobooster__prod__analytics__POSTHOG_ERASURE_API_KEY` to be created or updated. After Jake approves, `bun run secrets:deploy:production`. A changed value updates the secret in place, keeping its id. Run both without application keys exported: the shell outranks Infisical.
3. Redeploy the API Worker so production carries the cron and the reference: a merge to `main`, or a manual CI run with `gh workflow run ci.yml --ref main -f deploy_production=true` (or `bun run deploy:production`, which still loads the legacy Keychain `production` scope). Confirm the deploy with Jake. The cron reads the secret on every run, so after an in-place rotation the next run uses the new value even without a redeploy. The production deploy reconciles D1 migrations (including `analytics_erasure_requests`) before the API Worker uploads, because the Worker's `DB` binding is a props-level dependency on the database.
4. Verify: the API Worker's Settings → Triggers lists `17 * * * *`; after the next :17 run, Workers Logs show `Analytics erasure run` with counts (not `Analytics erasure run needs attention` or `Analytics erasure secret read failed`); PostHog shows no new `$exception` with `path` `cron:analytics-erasure`. `bun run analytics:erase -- --database-id <id>` shows the queue's counts read-only.

Rolling back the Worker removes the trigger; queued requests wait in D1 and resume on the next deploy that carries it.

## iOS releases (TestFlight)

Until the CI executor below is enabled, TestFlight builds ship from a person's Mac with `ios:testflight`, the one supported local upload path. `ios:release` on its own still only prepares archives or exports signed IPAs, and `release-ios.sh --upload` stays refused.

### Local TestFlight release

From the main checkout (or any worktree) at `origin/main` with no changes, signed into Xcode with an account on team `6C46GY4Z38`, with an idle shared `agent-sim-*` simulator and Maestro installed (see [Release smoke check](#release-smoke-check)):

```bash
bun run secrets:run apple -- bun run --cwd apps/mobile ios:testflight
```

Load only the Keychain `apple` scope (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`). `scripts/release/testflight.ts` runs, in order:

1. Refuses a CI/provider marker, a preset `BUILD_NUMBER`, a missing App Store Connect key, or an analytics key other than the committed one, before running anything.
2. Fetches `origin/main` and requires `HEAD` to equal it with no tracked or untracked changes. Runs `bun install --frozen-lockfile` (a fresh worktree has no dependencies), `bun run ci`, `bun run build`, and `ios:release-smoke --build`, then rechecks the checkout. None of these steps sees the Apple key.
3. Runs `release-ios.sh --no-upload` with `PCOB_RELEASE_SIGNING=xcode-account` unless set otherwise. With the key, the build number is one above every App Store Connect build, every in-flight upload, every local claim, and floor 292; it is claimed before archiving. The Hermes gate runs before and after archiving, and the archive must embed the PostHog key ([analytics key](#analytics-key)).
4. Runs the [signed export gate](#signed-export-gate) against the IPA, with the React Native prebuilt frameworks below exempted from the dSYM check.
5. Rechecks that App Store Connect has nothing at or above the number (apart from the `AWAITING_UPLOAD` record Xcode's export itself creates for this number; build 374's export created one three seconds after it started, and the upload completes it), prints the version, build, revision, and IPA hash, and asks you to type the build number back (`--yes` skips this). Then makes one `xcrun altool --upload-package` with `--apple-id` (the numeric App Store Connect app id, which `findAppId` looks up), `--bundle-id`, `--bundle-version`, `--bundle-short-version-string`, and `--p8-file-path` pointing at an owner-only temporary key removed afterwards, also on interrupt.
6. Polls `ios:release:status` once a minute, for at most 30 minutes, until the build is `VALID` with this number and version `0.1.0`. `INVALID` or `FAILED` fails the run; a timeout exits non-zero and says the outcome is pending.

A failed or interrupted upload is never retried: Apple may still have it. Check `ios:release:status <build>`. The number stays claimed locally and burned, and the next release takes a higher one. Source maps are not uploaded and the CI ledger is not written; the source-map workstream and the executor own those. Tester-group access and installed-device acceptance remain manual.

Build 373 (2026-10-07, `524e880c`) was the first local upload: an `xcode-account` export and a hand-run `altool` with the flags above. App Store Connect processed it `VALID`. It shipped without the analytics key, so PostHog has no events or `$exception` from it; that release is why the key is now committed and checked.

### What's in TestFlight

```bash
bun run secrets:run apple -- bun run --cwd apps/mobile ios:release:latest
# Or the newest N builds, default 10, at most 200:
bun run secrets:run apple -- bun run --cwd apps/mobile ios:release:builds --limit 5
```

Both print JSON: each build's number, version, processing state, upload date, expiry, TestFlight internal and external states, and beta groups, newest upload first. `pendingUploads` lists uploads numbered above every listed build that App Store Connect has not listed as builds yet. `ios:release:status <build>` reads one build.

### Analytics key

The app reports analytics and diagnostics to PostHog project 614621 only when its archive embeds `EXPO_PUBLIC_POSTHOG_KEY` ([mobile diagnostics](mobile-diagnostics.md)). That project key is a public ingestion token that pcobooster.com already serves in its web bundle, so it is committed as `POSTHOG_PROJECT_KEY` in `apps/mobile/scripts/release/release-rules.ts` and every release archive embeds it from source. Release steps use the public token from source. `release-ios.sh` refuses an `EXPO_PUBLIC_POSTHOG_KEY` or `POSTHOG_PROJECT_KEY` in the environment that differs from the committed key, and refuses any archive whose `main.jsbundle` does not contain it, including a `--skip-build` export. If the project key ever rotates, change the constant in a reviewed commit. The symbol-upload key (`POSTHOG_CLI_API_KEY`) is a different, secret credential and is still never baked in.

### Preparing or exporting without uploading

From clean committed source after `bun run ci` and `bun run build`:

```bash
BUILD_NUMBER=<explicit-number> bun run ios:release --prepare
# Explicit signed local export, with this Mac's Apple account in Xcode:
BUILD_NUMBER=<explicit-number> PCOB_RELEASE_SIGNING=xcode-account bun run ios:release --no-upload
```

`--prepare` is the default: clean Expo prebuild, Pods, unsigned Release arm64 archive, exact source/app provenance, and the matching Hermes gate. It does not sign. `--no-upload` additionally signs and exports an IPA using `destination=export`. `--skip-build` reuses only a stamped archive whose revision, source state, native app files, JavaScript bundle, identity, version, and build number still match. The app keeps version `0.1.0` and bundle ID `com.pcobooster.ios`; production API requests use `https://pcobooster.com`. Archives need 15 GiB free disk and land in ignored `apps/mobile/build/release/`. Dotenv is disabled. Upload flags fail before native generation; environment markers cannot turn `release-ios.sh` into an uploader.

An ASC read key allows allocation above every iOS build and in-flight upload, with a machine-local claim ledger and lock preventing reuse within local preparation. Without a key, preparation/export requires an explicit number above floor 292 and local claims; that number is **not validated against ASC and cannot be uploaded** (`ios:testflight` requires the key). `build-number verify` fails without a read key. Git ancestry is never used. Local claims are preparation bookkeeping, not a distributed reservation: separate machines can observe the same ASC snapshot, so run one release at a time.

For ASC reads or API-key export, load only the Keychain `apple` scope:

```bash
bun run ios:release --no-upload
```

`ASC_KEY_ID`, `ASC_ISSUER_ID`, and one of `ASC_KEY_P8_BASE64` or `ASC_KEY_PATH` supply the key. Credentials are removed from native generation/compilation; decoded temporary keys use private permissions and are deleted on exit. `PCOB_RELEASE_SIGNING=xcode-account` explicitly uses the local Xcode account, optionally with the key for reads. Any truthy CI/provider marker refuses this fallback. API-key cloud signing remains **unproven**: the current key reads ASC but export failed with a permission/certificate error. An Admin team key and cloud-managed distribution certificate access require an actual successful export before being called supported.

For an installed Apple Distribution certificate with its private key and a matching App Store provisioning profile, use `PCOB_RELEASE_SIGNING=api-key` with both `PCOB_RELEASE_CERTIFICATE_SHA1=<40-hex-certificate-fingerprint>` and `PCOB_RELEASE_PROFILE_UUID=<profile-uuid>`. These public identifiers opt into manual local export for `com.pcobooster.ios` and team `6C46GY4Z38`; they do not create or import credentials. The API key still handles App Store Connect reads and upload. Export selects those exact installed identities without provisioning updates or cloud-signing fallback. Missing/malformed selectors and automation markers fail before archiving. The default remains automatic signing; all archive, signed-IPA, provenance, and upload checks remain required. This local option does not enable the CI release workflow.

### CI release executor: blocked until enablement

`.github/workflows/ios-release.yml` is the intended long-term upload path, triggered only by `workflow_dispatch` on `main`. Until it is enabled, uploads go through the [local TestFlight release](#local-testflight-release). Its app-wide `ios-release-com.pcobooster.ios` concurrency group covers every job with `cancel-in-progress: false`; that group, not a lock, serializes releases. The secretless `prepare` job runs the release boundary tests and the matching host Hermes gate. The `release` job (requested with `request_upload`, environment `ios-release-upload`) is implemented, but its **first step fails BLOCKED** before checkout, credentials, ledger writes, signing, or upload. Separately, `RELEASE_ENABLEMENT` in `apps/mobile/scripts/release/ci-release.ts` is `"blocked"`, so `ci-cli.ts release` and `availability` refuse before reading any credential, whatever CI variables are set, and the job grants no `id-token` or write permission. Local `release-ios.sh --upload` stays refused, even with spoofed CI markers. The existing `testflight` environment has no reviewer gate and shares broad production credentials, so the executor does not use it.

After the block, the job checks out exactly `github.sha`, refuses any `GITHUB_RUN_ATTEMPT` other than 1, selects the approved Xcode, runs `bun run ci`, installs checksummed Maestro and `posthog-cli`, runs the Release simulator smoke at this revision, will receive isolated credentials only after its separate enablement change, then runs `bun run --cwd apps/mobile scripts/release/ci-cli.ts release` once and the bounded `availability` report. Artifacts (manifest, IPA, maps, dSYMs, uploader output, Hermes and smoke evidence) are retained for 90 days; they are review material, not the ledger.

`ci-cli.ts release` (`runRelease` in `ci-release.ts`, with every external step injected for tests) runs, in order:

1. Refuse a rerun attempt; check the checkout is the clean dispatched revision and the sealed smoke evidence matches it. Nothing is claimed yet.
2. Read the durable ledger and App Store Connect. The build number is one above every ASC build, every in-flight ASC upload, every ledger claim, and floor 292. A missing, corrupt, or foreign ledger, or a failed ASC read, fails here.
3. Persist `claimed` before any archive work. If the write fails, stop; the next run rereads the ledger, so a write that landed still burns its number.
4. `release-ios.sh --prepare` (clean prebuild, unsigned archive, Hermes gates, maps), then `--no-upload --skip-build` with API-key signing. Verify the signed export (below), upload source maps through `source-maps.ts upload` and check the cloned map, and persist `verified` with every artifact hash. Any failure persists `abandoned`; the number stays burned. Archive and export never see the PostHog key or ledger token, and the source-map upload never sees the Apple key or ledger token.
5. Recheck the IPA and manifest hashes and that ASC has nothing at or above this number, then persist `upload_started`. The export's own `AWAITING_UPLOAD` record for this number would fail this recheck as written; the executor must exclude it as the local release does (`takenBuildNumbers(..., ownExport)`) before enablement. If that write fails, the uploader is never called.
6. One `xcrun altool --upload-package` of the verified IPA, with the app's numeric `--apple-id` and the build's bundle ID, version, and build number, and the key in an owner-only temporary file removed afterwards. A failure, an interruption, or an error printed with exit 0 leaves `upload_started`: the outcome is unknown, so nothing retries it and the number is never reused.
7. Persist `upload_accepted`. If that write fails, the run reports the upload as unknown; reconciliation shows it.

`ci-cli.ts availability` polls ASC at most 30 minutes (once a minute) and records `processed` only for a `VALID`, unexpired build with this exact build number and version `0.1.0`. A timeout or an unlisted build is reported as unknown, never as proof that retrying is safe. Tester-group access, release metadata, and physical-device acceptance stay separate human checks.

`bun run --cwd apps/mobile scripts/release/ci-cli.ts reconcile` (ledger read token and ASC read key in the environment) is read-only. It lists each ledger record with ASC's view: an `upload_started` build ASC lacks is **unknown**, not failed; ASC builds above the first claim that the ledger never claimed were uploaded by something else. Nothing reconciles automatically, and nothing ever reuses a number.

#### Durable ledger

The ledger lives on the dedicated `ios-release-ledger` branch: `ledger.json` (version, bundle ID, repository) and `events.jsonl`, one event per line. Each build follows `claimed -> verified -> upload_started -> upload_accepted -> processed`, or `claimed | verified -> abandoned`, all from the run that claimed it; one claim per run, claims only increase, and an upload of unknown outcome can never become `abandoned`. Every transition reads the branch head, creates a child commit through the Git data API, moves the ref with `force: false`, and rereads the branch to confirm exactly that event landed. A moved head is refused (`LedgerConflictError`) and never retried. Blobs are checked against their Git object IDs. A missing branch is an error, never an empty ledger. Caches and expiring Actions artifacts are never authoritative. `release-state.ts` remains local preparation bookkeeping only.

#### Signed export gate

`signed-export.ts` unpacks the one exported IPA into a private temporary folder (always removed) and requires: bundle ID, version, and build in `Info.plist`; `main.jsbundle` byte-identical to the stamped archive; `codesign --verify --deep --strict`; an Apple Distribution authority chained to Apple Root CA for team `6C46GY4Z38` and identifier `com.pcobooster.ios`; distribution entitlements (`application-identifier`, team, no `get-task-allow`); an App Store provisioning profile (no device list); every executable's LC_UUID present in the archive's dSYMs and in the IPA's `Symbols/`, with no framework exempt until a real export is reviewed; source maps that `source-maps.ts` ties to this bytecode; Hermes evidence that passed for this revision and bundle hash; and the sealed smoke capture. It writes `release-manifest.json` and returns hashes of the IPA, maps, dSYMs, evidence, and manifest for the ledger. A successful symbol upload, or `uploadSymbols`, is not proof that a real crash symbolicates.

#### Enablement approvals (none granted)

Each item needs explicit approval and proof before the block is removed. None follows from code review or from an uploader exit code.

- `ios-release-upload` environment: `main` only, a required reviewer other than the dispatcher, no self-approval or admin bypass. Confirm the repository supports those rules.
- The `ios-release-ledger` branch, initialized with the header above and an empty `events.jsonl`, protected against deletion and force pushes, writable only by the executor's identity. If `GITHUB_TOKEN` with `contents: write` cannot be limited to that branch, approve a scoped GitHub App token instead of broadening the job.
- An isolated, protected `ios-release-upload` GitHub environment, limited to `main`, holding only ASC read/signing credentials and a separately approved PostHog symbol-upload credential. The workflow must explicitly inject only those keys, validate that boundary, and gain approval in its separate enablement change. Production application and deployment credentials are excluded.
- Apple: a key role and distribution certificate/profile access that make `xcodebuild -exportArchive` with `-allowProvisioningUpdates` and the API key succeed for this app and team. The current read-capable key failed with a cloud-signing permission/certificate error; an actual successful export must replace that.
- The runner's Xcode (`IOS_RELEASE_DEVELOPER_DIR`), its simulator runtime for `iPhone 17 Pro`, and its `altool --upload-package` options, proven on the runner image. A local upload (build 373) proved `--apple-id`, `--bundle-id`, `--bundle-version`, `--bundle-short-version-string`, and `--p8-file-path` with this key on a developer Mac only.
- Checksummed tool releases: `IOS_RELEASE_MAESTRO_URL`/`_SHA256` and `IOS_RELEASE_POSTHOG_CLI_URL`/`_SHA256` (`posthog-cli` 0.18.9).
- A reviewed list of any embedded framework that ships without a dSYM, from a real export. Build 373's export had dSYMs and `Symbols/` entries for the app and every Expo framework, and none for React Native's prebuilt `React.framework`, `ReactNativeDependencies.framework`, and `hermesvm.framework`. The local release exempts exactly those (`PREBUILT_FRAMEWORKS_WITHOUT_DSYMS`); the executor still passes an empty list until this item is approved.
- PostHog: authorization for source-map upload, and a synthetic internal event that symbolicates against the exact release maps.
- The enablement change itself: remove the block step, set `RELEASE_ENABLEMENT` to `"approved"`, and grant `id-token: write` plus the approved ledger writer, in one reviewed commit. Then a separately confirmed dispatch of that exact revision. Apple processing, build/version, tester-group access, metadata, and device acceptance are verified separately afterwards.

dSYMs stay in the archive and the IPA carries `Symbols/`; the source-map workstream (#298) owns JavaScript symbolication beyond these gates.

### Release Hermes gate

`bun run --cwd apps/mobile ios:hermes-gate` checks that the production contracts and the typed product client load in the exact Hermes engine the app ships, from Release bytecode. It resolves the Hermes V1 version React Native's podspec installs, takes that version's release tarball from Maven Central (CocoaPods' shared cache first, checked against Maven's SHA-1), compiles a small runner against the tarball's macOS `hermesvm` framework, bundles a probe with `expo export:embed` (the Release build's own bundling command, configuration, and polyfills), and compiles it with the tarball's `hermesc` and React Native's Release flags (`-emit-binary -O`). The current source must pass and reflect exactly the route table Node computes; the build 371 route parser, put back into a copy of `endpoint.ts`, must fail with build 371's fatal (`/service-types/:serviceTypeId/plans names params [] but declares [serviceTypeId]`), so the gate cannot pass by testing nothing. Node and Bun parse the old routes correctly, which is why only a Hermes check catches it. It takes about 15 seconds and needs macOS and Xcode's clang, not a native app build.

`ios:release` runs the gate before archiving and again after, parsing the entire archived `main.jsbundle` with the matching `hermesc -b -dump-bytecode` reader and recording its SHA-256. A header/version match alone cannot pass. The archive app tree is separately stamped and verified against source before/after the build; the host probe still does not execute the React Native archive bundle or establish native/device startup. Evidence (`evidence.json`, probe output, bytecode hashes) lands in ignored `apps/mobile/build/hermes-gate/runs/<revision>`, labeled `host-hermes-probe`: it covers module load and client construction, not React Native, UIKit, native modules, routing, or a device. The gate is not part of `bun run ci`; run it when a change touches `packages/contracts`, `packages/client`, `packages/planning-center-models`, or app startup, and always before a release.

### Release smoke check

`bun run --cwd apps/mobile ios:release-smoke --build` builds a Release simulator app (Hermes bytecode, no Metro) with `EXPO_PUBLIC_PCOB_RELEASE_SMOKE=1`, selects the first Shutdown shared simulator (`agent-sim-1`, `agent-sim-2`, `agent-sim-3`, then `agent-sim-ipad`; `--simulator` may select one explicitly), uninstalls only this app to clear its container and trigger its own first-install Keychain cleanup, and cold-launches five paths with Maestro: fresh install signed out, signed out offline, fixture sign-in saved to the Keychain, restored session, and restored session offline. The simulator is never erased; exit cleanup shuts down only the simulator this invocation booted. A path passes when its first screen appears, the process is still running, `device.log` has no fatal JS or native error, and no crash report appeared. The smoke flag routes every request to the fixtures, or fails it as a lost connection, while the Keychain, app storage, query-cache restoration, native modules, and router stay real; no Planning Center or production API request is made. `release-ios.sh` refuses to archive with the flag set, and builds without it never read `-PCOBSmoke`. Before/after source fingerprints and full native app/bundle hashes bind the build stamp. Without `--build`, reuse requires the same source state and every app file to match; a dirty stamp cannot be promoted to clean evidence after reverting edits. A sealed evidence tree and manifest validator check all five paths, app/source identity, logs, and screenshots. Revalidate retained evidence with `bun run --cwd apps/mobile scripts/release/artifact-cli.ts verify-evidence <capture-directory> <app-directory>`; the sibling `<capture-directory>.sha256` is an integrity checksum, not a signature against a malicious operator. Evidence lands in `apps/mobile/.captures/release-smoke/<revision>/manifest.json` with each path's log, screenshots, and Maestro output, labeled `simulator-release-smoke`.

Run the smoke check before declaring a beta usable. The Release build takes several minutes and several GB of derived data, so it is not part of PR CI. The smoke check does not cover the signed TestFlight binary, a physical device, native OAuth, or live data; installed-device acceptance is #304.

### After upload

An upload does not establish TestFlight availability. `ios:testflight` waits for `VALID`; `bun run --cwd apps/mobile ios:release:status <build>` (with the key in the environment) reads the build's processing state, version, TestFlight internal and external states, and beta groups at any time. Check that the processed build matches the uploaded number and revision, then confirm tester access in App Store Connect. There is no enabled upload job. The dispatched executor remains blocked until the enablement approvals above are granted and proven. `alchemy.ci.ts` retains the `testflight` environment, and the `TESTFLIGHT_RELEASES` variable for a future job.

## iOS updates (over the air)

Release builds check `https://pcobooster.com/api/updates/manifest` at every cold launch (Expo Updates protocol v1, `expo-updates`). A published update downloads in the background and runs from the next cold launch; the launch never waits for it. Only JavaScript and bundled assets travel this way. Anything native (a new native module, an Expo SDK or React Native upgrade, `app.config.ts` changes, the asset catalog, the signing certificate) needs a TestFlight build.

### Which builds an update reaches

Each build's runtime version is Expo's fingerprint of its native layer (`runtimeVersion: { policy: "fingerprint" }`), and an update reaches only builds with the runtime version it was published for. `apps/mobile/fingerprint.config.cjs` keeps the fingerprint identical on every Mac: it leaves out the version and build number, package.json scripts, and whether the Mac has ccache, and adds `app.config.ts` itself (its config plugin), the asset catalog that plugin copies, the update certificate, and `patches/`. Under bun's isolated install, Expo identifies third-party native modules by package name, version, and store path rather than their files, so their native code changes the runtime version through a version bump or a patch. Any patch counts, server-only ones included; that errs toward needing a new build. The publish warns when nothing is published yet for its runtime version, since a first update reaches only builds whose `build/release/runtime-version` matches. A native change therefore makes a new runtime version, and builds without that change keep the last update published for theirs. Every build's runtime version is in its `EXUpdates.bundle/fingerprint`; `release-ios.sh` refuses an archive without one and records it beside the archive (`build/release/runtime-version`).

### How it is served

- One R2 bucket per stage (`apps/server/src/mobile-update-bucket.ts`), kept for production and staging. Assets are stored under their SHA-256 and never change; each runtime version has one stored answer, `ios/<runtime>/current.json` (`@pcobooster/contracts/mobile-updates`).
- The API Worker reads the bucket through a read-only binding and serves `GET /api/updates/manifest` and `GET /api/updates/assets/:hash` (`packages/api/src/http/mobile-updates.ts`). It answers 204 when nothing is published for a runtime version, "no update available" to a phone already running the update, and the stored manifest or rollback otherwise. Every check logs `update check` with the runtime version, the phone's current update id, and the outcome, so Workers Logs show which builds check in and what they are told.
- Everything a phone receives is signed on the operator's Mac before upload, and builds embed the certificate (`apps/mobile/certs/updates-certificate.pem`, keyid `main`, `rsa-v1_5-sha256`). A phone refuses any manifest or directive the certificate does not verify, and checks every asset against the manifest's hash. The Worker holds no signing key, so neither it nor anyone who can write the bucket can make phones run code the key did not sign. Someone who can write the bucket (deploy tokens and the operator) could still re-serve an older signed answer: a superseded update to phones that have not moved past it, or a rollback to another runtime version, since directives do not name one.
- `expo-updates` falls back to the previous update by itself when a new one crashes before it finishes launching.

### Publishing

```bash
bun run ios:update
```

From a clean checkout at `origin/main`, after main's deploy finished, with the Keychain `mobile-updates` scope (`UPDATES_SIGNING_KEY_PEM_BASE64`) and an Alchemy login (`bun alchemy login`) that can write R2. `apps/mobile/scripts/updates/publish.ts`:

1. Refuses automation markers, an analytics key other than the committed one, a signing key the committed certificate does not accept, and the variables `release-ios.sh` refuses (`EXPO_PUBLIC_PCOB_RELEASE_SMOKE`, `EXPO_PUBLIC_DIAGNOSTICS_PROBES`, `PCOB_UPDATES_URL`). The export inherits no other `EXPO_PUBLIC_` value.
2. Requires `HEAD` to be `origin/main` with no changes and production's API (`health` at pcobooster.com, as `verify-deployment.ts` reads it) to serve that commit, so an update never runs ahead of the API it calls. This read and the live check in step 6 go through pcobooster.com, as phones do; Bot Fight Mode lets them through from the operator's Mac on a home or office connection, but can challenge them from a VPN or cloud host (see [deploy verification](#preview-lifecycle)). Runs `bun install --frozen-lockfile`, `bun run ci`, and the [release smoke check](#release-smoke-check), none of which sees the signing key.
3. Resolves the runtime version, then `expo export --platform ios --clear` with the committed analytics key and this revision (`EXPO_PUBLIC_SOURCE_REVISION`, which diagnostics report). The bundle must be Hermes bytecode that embeds both and passes the [release Hermes gate](#release-hermes-gate).
4. Builds the manifest (every publish is a new update id, so republishing after a rollback reaches the phones that had run it; files are still stored and downloaded once, by hash), signs it and its "no update available" answer, verifies both against the certificate, writes `apps/mobile/build/updates/<revision>/release-prod.json`, and asks for the update id's first 8 characters (`--yes` skips this).
5. Deploys `alchemy.mobile-updates.ts --stage prod` with the operator's Alchemy login, never a token in the environment. It rechecks every file's hash, stores the files not already stored, and writes the answer last; the Worker serves it from that moment.
6. Asks the live route as a phone would and checks the manifest, the "no update available" answer, every signature, and every asset hash.

Source maps from the export stay in `apps/mobile/build/updates/<revision>/export`; they are not uploaded.

### Rolling back

```bash
bun run ios:update --rollback [--runtime-version <fingerprint>]
```

Signs a "roll back to embedded" answer for the runtime version (`--runtime-version`, or the checkout's when it has no changes), and refuses when that runtime version has no update published, so a rollback cannot report success for builds that are not running one. No preflight runs: phones of that runtime version go back to the JavaScript their build shipped with at their next cold launch, and phones already on it are told nothing changed. Publishing a fix later replaces the rollback. To move forward instead, revert on main and publish normally.

### Status

```bash
bun run ios:update:status [--runtime-version <fingerprint>]
```

Asks production as a phone of this checkout's runtime version (or the one given) would, and prints nothing, the update (id, published time, revision), or the rollback, with whether the signature verifies. It needs no credentials.

### Rehearsing locally

With `bun run dev` running, build a Release simulator app that asks the local stack, then publish to it from any checkout (no preflight; files and answer go to the local bucket):

```bash
PCOB_UPDATES_URL=http://127.0.0.1:<web port>/api/updates/manifest EXPO_NO_DOTENV=1 NODE_ENV=production \
  bun run --cwd apps/mobile ios:build --configuration Release --udid <simulator>
bun run ios:update --stage local --yes
```

`PCOB_UPDATES_URL` changes the runtime version, so a rehearsal build only accepts rehearsal updates, and `release-ios.sh` refuses to archive with it set.

### Signing key

The key was generated with `npx expo-updates codesigning:generate` (RSA 2048, certificate valid to 2036-10-09) and lives only in the operator's Keychain; keep a backup (for example in a password manager). Losing it does not break installed builds, but no update can reach them until a TestFlight build ships a new certificate. To rotate: generate a new pair, commit the new certificate, save the key with `bun run secrets:set mobile-updates UPDATES_SIGNING_KEY_PEM_BASE64 --stdin`, and ship a TestFlight build. The certificate is part of the fingerprint, so the new build has a new runtime version and old builds keep the last update signed with the old key.

### Not yet automated

Publishing runs from a person's Mac, like TestFlight uploads. A CI executor would need the signing key in a protected GitHub environment with a required reviewer, and its own approval.

## Deployment credentials and token scope

`alchemy.ci.ts` provisions scoped Cloudflare account API tokens and writes their values as encrypted `GitHub.Secret` resources. This follows [Alchemy's Cloudflare CI pattern](https://alchemy.run/cloudflare/tutorial/part-5/). Unlike the former Infisical flow, this stores the deployment token in GitHub rather than obtaining it through an OIDC exchange.

- Preview token: `cloudflare-preview`, `cloudflare-preview-cleanup`, and `cloudflare-staging` environments.
- Production token: only `production`, restricted to `main`.
- `production` is the one jbolabs environment for production secrets. It also carries `INFISICAL_IDENTITY_ID` (`ci-prod`) and `INFISICAL_OIDC_AUDIENCE`, the only subject `ci-prod` trusts (`repo:jbolabs@305914027/*:environment:production`). A job that reads `pcobooster-prod` declares `environment: production` and `id-token: write`; no job does yet. It replaced `cloudflare-production`, which Alchemy retains untouched: delete it by hand after the rename merges. `scripts/infra/environments.test.ts` fails if `production` admits any branch other than `main`.
- Access check credentials: only preview and staging environments. Their service-token ID is a variable.
- Optional PostHog annotation key: only production. Signing/release credentials are separate and the release executor stays blocked.

The preview token permits account-level Workers Scripts, KV, D1, R2, Secrets Store, Flagship, and Access writes. Production adds the existing zone-specific DNS, redirects, WAF, and bot permissions; neither can administer tokens. These grants can affect other resources in the same account. Namespaces and GitHub environments do not enforce per-secret Cloudflare isolation: a preview deployer with Workers and Secrets Store Edit can bind another account secret to code it controls. Keep preview approval strict. Separate Cloudflare accounts are required if previews must be unable to consume production secrets under the current account-level permission model.

## Control plane as code

The retained `pcobooster-ci/ci` stack owns repository merge settings, the existing main ruleset, deployment environments, variables, Cloudflare tokens, encrypted GitHub environment credentials, and staging's Access service token. Existing generated token values are reused without rotation during migration. Token rotation is still performed by bumping `deployTokens.generation` and its expiry; all environment secrets are updated before the previous generation is revoked.

Local `infra:plan` and `infra:deploy` obtain GitHub authentication through `gh auth token`, configuration from the Keychain preview/production scopes, and Cloudflare authentication from the saved Alchemy OAuth profile. Secret values are captured internally and never printed. Without token-admin permission the plan trusts recorded token state; reading or changing deploy tokens requires it: provide a short-lived `CLOUDFLARE_TOKEN_ADMIN_API_TOKEN` with Account API Tokens Edit, then delete it after the approved operation.

`bun run infra:plan` is a dry run with drift detection. Review the plan and confirm with Jake before `bun run infra:deploy`. The separate runtime-secret plans (`secrets:plan:preview`, `secrets:plan:production`) must also be reviewed before their deployment commands. [Migration order and acceptance](secrets-migration.md) prevents merging consumer code before its prerequisites exist.

Old Infisical resources and obsolete environment variables are retained externally until cutover acceptance; removing their code declarations does not delete them. Their identities should be revoked only after the replacement deployments, recovery path, and local commands are verified.

## Cloudflare drift

### Refreshing the production zone activation record

The `Cloudflare drift` workflow reads provider state and reports configuration or zone-status changes. `scripts/cloudflare/drift-comparison.ts` excludes only verified provider representation differences and timestamps; it retains zone status.

On October 8, 2026, run [37810110050](https://github.com/bodegalabs/pcobooster/actions/runs/37810110050) confirmed all 11 staging resources matched. Production differed only in the logical `Zone` status: Alchemy still recorded `pcobooster.com` as `pending`, while the same zone had been active since September 23. `FormerZone` is the separate `worshipadmin.com` record and is outside this maintenance operation.

`refresh-production-zone-activation.ts` is custom maintenance through Alchemy's public `StateService` and Zone provider APIs. Alchemy beta.79 has no targeted accept-live operation: the [drift CLI](https://alchemy.run/cli/drift) repairs every observed resource, and the [state CLI](https://alchemy.run/cli/state) lists, reads, or deletes records. This script reads only `pcobooster/prod/Zone` and its exact provider zone; it updates only the recorded status and activation/modification timestamps. It preserves desired props, resource lifecycle metadata, bindings, and all other attributes. It never invokes provider reconciliation or changes Cloudflare zone settings, DNS, Workers, or `FormerZone`.

Use the saved default Alchemy Cloudflare profile, with stray deployment credentials removed. The dry run does not need application secrets or evaluate the application stack:

```sh
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID bun scripts/cloudflare/refresh-production-zone-activation.ts
```

After reviewing the reported three fields, confirm no local or GitHub production deployment is running or queued in the `cloudflare-prod` concurrency group. Then apply the single record refresh:

```sh
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID bun scripts/cloudflare/refresh-production-zone-activation.ts --apply
```

The script requires the hardcoded account, zone ID, and hostname to match both stored and observed attributes, and permits only `pending` to `active`. It refuses configuration changes, missing resources, unstable resource lifecycle states, and a changed record immediately before the write. Alchemy's StateService has no atomic compare-and-set, so keeping deployments idle remains necessary. The script verifies the record after writing; a later invocation returns `already-active` without writing. Finally dispatch the read-only `Cloudflare drift` workflow on `main` and verify both stage reports. Keep status comparisons enabled so future inactive or moved zones remain visible.

The one-time refresh was applied on October 8 after independent review and idle deployment checks, using the saved `admin` Alchemy profile. A subsequent invocation returned `already-active` with no differing fields. Read-only [run 37811619586](https://github.com/bodegalabs/pcobooster/actions/runs/37811619586) then passed on revision `352dd1d442a8444c975d650770371c64a0bfaad4`: all 25 production resources and all 11 staging resources matched. The ordinary drift matcher remained unchanged.

## Merge gates

The `main` ruleset requires `ci` and `cloudflare-build` and is managed by `alchemy.ci.ts`. Preserve squash-only merging and the absence of bypass actors. There is deliberately no merge queue: merges rarely overlap, and `ci` and `cloudflare-build` rerun on the merged commit before production, so a conflict between two pull requests fails there instead of reaching production (staging, deployed alongside validation, may briefly serve it). Never remove a gate merely to bypass a red or missing check.

Cloudflare/D1 became the live production system on September 23, 2026; see the [cutover record](cloudflare-cutover.md). Vercel temporarily forwards cached DNS traffic to Cloudflare, and Neon is retained as the source snapshot. Follow [database migration and rollback](database.md): after D1 accepts new writes, routing back to the old PostgreSQL snapshot alone is not a safe rollback.
