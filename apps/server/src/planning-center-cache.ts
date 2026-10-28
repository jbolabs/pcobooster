import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { Effect } from "effect";

/**
 * One KV namespace per stage for the shared Planning Center read tier. It holds only cached
 * reads that expire within minutes, so every stage, production included, can drop it freely.
 */
export const PlanningCenterCache = Effect.gen(function* planningCenterCache() {
  const { stage } = yield* Alchemy.Stack;
  return yield* Cloudflare.KV.Namespace("PlanningCenterCache", {
    title: `pcobooster-${stage}-planning-center-cache`,
  });
});
