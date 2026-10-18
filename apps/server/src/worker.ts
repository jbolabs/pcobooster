import { deploymentTier } from "@pcobooster/api/config/feature-flags";
import type { ServerEnvironment } from "@pcobooster/api/config/server-config";
import { resolveServerConfig } from "@pcobooster/api/config/server-config";
import { MobileUpdates } from "@pcobooster/api/http/mobile-updates";
import { IsolateServer } from "@pcobooster/api/http/procedure-scope";
import { structuredLogging } from "@pcobooster/api/logging";
import { UpdateStoreUnavailable } from "@pcobooster/api/modules/mobile-updates/update-store";
import type { UpdateStore } from "@pcobooster/api/modules/mobile-updates/update-store";
import { PlanningCenterRatePacer } from "@pcobooster/api/planning-center/rate-pacer";
import type { SharedReadStore } from "@pcobooster/api/planning-center/services/shared-read-store";
import { createServerDependencies } from "@pcobooster/api/server";
import type { FeatureFlagSource } from "@pcobooster/api/server";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Layer, Redacted, Scope } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { Database } from "./database";
import { waitUntilAfterDisconnect } from "./disconnect";
import { FeatureFlagApp } from "./feature-flags";
import {
  AUTH_RATE_LIMIT_PERIOD_SECONDS,
  AuthWriteLimit,
  makeHttpApp,
} from "./http-app";
import type { AuthWriteLimiter } from "./http-app";
import { MobileUpdateBucket } from "./mobile-update-bucket";
import { apiWorkerObservability, apiWorkerTelemetry } from "./observability";
import { PlanningCenterCache } from "./planning-center-cache";
import { postHogProcedureReporter } from "./procedure-reporting";
import { readAuthSecret, readRuntimeSecret } from "./runtime-secrets";
import {
  cachedAcrossRequests,
  cachedAcrossRequestsBy,
} from "./shared-initialization";
import { currentStageSettings } from "./stage";

const SECRET_REFRESH_MS = 60_000;

const unreadableBucket = (cause: unknown) =>
  new UpdateStoreUnavailable({
    reason: cause instanceof Error ? cause.message : "R2 read failed",
  });

/**
 * Auth writes (sign-in, sign-out, native sign-in start and exchange; see `http-app.ts`) each
 * client IP may make per minute. A whole church signing in from one network stays well under it;
 * a script hammering sign-in does not. Cloudflare counts per location, so it is a brake on abuse,
 * not an exact quota.
 */
const AUTH_WRITES_PER_PERIOD = 30;

const secret = (name: string) =>
  Config.Redacted(name).pipe(Config.map(Redacted.value));
const optionalSecret = (name: string) =>
  secret(name).pipe(Config.withDefault(""));
const optionalString = (name: string) =>
  Config.String(name).pipe(Config.withDefault(""));

