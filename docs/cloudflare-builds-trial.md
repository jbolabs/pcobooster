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

The check command runs `bun run ci` and `bun run build:cloudflare`. The deploy command runs the pinned Alchemy CLI, then checks the deployed web and API revision using the dedicated Access token. `GITHUB_SHA` is set from Cloudflare's verified commit SHA for the application's existing version endpoint. Build caching is disabled during the trial.

The application receives fresh D1, KV, R2, and Workers resources for its stage and uses the existing preview runtime secret references. It does not copy production data or exercise live Planning Center writes. A successful smoke check proves deployment and revision routing; it does not establish full application behavior or long-term provider reliability.

## Cleanup

The verified build log prints its stage. Failed or interrupted builds may also leave a stage; derive it from the first 12 hexadecimal characters of their build UUID, ignoring hyphens.

```sh
bun scripts/cloudflare/builds-trial/manage.ts destroy-app builds-trial-0123456789ab
bun scripts/cloudflare/builds-trial/manage.ts destroy-control
```

Application cleanup refuses every stage outside the trial pattern. Control cleanup removes its runner, trigger, and dedicated credentials. The repository connection is shared and is retained. GitHub app authorization is also retained; removing it later requires an explicit account-level decision. Existing production/staging stacks and `.github/workflows` are not part of either cleanup stack.

Do not promote this trial to production merely because a build is green. First inspect hosted check logs, deployment verification, duration, and cleanup behavior, then separately decide how to handle PR checks and production deployment ordering.
