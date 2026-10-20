import { describe, expect, it } from "vitest";

import { infisicalProjects, infisicalSource } from "./infisical";

describe(infisicalSource, () => {
  it("maps only production and the main-deployed preview tier to the production project", () => {
    expect(
      ["prod", "preview", "staging"].map((stage) => infisicalSource(stage))
    ).toStrictEqual([
      { project: infisicalProjects.prod, environment: "prod" },
      { project: infisicalProjects.prod, environment: "preview" },
      { project: infisicalProjects.prod, environment: "preview" },
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
        project: infisicalProjects.dev,
        environment: "dev",
      });
    }
  });
});
