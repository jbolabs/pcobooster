import { readdirSync } from "node:fs";
import path from "node:path";

import {
  planningCenterFallbackTimeZone,
  productionPostHogKey,
} from "@pcobooster/config/public-environment";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as State from "alchemy/State";
import { Config, Effect, Layer } from "effect";

import { parseTeamEmails } from "./apps/server/src/access";
import { Database } from "./apps/server/src/database";
import { workerObservability } from "./apps/server/src/observability";
import { currentStageSettings } from "./apps/server/src/stage";
import Api from "./apps/server/src/worker";
import { verifyDevelopmentOrganization } from "./scripts/cloudflare/dev-organization";
import { prepareCloudflareBuild } from "./scripts/cloudflare/prepare";
import {
  allowUniversalSslIssuers,
  protectZoneEdge,
} from "./scripts/cloudflare/zones";
import { stageSecrets } from "./stacks/secrets";

const workspacePackages = readdirSync(
  path.join(import.meta.dirname, "packages"),
  { withFileTypes: true }
).flatMap((entry) => (entry.isDirectory() ? [`packages/${entry.name}`] : []));

/**
 * What a product rebuild depends on. The app root's explicit globs also hash the
 * gitignored `cloudflare-build-inputs.json` stamp (`scripts/cloudflare/prepare.ts`), which
 * carries the stage and inlined variables that Alchemy's memo cannot see. Every workspace
 * package, the build scripts, and the root configuration are listed as workspaces: an explicit
 * list replaces Alchemy's own detection of imported packages, and each entry is hashed with its
 * gitignore rules, so `node_modules` and build output never count.
 */
const viteMemo = (
  excludeFromApp: readonly string[],
  extraWorkspaces: readonly string[] = []
) => ({
  include: ["**/*"],
  exclude: [
    "node_modules/**",
    "dist/**",
    ".tanstack/**",
    ".turbo/**",
    ".wrangler/**",
    "*.tsbuildinfo",
    ...excludeFromApp,
  ],
  lockfile: true,
  workspaces: [
    ...[...workspacePackages, "scripts", ...extraWorkspaces].map(
      (directory) => ({ cwd: `../../${directory}` })
    ),
    {
      cwd: "../..",
      include: ["package.json", "turbo.json", "tsconfig.json"],
      lockfile: true,
    },
  ],
});

const canAttachDomains = (production: boolean) =>
  production && process.env.CLOUDFLARE_CUSTOM_DOMAINS === "1";

/** `PCOBOOSTER_ADMIN_EMAILS`, the people Cloudflare Access admits to every non-production stage. */
const teamEmails = Config.String("PCOBOOSTER_ADMIN_EMAILS").pipe(
  Config.withDefault(""),
  Config.map(parseTeamEmails)
);

const allowTeam = Effect.gen(function* allowTeam() {
  const emails = yield* teamEmails;
  return {
    decision: "allow" as const,
    include: emails.map((email) => ({ email })),
  };
});

/**
 * Cloudflare Access in front of a staging or pull request stage's product Worker, which serves
 * the app and the API. It covers the `workers.dev` URL and version preview URLs; the API Worker
 * has no public URL outside production. The deploy-check service token
 * (`alchemy.ci.ts`) lets CI verify each deploy without a login.
 */
const nonProductionAccess = (stage: string) =>
  Effect.gen(function* nonProductionAccessPolicy() {
    const serviceTokenId = yield* Config.String(
      "STAGING_ACCESS_SERVICE_TOKEN_ID"
    );
    const policy: Cloudflare.Workers.WorkerAccessApplication = {
      name: `pcobooster ${stage}`,
      sessionDuration: "168h",
      policies: [
        yield* allowTeam,
        {
          decision: "non_identity",
          include: [{ serviceToken: serviceTokenId }],
        },
      ],
    };
    return policy;
  });

export default Alchemy.Stack(
  "pcobooster",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Drizzle.providers()),
    state: Layer.unwrap(
      Alchemy.Stage.pipe(
        Effect.map((stage) =>
          stage === "local" ? State.localState() : Cloudflare.state()
        )
      )
    ),
    // Stage `local` reads development credentials from Infisical `pcobooster-dev`. Deployed stages
    // read stored secrets by reference and their CI environment, never Infisical: PR stages must
    // not need an identity.
    secrets: stageSecrets(["local"]),
  },
  Effect.gen(function* infrastructure() {
    const { stage, production, local, publicOrigin, webDevPort, workerNames } =
      yield* currentStageSettings;
    if (stage === "test") {
      return yield* Effect.die(
        new Error(
          "The test stage belongs to the API stack test, not this stack"
        )
      );
    }
    // Picks the product favicon (`apps/web/vite.config.ts`); the build stamp hashes the stage.
    process.env.PCOBOOSTER_STAGE = stage;
    process.env.POSTHOG_PROJECT_KEY = production ? productionPostHogKey : "";
    process.env.PLANNING_CENTER_TIME_ZONE = planningCenterFallbackTimeZone;
    if (local) {
      yield* verifyDevelopmentOrganization;
    }
    yield* Effect.promise(async () => {
      await prepareCloudflareBuild(stage);
    });
    const attachDomains = canAttachDomains(production);
    const zone = production
      ? yield* Cloudflare.Zone.Zone("Zone", {
          name: "pcobooster.com",
          type: "full",
        }).pipe(RemovalPolicy.retain())
      : undefined;
    if (zone !== undefined) {
      yield* allowUniversalSslIssuers("", zone, "pcobooster.com");
      yield* protectZoneEdge("", zone);
    }
    const database = yield* Database;
    // Effect-native: it reads its own settings and binds the database (`apps/server/src/worker.ts`).
    const api = yield* Api;
    // TanStack Start. Its build stages the marketing site into `public/marketing` first.
    const web = yield* Cloudflare.Website.Vite("Web", {
      name: workerNames.web,
      rootDir: path.join(import.meta.dirname, "apps/web"),
      domain: attachDomains
        ? { name: "pcobooster.com", aliases: ["www.pcobooster.com"], zone }
        : undefined,
      access:
        production || local ? undefined : yield* nonProductionAccess(stage),
      compatibility: { date: "2026-09-01", flags: ["nodejs_compat"] },
      observability: workerObservability(production),
      dev: { host: "127.0.0.1", port: webDevPort, strictPort: true },
      // The build stages the marketing site, which the product does not import.
      memo: viteMemo(["public/marketing/**"], ["apps/marketing"]),
      env: {
        API: api,
        PRODUCT_ORIGIN: publicOrigin,
        // The deployed commit, served at `/version` for post-deploy verification. As an env
        // prop it is part of the Worker's change hash, so every commit redeploys it.
        PCOBOOSTER_VERSION: Config.String("GITHUB_SHA").pipe(
          Config.withDefault("")
        ),
        // Local stage only, like the API's; production builds ignore it regardless.
        DEV_AUTH_BYPASS: local
          ? Config.String("DEV_AUTH_BYPASS").pipe(Config.withDefault(""))
          : "",
      },
    });
    return {
      web: web.url,
      databaseId: database.databaseId,
      nameServers: zone?.nameServers,
    };
  })
);
