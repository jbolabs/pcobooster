/**
 * Destroy pull request stages whose pull request is no longer open, and stages of open pull
 * requests that have gone 3 days without a deploy (the next push redeploys them). The close-time
 * cleanup job is the normal path; this sweep catches cancelled runs, failed teardowns, and idle
 * previews.
 *
 *   bun scripts/cloudflare/sweep-previews.ts [--dry-run]
 *
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GITHUB_TOKEN, GITHUB_REPOSITORY.
 */
import { spawnSync } from "node:child_process";

import { isoDateTimeWithOffset } from "@pcobooster/contracts/http/schema";
import { Schema } from "effect";

import { currentPullRequest, runnerGitHubAccess } from "./builds/github";
import type { CloudflareResource } from "./stages";
import { previewStages, sweepDecision } from "./stages";

const cloudflareApi = "https://api.cloudflare.com/client/v4";
const d1PageSize = 100;
const dryRun = process.argv.includes("--dry-run");

const required = (name: string): string => {
  const value = process.env[name] ?? "";
  if (value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
};

const cloudflareToken = required("CLOUDFLARE_API_TOKEN");
const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const githubToken = process.env.GITHUB_TOKEN;
const repository = required("GITHUB_REPOSITORY");

const decodeCloudflareResponse = Schema.decodeUnknownSync(
  Schema.Struct({
    success: Schema.Boolean,
    errors: Schema.Array(Schema.Unknown),
    result: Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        name: Schema.optional(Schema.String),
        modified_on: Schema.optional(isoDateTimeWithOffset),
        created_at: Schema.optional(isoDateTimeWithOffset),
      })
    ),
    result_info: Schema.optional(
      Schema.Struct({ total_pages: Schema.optional(Schema.Finite) })
    ),
  })
);

const cloudflareList = async (path: string) => {
  const response = await fetch(`${cloudflareApi}${path}`, {
    headers: { authorization: `Bearer ${cloudflareToken}` },
  });
  const body = decodeCloudflareResponse(await response.json());
  if (!body.success) {
    throw new Error(`GET ${path} failed: ${JSON.stringify(body.errors)}`);
  }
  return body;
};

const workers = async (): Promise<CloudflareResource[]> => {
  const body = await cloudflareList(`/accounts/${accountId}/workers/scripts`);
  return body.result.flatMap((script) =>
    script.id === undefined || script.modified_on === undefined
      ? []
      : [{ name: script.id, changedAt: new Date(script.modified_on) }]
  );
};

const databases = async (): Promise<CloudflareResource[]> => {
  const found: CloudflareResource[] = [];
  for (let page = 1; ; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Cloudflare pages must be read in order.
    const body = await cloudflareList(
      `/accounts/${accountId}/d1/database?name=pcobooster-pr-&per_page=${d1PageSize}&page=${page}`
    );
    found.push(
      ...body.result.flatMap((database) =>
        database.name === undefined || database.created_at === undefined
          ? []
          : [{ name: database.name, changedAt: new Date(database.created_at) }]
      )
    );
    if (page >= (body.result_info?.total_pages ?? 1)) {
      return found;
    }
  }
};

const decodePullRequestState = Schema.decodeUnknownSync(
  Schema.Struct({ state: Schema.Literals(["open", "closed"]) })
);

const isOpen = async (pullRequest: number): Promise<boolean> => {
  if (process.env.BUILDS_REPOSITORY_READ_TOKEN !== undefined) {
    if (repository !== "jbolabs/pcobooster") {
      throw new Error("Unexpected repository");
    }
    const pr = await currentPullRequest(
      pullRequest,
      runnerGitHubAccess(process.env)
    );
    return pr.state === "open";
  }
  const headers = new Headers({
    accept: "application/vnd.github+json",
    "User-Agent": "pcobooster-builds-cleanup",
  });
  if (githubToken !== undefined) {
    headers.set("Authorization", `Bearer ${githubToken}`);
  }
  const response = await fetch(
    `https://api.github.com/repos/${repository}/pulls/${pullRequest}`,
    { headers }
  );
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(
      `Reading pull request #${pullRequest} failed: ${response.status}`
    );
  }
  return decodePullRequestState(await response.json()).state === "open";
};

const destroy = (pullRequest: number): boolean => {
  const result = spawnSync(
    "bun",
    [
      "run",
      "alchemy",
      "destroy",
      "alchemy.cleanup.ts",
      "--stage",
      `pr-${pullRequest}`,
      "--no-input",
      "--yes",
    ],
    { stdio: "inherit" }
  );
  return result.status === 0;
};

const resources = await Promise.all([workers(), databases()]);
const now = new Date();
const failed: number[] = [];
for (const stage of previewStages(resources.flat())) {
  const { pullRequest } = stage;
  // oxlint-disable-next-line no-await-in-loop -- Stages are checked and destroyed one at a time.
  const decision = sweepDecision(stage, await isOpen(pullRequest), now);
  process.stdout.write(
    `pr-${pullRequest} (last deployed ${stage.lastDeployedAt.toISOString()}): ${decision}\n`
  );
  if (decision !== "keep" && !dryRun && !destroy(pullRequest)) {
    failed.push(pullRequest);
  }
}
if (failed.length > 0) {
  throw new Error(
    `Failed to destroy: ${failed.map((n) => `pr-${n}`).join(", ")}`
  );
}
