# CI and deployment

Cloudflare Workers Builds validates same-repository pull requests and deploys isolated previews. The Alchemy-managed controller dispatches exact revisions, checks their current base, and manages cleanup. See [Cloudflare Builds](cloudflare-builds.md) for credentials, lifecycle and recovery.

Run `bun run ci` and `bun run build` before a PR. During development use `bun run ci:affected --base origin/main`; stacked work uses its preceding branch. Final proof still requires full local gates. PR validation uses a separate expiring remote Turbo cache. Production runs full fresh validation, then deploys staging, verifies its revision, checks freshness again, deploys production and verifies both revision and domain routing. PostHog annotation remains part of the release.

A single conditional R2 lane serializes production, cleanup and drift checks. New release requests remain queued while a build runs. A two-minute Cron drains pending requests; daily maintenance scans provider build history, sweeps legacy `pr-*` stages and checks staging/production drift without repairing it. Unknown dispatch outcomes block the lane until reconciled; they are never unlocked by a timer.

Fork previews are excluded because Cloudflare deployment credentials are account-scoped. Only repository writers may run preview code. The Cloudflare native check is the required merge gate after cutover, pinned to app 85455 and requiring an up-to-date branch. Missing checks block merging.

## iOS releases (TestFlight)

TestFlight builds ship from a person's Mac with `ios:testflight`, the one supported local upload path. `ios:release` on its own still only prepares archives or exports signed IPAs, and `release-ios.sh --upload` stays refused.

### Local TestFlight release

