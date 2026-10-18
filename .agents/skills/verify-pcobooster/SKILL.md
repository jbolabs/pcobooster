---
name: verify-pcobooster
description: Verify pcobooster.com changes on the rendered marketing or product surface and capture visual proof. Use after deterministic checks when a change affects routes, UI, auth boundaries, or user-visible behavior.
---

# Verify pcobooster.com

Read [references/feature-map.md](references/feature-map.md) and select every flow touched by the diff.

## Launch

- Public marketing-only changes: run `bun run dev:marketing` and use `http://127.0.0.1:3002` (or the port `DEV_PORT_BASE` gives marketing).
- Integrated product changes: run `bun run dev` and open the product URL it prints; linked worktrees get their own ports. Use `bun run dev:auth` only for sign-in flows. Treat missing Keychain or provider credentials as a blocked environment, not a product failure.
- A Cloudflare preview may replace local launch when its deployed revision matches the committed revision being proved. Confirm the Actions run and deployment; a stable per-PR URL alone does not prove the revision.

Completion: the selected surface responds, the rendered page matches the target revision, and the browser console has no startup error.

## Drive

Use the available browser-verification skill or browser automation. Prefer visible roles and labels over layout selectors. Exercise the success state plus one relevant empty, error, auth, or boundary state. Provider mutations require the pinned sandbox launch from `bun run dev` and an isolated scratch plan; see `docs/planning-center-sandbox.md`. Use `bun run dev:church` for Agape reproductions with provider writes blocked. `dev:church:write` requires explicit user authorization for the specific church mutation. Presentation mode only masks data.

Completion: every changed behavior is observed on the rendered surface or recorded as an explicit limitation.

## Evidence

Capture the smallest image or video set that proves the behavior. Then run:

```bash
bun run proof -- run \
  --base <pr-base-branch> \
  --flow "<verified flow>" \
  --artifact "<path>#<useful alt text>"
```

Completion: the receipt is `PASS` or `PASS_WITH_NOTES`, and `bun run proof -- verify --receipt <path>` succeeds on the same checkout.

Fetch the PR base before proving. Use `origin/main` for a bottom PR and the preceding remote branch for an upper stack layer.

## Cleanup

Stop local servers and leave proof media under ignored `.artifacts/`. Report live sandbox mutation checks separately from synthetic CI coverage.
