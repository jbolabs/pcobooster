import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import { validationScope } from "./affected";

export const testLanes = ["application", "worker", "guards"] as const;
const laneSchema = Schema.Literals(testLanes);
type TestLane = typeof laneSchema.Type;

const planSchema = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({ taskId: Schema.String, command: Schema.String })
    ),
  })
);

export const laneFilters = (
  lane: TestLane,
  tasks: readonly { taskId: string; command: string }[]
): string[] =>
  tasks.flatMap(({ taskId, command }) => {
    if (
      command === "<NONEXISTENT>" ||
      (!taskId.endsWith("#test") && taskId !== "//#test:root")
    ) {
      return [];
    }
    const [packageName] = taskId.split("#");
    let taskLane: TestLane = "application";
    if (packageName === "//") {
      taskLane = "guards";
    } else if (packageName === "@pcobooster/server") {
      taskLane = "worker";
    }
    return taskLane === lane ? [`--filter=${packageName}`] : [];
  });

if (import.meta.main) {
  const lane = Schema.decodeUnknownSync(laneSchema)(process.argv[2]);
  const cwd = fileURLToPath(new URL("../../", import.meta.url));
  const scope = validationScope(cwd, process.env.BASE);
  process.stdout.write(`${scope.reason}\n`);
  const plan = Schema.decodeUnknownSync(planSchema)(
    execFileSync(
      "bun",
      [
        "x",
        "--no-install",
        "turbo",
        "run",
        "test",
        "//#test:root",
        ...scope.args,
        "--dry=json",
      ],
      { cwd, encoding: "utf-8", stdio: "pipe" }
    )
  );
  const filters = laneFilters(lane, plan.tasks);
  // An empty filter list means every package to Turbo, so end an unaffected lane explicitly.
  if (filters.length === 0) {
    process.stdout.write(`No affected tests in ${lane}.\n`);
  } else {
    const result = spawnSync("bun", ["run", "test", ...filters], {
      cwd,
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  }
}
