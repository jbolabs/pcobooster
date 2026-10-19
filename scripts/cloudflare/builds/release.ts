/** Trusted-main release: full gates, staging verification, then production. */
import { execFileSync } from "node:child_process";

import { Schema } from "effect";

import { readGitHub, runnerGitHubAccess } from "./github";
import { validateRelease } from "./release-validation";
import { run } from "./validate";

const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf-8",
}).trim();
if (
  process.env.WORKERS_CI !== "1" ||
  process.env.WORKERS_CI_BRANCH !== "main" ||
  process.env.WORKERS_CI_COMMIT_SHA !== sha
) {
  throw new Error("Release requires the exact trusted main revision");
}
const current = async () => {
  const ref = await readGitHub(
    "commits/main",
    Schema.Struct({ sha: Schema.String }),
    runnerGitHubAccess(process.env)
  );
  return ref.sha === sha;
};
const settings = (stage: "staging" | "prod"): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_SHA: sha,
    TURBO_FORCE: "true",
    TURBO_CACHE: "local:rw",
    LEFTHOOK: "0",
  };
  env.PCOBOOSTER_ADMIN_EMAILS =
    stage === "prod"
      ? process.env.BUILDS_PRODUCTION_ADMIN_EMAILS
      : process.env.BUILDS_PREVIEW_ADMIN_EMAILS;
  if (stage === "prod") {
    env.CLOUDFLARE_CUSTOM_DOMAINS = "1";
  } else {
    delete env.CLOUDFLARE_CUSTOM_DOMAINS;
  }
  return env;
};
if (await current()) {
  validateRelease();
  if (await current()) {
    const staging = settings("staging");
    run(
      ["alchemy", "deploy", "--stage", "staging", "--no-input", "--yes"],
      staging
    );
    run(
      [
        "scripts/cloudflare/verify-deployment.ts",
        "https://pcobooster-staging-web.jakebodea.workers.dev",
        sha,
      ],
      staging
    );
    if (await current()) {
      const prod = settings("prod");
      run(
        ["alchemy", "deploy", "--stage", "prod", "--no-input", "--yes"],
        prod
      );
      run(
        [
          "scripts/cloudflare/verify-deployment.ts",
          "https://pcobooster-prod-web.jakebodea.workers.dev",
          sha,
        ],
        prod
      );
      run(
        [
          "scripts/cloudflare/verify-custom-domains.ts",
          "pcobooster-prod-web",
          "pcobooster.com",
          "www.pcobooster.com",
        ],
        prod
      );
      run(["scripts/posthog/annotate-deploy.ts", sha], prod);
    }
  }
}
