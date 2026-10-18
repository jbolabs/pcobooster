import { resolveServerConfig } from "@pcobooster/api/config/server-config";
import type {
  ServerConfig,
  ServerEnvironment,
} from "@pcobooster/api/config/server-config";
import type {
  FeatureFlags,
  FeatureFlagSubject,
} from "@pcobooster/api/modules/feature-flags/feature-flags";
import { createModuleReadCaches } from "@pcobooster/api/modules/read-caches";
import type { PlanningCenterPersonalAccessToken } from "@pcobooster/api/planning-center/core-client";
import { createPlanningCenterReadCaches } from "@pcobooster/api/planning-center/services/factory";
import type { ServerDependencies } from "@pcobooster/api/server";
import type { FeatureFlagName } from "@pcobooster/contracts/features";
import { Effect } from "effect";

/** Credentials that only ever reach mocked `fetch` calls. */
export const testPlanningCenterToken: PlanningCenterPersonalAccessToken = {
  applicationId: "test-client",
  secret: "test-token",
};

export const testServerEnvironment: ServerEnvironment = {
  NODE_ENV: "test",
  DEV_PLANNING_CENTER_ACCESS: "write",
  APP_ENV: "preview",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "pcobooster-unit-test-secret-with-no-production-access",
  PLANNING_CENTER_OAUTH_CLIENT_ID: "test-client",
  PLANNING_CENTER_OAUTH_CLIENT_SECRET: "test-client-secret",
};

export const testServerConfig = (
  environment: Partial<ServerEnvironment> = {}
): ServerConfig =>
  resolveServerConfig({ ...testServerEnvironment, ...environment });

export interface TestFeatureFlags extends FeatureFlags {
  /** Every evaluation, in order. */
  readonly evaluations: {
    readonly flag: FeatureFlagName;
    readonly subject: FeatureFlagSubject;
  }[];
}

/** Flags that serve the given values (off when unlisted) and record each evaluation. */
export const testFeatureFlags = (
  enabled: Partial<Record<FeatureFlagName, boolean>> = {}
): TestFeatureFlags => {
  const evaluations: TestFeatureFlags["evaluations"] = [];
  return {
    evaluations,
    isEnabled: (flag, subject) =>
      Effect.sync(() => {
        evaluations.push({ flag, subject });
        return enabled[flag] ?? false;
      }),
  };
};

/**
 * Server dependencies for unit tests. Config defaults to `testServerConfig()` and every flag to off; a test that
 * touches the database or Better Auth must supply them, so none starts them by accident.
 * Planning Center and module read caches are fresh and memory-only unless a test supplies them.
 */
export const testServer = (
  overrides: Partial<ServerDependencies> = {}
): ServerDependencies => {
  const {
    config = testServerConfig(),
    featureFlags = testFeatureFlags(),
    planningCenterReadCaches = createPlanningCenterReadCaches(null),
    moduleReadCaches = createModuleReadCaches(),
    database,
    auth,
  } = overrides;
  return {
    config,
    featureFlags,
    planningCenterReadCaches,
    moduleReadCaches,
    get database() {
      if (database === undefined) {
        throw new Error("This test did not provide a database");
      }
      return database;
    },
    get auth() {
      if (auth === undefined) {
        throw new Error("This test did not provide Better Auth");
      }
      return auth;
    },
  };
};
