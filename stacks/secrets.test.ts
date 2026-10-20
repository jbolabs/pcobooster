import { describe, expect, it } from "vitest";

import { infisical, infisicalSource, stageSecrets } from "./secrets";

describe(infisicalSource, () => {
  it("maps only production and the main-deployed preview tier to the production project", () => {
    expect(
      ["prod", "preview", "staging"].map((stage) => infisicalSource(stage))
    ).toStrictEqual([
      { project: infisical.prod, environment: "prod" },
      { project: infisical.prod, environment: "preview" },
      { project: infisical.prod, environment: "preview" },
    ]);
  });

  it("never lets a local, pull request, or other stage select production values", () => {
    for (const stage of [
      "local",
      "pr-123",
      "pr-prod",
      "load",
      "Prod",
      "prod-x",
    ]) {
      expect(infisicalSource(stage)).toStrictEqual({
        project: infisical.dev,
        environment: "dev",
      });
    }
  });

  it("gives pull request stages no Infisical source, even when a stack lists them", () => {
    const secrets = stageSecrets(["local", "pr-7"]);
    expect({
      pullRequest: secrets({ stage: "pr-7" }),
      unlisted: secrets({ stage: "staging" }),
      local: secrets({ stage: "local" }).length,
    }).toStrictEqual({ pullRequest: [], unlisted: [], local: 1 });
  });
});
