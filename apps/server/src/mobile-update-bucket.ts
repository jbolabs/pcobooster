import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import { Effect } from "effect";

/**
 * One R2 bucket per stage for the iOS app's over-the-air updates
 * (`packages/api/src/modules/mobile-updates`). The publisher writes signed answers and assets
 * into it; the API Worker only reads. Installed apps run what production's holds, so production
 * and staging keep theirs; a pull request stage's is emptied and removed with the stage.
 */
export const MobileUpdateBucket = Effect.gen(function* mobileUpdateBucket() {
  const { stage } = yield* Alchemy.Stack;
  const kept = stage === "prod" || stage === "staging";
  return yield* Cloudflare.R2.Bucket("MobileUpdates", {
    name: `pcobooster-${stage}-mobile-updates`,
    locationHint: "wnam",
    forceDestroy: !kept,
  }).pipe(RemovalPolicy.retain(kept));
});