/** Bind immutable configuration during construction; read stored secrets inside requests. */
const readEnvironment = Effect.gen(function* readEnvironment() {
  const { production, local, publicOrigin, previewOriginPattern } =
    yield* currentStageSettings;
  const authSecret = yield* readAuthSecret;
  const clientId = yield* readRuntimeSecret("PLANNING_CENTER_OAUTH_CLIENT_ID");
  const clientSecret = yield* readRuntimeSecret(
    "PLANNING_CENTER_OAUTH_CLIENT_SECRET"
  );
  const proxySecret = local
    ? Effect.succeed("")
    : yield* readRuntimeSecret("OAUTH_PROXY_SECRET");
  const demoAccess = production
    ? yield* readRuntimeSecret("DEMO_ACCESS_KEY")
    : Effect.succeed("");
  const demoClient = production
    ? yield* readRuntimeSecret("DEMO_PLANNING_CENTER_CLIENT")
    : Effect.succeed("");
  const demoPat = production
    ? yield* readRuntimeSecret("DEMO_PLANNING_CENTER_PAT")
    : Effect.succeed("");
  const environment = {
    NODE_ENV: local ? "development" : "production",
    APP_ENV: production ? "production" : "preview",
    PCOBOOSTER_VERSION: yield* optionalString("PCOBOOSTER_VERSION"),
    BETTER_AUTH_URL: publicOrigin,
    OAUTH_PREVIEW_ORIGIN_PATTERN: previewOriginPattern,
    OAUTH_PROXY_PRODUCTION_URL: local ? "" : "https://pcobooster.com",
    PLANNING_CENTER_TIME_ZONE: yield* Config.String(
      "PLANNING_CENTER_TIME_ZONE"
    ).pipe(Config.withDefault("America/Los_Angeles")),
    POSTHOG_PROJECT_KEY: production
      ? yield* optionalString("POSTHOG_PROJECT_KEY")
      : "",
    DEV_AUTH_BYPASS: local ? yield* optionalString("DEV_AUTH_BYPASS") : "",
    DEV_PLANNING_CENTER_ACCESS: local
      ? yield* optionalString("DEV_PLANNING_CENTER_ACCESS")
      : "",
    PLANNING_CENTER_CLIENT: local
      ? yield* optionalSecret("PLANNING_CENTER_CLIENT")
      : "",
    PLANNING_CENTER_PAT: local
      ? yield* optionalSecret("PLANNING_CENTER_PAT")
      : "",
    PRESENTATION_MODE: local ? yield* optionalString("PRESENTATION_MODE") : "",
    PRESENTATION_SEED: local ? yield* optionalSecret("PRESENTATION_SEED") : "",
  };
  return Effect.gen(function* resolveEnvironment() {
    const resolved: ServerEnvironment = {
      ...environment,
      BETTER_AUTH_SECRET: yield* authSecret,
      PLANNING_CENTER_OAUTH_CLIENT_ID: yield* clientId,
      PLANNING_CENTER_OAUTH_CLIENT_SECRET: yield* clientSecret,
      OAUTH_PROXY_SECRET: yield* proxySecret,
      DEMO_ACCESS_KEY: yield* demoAccess,
      DEMO_PLANNING_CENTER_CLIENT: yield* demoClient,
      DEMO_PLANNING_CENTER_PAT: yield* demoPat,
    };
    yield* Effect.try({
      try: () => resolveServerConfig(resolved),
      catch: () =>
        new Error(
          "Invalid API Worker settings; check the configured secret names and required values"
        ),
    }).pipe(Effect.orDie);
    return resolved;
  });
});

/**
 * The API Worker: one Effect router (`http-app.ts`) serves the product API (`/api/v1`), Better
 * Auth, the iOS app's over-the-air updates, and liveness.
 */
