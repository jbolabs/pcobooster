import { describe, expect, it } from "vitest";

import { validationScope } from "./affected";
import {
  fixtureGit,
  turboPlan,
  validationFixture,
  writeFixture,
} from "./fixtures";

describe("affected validation", () => {
  it.each(["unstaged", "staged", "untracked", "committed", "deleted"])(
    "checks an %s app change and keeps repository guards",
    (state) => {
      const cwd = validationFixture();
      const base = fixtureGit(cwd, "rev-parse", "HEAD");
      if (state === "deleted") {
        fixtureGit(cwd, "rm", "apps/video/src/input.ts");
      } else {
        writeFixture(
          cwd,
          state === "untracked"
            ? "apps/video/src/new.ts"
            : "apps/video/src/input.ts",
          "export const input = 2;\n"
        );
      }
      if (state === "staged" || state === "committed") {
        fixtureGit(cwd, "add", ".");
      }
      if (state === "committed") {
        fixtureGit(
          cwd,
          "-c",
          "user.name=CI fixture",
          "-c",
          "user.email=ci@example.com",
          "commit",
          "-m",
          "Change app"
        );
      }
      const scope = validationScope(cwd, base);
      expect(
        turboPlan(cwd, ["test", "//#test:root", ...scope.args])
          .filter((task) => !task.taskId.endsWith("#test:inputs"))
          .map((task) => task.taskId)
          .toSorted()
      ).toStrictEqual(["//#test:root", "@pcobooster/video#test"]);
    }
  );

  it("includes dependents without waiting for prerequisite tests", () => {
    const cwd = validationFixture();
    writeFixture(
      cwd,
      "packages/client/src/input.ts",
      "export const input = 2;\n"
    );
    const scope = validationScope(cwd, "HEAD");
    expect(
      turboPlan(cwd, ["test", "//#test:root", ...scope.args])
        .filter((task) => !task.taskId.endsWith("#test:inputs"))
        .map((task) => task.taskId)
        .toSorted()
    ).toStrictEqual([
      "//#test:root",
      "@pcobooster/client#test",
      "@pcobooster/mobile#test",
      "@pcobooster/web#test",
    ]);
  });

  it("selects mobile tests when their source design tokens change", () => {
    const cwd = validationFixture();
    writeFixture(
      cwd,
      "packages/design-tokens/src/tokens.css",
      ":root { --color: blue; }\n"
    );
    const scope = validationScope(cwd, "HEAD");
    expect(
      turboPlan(cwd, ["test", "//#test:root", ...scope.args])
        .filter((task) => !task.taskId.endsWith("#test:inputs"))
        .map((task) => task.taskId)
        .toSorted()
    ).toStrictEqual([
      "//#test:root",
      "@pcobooster/design-tokens#test",
      "@pcobooster/mobile#test",
    ]);
  });

  it.each([
    "vitest.config.ts",
    "packages/config/tsconfig.base.json",
    "scripts/testing/miniflare.ts",
    "scripts/database/local-d1.ts",
    "scripts/secrets/manifest.ts",
    "stacks/secrets.ts",
    "scripts/cloudflare/verify-deployment.ts",
    ".github/workflows/ci.yml",
    "patches/provider.patch",
  ])("runs every package when shared input %s changes", (file) => {
    const cwd = validationFixture();
    writeFixture(cwd, file, "changed\n");
    const scope = validationScope(cwd, "HEAD");
    expect({ args: scope.args, reason: scope.reason }).toStrictEqual({
      args: [],
      reason: `Full validation (shared input: ${file}).`,
    });
  });

  it("requires resolvable history rather than silently skipping checks", () => {
    const cwd = validationFixture();
    expect(() => validationScope(cwd, "missing-base")).toThrow(
      "Command failed"
    );
    expect(validationScope(cwd)).toStrictEqual({
      args: [],
      reason: "Full validation (no comparison base).",
    });
  });
});
