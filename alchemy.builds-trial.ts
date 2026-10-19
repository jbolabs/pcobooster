/** Isolated experiment: no GitHub settings, production resources, or existing CI tokens. */
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import type { Redacted } from "effect";
import { Config, Effect, Layer } from "effect";

import {
  TrialBuilds,
  trialBuildsProvider,
} from "./scripts/cloudflare/builds-trial/resource";
import {
  trialControlStage,
  trialWorker,
} from "./scripts/cloudflare/builds-trial/settings";

const state = Layer.unwrap(
  Alchemy.Stage.pipe(
    Effect.map((stage) => {
      if (stage !== trialControlStage) {
        throw new Error("Only the isolated Builds control stage is allowed");
      }
      return Cloudflare.state();
    })
  )
);

export default Alchemy.Stack(
  "pcobooster-builds-trial",
  {
    state,
    providers: trialBuildsProvider.pipe(
      Layer.provideMerge(Cloudflare.providers())
    ),
  },
  Effect.gen(function* trial() {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const token = yield* Cloudflare.ApiToken.UserApiToken("TrialDeployToken", {
      name: "pcobooster-builds-trial-deploy",
      expiresOn: "2026-10-26T23:59:59Z",
      policies: [
        {
          effect: "allow",
          resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
          permissionGroups: [
            "Workers Scripts Write",
            "D1 Write",
            "Workers KV Storage Write",
            "Workers R2 Storage Write",
            "Secrets Store Write",
            { id: "521a41dc78f94eaba5e643528846cb7b" },
            { id: "1e13c5124ca64b72b1969a67e8829049" },
          ],
        },
      ],
    });
    const access = yield* Cloudflare.Access.ServiceToken("TrialVerification", {
      name: "pcobooster-builds-trial-check",
      duration: "168h",
      clientSecretVersion: 1,
    });
    const worker = yield* Cloudflare.Workers.Worker("BuildRunner", {
      name: trialWorker,
      main: "./scripts/cloudflare/builds-trial/runner.ts",
      workersDev: false,
      compatibility: { date: "2026-09-01" },
    });
    const clientSecret = Output.map((value: Redacted.Redacted | undefined) => {
      if (!value) {
        throw new Error("Trial verification secret is unavailable");
      }
      return value;
    })(access.clientSecret);
    const props = {
      workerTag: worker.workerId,
      tokenId: token.tokenId,
      token: token.value,
      variables: {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: token.value,
        STAGING_ACCESS_SERVICE_TOKEN_ID: access.serviceTokenId,
        CLOUDFLARE_ACCESS_CLIENT_ID: access.clientId,
        CLOUDFLARE_ACCESS_CLIENT_SECRET: clientSecret,
        PCOBOOSTER_ADMIN_EMAILS: yield* Config.String(
          "PCOBOOSTER_ADMIN_EMAILS"
        ),
        BUN_VERSION: "1.4.2",
        NODE_VERSION: "24.11.1",
        LEFTHOOK: "0",
      },
    };
    const builds = yield* TrialBuilds("Builds", props);
    return { triggerId: builds.triggerId, runner: worker.workerName };
  })
);
