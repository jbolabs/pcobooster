# Cloudflare Builds PR validation

`alchemy.builds.ts` owns the webhook, controller, native Builds triggers, credentials, R2 ledgers, cache and cleanup schedule. The initial rollout accepts only `codex/cloudflare-builds-trial`. Production dispatch is disabled and existing Actions remain authoritative.

Apply the control plane with `bun scripts/secrets/infra.ts bun alchemy deploy alchemy.builds.ts --stage builds-control --profile admin --no-input --yes`. The GitHub Cloudflare application must already be installed on this repository. The previous benchmark trigger is retired through `alchemy.builds-trial.ts` so it does not duplicate PR builds.

Signed same-repository PR deliveries dispatch a build of the exact head. The build checks that the PR remains open and current, merges its exact base into the checkout, reinstalls the merged lockfile, audits newly introduced high/critical dependency advisories, runs affected checks with remote Turbo caching, builds fresh, and deploys an isolated stage. Forks are excluded because preview deployment requires account credentials. Repository writers are trusted to execute code with preview credentials; Cloudflare does not offer stage-scoped deployment tokens.

The controller's `/preview/<number>` link redirects only to a successful build matching the current head and base, and rejects cleaned previews. Daily cleanup and PR-close events scan provider build history so lost ledger writes cannot orphan stages. Failed, closed, superseded and three-day-old deployments are destroyed using the isolated cleanup stack. Each build has its own stage; cleanup never targets staging or production.

Only validation artifacts are cached. Patch installation, dependency review, frontend builds and deployment verification execute fresh. The cache bucket expires artifacts after seven days. Existing dependency advisories are baseline findings, not silently upgraded dependencies.

## Dispatch recovery

Stateful maintenance has one conditional R2 lock. A definitive API rejection permits a retry; an uncertain outcome retains the lock and raises an error. The authenticated `GET /dispatch` returns its attempt ID. An operator can inspect authoritative Cloudflare build history, then `POST /dispatch` with `{ "attempt": "...", "build": "..." }` and the Alchemy-managed control bearer token. The controller validates the build's trigger, branch and creation time before conditionally adopting it. Active adopted builds still block another dispatch. There is deliberately no timer that unlocks an uncertain deployment. If no build exists, the lane stays blocked pending explicit operator investigation; the adoption endpoint cannot prove non-dispatch.

## Acceptance and rollback

Before replacing merge requirements, prove API-dispatched native GitHub checks for both success and deliberate failure at the exact head SHA, preview access and cleanup/reopen behavior. Local CI alone does not prove those integrations. Keep Actions until the separate cutover PR passes these gates. Roll back this parallel rollout by reverting the control-plane change and applying Alchemy; production and existing Actions remain independent.
