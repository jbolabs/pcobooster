/** Local operator entrypoint. Only preview email settings are read from Keychain. */
import { spawnSync } from "node:child_process";

import { readKeychain } from "../../secrets/keychain";
import { trialControlStage, trialStagePattern } from "./settings";

const [mode, stage] = process.argv.slice(2);
if (!["plan", "apply", "destroy-control", "destroy-app"].includes(mode ?? "")) {
  throw new Error(
    "Expected plan, apply, destroy-control, or destroy-app <stage>"
  );
}
if (mode === "destroy-app" && !trialStagePattern.test(stage ?? "")) {
  throw new Error("Invalid trial cleanup stage");
}
const preview = await readKeychain("preview");
const env = {
  ...process.env,
  PCOBOOSTER_ADMIN_EMAILS: preview.PCOBOOSTER_ADMIN_EMAILS,
};
for (const key of [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
]) {
  Reflect.deleteProperty(env, key);
}
const destroy = mode?.startsWith("destroy");
const result = spawnSync(
  "bun",
  [
    "alchemy",
    destroy ? "destroy" : "deploy",
    mode === "destroy-app"
      ? "alchemy.builds-trial-cleanup.ts"
      : "alchemy.builds-trial.ts",
    "--stage",
    mode === "destroy-app" ? (stage ?? "") : trialControlStage,
    "--profile",
    "admin",
    "--no-input",
    ...(mode === "plan" ? ["--dry-run"] : ["--yes"]),
  ],
  { env, stdio: "inherit" }
);
process.exitCode = result.status ?? 1;
