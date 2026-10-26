/**
 * Publishes one prepared iOS update into the application stack's update bucket
 * (`apps/server/src/mobile-update-bucket.ts`). `bun run ios:update` prepares and signs the release,
 * then deploys this stack with the operator's Alchemy login; never run it by hand. It stores every
 * file not already stored, after checking its bytes still hash to what was signed, and then, last,
 * the answer phones of the runtime version get. The API Worker serves that answer as soon as it is
 * written. Redeploying the same release changes nothing.
 */
import { readFileSync } from "node:fs";

import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  assetKey,
  publishedUpdateKey,
} from "@pcobooster/contracts/mobile-updates";
import * as Alchemy from "alchemy";
import * as State from "alchemy/State";
import { Config, Effect, Layer } from "effect";

import {
  decodePreparedRelease,
  RELEASE_VARIABLE,
} from "./apps/mobile/scripts/updates/prepared-release";
import type { PreparedRelease } from "./apps/mobile/scripts/updates/prepared-release";
import { sha256Base64Url } from "./apps/mobile/scripts/updates/update-manifest";

const PublishMobileUpdate = Alchemy.Action(
  "PublishMobileUpdate",
  Effect.gen(function* publisher() {
    const stage = yield* Alchemy.Stage;
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(
      yield* Cloudflare.R2.Bucket.ref("MobileUpdates", {
        stack: "pcobooster",
        stage,
      })
    );
    return Effect.fn("publishMobileUpdate")(function* publish(
      release: PreparedRelease
    ) {
      for (const upload of release.uploads) {
        const bytes = readFileSync(upload.path);
        if (sha256Base64Url(bytes) !== upload.hash) {
          return yield* Effect.die(
            new Error(
              `${upload.path} changed after it was signed; publish again.`
            )
          );
        }
        const key = assetKey(upload.hash);
        // Stored assets never change: their key is their hash.
        if ((yield* bucket.head(key)) === null) {
          yield* bucket.put(key, bytes, {
            httpMetadata: { contentType: upload.contentType },
          });
        }
      }
      yield* bucket.put(
        publishedUpdateKey(release.runtimeVersion),
        release.record,
        { httpMetadata: { contentType: "application/json" } }
      );
      return {
        runtimeVersion: release.runtimeVersion,
        summary: release.summary,
      };
    });
  }).pipe(Effect.provide(Cloudflare.R2.ReadWriteBucketLocal))
);

export default Alchemy.Stack(
  "pcobooster-mobile-updates",
  {
    providers: Cloudflare.providers(),
    state: Layer.unwrap(
      Alchemy.Stage.pipe(
        Effect.map((stage) =>
          stage === "local" ? State.localState() : Cloudflare.state()
        )
      )
    ),
  },
  Effect.gen(function* mobileUpdates() {
    const stage = yield* Alchemy.Stage;
    const release = decodePreparedRelease(
      readFileSync(yield* Config.String(RELEASE_VARIABLE), "utf-8")
    );
    if (release.stage !== stage) {
      return yield* Effect.die(
        new Error(
          `This release was prepared for ${release.stage}, not ${stage}.`
        )
      );
    }
    return yield* PublishMobileUpdate(release);
  })
);
