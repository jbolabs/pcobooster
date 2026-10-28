import { describe, expect, it } from "vitest";

import { resolveStageSettings } from "./stage";

describe("resolveStageSettings worker names", () => {
  it("isolates a test run's listener, browser origin, and registry names", () => {
    const settings = resolveStageSettings("test", "jakebodea", 3000, 51_234);
    expect({
      port: settings.apiDevPort,
      origin: settings.publicOrigin,
      name: settings.workerNames.api,
    }).toStrictEqual({
      port: 51_234,
      origin: "http://127.0.0.1:51234",
      name: "pcobooster-test-51234-api",
    });
    expect(
      resolveStageSettings("prod", "jakebodea", 3000, 51_234).publicOrigin
    ).toBe("https://pcobooster.com");
  });

  it("keeps deployed stages on their published script names", () => {
    expect(
      resolveStageSettings("pr-42", "jakebodea").workerNames
    ).toStrictEqual({
      api: "pcobooster-pr-42-api",
      web: "pcobooster-pr-42-web",
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
    });
  });

  it("gives a worktree on its own port block its own registry names", () => {
    expect(
      resolveStageSettings("local", "jakebodea", 4040).workerNames
    ).toStrictEqual({
      api: "pcobooster-local-4040-api",
      web: "pcobooster-local-4040-web",
    });
  });
});
