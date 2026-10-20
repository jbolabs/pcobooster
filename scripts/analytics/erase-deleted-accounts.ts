/**
 * Erases deleted accounts from PostHog: runs the `analytics_erasure_requests` queue that account
 * deletion fills (`packages/api/src/modules/account-deletion/analytics-erasure.ts`) against a
 * deployed D1 database, over the D1 HTTP API.
 *
 *   bun run analytics:erase -- --database-id <D1 UUID>            # counts only
 *   bun run analytics:erase -- --database-id <D1 UUID> --process  # erase what is due
 *
 * Safe to repeat and to run on a schedule: each request is advanced at most once per pass and
 * PostHog treats a repeated deletion as done. Prints counts, never distinct ids or tokens.
 * Credentials come from the `analytics-erasure` Keychain scope (see docs/analytics.md).
 */
import { parseArgs } from "node:util";

import { project } from "@pcobooster/analytics/reports";
import {
  erasureStatus,
  postHogEraser,
  processDueErasures,
} from "@pcobooster/api/modules/account-deletion/analytics-erasure";
import type { ErasureSql } from "@pcobooster/api/modules/account-deletion/analytics-erasure";
import { Option, Schema } from "effect";

const CLOUDFLARE_ACCOUNT_ID = "984b82870acd18daf8bda97bad966b38";
const DEFAULT_POSTHOG_HOST = "https://us.posthog.com";

const d1Response = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Array(
    Schema.Struct({
      success: Schema.Boolean,
      results: Schema.Array(Schema.Unknown),
    })
  ),
});
const decodeD1Response = Schema.decodeUnknownOption(d1Response);

export interface D1HttpOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly accountId: string;
  readonly databaseId: string;
  readonly token: string;
}

/** One statement per call through D1's `query` endpoint. Errors never echo the response body. */
export const d1HttpSql = ({
  fetch,
  accountId,
  databaseId,
  token,
}: D1HttpOptions): ErasureSql => {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  return async (sql, params) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`D1 request failed with HTTP ${response.status}`);
    }
    const decoded = Option.getOrUndefined(
      decodeD1Response(await response.json())
    );
    if (
      decoded === undefined ||
      !decoded.success ||
      decoded.result.some((item) => !item.success)
    ) {
      throw new Error("D1 returned an unsuccessful query result");
    }
    return decoded.result.flatMap((item) => item.results);
  };
};

const required = (name: string): string =>
  Schema.decodeUnknownSync(Schema.NonEmptyString)(process.env[name], {
    errors: "first",
  });

const main = async () => {
  const { values } = parseArgs({
    options: {
      "database-id": { type: "string" },
      process: { type: "boolean", default: false },
      limit: { type: "string", default: "50" },
    },
    strict: true,
  });
  const databaseId = Schema.decodeUnknownSync(
    Schema.String.check(Schema.isUUID())
  )(values["database-id"]);
  const limit = Schema.decodeUnknownSync(Schema.NumberFromString)(values.limit);
  const run = d1HttpSql({
    fetch: globalThis.fetch,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? CLOUDFLARE_ACCOUNT_ID,
    databaseId,
    token: required("CLOUDFLARE_D1_API_TOKEN"),
  });
  const now = new Date();
  const ran = values.process
    ? await processDueErasures(
        run,
        postHogEraser({
          fetch: globalThis.fetch,
          host: process.env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
          projectId: project.id,
          apiKey: required("POSTHOG_ERASURE_API_KEY"),
        }),
        now,
        limit
      )
    : null;
  const status = await erasureStatus(run, new Date());
  process.stdout.write(`${JSON.stringify({ ran, status }, null, 2)}\n`);
  // A failing pass is rescheduled, but a scheduled runner should still notice it.
  if (ran !== null && ran.failed > 0) {
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  await main();
}
