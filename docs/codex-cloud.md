# Codex cloud development

`scripts/codex-cloud/setup.sh` and `maintenance.sh` install the pinned Bun/Node toolchain and dependencies without application secrets. `bun run ci` runs without application or Cloudflare credentials.

App sessions use Alchemy's local providers and a checkout-local D1 database. The former Neon branch scripts are removed; there is no branch teardown step. Never use Production, Staging, or Development `/local` secrets in Codex cloud.

Prefer giving the host the `agent-dev` Infisical identity (`INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`) and running commands through `bun run agent:run <command>`, which loads `pcobooster-dev`; see [Infisical](environment.md#infisical). Otherwise set only the `cloud` allowlist directly: development `BETTER_AUTH_SECRET`, `PLANNING_CENTER_OAUTH_CLIENT_ID`, and `PLANNING_CENTER_OAUTH_CLIENT_SECRET` (required), plus optional `PLANNING_CENTER_CLIENT`, `PLANNING_CENTER_PAT`, and `PCOBOOSTER_ADMIN_EMAILS`. These are kept separate from Keychain local PATs and deployed secrets. `bun run cloud:dev` and `cloud:build` allowlist these names and remove known credentials from other scopes. On macOS the `cloud` scope can be read from Keychain; Linux receives values from the host. Cloud development runs with OAuth, never the local PAT bypass. Do not inject Cloudflare deployment tokens. Run deployment verification in an approved deployment environment, not a cloud coding session.

Local D1 data and generated Alchemy output live under ignored `.alchemy/` and disappear with the checkout. Planning Center mutations remain test-only; presentation mode is masking, not a provider sandbox.

The cloud launcher supplies fictional Cloudflare account/token placeholders because Alchemy resolves credentials even for local providers. These allow local Worker startup without a Cloudflare login and cannot authenticate a remote deployment.
