import { Schema } from "effect";

import { trialStage } from "../builds-trial/settings";
import { pullRequestSchema, readGitHub, runnerGitHubAccess } from "./github";
import { run } from "./validate";

const required = (key: string): string => {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing ${key}`);
  }
  return value;
};
if (
  required("WORKERS_CI") !== "1" ||
  required("WORKERS_CI_BRANCH") !== required("BUILDS_TRUSTED_BRANCH")
) {
  throw new Error("Maintenance only executes the trusted control branch");
}
const buildSchema = Schema.Struct({
  build_uuid: Schema.String,
  status: Schema.String,
  build_outcome: Schema.NullOr(Schema.String),
  created_on: Schema.String,
  build_trigger_metadata: Schema.Struct({ commit_hash: Schema.String }),
});
const pageSchema = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Array(buildSchema),
  result_info: Schema.Struct({ total_pages: Schema.Number }),
});
const origin = required("BUILDS_CONTROL_URL");
const headers = { Authorization: `Bearer ${required("BUILDS_CONTROL_TOKEN")}` };
const clean = async (build: typeof buildSchema.Type): Promise<void> => {
  if (build.status !== "stopped") {
    return;
  }
  const marker = `${origin}/cleaned/${build.build_uuid}`;
  const previous = await fetch(marker, { headers });
  if (previous.ok) {
    return;
  }
  if (previous.status !== 404) {
    throw new Error("Cleanup marker unavailable");
  }
  const prs = await readGitHub(
    `commits/${build.build_trigger_metadata.commit_hash}/pulls`,
    Schema.Array(pullRequestSchema),
    runnerGitHubAccess(process.env)
  );
  const current = prs.some(
    (pr) =>
      pr.state === "open" &&
      pr.head.sha === build.build_trigger_metadata.commit_hash
  );
  if (
    build.build_outcome === "success" &&
    current &&
    Date.now() - Date.parse(build.created_on) < 259_200_000
  ) {
    return;
  }
  run([
    "alchemy",
    "destroy",
    "alchemy.builds-trial-cleanup.ts",
    "--stage",
    trialStage(build.build_uuid),
    "--no-input",
    "--yes",
  ]);
  const saved = await fetch(marker, { method: "POST", headers });
  if (!saved.ok) {
    throw new Error("Cannot record successful cleanup");
  }
};
// Enumerate Cloudflare's authoritative Builds history, including dispatches whose R2 ledger write failed.
for (let pageNumber = 1; ; pageNumber += 1) {
  // oxlint-disable-next-line no-await-in-loop -- Traverse provider pagination in order.
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${required("CLOUDFLARE_ACCOUNT_ID")}/builds/workers/${required("BUILDS_PR_WORKER_TAG")}/builds?page=${pageNumber}&per_page=100`,
    { headers: { Authorization: `Bearer ${required("BUILDS_CI_TOKEN")}` } }
  );
  if (!response.ok) {
    throw new Error(`Build listing failed: ${response.status}`);
  }
  // oxlint-disable-next-line no-await-in-loop -- Decode this page before requesting the next.
  const page = Schema.decodeUnknownSync(pageSchema)(await response.json());
  if (!page.success) {
    throw new Error("Build listing rejected");
  }
  for (const build of page.result) {
    // oxlint-disable-next-line no-await-in-loop -- Alchemy cleanup operations must be serialized.
    await clean(build);
  }
  if (pageNumber >= page.result_info.total_pages) {
    break;
  }
}
