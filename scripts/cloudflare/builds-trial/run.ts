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
const run = (args: string[]) => {
  const result = spawnSync("bun", args, { stdio: "inherit", env });
  if (result.status !== 0) {
    throw new Error(`Trial step failed: ${args.join(" ")}`);
  }
};
if (mode === "check") {
  run(["run", "ci"]);
  run(["run", "build:cloudflare"]);
} else {
  run(["alchemy", "deploy", "--stage", stage, "--no-input", "--yes"]);
  run([
    "scripts/cloudflare/verify-deployment.ts",
    `https://pcobooster-${stage}-web.jakebodea.workers.dev`,
    sha,
  ]);
  process.stdout.write(
    `${JSON.stringify({ result: "verified", stage, sha })}\n`
  );
}
