import { describe, expect, it } from "vitest";

import { resolveStageSettings } from "../../../apps/server/src/stage";
import { trialBranch, trialContext } from "./settings";

const sha = "a".repeat(40);
const env = {
  WORKERS_CI: "1",
  WORKERS_CI_BRANCH: trialBranch,
  WORKERS_CI_COMMIT_SHA: sha,
  WORKERS_CI_BUILD_UUID: "01234567-89ab-cdef-0123-456789abcdef",
};
describe("hosted Alchemy trial boundaries", () => {
  it("derives an isolated preview deployment from the build identity", () => {
    const context = trialContext(env, sha);
    expect(context).toStrictEqual({ sha, stage: "builds-trial-0123456789ab" });
    const settings = resolveStageSettings(context.stage, "example");
    expect(settings).toMatchObject({
      production: false,
      local: false,
      staging: false,
      publicOrigin:
        "https://pcobooster-builds-trial-0123456789ab-web.example.workers.dev",
    });
  });

  it.each([
    { WORKERS_CI_BRANCH: "main" },
    { WORKERS_CI: "" },
    { WORKERS_CI_COMMIT_SHA: "b".repeat(40) },
    { WORKERS_CI_BUILD_UUID: "prod" },
    { CLOUDFLARE_CUSTOM_DOMAINS: "1" },
    { ALCHEMY_STAGE: "prod" },
    { PCOBOOSTER_STAGE: "staging" },
  ])("refuses an unsafe build context %j", (override) => {
    expect(() => trialContext({ ...env, ...override }, sha)).toThrow(
      /trial branch|revision|UUID|overrides/u
    );
  });

  it("keeps other arbitrary remote stages rejected", () => {
    expect(() => resolveStageSettings("builds-trial-prod", "example")).toThrow(
      "Unsupported deployment stage"
    );
  });
});
