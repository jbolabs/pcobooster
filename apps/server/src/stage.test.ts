import { describe, expect, it } from "vitest";

import { resolveStageSettings } from "./stage";

describe("resolveStageSettings worker names", () => {
  it("keeps deployed stages on their published script names", () => {
    expect(
      resolveStageSettings("pr-42", "jakebodea").workerNames
    ).toStrictEqual({
      api: "pcobooster-pr-42-api",
      web: "pcobooster-pr-42-web",
      admin: "pcobooster-pr-42-admin",
    });
    expect(resolveStageSettings("pr-42", "jakebodea").publicOrigin).toBe(
      "https://pcobooster-pr-42-web.jakebodea.workers.dev"
    );
  });

  it("keeps the main checkout's local names on the default ports", () => {
    expect(
      resolveStageSettings("local", "jakebodea").workerNames
    ).toStrictEqual({
      api: "pcobooster-local-api",
      web: "pcobooster-local-web",
      admin: "pcobooster-local-admin",
    });
  });

  it("gives a worktree on its own port block its own registry names", () => {
    expect(
      resolveStageSettings("local", "jakebodea", 4040).workerNames
    ).toStrictEqual({
      api: "pcobooster-local-4040-api",
      web: "pcobooster-local-4040-web",
      admin: "pcobooster-local-4040-admin",
    });
  });
});
