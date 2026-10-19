import type { R2Bucket, ScheduledController } from "@cloudflare/workers-types";
import { Schema } from "effect";

import { trialStage } from "../builds-trial/settings";
import {
  currentPullRequest,
  eligiblePullRequest,
  pullRequestSchema,
  repository,
} from "./github";
import {
  DispatchRejectedError,
  reconcileBuild,
  serializedBuild,
} from "./serialized";

interface Environment {
  RECORDS: R2Bucket;
  WEBHOOK_SECRET: string;
  CONTROL_TOKEN: string;
  CI_TOKEN: string;
  ACCOUNT_ID: string;
  PR_TRIGGER: string;
  MAINTENANCE_TRIGGER: string;
  RELEASE_TRIGGER: string;
  RELEASE_ENABLED: string;
  TRUSTED_BRANCH: string;
  BOOTSTRAP_BRANCH: string;
}
const eventSchema = Schema.Struct({
  action: Schema.optional(Schema.String),
  repository: Schema.Struct({ full_name: Schema.String }),
  pull_request: Schema.optional(pullRequestSchema),
  ref: Schema.optional(Schema.String),
  after: Schema.optional(Schema.String),
});
const buildResponse = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Struct({ build_uuid: Schema.String }),
});
const recordSchema = Schema.Struct({
  build: Schema.String,
  pullRequest: Schema.Number,
  sha: Schema.String,
  base: Schema.String,
  created: Schema.Number,
});

export const validSignature = async (
  body: string,
  signature: string,
  secret: string
): Promise<boolean> => {
  if (!/^sha256=[a-f0-9]{64}$/u.test(signature)) {
    return false;
  }
  const bytes = Uint8Array.from(
    signature.slice(7).match(/../gu) ?? [],
    (byte) => Number.parseInt(byte, 16)
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return await crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(body)
  );
};
const start = async (
  env: Environment,
  trigger: string,
  branch: string,
  sha?: string
) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/builds/triggers/${trigger}/builds`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CI_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ branch, commit_hash: sha }),
    }
  );
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new DispatchRejectedError(
        `Build dispatch rejected: ${response.status}`
      );
    }
    throw new Error(`Build dispatch outcome uncertain: ${response.status}`);
  }
  const result = Schema.decodeUnknownSync(buildResponse)(await response.json());
  if (!result.success) {
    throw new Error("Build dispatch rejected");
  }
  return result.result.build_uuid;
};
const dispatchMaintenance = async (env: Environment) => {
  if (env.MAINTENANCE_TRIGGER === "disabled") {
    return;
  }
  await serializedBuild(
    env.RECORDS,
    async (build) =>
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/builds/builds/${build}`,
        { headers: { Authorization: `Bearer ${env.CI_TOKEN}` } }
      ),
    async () => await start(env, env.MAINTENANCE_TRIGGER, env.TRUSTED_BRANCH),
    { trigger: env.MAINTENANCE_TRIGGER, branch: env.TRUSTED_BRANCH }
  );
};

