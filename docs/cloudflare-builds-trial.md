# Cloudflare Builds trial

This experiment runs PCOBooster's existing checks and Alchemy application stack on Cloudflare's hosted build machines. It does not replace GitHub Actions. Only `codex/cloudflare-builds-trial` triggers it; every build deploys a separate `builds-trial-<12 hex>` stage derived from its build UUID. The wrapper validates the branch and checked-out SHA and rejects inherited stage/domain overrides before running any deployment.

## Provisioning

GitHub must first authorize the Cloudflare Workers and Pages app for `jbolabs/pcobooster`. This one-time account authorization is outside Alchemy. The private runner Worker, dedicated expiring deploy token, Access verification token, repository connection, trigger, commands, and environment variables are declared in `alchemy.builds-trial.ts` and its custom provider. The runner only anchors the build trigger; the deploy command runs the real application stack.

```sh
bun scripts/cloudflare/builds-trial/manage.ts plan
bun scripts/cloudflare/builds-trial/manage.ts apply
```

These local commands use the existing Alchemy `admin` profile. The only Keychain setting they read into the stack is the preview admin email allowlist. The hosted build receives a dedicated user-owned API token scoped to this account (expires October 26, 2026), not the admin profile. Workers Builds currently rejects account-owned tokens before checkout; see [Cloudflare token requirements](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token). Cloudflare token permissions are account-wide; branch and stage guards provide the experiment's deployment boundary, rather than a provider-enforced resource sandbox. Only trusted commits belong on this branch.

## Hosted execution

The check command fetches full checkout history and `origin/main` for migration-history validation, then runs the same lint, typecheck, install-integrity, and test gates as `bun run ci`, followed by `bun run build:cloudflare`. Turbo package checks run with `--concurrency=1` so each package can use its four Vitest workers without oversubscribing the four-core build machine. Test assertions and timeouts are unchanged. The deploy command runs the pinned Alchemy CLI, then checks the deployed web and API revision using the dedicated Access token. `GITHUB_SHA` is set from Cloudflare's verified commit SHA for the application's existing version endpoint. Cloudflare build caching is enabled declaratively through `buildCaching: true`. The first successful build populates Bun's dependency-download cache; the next build restores it. Turbo remains forced to execute so this trial measures dependency-cache savings without reusing test results or deployment outputs. Cloudflare's documented native framework cache does not include Turbo or TanStack Start.

The application receives fresh D1, KV, R2, and Workers resources for its stage and uses the existing preview runtime secret references. It does not copy production data or exercise live Planning Center writes. A successful smoke check proves deployment and revision routing; it does not establish full application behavior or long-term provider reliability.

## Cleanup

The verified build log prints its stage. Failed or interrupted builds may also leave a stage; derive it from the first 12 hexadecimal characters of their build UUID, ignoring hyphens.

```sh
bun scripts/cloudflare/builds-trial/manage.ts destroy-app builds-trial-0123456789ab
bun scripts/cloudflare/builds-trial/manage.ts destroy-control
```

Application cleanup refuses every stage outside the trial pattern. Control cleanup removes its runner, trigger, and dedicated credentials. The repository connection is shared and is retained. GitHub app authorization is also retained; removing it later requires an explicit account-level decision. Existing production/staging stacks and `.github/workflows` are not part of either cleanup stack.

Do not promote this trial to production merely because a build is green. First inspect hosted check logs, deployment verification, duration, and cleanup behavior, then separately decide how to handle PR checks and production deployment ordering.

## Verified result: October 19, 2026

Cloudflare build `c102fab1-41c3-4cab-a7aa-7276ba15f1d0` succeeded for commit `f6bd58e94b78f480dd15a2df8f5d1231e99c0cf2`. It ran from 16:43:43 to 16:47:30 UTC (3m47s including initialization), with build caching disabled. Hosted logs recorded 3,565 passing tests, successful typechecking and frontend builds, all 13 Alchemy application resources created, and the expected SHA served through the web/API verification path.

Two earlier attempts exposed configuration differences, now handled in code:

- Account-owned tokens fail before checkout; use `UserApiToken` with account-scoped policies.
- The default checkout lacked `origin/main`, and parallel package suites oversubscribed four cores. Fetch the required history and serialize package gates. All test assertions and timeouts remain unchanged.

The trial application and control stack were both destroyed successfully after verification (13 and four resources respectively). Read-only checks confirmed no remaining trial Workers or registered build tokens. The repository connection and approved GitHub app installation remain available for future use. No active Builds trigger remains.

No existing Actions files were changed and no trial commit was merged. An unrelated existing main workflow ran concurrently: GitHub Actions run `39285661204` deployed `def7c82fd09f9b30a3f920c2ad5849cc8a526196` to staging and production. Production's `/version` matched that main SHA, not the trial SHA. The trial only deployed `builds-trial-c102fab141c3`.

This proves hosted Alchemy compatibility and teardown, not sustained availability, PR-check replacement, or production migration readiness. At roughly four minutes per run, [Workers Paid's 6,000 included monthly build minutes](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) would cover approximately 1,500 similar runs across the account. Additional build time is $0.005/minute, about $0.02 for a similar run; this is a pricing estimate, not a measured invoice.

### Affected validation and Turbo cache trial

The trial reuses `validationScope` against fetched `origin/main`, including dependent packages and root guards. Shared infrastructure/configuration changes deliberately choose full validation. Missing history fails closed. The fetched main revision also participates in validation cache keys because repository guards inspect its history.

`alchemy.builds-trial.ts` owns a separate authenticated Turbo cache Worker, random bearer secret, and private R2 bucket with seven-day object expiry. Only trial lint/typecheck/test tasks use remote caching. Patch-install checks always execute. Validation subprocesses have deployment credentials removed. The cache namespace pins Linux x64 and the trial toolchain; it is not shared with GitHub Actions or production. Application build and Alchemy deployment commands force fresh execution and disable remote caching.

A warm measurement uses an empty commit with the same Git tree after a successful cache-populating build. Compare check-command duration and actual Turbo hit counts, not replayed test log timestamps. Native dependency caching is a separate setting and may have variable restore overhead.
