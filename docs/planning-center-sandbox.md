# Planning Center verification sandbox

Agent development uses **Jake Bodea's Org**, Services organization **524200**, in `America/Los_Angeles`. Keep it on the five-person free Services plan. Provisioning verifies the organization ID, name, time zone, and free-plan capacity. Credentials stay in the macOS Keychain `sandbox` scope, never Alchemy resource inputs or outputs.

## Commands

- `bun run dev`: load app settings from Infisical `pcobooster-dev`, override its church PAT with the Keychain sandbox PAT, verify the organization, then launch local Workers. Missing or mismatched sandbox credentials stop startup.
- `bun run dev:present`: the same sandbox connection with presentation masking.
- `bun run dev:church`: verify Agape organization **42167**, use the `pcobooster-dev` church PAT, and block provider data writes in the core client.
- `bun run dev:church:write`: explicitly enable real Agape writes. Agents must have user authorization for the specific church mutation before running this command; starting it is not authorization to change arbitrary church records.
- `bun run dev:auth`: real OAuth sign-in, read-only by default. PAT bypass does not test OAuth.
- `bun run sandbox:plan`: read-only Alchemy plan.
- `bun run sandbox:apply`: reconcile test records after deployment approval. This writes to Planning Center, never deploys Cloudflare infrastructure, and never changes subscriptions.

Run one development profile at a time per checkout. Church profiles use the next four ports in the worktree block, so browser storage cannot mix sandbox and church answers. Use separate worktrees for simultaneous sessions. The toolbar always names the source and write policy.

Run one apply at a time across worktrees. Alchemy keeps ignored local state under `.alchemy/`; a fresh checkout can recover records by their declared unique identities. Records are retained when removed from the stack. Duplicate identities stop adoption. If local state is lost after manually renaming a record, restore its declared name before applying.

## Dataset

`alchemy.sandbox.ts` declares two service types, two teams, an original fictional song and arrangement, and sixteen Sundays from August 23 through December 6, 2026. Each Sunday has a Pacific-time service and rehearsal, two order items, confirmed, declined, or unconfirmed assignments, and an open Keys position. Two volunteers have blockouts. Plan reminders and prepared assignment notifications are disabled. Advance the fixed date anchor deliberately as fixtures age.

The public Services API cannot create Services people or team positions. These were bootstrapped once in the browser: Jake plus Avery, Morgan, Riley, and Casey Sandbox; Vocals, Guitar, Keys, and Audio positions. Their IDs live in `scripts/planning-center-sandbox/roster.ts`. Fictional people have no contact details or login methods. Alchemy manages position memberships, blockouts, plans, and assignments afterward.

## Verification

Use `bun run dev`, confirm the sandbox organization in the product, and use a dedicated scratch plan for mutation exercises. Do not run competing mutations against the same plan. Applying the stack restores the declared baseline, including assignment statuses; it does not delete scratch plans or other records. Never apply while another agent uses the baseline.

Five people cover live provider behavior, persistence, scheduling history, and availability. Synthetic provider boundaries remain necessary for large-roster pagination, rate-limit failures, and deterministic CI. This is a real Planning Center account: notification actions still have real effects. Keep notifications disabled; test delivery only with addresses you control.

## Credentials

Use hidden prompts, never command arguments or chat:

```sh
bun run secrets:set sandbox PLANNING_CENTER_CLIENT
bun run secrets:set sandbox PLANNING_CENTER_PAT
```

The church profiles use the Agape PAT in Infisical `pcobooster-dev`; the stack refuses to start if it belongs to another organization. Normal `bun run dev` reads its PAT from the Keychain `sandbox` scope. App and OAuth settings come from `pcobooster-dev` for every profile.
