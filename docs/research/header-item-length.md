# Header item length investigation

Investigated 2026-10-18. The reported stored oversized header remains a hypothesis: the affected provider record and original request were not available. The synthetic regression models PCO validating the merged stored record on PATCH; it does not prove that provider behavior. On 2026-10-19, production logs confirmed two header title edits sent no length and received provider 422 errors naming `length` and `PlanHeader`. The still-open fix was absent from both live Worker revisions.

The local Services Item documentation (`docs/planning-center-api/services/2018-11-01/vertices/item.md`) and [public Item reference](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/item) declare integer `length`, but do not document the 24 hour constraint, header zero acceptance, or stored-record revalidation. The application treats lengths as seconds. Zero expresses an untimed header and avoids retaining an oversized value; real sandbox verification on 2026-10-19 confirmed zero acceptance through `prepareUpdatePlanItem` and `commitUpdatePlanItem`, including a separate GET proving the edited title and zero length persisted. A direct oversized scratch-header PATCH returned the same 422 length validation. The API refused the oversized write, so repair of an already-oversized stored record remains covered synthetically rather than reproduced live. The mobile fixture `apps/mobile/src/harness/fixtures/planItems.list.json` uses null header lengths. `scripts/check-pc-contracts.ts` samples people, schedules and plan times, not Item resources, so it cannot establish a header-length contract.

## Read and display paths

- `plan-items-service.ts` reads provider Item attributes. `plan-items-shared.ts` preserves numeric lengths in normalized items and arrangement options. The response contracts accept finite numeric lengths and null, including historical oversized values.
- `plan-item-draft.ts` builds the shared web and mobile draft. Its run sheet sums child lengths into a separate `sectionLength`; it never stores the total on the header Item.
- `plan-overview.ts` excludes headers from service length. Drafts now normalize historical values to the write range, and header draft length to zero.

## Write paths

- The web controller and mobile `ItemDraft` omit length on header updates. Existing clients need no change: the API reads the stored Item type and supplies zero on header PATCH, including description and custom sequence edits.
- New basic and song items use `prepareCreatePlanItem` and `buildPlanItemAttributes`. Song lengths can come from arrangement defaults. Previously neither those defaults nor ordinary input lengths had an upper bound.
- Duration text parsing uses seconds for a single number, minutes times 60 for two parts, and hours times 3600 for three. There was no upper bound. No milliseconds conversion or mistaken section sum was found in these writes.
- Reorder, move and placement after creation send only the ID sequence to `item_reorder`, never Item lengths. No separate item duplication write path was found; creation and raw service writes share the same protection.
- The shared clamp floors finite values to integer seconds in 0..86400 and converts nonfinite numbers to zero. API payloads, raw Item create/PATCH writes, song defaults, shared drafts and web song insertion use it. Missing and null lengths remain distinct on ordinary API writes.

## Request accounting and diagnostics

An Item update now adds one provider GET to determine the authoritative Item type, then one PATCH. Song-default reads remain unchanged. This increases the run-sheet update row in the existing request ledger by one request, leaving it well below the unchanged 40-attempt cap and inside the existing platform overhead envelope. Reorders add no reads.

Provider 400/422 validation maps through `InvalidInput`. The known 24 hour error gets a recovery message. Only allowlisted validation phrases, codes and the length field cross the fault and analytics boundaries; arbitrary detail, titles, pointers and bodies are excluded from workflow telemetry. Unknown validation wording remains visible through the existing user-facing mapping but is not copied to analytics. Real PCO validation and zero-length title persistence are verified in sandbox organization 524200 on disposable plan 92779388, header 1247665497. Live iOS Safari remains unverified. Header draft comparisons normalize both saved and draft length, so zero-length headers do not trigger unchanged autosaves.
