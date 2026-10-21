import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { Schema } from "effect";

import { buildContext } from "./context";
import { reviewDependencies } from "./dependency-review";
import {
  currentPullRequest,
  eligiblePullRequest,
  pullRequestForCommit,
  runnerGitHubAccess,
} from "./github";
import { run, validate } from "./validate";

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf-8" }).trim();
const { sha, stage } = buildContext(process.env, git("rev-parse", "HEAD"));
const github = runnerGitHubAccess(process.env);
const pr = await pullRequestForCommit(sha, github);
const currentRevision = async (): Promise<boolean> => {
  const current = await currentPullRequest(pr.number, github);
  return eligiblePullRequest(current, sha) && current.base.sha === pr.base.sha;
};
const [mode] = process.argv.slice(2);
if (mode === "check") {
  git(
    "fetch",
    ...(git("rev-parse", "--is-shallow-repository") === "true"
      ? ["--unshallow"]
      : []),
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
    pr.base.sha
  );
  // Test the integration with the exact PR base; conflict failures block deployment.
  git(
    "-c",
    "user.name=Cloudflare CI",
    "-c",
    "user.email=ci@pcobooster.com",
    "merge",
    "--no-commit",
    "--no-ff",
    pr.base.sha
  );
  run(["install", "--frozen-lockfile"], { ...process.env, LEFTHOOK: "0" });
  reviewDependencies(pr.base.sha);
  validate(pr.base.sha, true);
  writeFileSync(
    ".pr-validation.json",
    JSON.stringify({ sha, base: pr.base.sha, pullRequest: pr.number })
  );
} else if (mode === "deploy") {
  const proof = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        sha: Schema.String,
        base: Schema.String,
        pullRequest: Schema.Number,
      })
    )
  )(readFileSync(".pr-validation.json", "utf-8"));
  if (
    proof.sha !== sha ||
    proof.base !== pr.base.sha ||
    proof.pullRequest !== pr.number
  ) {
    throw new Error("PR base or head changed after validation");
  }
  if (!(await currentRevision())) {
    throw new Error("Pull request closed or superseded before deploy");
  }
  const env = {
    ...process.env,
    GITHUB_SHA: sha,
    TURBO_FORCE: "true",
    TURBO_CACHE: "local:rw",
    LEFTHOOK: "0",
  };
  run(["alchemy", "deploy", "--stage", stage, "--no-input", "--yes"], env);
  const url = `https://pcobooster-${stage}-web.jakebodea.workers.dev`;
  run(["scripts/cloudflare/verify-deployment.ts", url, sha], env);
  if (!(await currentRevision())) {
    run(
      [
        "alchemy",
        "destroy",
        "alchemy.builds-trial-cleanup.ts",
        "--stage",
        stage,
        "--no-input",
        "--yes",
      ],
      env
    );
    throw new Error(
      "Pull request superseded during deploy; isolated preview removed"
    );
  }
  process.stdout.write(
    `${JSON.stringify({ result: "verified", pullRequest: pr.number, sha, stage, url })}\\n`
  );
} else {
  throw new Error("Expected check or deploy");
}
