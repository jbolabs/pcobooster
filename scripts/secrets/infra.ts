import { spawn } from "node:child_process";
import { once } from "node:events";

import { readKeychain } from "./keychain";
import { processExit } from "./manifest";

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  throw new Error("Usage: secrets:infra <command> [arguments]");
}
const [preview, production, builds] = await Promise.all([
  readKeychain("preview"),
  readKeychain("production"),
  readKeychain("builds-control"),
]);
const github = spawn("gh", ["auth", "token"], {
  stdio: ["ignore", "pipe", "pipe"],
});
const chunks: Buffer[] = [];
github.stdout.on("data", (chunk: Buffer) => {
  chunks.push(chunk);
});
github.stderr.resume();
const [githubCode] = processExit(await once(github, "close"));
if (githubCode !== 0) {
  throw new Error("GitHub credentials unavailable; run gh auth login");
}
const environment = { ...process.env };
for (const key of [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "INFISICAL_API_TOKEN",
]) {
  Reflect.deleteProperty(environment, key);
}
const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...environment,
    BUILDS_GITHUB_APP_PRIVATE_KEY: builds.BUILDS_GITHUB_APP_PRIVATE_KEY,
    GITHUB_TOKEN: Buffer.concat(chunks).toString().trim(),
    CI_PREVIEW_ADMIN_EMAILS: preview.PCOBOOSTER_ADMIN_EMAILS,
    CI_PRODUCTION_ADMIN_EMAILS: production.PCOBOOSTER_ADMIN_EMAILS,
    POSTHOG_ANNOTATION_API_KEY: production.POSTHOG_ANNOTATION_API_KEY,
  },
});
const stop = (signal: NodeJS.Signals): void => {
  child.kill(signal);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const [code] = processExit(await once(child, "exit"));
process.exitCode = code ?? 1;
