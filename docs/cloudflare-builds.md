# Cloudflare Builds PR validation

`alchemy.builds.ts` owns the webhook, controller, native Builds triggers, credentials, R2 ledgers, cache and cleanup schedule. The cutover configuration accepts same-repository PRs, routes main releases through a serialized queue, and schedules maintenance. This configuration must not be applied until the acceptance gates below pass.

Apply the control plane with `bun scripts/secrets/infra.ts bun alchemy deploy alchemy.builds.ts --stage builds-control --profile admin --no-input --yes`. The GitHub Cloudflare application must already be installed on this repository. The previous benchmark trigger is retired through `alchemy.builds-trial.ts` so it does not duplicate PR builds.

Signed same-repository PR deliveries dispatch a build of the exact head. The build checks that the PR remains open and current, merges its exact base into the checkout, reinstalls the merged lockfile, audits newly introduced high/critical dependency advisories, runs affected checks with remote Turbo caching, builds fresh, and deploys an isolated stage. Forks are excluded because preview deployment requires account credentials. Repository writers are trusted to execute code with preview credentials; Cloudflare does not offer stage-scoped deployment tokens.

The controller's `/preview/<number>` link redirects only to a successful build matching the current head and base, and rejects cleaned previews. Daily cleanup and PR-close events scan provider build history so lost ledger writes cannot orphan stages. Failed, closed, superseded and three-day-old deployments are destroyed using the isolated cleanup stack. Each build has its own stage; cleanup never targets staging or production.

Only validation artifacts are cached. Patch installation, dependency review, frontend builds and deployment verification execute fresh. The cache bucket expires artifacts after seven days. Existing dependency advisories are baseline findings, not silently upgraded dependencies.

## Dispatch recovery

Stateful maintenance has one conditional R2 lock. A definitive API rejection permits a retry; an uncertain outcome retains the lock and raises an error. The authenticated `GET /dispatch` returns its attempt ID. An operator can inspect authoritative Cloudflare build history, then `POST /dispatch` with `{ "attempt": "...", "build": "..." }` and the Alchemy-managed control bearer token. The controller validates the build's trigger, branch and creation time before conditionally adopting it. Active adopted builds still block another dispatch. There is deliberately no timer that unlocks an uncertain deployment. If no build exists, the lane stays blocked pending explicit operator investigation; the adoption endpoint cannot prove non-dispatch.

## Acceptance and rollback

Before replacing merge requirements, prove API-dispatched native GitHub checks for both success and deliberate failure at the exact head SHA, preview access and cleanup/reopen behavior. Local CI alone does not prove those integrations. Keep Actions until the separate cutover PR passes these gates. Roll back this parallel rollout by reverting the control-plane change and applying Alchemy; production and existing Actions remain independent.

### Repository reads

GitHub anonymous API reads returned 403 from the controller's shared egress. The private `PCOBooster Cloudflare CI` GitHub App (5385188, installation 173133738) is installed only on `jbolabs/pcobooster`, with read-only Contents, Pull Requests and mandatory Metadata permissions. Its declarative registration specification is `scripts/cloudflare/builds/github-app-manifest.json`; GitHub registration and installation are a one-time administrator step.

Store the downloaded signing key as PKCS8 PEM in the `builds-control` Keychain scope under `BUILDS_GITHUB_APP_PRIVATE_KEY`. `scripts/secrets/infra.ts` supplies it to the Alchemy stack; Alchemy owns the encrypted controller binding and the separate random repository-reader credential. The signing key stays in the controller. Runners call its authenticated `/github/` read proxy, restricted to PR details, commit-to-PR lookup and the current main commit. Neither the signing key nor the GitHub installation token is returned to build jobs. Validation subprocesses remove the reader credential together with deployment credentials.

## Cutover and rollback

This layer removes all four Actions workflows and the unused composite actions. iOS remains on the existing guarded `ios:testflight` Mac command. It does not enable the dormant CI uploader or remove local release gates.

Before activation:

1. Repository-scoped authentication replaces anonymous GitHub reads. Verify exact-head native check success and failure, preview redirects, close cleanup and reopening.
2. Rehearse the release runner's full validation phase on Workers Builds and verify pending releases and maintenance share one lane. Keep production deployment disabled during rehearsal.
3. Apply the Alchemy-managed ruleset only after the upper PR has a successful current Cloudflare check. It replaces the two Actions checks with the Cloudflare check and requires an up-to-date branch. Merge the separately reviewed removal PR only with explicit approval.
4. Apply `alchemy.builds.ts` from merged main. This enables trusted-main releases and two-minute queue draining. The first release is an explicit authenticated `POST /release` through the controller; this is a production operation requiring approval. Confirm staging, production revision, custom domains and PostHog annotation.

The cutover is not live while this PR is a draft. Dry-run the control plane before applying it. The native GitHub app installation remains a one-time account authorization; credentials, triggers and control-plane settings belong in Alchemy.

Rollback: disable release dispatch through Alchemy before restoring Actions, wait for the stateful lane and pending queue to be idle, revert the removal PR, and reapply the previous Alchemy control plane and ruleset. Restore both the workflows and their merge checks together. Inactive GitHub environment credentials remain available for this rollback, subject to their existing expiry. Reverting CI does not roll back deployed application code or D1 data.

The disposable `alchemy.builds-rehearsal.ts` stack (`builds-rehearsal` stage) runs `scripts/cloudflare/builds/release-validation.ts` on the cutover branch with a no-op deploy command. Production uses the same `validateRelease` function. Destroy this rehearsal stack after capturing its successful build evidence.
