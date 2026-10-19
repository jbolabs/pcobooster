import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { Effect, Layer } from "effect";

import { trialStagePattern } from "./scripts/cloudflare/builds-trial/settings";

export default Alchemy.Stack(
  "pcobooster",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: Layer.unwrap(
      Alchemy.Stage.pipe(
        Effect.map((stage) => {
          if (!trialStagePattern.test(stage)) {
            throw new Error(
              "Cleanup only accepts isolated Builds trial stages"
            );
          }
          return Cloudflare.state();
        })
      )
    ),
  },
  Effect.succeed({})
);
