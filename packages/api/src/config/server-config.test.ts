import { resolveServerConfig } from "@pcobooster/api/config/server-config";
import {
  testServerConfig,
  testServerEnvironment,
} from "@pcobooster/api/testing/server";
import { describe, expect, it } from "vitest";

const localTools = {
  DEV_AUTH_BYPASS: "1",
  PLANNING_CENTER_CLIENT: "local-app",
  PLANNING_CENTER_PAT: "local-secret",
};

describe(resolveServerConfig, () => {
  it("defaults developer connections to read-only and ignores the setting in deployed builds", () => {
    expect(
      testServerConfig({
        NODE_ENV: "development",
        DEV_PLANNING_CENTER_ACCESS: undefined,
      }).planningCenterReadOnly
    ).toBeTruthy();
    expect(
      testServerConfig({
        NODE_ENV: "development",
        DEV_PLANNING_CENTER_ACCESS: "write",
      }).planningCenterReadOnly
    ).toBeFalsy();
    expect(
      testServerConfig({
        NODE_ENV: "production",
        DEV_PLANNING_CENTER_ACCESS: "read",
      }).planningCenterReadOnly
    ).toBeFalsy();
  });

  it("enables dev-only tools only for local development", () => {
    const local = testServerConfig({ NODE_ENV: "development", ...localTools });
    expect(local.devAuthBypass).toBeTruthy();
    expect(local.localPlanningCenterToken).toStrictEqual({
      applicationId: "local-app",
      secret: "local-secret",
    });

    const deployed = testServerConfig({
      NODE_ENV: "production",
      ...localTools,
    });
    expect(deployed.devAuthBypass).toBeFalsy();
    expect(deployed.localPlanningCenterToken).toBeNull();
  });

  it("shares the PostHog project only from production", () => {
    const key = { POSTHOG_PROJECT_KEY: "phc_test" };
    expect(testServerConfig({ APP_ENV: "production", ...key })).toMatchObject({
      postHogProjectKey: "phc_test",
    });
    expect(testServerConfig({ APP_ENV: "preview", ...key })).toMatchObject({
      postHogProjectKey: null,
    });
  });

  it("enables the OAuth proxy only with both a secret and a production URL", () => {
    expect(
      testServerConfig({ OAUTH_PROXY_SECRET: "proxy-secret" }).auth.proxy
    ).toBeNull();
    expect(
      testServerConfig({
        OAUTH_PROXY_SECRET: "proxy-secret",
        OAUTH_PROXY_PRODUCTION_URL: "https://pcobooster.com",
      }).auth.proxy
    ).toStrictEqual({
      secret: "proxy-secret",
      productionUrl: "https://pcobooster.com",
    });
  });

  it("rejects a missing required secret", () => {
    expect(() =>
      resolveServerConfig({ ...testServerEnvironment, BETTER_AUTH_SECRET: " " })
    ).toThrow("Missing BETTER_AUTH_SECRET environment variable");
  });
});
