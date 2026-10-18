import { readDemoConfiguration } from "@pcobooster/api/auth/demo-access";
import type { DemoConfiguration } from "@pcobooster/api/auth/demo-access";
import { resolveReleaseVersion } from "@pcobooster/api/config/release";
import type { PlanningCenterPersonalAccessToken } from "@pcobooster/api/planning-center/core-client";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { PresentationEnvironment } from "@pcobooster/presentation-mode";

/**
 * The API Worker's settings, read once when the Worker starts (`apps/server/src/worker.ts`)
 * and passed explicitly to everything that needs them.
 */
export interface ServerConfig {
  /** `alchemy dev` on a developer machine. Enables dev-only tools; never true once deployed. */
  readonly localDevelopment: boolean;
  /** The production stage, as opposed to a preview or local stage. */
  readonly production: boolean;
  readonly releaseVersion: string;
  /** The product's browser origin: Better Auth's base URL and the only CORS origin. */
  readonly publicOrigin: string;
  readonly auth: {
    readonly secret: string;
    /** Wildcard origin of preview product Workers, trusted for OAuth redirects. */
    readonly previewOriginPattern: string | null;
    readonly proxy: {
      readonly secret: string;
      readonly productionUrl: string;
    } | null;
    readonly planningCenter: {
      readonly clientId: string;
      readonly clientSecret: string;
    };
  };
  /** Used when Planning Center does not report the organization's time zone. */
  readonly fallbackTimeZone: string;
  /** Present only in production, the one stage that shares the product's PostHog project. */
  readonly postHogProjectKey: string | null;
  readonly demo: DemoConfiguration | null;
  /** Local stage only: signs every request in as the owner of the local personal access token. */
  readonly devAuthBypass: boolean;
  /** Local development defaults to read-only unless its launcher explicitly enables writes. */
  readonly planningCenterReadOnly: boolean;
  /** Local stage only: the personal access token behind the dev auth bypass. */
  readonly localPlanningCenterToken: PlanningCenterPersonalAccessToken | null;
  readonly presentation: PresentationEnvironment;
}

/** The raw string settings the Worker binds, keyed by their environment variable names. */
export interface ServerEnvironment {
  readonly NODE_ENV: string;
  readonly APP_ENV: string;
  readonly PCOBOOSTER_VERSION?: string;
  readonly BETTER_AUTH_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly OAUTH_PREVIEW_ORIGIN_PATTERN?: string;
  readonly OAUTH_PROXY_SECRET?: string;
  readonly OAUTH_PROXY_PRODUCTION_URL?: string;
  readonly PLANNING_CENTER_OAUTH_CLIENT_ID: string;
  readonly PLANNING_CENTER_OAUTH_CLIENT_SECRET: string;
  readonly PLANNING_CENTER_TIME_ZONE?: string;
  readonly POSTHOG_PROJECT_KEY?: string;
  readonly DEMO_ACCESS_KEY?: string;
  readonly DEMO_PLANNING_CENTER_CLIENT?: string;
  readonly DEMO_PLANNING_CENTER_PAT?: string;
  readonly DEV_AUTH_BYPASS?: string;
  readonly DEV_PLANNING_CENTER_ACCESS?: string;
  readonly PLANNING_CENTER_CLIENT?: string;
  readonly PLANNING_CENTER_PAT?: string;
  readonly PRESENTATION_MODE?: string;
  readonly PRESENTATION_SEED?: string;
}

const DEFAULT_TIME_ZONE = "America/Los_Angeles";

const optional = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return isNonEmptyString(trimmed) ? trimmed : null;
};

const required = (value: string, name: string): string => {
  const present = optional(value);
  if (present === null) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return present;
};

const resolveProxy = (
  environment: ServerEnvironment
): ServerConfig["auth"]["proxy"] => {
  const secret = optional(environment.OAUTH_PROXY_SECRET);
  const productionUrl = optional(environment.OAUTH_PROXY_PRODUCTION_URL);
  return secret !== null && productionUrl !== null
    ? { secret, productionUrl }
    : null;
};

const resolveLocalToken = (
  environment: ServerEnvironment
): PlanningCenterPersonalAccessToken | null => {
  const applicationId = optional(environment.PLANNING_CENTER_CLIENT);
  const secret = optional(environment.PLANNING_CENTER_PAT);
  return applicationId !== null && secret !== null
    ? { applicationId, secret }
    : null;
};

export const resolveServerConfig = (
  environment: ServerEnvironment
): ServerConfig => {
  const localDevelopment = environment.NODE_ENV !== "production";
  const production = environment.APP_ENV === "production";
  const devAuthBypassRequested =
    environment.DEV_AUTH_BYPASS === "1" ||
    environment.DEV_AUTH_BYPASS === "true";
  return {
    localDevelopment,
    production,
    releaseVersion: resolveReleaseVersion(environment.PCOBOOSTER_VERSION),
    publicOrigin: required(environment.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
    auth: {
      secret: required(environment.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
      previewOriginPattern: optional(environment.OAUTH_PREVIEW_ORIGIN_PATTERN),
      proxy: resolveProxy(environment),
      planningCenter: {
        clientId: required(
          environment.PLANNING_CENTER_OAUTH_CLIENT_ID,
          "PLANNING_CENTER_OAUTH_CLIENT_ID"
        ),
        clientSecret: required(
          environment.PLANNING_CENTER_OAUTH_CLIENT_SECRET,
          "PLANNING_CENTER_OAUTH_CLIENT_SECRET"
        ),
      },
    },
    fallbackTimeZone:
      optional(environment.PLANNING_CENTER_TIME_ZONE) ?? DEFAULT_TIME_ZONE,
    postHogProjectKey: production
      ? optional(environment.POSTHOG_PROJECT_KEY)
      : null,
    demo: readDemoConfiguration(environment),
    devAuthBypass: localDevelopment && devAuthBypassRequested,
    planningCenterReadOnly:
      localDevelopment && environment.DEV_PLANNING_CENTER_ACCESS !== "write",
    localPlanningCenterToken: localDevelopment
      ? resolveLocalToken(environment)
      : null,
    presentation: {
      NODE_ENV: environment.NODE_ENV,
      PRESENTATION_MODE: environment.PRESENTATION_MODE,
      PRESENTATION_SEED: environment.PRESENTATION_SEED,
    },
  };
};
