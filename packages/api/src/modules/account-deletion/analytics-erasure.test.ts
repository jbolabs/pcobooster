import { createDatabase } from "@pcobooster/api/db/client";
import { analyticsErasureRequests, user } from "@pcobooster/api/db/schema";
import {
  erasureStatus,
  postHogEraser,
  processDueErasures,
} from "@pcobooster/api/modules/account-deletion/analytics-erasure";
import type {
  AnalyticsEraser,
  ErasureOutcome,
  ErasureSql,
} from "@pcobooster/api/modules/account-deletion/analytics-erasure";
import { deleteAccountData } from "@pcobooster/api/modules/account-deletion/delete-account-data";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createLocalD1 } from "../../../../../scripts/database/local-d1";

const { runtime, binding } = await createLocalD1("analytics-erasure");
const database = createDatabase(binding);
const run: ErasureSql = async (query, params) => {
  const { results } = await binding
    .prepare(query)
    .bind(...params)
    .all();
  return results;
};

const deletedAt = new Date("2026-10-19T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

/** PostHog, answering each call with the next scripted outcome (accepting once they run out). */
const scriptedPostHog = (outcomes: ErasureOutcome[] = []) => {
  const erased: string[] = [];
  const eraser: AnalyticsEraser = {
    erase: async (distinctId) => {
      erased.push(distinctId);
      await Promise.resolve();
      return outcomes.shift() ?? { kind: "accepted" };
    },
  };
  return { eraser, erased };
};

const requestRow = async () => {
  const [row] = await database
    .select({
      distinctId: analyticsErasureRequests.distinctId,
      nextAttemptAt: analyticsErasureRequests.nextAttemptAt,
      passesCompleted: analyticsErasureRequests.passesCompleted,
      failedAttempts: analyticsErasureRequests.failedAttempts,
      lastError: analyticsErasureRequests.lastError,
      completedAt: analyticsErasureRequests.completedAt,
    })
    .from(analyticsErasureRequests);
  return row;
};

/** A user deleted at `deletedAt`, which queues their erasure. */
const deleteUser = async (id: string) => {
  await database
    .insert(user)
    .values({ id, name: id, email: `${id}@example.com`, emailVerified: false });
  await deleteAccountData(database, id, deletedAt);
};

describe(processDueErasures, () => {
  beforeEach(async () => {
    await database.delete(analyticsErasureRequests);
  });

  afterAll(async () => {
    await runtime.dispose();
  });

  it("erases after the grace period, confirms a week later, then keeps a receipt without the id", async () => {
    await deleteUser("user-1");
    const { eraser, erased } = scriptedPostHog();

    const duringGrace = await processDueErasures(
      run,
      eraser,
      at("2026-10-19T12:59:00.000Z")
    );
    const firstPass = await processDueErasures(
      run,
      eraser,
      at("2026-10-19T13:00:00.000Z")
    );
    const afterFirst = await requestRow();
    const midweek = await processDueErasures(
      run,
      eraser,
      at("2026-10-22T09:00:00.000Z")
    );
    const confirmation = await processDueErasures(
      run,
      eraser,
      at("2026-10-26T12:05:00.000Z")
    );

    expect({
      duringGrace,
      firstPass,
      afterFirst,
      midweek,
      confirmation,
      final: await requestRow(),
      erased,
    }).toStrictEqual({
      duringGrace: {
        tried: 0,
        accepted: 0,
        finished: 0,
        failed: 0,
        skipped: 0,
      },
      firstPass: { tried: 1, accepted: 1, finished: 0, failed: 0, skipped: 0 },
      afterFirst: {
        distinctId: "user-1",
        nextAttemptAt: at("2026-10-26T12:00:00.000Z"),
        passesCompleted: 1,
        failedAttempts: 0,
        lastError: null,
        completedAt: null,
      },
      midweek: { tried: 0, accepted: 0, finished: 0, failed: 0, skipped: 0 },
      confirmation: {
        tried: 1,
        accepted: 1,
        finished: 1,
        failed: 0,
        skipped: 0,
      },
      final: {
        distinctId: null,
        nextAttemptAt: null,
        passesCompleted: 2,
        failedAttempts: 0,
        lastError: null,
        completedAt: at("2026-10-26T12:05:00.000Z"),
      },
      erased: ["user-1", "user-1"],
    });
  });

  it("retries a failed pass with growing backoff and never counts it as done", async () => {
    await deleteUser("user-2");
    const { eraser, erased } = scriptedPostHog([
      { kind: "failed", reason: "http-403" },
      { kind: "failed", reason: "network" },
    ]);

    await processDueErasures(run, eraser, at("2026-10-19T13:00:00.000Z"));
    const afterFirstFailure = await requestRow();
    const tooSoon = await processDueErasures(
      run,
      eraser,
      at("2026-10-19T13:10:00.000Z")
    );
    await processDueErasures(run, eraser, at("2026-10-19T13:15:00.000Z"));
    const afterSecondFailure = await requestRow();
    await processDueErasures(run, eraser, at("2026-10-19T13:45:00.000Z"));

    expect({
      afterFirstFailure,
      tooSoon: tooSoon.tried,
      afterSecondFailure,
      recovered: await requestRow(),
      erased: erased.length,
    }).toStrictEqual({
      afterFirstFailure: {
        distinctId: "user-2",
        nextAttemptAt: at("2026-10-19T13:15:00.000Z"),
        passesCompleted: 0,
        failedAttempts: 1,
        lastError: "http-403",
        completedAt: null,
      },
      tooSoon: 0,
      afterSecondFailure: {
        distinctId: "user-2",
        nextAttemptAt: at("2026-10-19T13:45:00.000Z"),
        passesCompleted: 0,
        failedAttempts: 2,
        lastError: "network",
        completedAt: null,
      },
      recovered: {
        distinctId: "user-2",
        nextAttemptAt: at("2026-10-26T12:00:00.000Z"),
        passesCompleted: 1,
        failedAttempts: 0,
        lastError: null,
        completedAt: null,
      },
      erased: 3,
    });
  });

  it("leaves a request another run advanced first instead of advancing it twice", async () => {
    await deleteUser("user-3");
    const overlapping: AnalyticsEraser = {
      erase: async () => {
        // A second runner finishes the same pass while this one waits on PostHog.
        await run(
          "update analytics_erasure_requests set passes_completed = 1, next_attempt_at = ?",
          [at("2026-10-26T12:00:00.000Z").getTime()]
        );
        return { kind: "accepted" };
      },
    };

    const summary = await processDueErasures(
      run,
      overlapping,
      at("2026-10-19T13:00:00.000Z")
    );

    expect({ summary, row: await requestRow() }).toStrictEqual({
      summary: { tried: 1, accepted: 1, finished: 0, failed: 0, skipped: 1 },
      row: {
        distinctId: "user-3",
        nextAttemptAt: at("2026-10-26T12:00:00.000Z"),
        passesCompleted: 1,
        failedAttempts: 0,
        lastError: null,
        completedAt: null,
      },
    });
  });

  it("reports counts without any distinct id", async () => {
    await deleteUser("user-4");
    await deleteUser("user-5");
    await processDueErasures(
      run,
      scriptedPostHog([{ kind: "failed", reason: "http-500" }]).eraser,
      at("2026-10-19T13:00:00.000Z"),
      1
    );

    await expect(
      erasureStatus(run, at("2026-10-19T13:05:00.000Z"))
    ).resolves.toStrictEqual({
      waiting: 1,
      due: 1,
      failing: 1,
      completed: 0,
      oldestOpenRequestedAt: deletedAt,
    });
  });
});

describe(postHogEraser, () => {
  const requests: Request[] = [];
  const eraserAnswering = (answer: () => Response) =>
    postHogEraser({
      host: "https://us.posthog.com/",
      projectId: 614_621,
      apiKey: "phx_test",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        await Promise.resolve();
        return answer();
      },
    });

  it("asks PostHog to delete the person with their events and recordings", async () => {
    const outcome = await eraserAnswering(
      () => new Response("{}", { status: 202 })
    ).erase("user-9");

    const [sent] = requests.slice(-1);
    expect({
      outcome,
      url: sent?.url,
      method: sent?.method,
      headers: {
        authorization: sent?.headers.get("authorization"),
        "content-type": sent?.headers.get("content-type"),
      },
      body: await sent?.text(),
    }).toStrictEqual({
      outcome: { kind: "accepted" },
      url: "https://us.posthog.com/api/projects/614621/persons/bulk_delete/",
      method: "POST",
      headers: {
        authorization: "Bearer phx_test",
        "content-type": "application/json",
      },
      body: '{"distinct_ids":["user-9"],"delete_events":true,"delete_recordings":true}',
    });
  });

  it("reports a refusal or a lost connection by category only", async () => {
    const refused = await eraserAnswering(
      () => new Response('{"detail":"user-9 missing scope"}', { status: 403 })
    ).erase("user-9");
    const offline = await postHogEraser({
      host: "https://us.posthog.com",
      projectId: 614_621,
      apiKey: "phx_test",
      fetch: async () => {
        await Promise.resolve();
        throw new TypeError("fetch failed");
      },
    }).erase("user-9");

    expect({ refused, offline }).toStrictEqual({
      refused: { kind: "failed", reason: "http-403" },
      offline: { kind: "failed", reason: "network" },
    });
  });
});
