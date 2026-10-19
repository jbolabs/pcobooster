import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { validationScope } from "../../ci/affected";

export const run = (
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): void => {
  const result = spawnSync("bun", args, { stdio: "inherit", env });
  if (result.status !== 0) {
    throw new Error(`Build step failed: ${args.join(" ")}`);
  }
};
export const validate = (baseRef: string, cache: boolean): void => {
  const env = {
    ...process.env,
    TURBO_FORCE: "true",
    TURBO_CACHE: "local:rw",
    LEFTHOOK: "0",
  };
  const scope = validationScope(process.cwd(), baseRef);
  process.stdout.write(`${scope.reason}\n`);
  const base = spawnSync("git", ["rev-parse", baseRef], { encoding: "utf-8" });
  if (base.status !== 0) {
    throw new Error("Cannot resolve validation base");
  }
  writeFileSync(".trial-validation-base", base.stdout.trim());
  const cacheInputs = "--global-deps=.trial-validation-base";
  const validationEnv = {
    ...env,
    TURBO_FORCE: cache ? "false" : "true",
    TURBO_CACHE: cache ? "remote:rw" : "local:rw",
  };
  for (const key of Object.keys(validationEnv)) {
    if (
      key.startsWith("CLOUDFLARE_") ||
      key.startsWith("PCOBOOSTER_ADMIN_") ||
      key.startsWith("STAGING_ACCESS_") ||
      key.startsWith("GITHUB_TOKEN") ||
      key.startsWith("BUILDS_") ||
      key.startsWith("POSTHOG_ANNOTATION")
    ) {
      Reflect.deleteProperty(validationEnv, key);
    }
  }
  run(["turbo", "run", "//#lint:ci", cacheInputs], validationEnv);
  run(
    ["run", "typecheck", "--concurrency=1", cacheInputs, ...scope.args],
    validationEnv
  );
  run(["run", "test:install"], validationEnv);
  run(
    [
      "turbo",
      "run",
      "test",
      "//#test:root",
      "--concurrency=1",
      cacheInputs,
      ...scope.args,
    ],
    validationEnv
  );
  run(["run", "build:cloudflare"], {
    ...validationEnv,
    TURBO_FORCE: "true",
    TURBO_CACHE: "local:rw",
  });
};
