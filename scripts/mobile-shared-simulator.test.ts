import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const simulatorTests = path.resolve(
  import.meta.dirname,
  "../apps/mobile/scripts/simulator"
);

describe("shared simulator smoke tooling", () => {
  it("selects only idle shared simulators and cleans up only devices this run booted", () => {
    const result = spawnSync(
      "python3",
      [
        "-m",
        "unittest",
        "discover",
        "-s",
        simulatorTests,
        "-p",
        "test_*.py",
        "-v",
      ],
      {
        encoding: "utf-8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        timeout: 10_000,
      }
    );
    const details = [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n");

    expect({ status: result.status, details }).toMatchObject({ status: 0 });
    expect(result.stderr).toContain("Ran 8 tests");
    expect(result.stderr).toContain("OK");
  });
});