const handleEvent = async (
  event: typeof eventSchema.Type,
  env: Environment,
  delivery: string
): Promise<Response> => {
  const pr = event.pull_request;
  if (
    pr !== undefined &&
    [
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
      "edited",
    ].includes(event.action ?? "")
  ) {
    if (env.BOOTSTRAP_BRANCH !== "" && pr.head.ref !== env.BOOTSTRAP_BRANCH) {
      return new Response("Bootstrap branch only");
    }
    const current = await currentPullRequest(pr.number);
    if (!eligiblePullRequest(current, pr.head.sha)) {
      return new Response("Ignored stale or fork PR");
    }
    const dedupe = `dispatch/${delivery}`;
    const claim = await env.RECORDS.put(dedupe, "pending", {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    if (claim === null) {
      return new Response("Already dispatched");
    }
    try {
      const build = await start(
        env,
        env.PR_TRIGGER,
        current.head.ref,
        current.head.sha
      );
      await env.RECORDS.put(
        `previews/${pr.number}/${build}`,
        JSON.stringify({
          build,
          pullRequest: pr.number,
          sha: current.head.sha,
          base: current.base.sha,
          created: Date.now(),
        })
      );
      return Response.json({ build });
    } catch (error) {
      if (error instanceof DispatchRejectedError) {
        await env.RECORDS.delete(dedupe);
      }
      throw error;
    }
  }
  if (pr !== undefined && event.action === "closed") {
    await dispatchMaintenance(env);
  }
  if (event.ref === "refs/heads/main" && env.RELEASE_ENABLED === "true") {
    // Release runner serializes state changes and refuses superseded revisions.
    await start(env, env.RELEASE_TRIGGER, "main", event.after);
  }
  return new Response("Accepted");
};

const previewResponse = async (
  number: number,
  env: Environment
): Promise<Response> => {
  const pr = await currentPullRequest(number);
  if (pr.state !== "open") {
    return new Response("Preview closed", { status: 404 });
  }
  const objects: { key: string }[] = [];
  let cursor: string | undefined;
  do {
    // R2 pagination is sequential; inspect every retained build for this PR.
    // oxlint-disable-next-line no-await-in-loop
    const page = await env.RECORDS.list({
      prefix: `previews/${number}/`,
      cursor,
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  const candidates = await Promise.all(
    objects.map(async (object) => {
      const record = await env.RECORDS.get(object.key);
      return record === null
        ? null
        : Schema.decodeUnknownSync(recordSchema)(await record.json());
    })
  );
  const [candidate] = candidates
    .filter((record) => record !== null)
    .filter(
      (record) => record.sha === pr.head.sha && record.base === pr.base.sha
    )
    .toSorted((a, b) => b.created - a.created);
  if (candidate === undefined) {
    return new Response("Preview pending", { status: 404 });
  }
  if ((await env.RECORDS.head(`cleaned/${candidate.build}`)) !== null) {
    return new Response("Preview expired", { status: 404 });
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/builds/builds/${candidate.build}`,
    { headers: { Authorization: `Bearer ${env.CI_TOKEN}` } }
  );
  if (!response.ok) {
    return new Response("Build unavailable", { status: 503 });
  }
  const result = Schema.decodeUnknownSync(
    Schema.Struct({
      success: Schema.Boolean,
      result: Schema.Struct({
        status: Schema.String,
        build_outcome: Schema.NullOr(Schema.String),
      }),
    })
  )(await response.json());
  if (
    !result.success ||
    result.result.status !== "stopped" ||
    result.result.build_outcome !== "success"
  ) {
    return new Response("Preview not verified", { status: 404 });
  }
  return Response.redirect(
    `https://pcobooster-${trialStage(candidate.build)}-web.jakebodea.workers.dev`,
    302
  );
};

const recordsResponse = async (
  request: Request,
  url: URL,
  env: Environment
): Promise<Response | undefined> => {
  if (
    url.pathname === "/dispatch" &&
    request.headers.get("Authorization") === `Bearer ${env.CONTROL_TOKEN}`
  ) {
    if (request.method === "GET") {
      const lane = await env.RECORDS.get("stateful-build");
      return new Response(lane === null ? "null" : await lane.text(), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (request.method === "POST") {
      const input = Schema.decodeUnknownSync(
        Schema.Struct({ attempt: Schema.String, build: Schema.String })
      )(await request.json());
      if (!/^[a-f0-9-]{36}$/u.test(input.build)) {
        return new Response("Invalid build", { status: 400 });
      }
      const adopted = await reconcileBuild(
        env.RECORDS,
        input.attempt,
        input.build,
        async (build) =>
          await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/builds/builds/${build}`,
            { headers: { Authorization: `Bearer ${env.CI_TOKEN}` } }
          )
      );
      return Response.json({ adopted }, { status: adopted ? 200 : 409 });
    }
  }
  if (
    /^\/cleaned\/[a-f0-9-]{36}$/u.test(url.pathname) &&
    request.headers.get("Authorization") === `Bearer ${env.CONTROL_TOKEN}`
  ) {
    const key = url.pathname.slice(1);
    if (request.method === "POST") {
      await env.RECORDS.put(key, "cleaned");
      return new Response(null, { status: 204 });
    }
    return new Response(null, {
      status: (await env.RECORDS.head(key)) === null ? 404 : 200,
    });
  }
  if (
    request.method === "DELETE" &&
    /^\/records\/previews\/[1-9]\d*\/[a-f0-9-]{36}$/u.test(url.pathname) &&
    request.headers.get("Authorization") === `Bearer ${env.CONTROL_TOKEN}`
  ) {
    await env.RECORDS.delete(url.pathname.slice("/records/".length));
    return new Response(null, { status: 204 });
  }
  if (
    url.pathname === "/records" &&
    request.headers.get("Authorization") === `Bearer ${env.CONTROL_TOKEN}`
  ) {
    const page = await env.RECORDS.list({
      prefix: "previews/",
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    const records = await Promise.all(
      page.objects.map(async (item) => {
        const value = await env.RECORDS.get(item.key);
        return value === null
          ? null
          : {
              key: item.key,
              ...Schema.decodeUnknownSync(recordSchema)(await value.json()),
            };
      })
    );
    return Response.json({
      records,
      cursor: page.truncated ? page.cursor : null,
    });
  }
  return undefined;
};

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const url = new URL(request.url);
    const preview = /^\/preview\/(?<number>[1-9]\d*)$/u.exec(url.pathname)
      ?.groups?.number;
    if (preview !== undefined && request.method === "GET") {
      return await previewResponse(Number(preview), env);
    }
    const recordResponse = await recordsResponse(request, url, env);
    if (recordResponse !== undefined) {
      return recordResponse;
    }
    if (url.pathname === "/webhook" && request.method === "POST") {
      const body = await request.text();
      if (
        !(await validSignature(
          body,
          request.headers.get("X-Hub-Signature-256") ?? "",
          env.WEBHOOK_SECRET
        ))
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (request.headers.get("X-GitHub-Event") === "ping") {
        return new Response("pong");
      }
      const event = Schema.decodeUnknownSync(
        Schema.fromJsonString(eventSchema)
      )(body);
      if (event.repository.full_name !== repository) {
        return new Response("Wrong repository", { status: 403 });
      }
      const delivery = request.headers.get("X-GitHub-Delivery") ?? "";
      if (!/^[a-f0-9-]{36}$/u.test(delivery)) {
        return new Response("Invalid delivery identity", { status: 400 });
      }
      return await handleEvent(event, env, delivery);
    }
    return new Response("Not found", { status: 404 });
  },
  async scheduled(
    _event: ScheduledController,
    env: Environment
  ): Promise<void> {
    await dispatchMaintenance(env);
  },
};
