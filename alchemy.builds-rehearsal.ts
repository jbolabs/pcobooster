/** Disposable hosted rehearsal; validates releases without deploying any application. */
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";

import {
  TrialBuilds,
  trialBuildsProvider,
} from "./scripts/cloudflare/builds-trial/resource";

export default Alchemy.Stack(
  "pcobooster-builds-rehearsal",
  {
    state: Layer.unwrap(
      Alchemy.Stage.pipe(
        Effect.map((stage) => {
          if (stage !== "builds-rehearsal") {
            throw new Error("Expected builds-rehearsal stage");
          }
          return Cloudflare.state();
        })
      )
    ),
    providers: trialBuildsProvider.pipe(
      Layer.provideMerge(Cloudflare.providers())
    ),
  },
  Effect.gen(function* rehearsal() {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const token = yield* Cloudflare.ApiToken.UserApiToken("Token", {
      name: "pcobooster-release-rehearsal",
      expiresOn: "2026-11-19T23:59:59Z",
      policies: [
        {
          effect: "allow",
          resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
          permissionGroups: ["Workers Scripts Write"],
        },
      ],
    });
    const runner = yield* Cloudflare.Workers.Worker("Runner", {
      name: "pcobooster-release-rehearsal",
      main: "./scripts/cloudflare/builds-trial/runner.ts",
      workersDev: false,
      compatibility: { date: "2026-09-01" },
    });
    const builds = yield* TrialBuilds("Builds", {
      name: "pcobooster-release-rehearsal",
      branches: ["codex/cloudflare-actions-cutover"],
      workerTag: runner.workerId,
      buildCaching: true,
      tokenId: token.tokenId,
      token: token.value,
      buildCommand: "bun scripts/cloudflare/builds/release-validation.ts",
      deployCommand: "true",
      variables: {
        BUN_VERSION: "1.4.2",
        NODE_VERSION: "24.11.1",
        LEFTHOOK: "0",
      },
    });
    return { trigger: builds.triggerId, workerTag: runner.workerId };
  })
);
