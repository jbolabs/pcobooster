/**
 * A load run of the API Worker's router in local workerd: `bun run --cwd apps/server test:load`.
 *
 * It serves `TransportStackFixture` (the API Worker's router over a fake Planning Center, a
 * migrated local D1, and real Better Auth sessions) and drives it with `load-scenario.ts`.
 * Local workerd is one process, so this measures the code's per-request cost and its behavior
 * under concurrency (shared isolate state, pacing, session reads), not Cloudflare's capacity;
 * `apps/server/load/plan-page.k6.js` runs the same scenario against the fixture deployed to
 * Cloudflare.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import { assert } from "@effect/vitest";
import * as Alchemy from "alchemy";
import * as State from "alchemy/State";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Layer } from "effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { loadSettingsFromEnvironment, runLoad } from "./load-scenario";
import TransportStackFixture, {
  FIXTURE_STATE_PATH,
} from "./transport-stack.fixture";

const settings = loadSettingsFromEnvironment();
const PERCENT = 100;

Object.assign(process.env, {
  CLOUDFLARE_ACCOUNT_ID: "00000000000000000000000000000000",
  CLOUDFLARE_API_TOKEN: "load-test-never-reaches-cloudflare",
});
process.chdir(path.resolve(import.meta.dirname, "../../.."));

const providers = Layer.mergeAll(Cloudflare.providers(), Drizzle.providers());

const LoadStack = Alchemy.Stack(
  "pcobooster-api-load",
  { providers, state: State.inMemoryState() },
  Effect.gen(function* fixtureOnly() {
    const fixture = yield* TransportStackFixture;
    return { fixtureUrl: fixture.url };
  })
);

const { test, beforeAll, deploy } = Test.make({
  providers,
  state: State.inMemoryState(),
  stage: "test",
  dev: true,
});

const stack = beforeAll(
  Effect.gen(function* isolatedStack() {
    const directory = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const parent = path.resolve(".alchemy/tests");
        mkdirSync(parent, { recursive: true });
        return mkdtempSync(path.join(parent, "api-load-"));
      }),
      (root) =>
        Effect.sync(() => {
          rmSync(root, { recursive: true, force: true });
        })
    );
    return yield* deploy(LoadStack).pipe(
      Effect.updateService(Alchemy.AlchemyContext, (context) => ({
        ...context,
        dotAlchemy: directory,
      }))
    );
  }),
  { timeout: 180_000 }
);

test(
  `serves ${settings.users} users at once without errors`,
  Effect.gen(function* loadRun() {
    const { fixtureUrl: url } = yield* stack;
    const fixtureUrl =
      url ?? (yield* Effect.die(new Error("The fixture has no local URL")));
    yield* Test.executeWhenReady(
      HttpClientRequest.get(`${fixtureUrl}${FIXTURE_STATE_PATH}`)
    );
    const report = yield* Effect.promise(
      async () => await runLoad(fixtureUrl, settings)
    );
    yield* Effect.sync(() => {
      process.stdout.write(`\n${report.lines.join("\n")}\n\n`);
    });

    assert.isAtMost(
      report.failed / report.requests,
      0.01,
      `${report.failed} requests failed`
    );
    assert.isAtMost(
      (report.planningCenterRateLimited /
        Math.max(report.planningCenterRequests, 1)) *
        PERCENT,
      1
    );
  }),
  { timeout: 600_000 }
);
