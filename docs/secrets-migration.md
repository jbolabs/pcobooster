# Secrets migration

The approved secret-store and GitHub configuration changes were applied on 2026-10-08. All 10 application secrets report active with Workers-only scopes. All 9 encrypted GitHub environment secrets were verified present with new timestamps, and all 5 configuration variables match their existing values. Both original Cloudflare deployment tokens remain active with the same identities. Follow-up migration plans report no changes. The app and workflow changes are still local in this worktree; consumer rollout and acceptance remain pending.

The runtime-secret dry runs adopt the existing account store and create 3 preview and 7 production secrets. After refreshing the Cloudflare OAuth profile, `infra:plan` successfully completed its live inspection and produced the same migration plan, preserving the existing deployment tokens and Access service token. The inspection reports repository metadata drift and a missing, unused `TESTFLIGHT_RELEASES` variable in the old state. A separate GitHub read confirmed every managed merge setting matches the declaration. Do not run automatic drift repair for these unrelated records during migration. The normal control-plane deployment plan does not propose changing them.

Verified locally: `bun run ci`, all three app builds, ordinary Keychain-backed development startup and API/product HTTP 200 responses, cloud-development startup with fictional Cloudflare credentials, and a native workerd Secrets Store rotation with concurrent request-body reads. The Apple Keychain scope successfully authenticated a read-only App Store Connect build query; no signing or upload was attempted. The preview/production broker credentials match. Remote bindings, session continuity, OAuth sign-in, and remote rotation remain cutover acceptance work.

The app dry runs resolve the new central secret references: staging proposes 3 Worker updates and 5 binding changes, production 3 Worker updates and 9 binding changes. Database, schema, and existing zone/cache/flag resources report no changes. These plans were not applied.

The control-plane apply created 9 encrypted GitHub environment secrets and 5 variables, left the existing Cloudflare resources unchanged, and retained 22 old Infisical/variable objects externally while removing their Alchemy ownership rows. The 9 secrets are 4 deploy-token copies, 4 Access client credential copies, and 1 production PostHog annotation key. The 5 variables are 3 app-environment admin allowlists and 2 Access service-token IDs.

## Ownership

- `alchemy.secrets.ts`, stack `pcobooster-secrets`: the sole writer for retained runtime secrets. Stages `prod` and `preview` hold 8 and 3 secrets respectively (production added `POSTHOG_ERASURE_API_KEY` after the migration). Product stacks only reference them.
- `alchemy.ci.ts`: generated deployment tokens and Access check credentials, delivered as encrypted GitHub environment secrets. It reuses existing token generations and service-token values during migration.
- Infisical `pcobooster-prod` (envs `preview`, `prod`): the source `alchemy.secrets.ts` reads natively (`Infisical.Secrets`), with the operator's `admin` Alchemy profile. Infisical `pcobooster-dev` (env `dev`) holds the development credentials stage `local` reads. See [Infisical](environment.md#infisical).
- macOS Keychain: `com.pcobooster.secrets.<scope>`, one generic-password item per key. Active scopes: the Planning Center sandbox, Apple signing, update signing, analytics erasure, PostHog administration, and legacy recovery. The `local`, `cloud`, `preview`, and `production` scopes are legacy.
- Public configuration stays in source. Process-owned development switches are not imported. User OAuth tokens remain in D1.

Infisical `pcobooster-prod` is the bootstrap and rotation input for the central secrets stack, not an input required by a running application. Rotate in Infisical, then deploy the reviewed secrets stack with `secrets:deploy:preview` or `secrets:deploy:production` (`--profile admin`); do not independently rotate Cloudflare values and later deploy stale inputs. The production/preview Keychain items still feed `deploy:staging`, `deploy:production`, and `infra:*`; keep them in sync until those move. Keep the Mac's encrypted disk and Keychain recovery available. Infisical and Keychain protect the source credentials; Alchemy's ignored state and local Worker bindings can retain generated deployment copies.

## Commands

