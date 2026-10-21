import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildContext } from "./context";
import { validSignature } from "./controller";
import { eligiblePullRequest } from "./github";

const sha = "a".repeat(40);
const pr = {
  number: 12,
  state: "open",
  head: { sha, ref: "feature", repo: { full_name: "jbolabs/pcobooster" } },
  base: {
    sha: "b".repeat(40),
    ref: "main",
    repo: { full_name: "jbolabs/pcobooster" },
  },
};
describe("Cloudflare PR trust boundaries", () => {
  it("accepts only a current open same-repository PR", () => {
    expect(eligiblePullRequest(pr, sha)).toBeTruthy();
    expect(eligiblePullRequest({ ...pr, state: "closed" }, sha)).toBeFalsy();
    expect(
      eligiblePullRequest(
        { ...pr, head: { ...pr.head, repo: { full_name: "attacker/fork" } } },
        sha
      )
    ).toBeFalsy();
    expect(eligiblePullRequest(pr, "c".repeat(40))).toBeFalsy();
  });

  it("verifies webhook signatures against the exact received body", async () => {
    const body = '{"action":"opened"}';
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    await expect(
      validSignature(body, signature, "secret")
    ).resolves.toBeTruthy();
    await expect(
      validSignature(`${body} `, signature, "secret")
    ).resolves.toBeFalsy();
    await expect(validSignature(body, signature, "wrong")).resolves.toBeFalsy();
    await expect(
      validSignature(body, "invalid", "secret")
    ).resolves.toBeFalsy();
  });

  it("isolates build stages and refuses production overrides", () => {
    const env = {
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "feature",
      WORKERS_CI_COMMIT_SHA: sha,
      WORKERS_CI_BUILD_UUID: "01234567-89ab-cdef-0123-456789abcdef",
    };
    expect(buildContext(env, sha)).toStrictEqual({
      sha,
      stage: "builds-trial-0123456789ab",
    });
    expect(() =>
      buildContext({ ...env, WORKERS_CI_BRANCH: "main" }, sha)
    ).toThrow("refuse main");
    expect(() =>
      buildContext({ ...env, CLOUDFLARE_CUSTOM_DOMAINS: "1" }, sha)
    ).toThrow("overrides");
    expect(() => buildContext(env, "b".repeat(40))).toThrow(
      "identity mismatch"
    );
  });
});
