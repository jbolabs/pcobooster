import { describe, expect, it } from "vitest";

import { environments, productionEnvironment } from "../../alchemy.ci";

describe("GitHub deployment environments", () => {
  it("restricts the production environment to main and gives it the ci-prod login", () => {
    const production = environments.filter(
      (environment) => environment.name === productionEnvironment
    );
    expect(
      production.map((environment) => ({
        name: environment.name,
        branches: environment.branches,
        identity: environment.variables.INFISICAL_IDENTITY_ID,
        audience: environment.variables.INFISICAL_OIDC_AUDIENCE,
      }))
    ).toStrictEqual([
      {
        name: "production",
        branches: { customBranchPolicies: ["main"] },
        identity: "23fa16cc-a7a1-4e35-8011-2f24b0e037ba",
        audience: "https://github.com/jbolabs",
      },
    ]);
  });

  it("keeps the Infisical login out of every other environment", () => {
    expect(
      environments
        .filter((environment) => environment.name !== productionEnvironment)
        .flatMap((environment) =>
          Object.keys(environment.variables).filter((key) =>
            key.startsWith("INFISICAL_")
          )
        )
    ).toStrictEqual([]);
  });
});