```sh
# Names-only import plan, then verified Keychain import. Infisical login is used only here.
bun run secrets:migrate
bun run secrets:migrate --apply

# Values are entered at a hidden prompt, or supplied through stdin for multiline keys.
bun run secrets:set sandbox PLANNING_CENTER_PAT

# Stage `local` reads Infisical pcobooster-dev through the default Alchemy profile.
bun run setup:infisical
bun run dev
bun run dev:auth
bun run secrets:run apple -- bun run --cwd apps/mobile ios:testflight

# Read-only plans. Runtime secrets read Infisical pcobooster-prod with --profile admin.
bun run secrets:plan:preview
bun run secrets:plan:production
bun run infra:plan
```

The importer refuses an existing Keychain value that differs; `--overwrite` is an explicit choice after reviewing the conflict names. It never writes secret values to files, command arguments, logs, or stack outputs. Runtime-secret plan output must remain redacted.

Temporary historical resource registrations let Alchemy retain the old Infisical objects while removing their ownership rows, without contacting or mutating Infisical. Those registrations were removed after the successful apply and follow-up plan. The importer's old projects (`pcobooster-preview`, `pcobooster-production`, `worshipadmin.com`) are now recovery copies; `pcobooster-dev` and `pcobooster-prod` are the active Infisical layout. Existing token-admin permissions are needed to inspect token policy drift or apply a future token change; the migration did not change tokens, and both original credential identities were verified active through Cloudflare's token verification API.

## Approved external cutover

Do not merge the consumer/workflow changes until steps 1 and 2 are verified. No application/database credentials are rotated or deleted during migration.

1. Review runtime-secret plans. Confirm only the 10 names in `scripts/secrets/manifest.ts` are created in the existing account store; existing Alchemy state credentials and other products' secrets stay untouched. After approval, run `secrets:deploy:preview` and `secrets:deploy:production`. Check all new metadata reports active and the values are proven by consumer behavior, not management-API reads (the API does not return values).
2. Review `infra:plan`. Expect encrypted deployment tokens in 3 preview/staging/cleanup environments and 1 production environment, Access client ID/secret in preview and staging, the optional production PostHog annotation key, and non-secret admin/Access variables. Existing Cloudflare token/service-token values and scopes are preserved. After approval, run `infra:deploy`; verify GitHub secret names and updated timestamps and confirm no token was revoked or replaced unexpectedly.
3. Exercise a reviewed preview revision through the normal CI environment. Verify its exact revision, Access check, health, OAuth broker sign-in, authenticated reads, and app-secret bindings; confirm no production signing/demo secret or local PAT is bound. Check native Worker settings and invocation traces against the updated overhead ledger. Run preview cleanup and prove the central 10 secrets remain.
4. Deploy the same reviewed changes through staging and production. Verify exact revision, health, existing signed-in session continuity, new OAuth sign-in, read-only demo, analytics configuration, and admin Access. For remote rotation proof, use a disposable preview test secret and consumer, allowing provider propagation plus the one-minute application cache. Keep the migrated application credential values unchanged.
5. Verify Apple tools can authenticate through their Keychain scope without uploading or enabling the blocked release executor. Verify the recovery credential is present without reconnecting production to Neon. Update Codex cloud host secrets to the separate development values.
6. Once all consumers and recovery are accepted, separately revoke unused Infisical machine identities and retire the projects. Preserve any other repos' consumers. Do not delete projects during this first-repo migration.

The repository's [AGENTS.md](../AGENTS.md) requires confirming deployment commands with Jake. The final approval should cover the specific reviewed runtime-secret and control-plane plans plus staging/production consumer rollout.

## Permissions and rollback

Existing deployment tokens grant account-level Workers and Secrets Store writes. Namespaces prevent collisions but do not prevent a preview deployer from binding a production secret. Preview labels, fork exclusion, and `main`-restricted production GitHub environments stay in place. Separate Cloudflare accounts are the stronger boundary when needed; this migration does not establish account separation.

The legacy Infisical values and old deployed Worker versions remain during acceptance. Before shipping consumer code, rollback is simply leaving old deployments in place. Afterwards, reverting the consumer/workflow changes restores the old injection flow while its identities remain valid. Retain both the new central secrets and original values until rollback acceptance. Central secret removal policies retain their values even if declarations disappear.

This migration does not enable the iOS release executor, delete the legacy database, change app feature flags, or authorize unrelated repositories.
