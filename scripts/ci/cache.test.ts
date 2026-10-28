import { describe, expect, it } from "vitest";

import {
  runTurbo,
  turboPlan,
  validationFixture,
  writeFixture,
} from "./fixtures";

describe("validation task cache", () => {
  it("reuses a guard result only while the inspected app source is unchanged", () => {
    const cwd = validationFixture();
    expect(runTurbo(cwd, ["//#test:root"])).toContain(
      "export const input = 1;"
    );
    expect(runTurbo(cwd, ["//#test:root"])).toContain("cache hit");
    const forced = runTurbo(cwd, ["//#test:root"], true);
    expect({
      bypassed: forced.includes("cache bypass"),
      checkedSource: forced.includes("export const input = 1;"),
    }).toStrictEqual({ bypassed: true, checkedSource: true });
    writeFixture(cwd, "apps/web/src/input.ts", "export const input = 2;\n");
    const output = runTurbo(cwd, ["//#test:root"]);
    expect(output).toContain("cache miss");
    expect(output).toContain("export const input = 2;");
  });

  it.each([
    "packages/design-tokens/src/tokens.css",
    "packages/client/src/input.ts",
    "packages/contracts/src/input.ts",
  ])("invalidates mobile tests when dependency %s changes", (file) => {
    const cwd = validationFixture();
    const before = turboPlan(cwd, ["test", "--filter=@pcobooster/mobile"]);
    writeFixture(cwd, file, "changed\n");
    const after = turboPlan(cwd, ["test", "--filter=@pcobooster/mobile"]);
    const beforeMobile = before.find(
      (task) => task.taskId === "@pcobooster/mobile#test"
    );
    const afterMobile = after.find(
      (task) => task.taskId === "@pcobooster/mobile#test"
    );
    expect({
      task: afterMobile?.taskId,
      reused: afterMobile?.hash === beforeMobile?.hash,
    }).toStrictEqual({
      task: "@pcobooster/mobile#test",
      reused: false,
    });
  });

  it.each([
    "scripts/testing/miniflare.ts",
    "scripts/database/local-d1.ts",
    "scripts/secrets/manifest.ts",
    "scripts/cloudflare/verify-deployment.ts",
    "packages/config/tsconfig.base.json",
  ])("invalidates package typechecks when shared input %s changes", (file) => {
    const cwd = validationFixture();
    const before = turboPlan(cwd, ["typecheck", "--filter=@pcobooster/web"]);
    writeFixture(cwd, file, "changed\n");
    const after = turboPlan(cwd, ["typecheck", "--filter=@pcobooster/web"]);
    expect(
      after.map((task, index) => ({
        task: task.taskId,
        reused: task.hash === before[index]?.hash,
      }))
    ).toStrictEqual([
      { task: "@pcobooster/client#typecheck", reused: false },
      { task: "@pcobooster/contracts#typecheck", reused: false },
      { task: "@pcobooster/web#typecheck", reused: false },
    ]);
  });

  it.each([
    "apps/mobile/scripts/release-ios.sh",
    ".github/workflows/ios-release.yml",
    "lint/oxlint-plugin-local.mjs",
    "packages/api/migrations/0001_example.sql",
    "alchemy.secrets.ts",
  ])("hashes %s for both root gates", (file) => {
    const cwd = validationFixture();
    const before = turboPlan(cwd, ["//#test:root", "//#typecheck:root"]);
    writeFixture(cwd, file, "changed\n");
    const after = turboPlan(cwd, ["//#test:root", "//#typecheck:root"]);
    expect(
      after.map((task, index) => ({
        task: task.taskId,
        hashed: Object.hasOwn(task.inputs, file),
        reused: task.hash === before[index]?.hash,
      }))
    ).toStrictEqual([
      { task: "//#test:root", hashed: true, reused: false },
      { task: "//#typecheck:root", hashed: true, reused: false },
    ]);
  });

  it.each([
    "scripts/testing/miniflare.ts",
    "scripts/database/local-d1.ts",
    "vitest.config.ts",
  ])("invalidates package tests when shared fixture %s changes", (file) => {
    const cwd = validationFixture();
    const before = turboPlan(cwd, ["test", "--filter=@pcobooster/web"]);
    writeFixture(cwd, file, "changed\n");
    const after = turboPlan(cwd, ["test", "--filter=@pcobooster/web"]);
    expect(
      after.map((task, index) => ({
        task: task.taskId,
        reused: task.hash === before[index]?.hash,
      }))
    ).toStrictEqual([
      { task: "@pcobooster/client#test:inputs", reused: false },
      { task: "@pcobooster/contracts#test:inputs", reused: false },
      { task: "@pcobooster/web#test", reused: false },
    ]);
  });
});
