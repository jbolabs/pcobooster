import { describe, expect, it } from "vitest";

import { resolveDevelopmentProfile } from "./dev-profile-config";

describe("development account profiles", () => {
  it("defaults to the writable isolated sandbox", () => {
    expect(resolveDevelopmentProfile([])).toStrictEqual({
      kind: "sandbox",
      readOnly: false,
      label: "Sandbox · writes enabled",
    });
  });

  it("opens Agape read-only unless writes are explicitly requested", () => {
    expect(resolveDevelopmentProfile(["--church"])).toStrictEqual({
      kind: "church",
      readOnly: true,
      label: "Agape · read-only",
    });
    expect(resolveDevelopmentProfile(["--church", "--write"])).toStrictEqual({
      kind: "church-write",
      readOnly: false,
      label: "Agape · LIVE WRITES",
    });
  });

  it("rejects a write switch without a named church profile", () => {
    expect(() => resolveDevelopmentProfile(["--write"])).toThrow(
      "--write requires --church"
    );
  });
});
