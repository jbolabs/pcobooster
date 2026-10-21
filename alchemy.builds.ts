/** Parallel Cloudflare CI control plane. Production dispatch is disabled until cutover. */
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import type { Redacted } from "effect";
import { Config, Effect, Layer } from "effect";

import {
  TrialBuilds,
  trialBuildsProvider,
} from "./scripts/cloudflare/builds-trial/resource";

const requireUrl = Output.map((url: string | undefined) => {
  if (url === undefined) {
    throw new Error("Worker URL unavailable");
  }
  return url;
});
export default Alchemy.Stack(
  "pcobooster-builds",
  {
    state: Layer.unwrap(
      Alchemy.Stage.pipe(
        Effect.map((stage) => {
          if (stage !== "builds-control") {
            throw new Error("Expected builds-control stage");
          }
          return Cloudflare.state();
        })
      )
    ),
    providers: trialBuildsProvider.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Cloudflare.providers(),
          GitHub.providers(),
          Alchemy.RandomProvider()
        )
      )
    ),
  },
  Effect.gen(function* control() {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const token = yield* Cloudflare.ApiToken.UserApiToken("PreviewToken", {
      name: "pcobooster-builds-preview",
      expiresOn: "2027-09-23T23:59:59Z",
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
    const dispatch = yield* Cloudflare.ApiToken.UserApiToken("DispatchToken", {
      name: "pcobooster-builds-dispatch",
      expiresOn: "2027-09-23T23:59:59Z",
      policies: [
        {
          effect: "allow",
          resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
          permissionGroups: ["Workers CI Write"],
        },
      ],
    });
    const access = yield* Cloudflare.Access.ServiceToken(
      "PreviewVerification",
      {
        name: "pcobooster-builds-verify",
        duration: "8760h",
        clientSecretVersion: 1,
      }
    );
    const repositoryReadSecret = yield* Alchemy.Random(
      "RepositoryReadSecret",
      {}
    );
    const cacheSecret = yield* Alchemy.Random("CacheSecret", {});
    const webhookSecret = yield* Alchemy.Random("WebhookSecret", {});
    const controlSecret = yield* Alchemy.Random("ControlSecret", {});
    const cache = yield* Cloudflare.R2.Bucket("Cache", {
      name: "pcobooster-builds-validation",
      forceDestroy: true,
      lifecycleRules: [
        {
          id: "expire",
          deleteObjectsTransition: {
            condition: { type: "Age", maxAge: 604_800 },
          },
        },
      ],
    });
    const records = yield* Cloudflare.R2.Bucket("Records", {
      name: "pcobooster-builds-records",
      forceDestroy: true,
    });
    const cacheWorker = yield* Cloudflare.Workers.Worker("CacheServer", {
      name: "pcobooster-builds-cache",
      main: "./scripts/cloudflare/builds-trial/cache-worker.ts",
      workersDev: true,
      compatibility: { date: "2026-09-01" },
      env: { CACHE: cache, TOKEN: cacheSecret.text },
    });
    const runner = yield* Cloudflare.Workers.Worker("PRRunner", {
      name: "pcobooster-pr-validation",
      main: "./scripts/cloudflare/builds-trial/runner.ts",
      workersDev: false,
      compatibility: { date: "2026-09-01" },
    });
    const builds = yield* TrialBuilds("PRBuilds", {
      name: "pcobooster-pr-validation",
      branches: ["__webhook_dispatch_only__"],
      workerTag: runner.workerId,
      buildCaching: true,
      tokenId: token.tokenId,
      token: token.value,
      buildCommand: "bun scripts/cloudflare/builds/pr.ts check",
      deployCommand: "bun scripts/cloudflare/builds/pr.ts deploy",
      variables: {
        BUILDS_REPOSITORY_READ_TOKEN: repositoryReadSecret.text,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: token.value,
        PCOBOOSTER_ADMIN_EMAILS: yield* Config.String(
          "CI_PREVIEW_ADMIN_EMAILS"
        ),
        STAGING_ACCESS_SERVICE_TOKEN_ID: access.serviceTokenId,
        CLOUDFLARE_ACCESS_CLIENT_ID: access.clientId,
        CLOUDFLARE_ACCESS_CLIENT_SECRET: Output.map(
          (value: Redacted.Redacted | undefined) => {
            if (value === undefined) {
              throw new Error("Access secret missing");
            }
            return value;
          }
        )(access.clientSecret),
        TURBO_API: requireUrl(cacheWorker.url),
        TURBO_TOKEN: cacheSecret.text,
        TURBO_TEAM: "pcobooster-pr",
        BUN_VERSION: "1.4.2",
        NODE_VERSION: "24.11.1",
        LEFTHOOK: "0",
      },
    });
    const maintenanceToken = yield* Cloudflare.ApiToken.UserApiToken(
      "MaintenanceToken",
      {
        name: "pcobooster-builds-maintenance",
        expiresOn: "2027-09-23T23:59:59Z",
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
      }
    );
    const maintenanceRunner = yield* Cloudflare.Workers.Worker(
      "MaintenanceRunner",
      {
        name: "pcobooster-builds-maintenance",
        main: "./scripts/cloudflare/builds-trial/runner.ts",
        workersDev: false,
        compatibility: { date: "2026-09-01" },
      }
    );
    const trustedBranch = "codex/cloudflare-builds-trial";
    const maintenance = yield* TrialBuilds("MaintenanceBuilds", {
      name: "pcobooster-builds-maintenance",
      branches: ["__webhook_dispatch_only__"],
      workerTag: maintenanceRunner.workerId,
      buildCaching: true,
      tokenId: maintenanceToken.tokenId,
      token: maintenanceToken.value,
      buildCommand: "bun scripts/cloudflare/builds/maintenance.ts",
      deployCommand: "true",
      variables: {
        BUILDS_REPOSITORY_READ_TOKEN: repositoryReadSecret.text,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: maintenanceToken.value,
        BUILDS_CI_TOKEN: dispatch.value,
        BUILDS_PR_WORKER_TAG: runner.workerId,
        BUILDS_CONTROL_TOKEN: controlSecret.text,
        BUILDS_CONTROL_URL:
          "https://pcobooster-builds-controller.jakebodea.workers.dev",
        BUILDS_TRUSTED_BRANCH: trustedBranch,
        BOOTSTRAP_BRANCH:
          "codex/cloudflare-builds-trial,codex/cloudflare-actions-cutover",
        BUN_VERSION: "1.4.2",
        NODE_VERSION: "24.11.1",
        LEFTHOOK: "0",
      },
    });
    const controller = yield* Cloudflare.Workers.Worker("Controller", {
      name: "pcobooster-builds-controller",
      crons: ["17 9 * * *"],
      main: "./scripts/cloudflare/builds/controller.ts",
      workersDev: true,
      compatibility: { date: "2026-09-01" },
      env: {
        GITHUB_APP_ID: "5385188",
        GITHUB_INSTALLATION_ID: "173133738",
        GITHUB_APP_PRIVATE_KEY: yield* Config.Redacted(
          "BUILDS_GITHUB_APP_PRIVATE_KEY"
        ),
        REPOSITORY_READ_TOKEN: repositoryReadSecret.text,
        RECORDS: records,
        WEBHOOK_SECRET: webhookSecret.text,
        CONTROL_TOKEN: controlSecret.text,
        CI_TOKEN: dispatch.value,
        ACCOUNT_ID: accountId,
        PR_TRIGGER: builds.triggerId,
        MAINTENANCE_TRIGGER: maintenance.triggerId,
        RELEASE_TRIGGER: "disabled",
        RELEASE_ENABLED: "false",
        TRUSTED_BRANCH: trustedBranch,
        BOOTSTRAP_BRANCH:
          "codex/cloudflare-builds-trial,codex/cloudflare-actions-cutover",
      },
    });
    const hook = yield* GitHub.Webhook("Webhook", {
      owner: "jbolabs",
      repository: "pcobooster",
      url: Output.map((url: string) => `${url}/webhook`)(
        requireUrl(controller.url)
      ),
      events: ["pull_request", "push"],
      secret: webhookSecret.text,
    });
    return {
      controller: controller.url,
      webhook: hook.webhookId,
      trigger: builds.triggerId,
    };
  })
);
