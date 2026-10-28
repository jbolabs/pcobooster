# Proofed delivery

This repository treats a pull request as a claim about one exact revision. Deterministic CI is the floor; a revision-bound proof receipt records what was checked, what was observed on the user surface, and what remains unverified.

## Contract

A proof receipt contains:

- the merge-base SHA, head SHA, and stable patch ID;
- a path-derived risk tier;
- the commands, exit codes, durations, and captured logs;
- verified user flows and media hashes;
- an independent verifier result for high and critical risk;
- a rollback plan for critical risk;
- limitations and one of `PASS`, `PASS_WITH_NOTES`, `FAIL`, or `BLOCKED`.

`bun run proof -- verify` rejects a receipt when the checkout, patch, command logs, generated report, or media no longer matches. It also recomputes changed files, minimum risk, visual-evidence requirements, required gates, and the verdict. Any material push or evidence edit therefore invalidates the previous verdict.

## Risk and evidence

| Tier | Typical change | Required proof |
| --- | --- | --- |
| low | docs and agent instructions | local CI |
| medium | web, marketing, shared models, scripts | local CI, build, and visual evidence for a visible surface |
| high | API behavior, contracts, server composition, dependency graph | medium proof plus an independent verifier |
| critical | auth, database, migrations, proxy policy, CI workflows | high proof plus explicit rollback and focused boundary tests |

Path classification is conservative. Raise the tier when behavior is riskier than its location suggests.

## Commands

```bash
bun run proof -- doctor
bun run proof -- run --base <pr-base-branch> --flow "Public auth boundary" --artifact "./proof.png#Unauthenticated services redirect"
bun run proof -- verify --receipt .artifacts/proofs/<revision>/receipt.json
bun run proof -- publish --pr <number-or-url> --receipt .artifacts/proofs/<revision>/receipt.json
```

Start `proof run` once after committing; it captures the canonical CI/build gates and focused checks. Review and media may be added afterward without rerunning those gates:

```bash
bun run proof -- finalize --receipt .artifacts/proofs/<revision>/receipt.json --verifier-verdict PASS --verifier-summary "..." --verifier-source <task-id-or-url>
```

Finalization verifies the original receipt, logs, media, clean checkout, head, and base before copying the captured evidence into a new receipt. It preserves the original and refuses failed checks or changes to risk/focused checks. A changed head or base still requires a fresh run. Use the finalized receipt for verification/publication; finalization cannot make missing required evidence pass.

Proof output lives under ignored `.artifacts/`. The publisher posts the Markdown report and uses GitHub CLI media attachments for images and videos.

For high or critical risk, add `--verifier-verdict PASS|PASS_WITH_NOTES`, `--verifier-summary "..."`, and `--verifier-source <task-id-or-url>`. For critical risk, also add `--rollback "..."` and one or more `--focused-check "Boundary name::bun vitest run ..."` arguments. Focused checks run inside the receipt capture and their logs are hashed. An explicit `--risk` can raise the automatically classified tier but cannot lower it. The verifier fields are an auditable attestation, not cryptographic identity proof; GitHub's `ci` check remains the authoritative execution record.

Fetch the base branch immediately before proving. A bottom PR uses `origin/main`; an upper stack layer uses its preceding remote branch. Publication rejects both stale head proof and proof against an outdated PR base.

## Merge gates

The Cloudflare merge gates are `ci` and `cloudflare-build` (see [merge gates](ci-cd.md#merge-gates)). These checks establish deterministic correctness and valid Worker bundles; they do not replace product-flow evidence or independent verification. Humans remain the merge authority until the proof workflow has a track record strong enough to justify a separately reviewed policy change.

## Current boundary

Public routes, authentication boundaries, and product views can be verified in a browser. Verify Planning Center mutations against the pinned free sandbox using `bun run dev` and disposable records outside the Alchemy baseline; see [the sandbox workflow](planning-center-sandbox.md). `bun run dev:church` permits read-only verification against Agape. Real church mutations require explicit authorization for the specific change and `bun run dev:church:write`. Presentation mode masks data but still uses the selected provider services, so it must not be treated as a mutation sandbox.
