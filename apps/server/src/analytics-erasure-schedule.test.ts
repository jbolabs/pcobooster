/**
 * The production cron's run over a real (local) D1 binding, with PostHog faked at its HTTP
 * boundary: deletion requests, erasure calls, and failure reports.
 */
import { createDatabase } from "@pcobooster/api/db/client";
import { analyticsErasureRequests, user } from "@pcobooster/api/db/schema";
import { deleteAccountData } from "@pcobooster/api/modules/account-deletion/delete-account-data";
import { Effect, Schema } from "effect";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createLocalD1 } from "../../../scripts/database/local-d1";
import { runScheduledErasures } from "./analytics-erasure-schedule";
import type { ErasureDatabase } from "./analytics-erasure-schedule";

const { runtime, binding } = await createLocalD1("analytics-erasure-cron");
const database = createDatabase(binding);
const decodeCapture = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      event: Schema.String,
      properties: Schema.Struct({
        error_code: Schema.String,
        path: Schema.String,
      }),
    })
  )
);
const deletedAt = new Date("2026-10-01T12:00:00.000Z");

/** PostHog's delete and capture endpoints, answering deletes with `deleteStatus`. */
const fakePostHog = (deleteStatus = 202) => {
  const calls: { url: string; body: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({ url: request.url, body: await request.text() });
    return new Response("{}", {
      status: request.url.includes("bulk_delete") ? deleteStatus : 200,
    });
  };
  const reported = () =>
    calls
      .filter(({ url }) => url === "https://us.i.posthog.com/i/v0/e/")
      .map(({ body }) => {
        const { event, properties } = decodeCapture(body);
        return { event, code: properties.error_code, path: properties.path };
      });
  return { fetch, calls, reported };
};

const deleteUser = async (id: string) => {
  await database
    .insert(user)
    .values({ id, name: id, email: `${id}@example.com`, emailVerified: false });
  await deleteAccountData(database, id, deletedAt);
};

const run = async (
  posthog: ReturnType<typeof fakePostHog>,
  now: string,
  options: { erasureApiKey?: string; database?: ErasureDatabase } = {}
) =>
  await Effect.runPromise(
    runScheduledErasures({
      database: options.database ?? binding,
      erasureApiKey: options.erasureApiKey ?? "phx_erasure",
      reportingKey: "phc_project",
      fetch: posthog.fetch,
      now: new Date(now),
    })
  );

describe(runScheduledErasures, () => {
  beforeEach(async () => {
    await database.delete(analyticsErasureRequests);
    await database.delete(user);
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("erases a due deletion through the D1 binding and reports nothing", async () => {
    await deleteUser("user-due");
    const posthog = fakePostHog();

    const result = await run(posthog, "2026-10-01T13:17:00.000Z");

    expect({ result, calls: posthog.calls }).toStrictEqual({
      result: {
        ran: { tried: 1, accepted: 1, finished: 0, failed: 0, skipped: 0 },
        status: {
          waiting: 1,
          due: 0,
          failing: 0,
          completed: 0,
          oldestOpenRequestedAt: deletedAt,
        },
        problems: [],
      },
      calls: [
        {
          url: "https://us.posthog.com/api/projects/614621/persons/bulk_delete/",
          body: '{"distinct_ids":["user-due"],"delete_events":true,"delete_recordings":true}',
        },
      ],
    });
  });

  it("reports a refused pass and an overdue request without the distinct id", async () => {
    await deleteUser("user-stuck");
    const posthog = fakePostHog(403);

    const result = await run(posthog, "2026-10-11T12:17:00.000Z");

    expect({
      problems: result.problems,
      reported: posthog.reported(),
      leaked: posthog
        .reported()
        .some((line) => JSON.stringify(line).includes("user-stuck")),
    }).toStrictEqual({
      problems: ["ANALYTICS_ERASURE_PASS_FAILED", "ANALYTICS_ERASURE_OVERDUE"],
      reported: [
        {
          event: "$exception",
          code: "ANALYTICS_ERASURE_PASS_FAILED",
          path: "cron:analytics-erasure",
        },
        {
          event: "$exception",
          code: "ANALYTICS_ERASURE_OVERDUE",
          path: "cron:analytics-erasure",
        },
      ],
      leaked: false,
    });
  });

  it("reports a missing erasure key instead of calling PostHog", async () => {
    await deleteUser("user-unkeyed");
    const posthog = fakePostHog();

    const result = await run(posthog, "2026-10-01T13:17:00.000Z", {
      erasureApiKey: "",
    });

    expect({ result, reported: posthog.reported() }).toStrictEqual({
      result: {
        ran: null,
        status: null,
        problems: ["ANALYTICS_ERASURE_NOT_CONFIGURED"],
      },
      reported: [
        {
          event: "$exception",
          code: "ANALYTICS_ERASURE_NOT_CONFIGURED",
          path: "cron:analytics-erasure",
        },
      ],
    });
  });

  it("reports a database failure as a failed run", async () => {
    const posthog = fakePostHog();
    const unavailable: ErasureDatabase = {
      prepare: () => ({
        bind: () => ({
          all: async () => {
            await Promise.resolve();
            throw new Error("D1_ERROR: database unavailable");
          },
        }),
      }),
    };

    const result = await run(posthog, "2026-10-01T13:17:00.000Z", {
      database: unavailable,
    });

    expect({
      problems: result.problems,
      reported: posthog.reported(),
    }).toStrictEqual({
      problems: ["ANALYTICS_ERASURE_RUN_FAILED"],
      reported: [
        {
          event: "$exception",
          code: "ANALYTICS_ERASURE_RUN_FAILED",
          path: "cron:analytics-erasure",
        },
      ],
    });
  });
});
