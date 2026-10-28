import { describe, expect, it } from "vitest";

import { validationScope } from "./affected";
import { turboPlan, validationFixture, writeFixture } from "./fixtures";
import { laneFilters, testLanes } from "./test-lane";

describe("parallel test lanes", () => {
  it("assigns every executable test to exactly one lane", () => {
    const tasks = [
      { taskId: "//#test:root", command: "vitest guards" },
      { taskId: "@pcobooster/server#test", command: "vitest worker" },
      { taskId: "@pcobooster/api#test", command: "vitest api" },
      { taskId: "@pcobooster/web#test", command: "vitest web" },
      { taskId: "@pcobooster/ui#test", command: "<NONEXISTENT>" },
      { taskId: "@pcobooster/api#test:inputs", command: "<NONEXISTENT>" },
    ];
    expect(testLanes.map((lane) => laneFilters(lane, tasks))).toStrictEqual([
      ["--filter=@pcobooster/api", "--filter=@pcobooster/web"],
      ["--filter=@pcobooster/server"],
      ["--filter=//"],
    ]);
  });

  it("keeps the affected selection when partitioning real Turbo plans", () => {
    const cwd = validationFixture();
    writeFixture(cwd, "apps/admin/src/input.ts", "export const input = 2;\n");
    const tasks = turboPlan(cwd, [
      "test",
      "//#test:root",
      ...validationScope(cwd, "HEAD").args,
    ]);
    expect(testLanes.map((lane) => laneFilters(lane, tasks))).toStrictEqual([
      ["--filter=@pcobooster/admin"],
      [],
      ["--filter=//"],
    ]);
  });

  it("hashes transitive inputs without depending on their test executions", () => {
    const cwd = validationFixture();
    const task = turboPlan(cwd, ["test", "--filter=@pcobooster/web"]).find(
      (candidate) => candidate.taskId === "@pcobooster/web#test"
    );
    expect(task?.dependencies).toStrictEqual([
      "@pcobooster/client#test:inputs",
    ]);
  });
});
