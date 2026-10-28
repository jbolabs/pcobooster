import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
/**
 * A throwaway Cloudflare stack for a load run: `TransportStackFixture` (the API Worker's router
 * over a fake Planning Center) and its own D1 database, in the production database's region, on
 * workers.dev. It reaches no Planning Center account and no other stage's data.
 *
 *   bun run secrets:run preview -- bun alchemy deploy alchemy.load.ts --stage load
 *   k6 run -e FIXTURE_URL=<fixture URL> apps/server/load/plan-page.k6.js
 *   bun run secrets:run preview -- bun alchemy destroy alchemy.load.ts --stage load
 *
 * State stays in this checkout's `.alchemy`, apart from the shared state store.
 */
import * as Alchemy from "alchemy";
import * as State from "alchemy/State";
import { Effect, Layer } from "effect";

import TransportStackFixture, {
  LOAD_STAGE,
} from "./apps/server/src/transport-stack.fixture";

export default Alchemy.Stack(
  "pcobooster-load",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: State.localState(),
  },
  Effect.gen(function* loadStack() {
    const { stage } = yield* Alchemy.Stack;
    if (stage !== LOAD_STAGE) {
      return yield* Effect.die(
        new Error(`Deploy the load stack only to the "${LOAD_STAGE}" stage.`)
      );
    }
    const fixture = yield* TransportStackFixture;
    return { fixtureUrl: fixture.url };
  })
);