From the main checkout (or any worktree) at `origin/main` with no changes, signed into Xcode with an account on team `6C46GY4Z38`, with a shared `agent-sim-*` simulator and Maestro installed (see [Release smoke check](#release-smoke-check)):

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

### Local release safety

The Actions release workflow is removed. Use `ios:testflight` above; its local checkout, build-number claim, exact revision, Hermes, signed-export and interactive upload checks remain intact. The dormant CI executor remains blocked and receives no credentials. Removing the workflow does not enable it. `ios:release --upload` remains refused.

#### Signed export gate

The local TestFlight command checks the exported IPA before uploading. It retains the existing signing, bundle identity, version, symbol and artifact checks. Do not bypass these gates to reuse a failed upload's build number.

### Release Hermes gate

`bun run --cwd apps/mobile ios:hermes-gate` checks that the production contracts and the typed product client load in the exact Hermes engine the app ships, from Release bytecode. It resolves the Hermes V1 version React Native's podspec installs, takes that version's release tarball from Maven Central (CocoaPods' shared cache first, checked against Maven's SHA-1), compiles a small runner against the tarball's macOS `hermesvm` framework, bundles a probe with `expo export:embed` (the Release build's own bundling command, configuration, and polyfills), and compiles it with the tarball's `hermesc` and React Native's Release flags (`-emit-binary -O`). The current source must pass and reflect exactly the route table Node computes; the build 371 route parser, put back into a copy of `endpoint.ts`, must fail with build 371's fatal (`/service-types/:serviceTypeId/plans names params [] but declares [serviceTypeId]`), so the gate cannot pass by testing nothing. Node and Bun parse the old routes correctly, which is why only a Hermes check catches it. It takes about 15 seconds and needs macOS and Xcode's clang, not a native app build.

`ios:release` runs the gate before archiving and again after, parsing the entire archived `main.jsbundle` with the matching `hermesc -b -dump-bytecode` reader and recording its SHA-256. A header/version match alone cannot pass. The archive app tree is separately stamped and verified against source before/after the build; the host probe still does not execute the React Native archive bundle or establish native/device startup. Evidence (`evidence.json`, probe output, bytecode hashes) lands in ignored `apps/mobile/build/hermes-gate/runs/<revision>`, labeled `host-hermes-probe`: it covers module load and client construction, not React Native, UIKit, native modules, routing, or a device. The gate is not part of `bun run ci`; run it when a change touches `packages/contracts`, `packages/client`, `packages/planning-center-models`, or app startup, and always before a release.

### Release smoke check

`bun run --cwd apps/mobile ios:release-smoke --build` builds a Release simulator app (Hermes bytecode, no Metro) with `EXPO_PUBLIC_PCOB_RELEASE_SMOKE=1`, erases the dedicated `pcob-release-smoke` simulator (create it once with `xcrun simctl create pcob-release-smoke "iPhone 17 Pro"`), and cold-launches five paths with Maestro: fresh install signed out, signed out offline, fixture sign-in saved to the Keychain, restored session, and restored session offline. A path passes when its first screen appears, the process is still running, `device.log` has no fatal JS or native error, and no crash report appeared. The smoke flag routes every request to the fixtures, or fails it as a lost connection, while the Keychain, app storage, query-cache restoration, native modules, and router stay real; no Planning Center or production API request is made. `release-ios.sh` refuses to archive with the flag set, and builds without it never read `-PCOBSmoke`. Before/after source fingerprints and full native app/bundle hashes bind the build stamp. Without `--build`, reuse requires the same source state and every app file to match; a dirty stamp cannot be promoted to clean evidence after reverting edits. A sealed evidence tree and manifest validator check all five paths, app/source identity, logs, and screenshots. Revalidate retained evidence with `bun run --cwd apps/mobile scripts/release/artifact-cli.ts verify-evidence <capture-directory> <app-directory>`; the sibling `<capture-directory>.sha256` is an integrity checksum, not a signature against a malicious operator. Evidence lands in `apps/mobile/.captures/release-smoke/<revision>/manifest.json` with each path's log, screenshots, and Maestro output, labeled `simulator-release-smoke`.

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

## Control plane and credentials

`alchemy.builds.ts` owns the Builds credentials, triggers, webhook, controller and caches. Preview, release and maintenance use separate credentials. Release and maintenance run only trusted `main`; their tokens include the existing production zone permissions. PR credentials do not include zone permissions, but their account-level Workers and Secrets Store grants still require trusted repository writers.

`alchemy.ci.ts` continues owning repository protection and the inactive GitHub environment credentials for rollback. Applying the cutover updates its required check to Cloudflare; do not apply before hosted acceptance. The separate removal PR is the rollback boundary. See [cutover steps](cloudflare-builds.md#cutover-and-rollback).

## Cloudflare drift

Daily serialized maintenance runs `scripts/cloudflare/check-drift.ts` for staging and production. A drift failure is visible in the native maintenance build and never repairs resources automatically.

### Refreshing the production zone activation record

The `Cloudflare drift` workflow reads provider state and reports configuration or zone-status changes. `scripts/cloudflare/drift-comparison.ts` excludes only verified provider representation differences and timestamps; it retains zone status.

On October 8, 2026, run [37810110050](https://github.com/bodegalabs/pcobooster/actions/runs/37810110050) confirmed all 11 staging resources matched. Production differed only in the logical `Zone` status: Alchemy still recorded `pcobooster.com` as `pending`, while the same zone had been active since September 23. `FormerZone` is the separate `worshipadmin.com` record and is outside this maintenance operation.

`refresh-production-zone-activation.ts` is custom maintenance through Alchemy's public `StateService` and Zone provider APIs. Alchemy beta.79 has no targeted accept-live operation: the [drift CLI](https://alchemy.run/cli/drift) repairs every observed resource, and the [state CLI](https://alchemy.run/cli/state) lists, reads, or deletes records. This script reads only `pcobooster/prod/Zone` and its exact provider zone; it updates only the recorded status and activation/modification timestamps. It preserves desired props, resource lifecycle metadata, bindings, and all other attributes. It never invokes provider reconciliation or changes Cloudflare zone settings, DNS, Workers, or `FormerZone`.

Use the saved default Alchemy Cloudflare profile, with stray deployment credentials removed. The dry run does not need application secrets or evaluate the application stack:

```sh
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID bun scripts/cloudflare/refresh-production-zone-activation.ts
```

After reviewing the reported three fields, confirm the Cloudflare stateful lane and its queue are idle. Then apply the single record refresh:

```sh
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID bun scripts/cloudflare/refresh-production-zone-activation.ts --apply
```

The script requires the hardcoded account, zone ID, and hostname to match both stored and observed attributes, and permits only `pending` to `active`. It refuses configuration changes, missing resources, unstable resource lifecycle states, and a changed record immediately before the write. Alchemy's StateService has no atomic compare-and-set, so keeping deployments idle remains necessary. The script verifies the record after writing; a later invocation returns `already-active` without writing. Finally run the serialized maintenance build and verify both drift reports. Keep status comparisons enabled so future inactive or moved zones remain visible.

The one-time refresh was applied on October 8 after independent review and idle deployment checks, using the saved `admin` Alchemy profile. A subsequent invocation returned `already-active` with no differing fields. Read-only [run 37811619586](https://github.com/bodegalabs/pcobooster/actions/runs/37811619586) then passed on revision `352dd1d442a8444c975d650770371c64a0bfaad4`: all 25 production resources and all 11 staging resources matched. The ordinary drift matcher remained unchanged.

## Merge gates

The desired `main` ruleset requires `Workers Builds: pcobooster-pr-validation` from Cloudflare app 85455 and an up-to-date PR base. It is managed by `alchemy.ci.ts`. Preserve squash-only merges and no bypass actors. Never remove a gate to bypass a red or missing check.

Cloudflare/D1 became the live production system on September 23, 2026; see the [cutover record](cloudflare-cutover.md). Vercel temporarily forwards cached DNS traffic to Cloudflare, and Neon is retained as the source snapshot. Follow [database migration and rollback](database.md): after D1 accepts new writes, routing back to the old PostgreSQL snapshot alone is not a safe rollback.
