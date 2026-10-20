# Codex cloud development

`scripts/codex-cloud/setup.sh` and `maintenance.sh` install the pinned Bun/Node toolchain and dependencies without application secrets. `bun run ci` runs without application or Cloudflare credentials.

App sessions use Alchemy's local providers and a checkout-local D1 database. The former Neon branch scripts are removed; there is no branch teardown step. Never use Production, Staging, or Development `/local` secrets in Codex cloud.

Give the host only the `agent-dev` Infisical identity: `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`. `setup.sh` stores it in the default Alchemy profile (`bun run setup:infisical`), and stage `local` then reads Infisical `pcobooster-dev` itself; see [Infisical](environment.md#infisical). Host-injected application keys are ignored: the launchers remove them so Infisical stays the source. Use `bun run dev:church` (the `pcobooster-dev` church PAT, read-only) or `bun run dev:auth` (OAuth); the sandbox `bun run dev` needs a Mac's Keychain `sandbox` scope. Scripts outside Alchemy run through `bun run secrets:dev <command>`. Do not inject Cloudflare deployment tokens or any `pcobooster-prod` credential. Run deployment verification in an approved deployment environment, not a cloud coding session.

Local D1 data and generated Alchemy output live under ignored `.alchemy/` and disappear with the checkout. Planning Center mutations remain test-only; presentation mode is masking, not a provider sandbox.

The dev launchers supply fictional Cloudflare account/token placeholders because Alchemy resolves credentials even for local providers. These allow local Worker startup without a Cloudflare login and cannot authenticate a remote deployment.
