import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { validationScope } from "../../ci/affected";
import { trialContext } from "./settings";

const checkout = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" });
if (checkout.status !== 0) {
  throw new Error("Cannot resolve checkout revision");
}
const { sha, stage } = trialContext(process.env, checkout.stdout.trim());
const [mode] = process.argv.slice(2);
if (mode !== "check" && mode !== "deploy") {
  throw new Error("Expected check or deploy");
}
const env = {
  ...process.env,
  GITHUB_SHA: sha,
  TURBO_FORCE: "true",
  TURBO_CACHE: "local:rw",
  LEFTHOOK: "0",
};
const run = (command: string, args: string[], childEnv = env) => {
  const result = spawnSync(command, args, { stdio: "inherit", env: childEnv });
  if (result.status !== 0) {
    throw new Error(`Trial step failed: ${args.join(" ")}`);
  }
};
if (mode === "check") {
  const shallow = spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
    encoding: "utf-8",
  });
  if (shallow.status !== 0) {
    throw new Error("Cannot inspect checkout history");
  }
  run("git", [
    "fetch",
    ...(shallow.stdout.trim() === "true" ? ["--unshallow"] : []),
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ]);
  const scope = validationScope(process.cwd(), "origin/main");
  process.stdout.write(`${scope.reason}\n`);
  const base = spawnSync("git", ["rev-parse", "origin/main"], {
    encoding: "utf-8",
  });
  if (base.status !== 0) {
    throw new Error("Cannot resolve validation base");
  }
  writeFileSync(".trial-validation-base", base.stdout.trim());
  const cacheInputs = "--global-deps=.trial-validation-base";
  const validationEnv = {
    ...env,
    TURBO_FORCE: "false",
    TURBO_CACHE: "remote:rw",
  };
  for (const key of Object.keys(validationEnv)) {
    if (
      key.startsWith("CLOUDFLARE_") ||
      key.startsWith("PCOBOOSTER_ADMIN_") ||
      key.startsWith("STAGING_ACCESS_")
    ) {
      Reflect.deleteProperty(validationEnv, key);
    }
  }
  run("bun", ["turbo", "run", "//#lint:ci", cacheInputs], validationEnv);
  run(
    "bun",
    ["run", "typecheck", "--concurrency=1", cacheInputs, ...scope.args],
    validationEnv
  );
  run("bun", ["run", "test:install"], validationEnv);
  run(
    "bun",
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
  run("bun", ["run", "build:cloudflare"]);
} else {
  run("bun", ["alchemy", "deploy", "--stage", stage, "--no-input", "--yes"]);
  run("bun", [
    "scripts/cloudflare/verify-deployment.ts",
    `https://pcobooster-${stage}-web.jakebodea.workers.dev`,
    sha,
  ]);
  process.stdout.write(
    `${JSON.stringify({ result: "verified", stage, sha })}\n`
  );
}
