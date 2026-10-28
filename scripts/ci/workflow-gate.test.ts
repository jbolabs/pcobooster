import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf-8"
);
const aggregate = workflow
  .split("\n  ci:\n")[1]
  ?.split("\n  cloudflare-build:")[0];
const gateCommand = /run: (?<command>.+)/u.exec(aggregate ?? "")?.groups
  ?.command;

describe("required CI aggregate", () => {
  it.each([
    ["success", "success", 0],
    ["failure", "success", 1],
    ["success", "failure", 1],
    ["cancelled", "success", 1],
    ["success", "cancelled", 1],
    ["skipped", "success", 1],
    ["success", "skipped", 1],
    ["", "success", 1],
  ] as const)("quality=%s tests=%s exits %s", (quality, tests, expected) => {
    if (gateCommand === undefined) {
      throw new Error("Missing required CI aggregate command");
    }
    const result = spawnSync("sh", ["-c", gateCommand], {
      env: { ...process.env, QUALITY: quality, TESTS: tests },
    });
    expect(result.status).toBe(expected);
    expect(aggregate).toContain("needs: [quality, tests]");
  });
});