export default class Api extends Cloudflare.Worker<Api>()(
  "Api",
  Effect.gen(function* apiProps() {
    const { stage, apiDevPort } = yield* currentStageSettings;
    return {
      name: `pcobooster-${stage}-api`,
      main: import.meta.url,
      workersDev: false,
      compatibility: { date: "2026-09-01", flags: ["nodejs_compat"] },
      observability: apiWorkerObservability(),
      // Separate from the Planning Center 40-request policy; see the dated request ledger.
      limits: { subrequests: 80 },
      dev: { host: "127.0.0.1", port: apiDevPort, strictPort: true },
      env: {
        // CI deploys the checked-out commit; post-deploy verification expects it from health.
        // Alchemy's change detection hashes `env` props but not the `Config` reads made in
        // init, so reading GITHUB_SHA there would leave a web-only deploy serving the old one.
        PCOBOOSTER_VERSION: yield* optionalString("GITHUB_SHA"),
      },
    };
  }),
  Effect.gen(function* api() {
    const database = yield* Cloudflare.D1.QueryDatabase(yield* Database);
    const planningCenterCache = yield* Cloudflare.KV.ReadWriteNamespace(
      yield* PlanningCenterCache
    );
    // Read-only: the publisher writes updates on the operator's Mac (`scripts/mobile-updates`).
    const mobileUpdates = yield* Cloudflare.R2.ReadBucket(
      yield* MobileUpdateBucket
    );
    const tier = deploymentTier(yield* currentStageSettings);
    // `alchemy dev` has no local Flagship: its binding would proxy to a live app, which needs
    // Cloudflare credentials and cloud resources. The local stage serves registry values.
    const flags =
      tier === "local"
        ? undefined
        : yield* Cloudflare.Flagship.ReadFlags(yield* FeatureFlagApp(tier));
    const authRateLimit = yield* Cloudflare.RateLimit("AUTH_RATE_LIMIT", {
      namespaceId: 1001,
      simple: {
        limit: AUTH_WRITES_PER_PERIOD,
        period: AUTH_RATE_LIMIT_PERIOD_SECONDS,
      },
    });
    const resolveEnvironment = yield* readEnvironment;
    const { publicOrigin } = yield* currentStageSettings;
    // One pacer per isolate shares each credential's Planning Center budget across requests.
    const pacer = new PlanningCenterRatePacer();
    // The router lives as long as the isolate, so this scope is never closed.
    const isolateScope = Scope.makeUnsafe();
    // Built once, here, before any request: nothing request-scoped can reach it.
    const http = yield* makeHttpApp({
      publicOrigin,
      pacer,
      afterDisconnect: waitUntilAfterDisconnect,
    }).pipe(Scope.provide(isolateScope));
    // The D1, KV, R2, and Flagship bindings and a runtime-minted secret are only readable inside a
    // request, so the server is built by the first one and shared by the rest of the isolate's
    // lifetime until a refreshed secret changes. Not `Effect.cached`: requests that arrive while the first one builds must not
    // resume inside it; see `cachedAcrossRequests`.
    const refreshedEnvironment = yield* cachedAcrossRequests(
      resolveEnvironment,
      { ttlMs: SECRET_REFRESH_MS }
    );
    const isolate = yield* cachedAcrossRequestsBy(
      refreshedEnvironment,
      (environment) =>
        Effect.gen(function* buildServer() {
          const config = resolveServerConfig(environment);
          const binding = yield* database.raw;
          const featureFlagSource: FeatureFlagSource =
            flags === undefined
              ? { kind: "registry", tier: "local" }
              : { kind: "flagship", binding: yield* flags.raw };
          const namespace = yield* planningCenterCache.raw;
          const rateLimit = yield* authRateLimit.raw;
          const updateBucket = yield* mobileUpdates.raw;
          const updates: UpdateStore = {
            readText: (key) =>
              Effect.tryPromise({
                try: async () => {
                  const object = await updateBucket.get(key);
                  return object === null ? null : await object.text();
                },
                catch: unreadableBucket,
              }),
            readAsset: (key) =>
              Effect.tryPromise({
                try: async () => {
                  const object = await updateBucket.get(key);
                  return object === null
                    ? null
                    : {
                        bytes: new Uint8Array(await object.arrayBuffer()),
                        contentType:
                          object.httpMetadata?.contentType ??
                          "application/octet-stream",
                      };
                },
                catch: unreadableBucket,
              }),
          };
          const planningCenterReadStore: SharedReadStore = {
            get: async (key) => await namespace.get(key, "text"),
            put: async (key, value, { expirationTtl }) => {
              await namespace.put(key, value, { expirationTtl });
            },
          };
          const server = createServerDependencies(
            config,
            binding,
            featureFlagSource,
            planningCenterReadStore
          );
          // Better Auth starts initializing (including OIDC discovery) when created. workerd ties
          // that I/O to the current request, so it must settle before this request ends or every
          // later request would wait on it forever.
          yield* Effect.promise(async () => {
            await server.auth.$context;
          });
          const report = postHogProcedureReporter(config.postHogProjectKey);
          const allowAuthWrite: AuthWriteLimiter = async (clientIp) => {
            const outcome = await rateLimit.limit({ key: clientIp });
            return outcome.success;
          };
          return { server, report, allowAuthWrite, updates };
        }),
      // Values remain in memory only; equality never emits them into logs or state.
      (left, right) => JSON.stringify(left) === JSON.stringify(right)
    );
    return {
      fetch: Effect.gen(function* fetch() {
        const { server, report, allowAuthWrite, updates } = yield* isolate;
        return yield* http.pipe(
          Effect.provideService(IsolateServer, { server, report }),
          Effect.provideService(AuthWriteLimit, allowAuthWrite),
          Effect.provideService(MobileUpdates, updates)
        );
      }).pipe(
        Effect.catchTag("SecretError", () =>
          Effect.logError(
            "Runtime secret read failed; serving unavailable"
          ).pipe(
            Effect.as(
              HttpServerResponse.text("Service temporarily unavailable", {
                status: 503,
              })
            )
          )
        )
      ),
    };
  }).pipe(
    // Workers Logs indexes each field of a structured line.
    Effect.provide(structuredLogging),
    Effect.provide(
      Layer.unwrap(currentStageSettings.pipe(Effect.map(apiWorkerTelemetry)))
    ),
    Effect.provide(Cloudflare.SecretsStore.ReadSecretBinding),
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding),
    Effect.provide(Cloudflare.R2.ReadBucketBinding),
    Effect.provide(Cloudflare.Flagship.ReadFlagsBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding)
  )
) {}
