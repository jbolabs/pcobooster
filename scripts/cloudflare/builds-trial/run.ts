import { spawnSync } from "node:child_process";

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
  LEFTHOOK: "0",
};
const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: "inherit", env });
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
  run("bun", ["run", "check"]);
  run("bun", ["run", "typecheck", "--concurrency=1"]);
  run("bun", ["run", "test:install"]);
  run("bun", ["turbo", "run", "test", "//#test:root", "--concurrency=1"]);
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
