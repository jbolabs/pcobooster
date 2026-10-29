import type { D1Database } from "@cloudflare/workers-types";
import { createAuth } from "@pcobooster/api/auth";
import type { Auth } from "@pcobooster/api/auth";
import type { DeploymentTier } from "@pcobooster/api/config/feature-flags";
import type { ServerConfig } from "@pcobooster/api/config/server-config";
import { createDatabase } from "@pcobooster/api/db/client";
import type { Db } from "@pcobooster/api/db/client";
import { boundaryLog } from "@pcobooster/api/logging";
import {
  createFlagshipFeatureFlags,
  createRegistryFeatureFlags,
} from "@pcobooster/api/modules/feature-flags/feature-flags";
import type {
  FeatureFlags,
  FlagshipBinding,
} from "@pcobooster/api/modules/feature-flags/feature-flags";
import { getPlanningCenterAccountIdentity } from "@pcobooster/api/modules/planning-center/account-identities";
import {
  createModuleReadCaches,
  moduleReadCachesForRequest,
} from "@pcobooster/api/modules/read-caches";
import type { ModuleReadCaches } from "@pcobooster/api/modules/read-caches";
import {
  createPlanningCenterReadCaches,
  planningCenterReadCachesForRequest,
} from "@pcobooster/api/planning-center/services/factory";
import type { PlanningCenterReadCaches } from "@pcobooster/api/planning-center/services/factory";
import type { SharedReadStore } from "@pcobooster/api/planning-center/services/shared-read-store";
import { Context } from "effect";

/**
 * Built once per Worker isolate and shared by every request it serves. Each request runs with
 * its own view, `serverDependenciesForRequest`.
 */
export interface ServerDependencies {
  readonly config: ServerConfig;
  readonly database: Db;
  readonly auth: Auth;
  readonly featureFlags: FeatureFlags;
  readonly planningCenterReadCaches: PlanningCenterReadCaches;
  readonly moduleReadCaches: ModuleReadCaches;
}

export class Server extends Context.Service<Server, ServerDependencies>()(
  "@pcobooster/api/Server"
) {}

/**
 * Where flag values come from: the stage's Cloudflare Flagship app, or (local stage only,
 * which has no Flagship emulator) the registry's values for a tier.
 */
export type FeatureFlagSource =
  | { readonly kind: "flagship"; readonly binding: FlagshipBinding }
  | { readonly kind: "registry"; readonly tier: DeploymentTier };

const featureFlagLog = boundaryLog("feature-flags");
const readCacheLog = boundaryLog("planning-center-cache");

const createFeatureFlags = (
  source: FeatureFlagSource,
  database: Db
): FeatureFlags =>
  source.kind === "registry"
    ? createRegistryFeatureFlags(source.tier)
    : createFlagshipFeatureFlags({
        flagship: source.binding,
        resolveOrganizationId: async (accountId) => {
          const identity = await getPlanningCenterAccountIdentity(
            accountId,
            database
          );
          return identity?.organizationId ?? null;
        },
        reportFailure: ({ cause, ...failure }) => {
          featureFlagLog.error(
            "Feature flag evaluation failed; serving off",
            { ...failure },
            cause ?? undefined
          );
        },
      });

export const createServerDependencies = (
  config: ServerConfig,
  binding: D1Database,
  featureFlagSource: FeatureFlagSource,
  /** The shared Planning Center read tier every isolate reads through. */
  planningCenterReadStore: SharedReadStore
): ServerDependencies => {
  const database = createDatabase(binding);
  return {
    config,
    database,
    auth: createAuth(config, database),
    featureFlags: createFeatureFlags(featureFlagSource, database),
    planningCenterReadCaches: createPlanningCenterReadCaches({
      store: planningCenterReadStore,
      reportError: (message, error) => {
        readCacheLog.warn(message, {}, error);
      },
    }),
    moduleReadCaches: createModuleReadCaches(),
  };
};

/**
 * The dependencies one request runs with. Its read caches share loaded values with every
 * request but join only loads this request started: workerd ties I/O to the request that
 * started it, so a load another request started may never settle once that request ends.
 */
export const serverDependenciesForRequest = (
  server: ServerDependencies
): ServerDependencies => ({
  config: server.config,
  featureFlags: server.featureFlags,
  // Read on use: test dependencies throw for a database or Better Auth they were not given.
  get database() {
    return server.database;
  },
  get auth() {
    return server.auth;
  },
  planningCenterReadCaches: planningCenterReadCachesForRequest(
    server.planningCenterReadCaches
  ),
  moduleReadCaches: moduleReadCachesForRequest(server.moduleReadCaches),
});
