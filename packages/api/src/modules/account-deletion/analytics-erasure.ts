/**
 * Carries out the PostHog erasure that account deletion queues in `analytics_erasure_requests`.
 *
 * Each request gets two passes, each asking PostHog to delete the person with that distinct id,
 * their events, and their recordings (`persons/bulk_delete`):
 *
 * 1. One hour after the deletion, so captures already in flight (a feedback forward, a phone's
 *    queued events) have landed. PostHog only deletes events captured before each request.
 * 2. Seven days after the deletion, to catch anything that still arrived late.
 *
 * A failed pass is retried with backoff and never skipped. PostHog accepts a deletion and then
 * removes events in the background (on PostHog Cloud, during off-peak hours), so a completed row
 * means PostHog accepted both requests, not that its storage is already clean. After the last
 * pass the distinct id is cleared and the row stays as a receipt holding no personal data.
 *
 * Runs over plain SQL (`ErasureSql`) so the same code drives local D1 in tests and the D1 HTTP
 * API from the operator command (`scripts/analytics/erase-deleted-accounts.ts`).
 */
import { Schema } from "effect";

const HOUR_MS = 60 * 60 * 1000;
export const FIRST_PASS_DELAY_MS = HOUR_MS;
export const CONFIRMATION_PASS_DELAY_MS = 7 * 24 * HOUR_MS;
export const ERASURE_PASSES = 2;
const FIRST_RETRY_MS = 15 * 60 * 1000;
const LONGEST_RETRY_MS = 24 * HOUR_MS;

export const firstErasurePassAt = (requestedAt: Date): Date =>
  new Date(requestedAt.getTime() + FIRST_PASS_DELAY_MS);

/** 15 minutes after the first failure, doubling, at most a day. */
export const retryDelayMs = (failedAttempts: number): number =>
  Math.min(
    FIRST_RETRY_MS * 2 ** Math.max(0, failedAttempts - 1),
    LONGEST_RETRY_MS
  );

export type SqlValue = string | number | null;
/** Runs one statement and resolves with its result rows. */
export type ErasureSql = (
  query: string,
  params: readonly SqlValue[]
) => Promise<readonly unknown[]>;

export type ErasureOutcome =
  | { readonly kind: "accepted" }
  /** `reason` is a category safe to store and log: an HTTP status, `network`, or `response`. */
  | { readonly kind: "failed"; readonly reason: string };

export interface AnalyticsEraser {
  readonly erase: (distinctId: string) => Promise<ErasureOutcome>;
}

const dueRow = Schema.Struct({
  id: Schema.Finite,
  distinct_id: Schema.String,
  requested_at: Schema.Finite,
  passes_completed: Schema.Finite,
  failed_attempts: Schema.Finite,
});
const decodeDueRows = Schema.decodeUnknownSync(Schema.Array(dueRow));

export interface ErasureRunSummary {
  /** Requests that were due and tried this run. */
  readonly tried: number;
  /** Passes PostHog accepted. */
  readonly accepted: number;
  /** Requests whose last pass was accepted this run. */
  readonly finished: number;
  /** Passes that failed and were rescheduled. */
  readonly failed: number;
  /** Rows another runner changed first, left to it. */
  readonly skipped: number;
}

interface PassResult {
  readonly outcome: "failed" | "advanced" | "finished";
  /** False when another run changed the row first. */
  readonly recorded: boolean;
}

/** One PostHog call for one request, then its row's conditional update. */
const settlePass = async (
  run: ErasureSql,
  eraser: AnalyticsEraser,
  row: typeof dueRow.Type,
  now: Date
): Promise<PassResult> => {
  const outcome = await eraser.erase(row.distinct_id);
  if (outcome.kind === "failed") {
    const attempts = row.failed_attempts + 1;
    const changed = await run(
      `update analytics_erasure_requests
       set failed_attempts = ?, last_error = ?, next_attempt_at = ?
       where id = ? and passes_completed = ? and distinct_id is not null
       returning id`,
      [
        attempts,
        outcome.reason,
        now.getTime() + retryDelayMs(attempts),
        row.id,
        row.passes_completed,
      ]
    );
    return { outcome: "failed", recorded: changed.length > 0 };
  }
  if (row.passes_completed + 1 >= ERASURE_PASSES) {
    const changed = await run(
      `update analytics_erasure_requests
       set distinct_id = null, next_attempt_at = null, passes_completed = ?,
         failed_attempts = 0, last_error = null, completed_at = ?
       where id = ? and passes_completed = ?
       returning id`,
      [row.passes_completed + 1, now.getTime(), row.id, row.passes_completed]
    );
    return { outcome: "finished", recorded: changed.length > 0 };
  }
  const changed = await run(
    `update analytics_erasure_requests
     set passes_completed = ?, failed_attempts = 0, last_error = null,
       next_attempt_at = ?
     where id = ? and passes_completed = ?
     returning id`,
    [
      row.passes_completed + 1,
      Math.max(now.getTime(), row.requested_at + CONFIRMATION_PASS_DELAY_MS),
      row.id,
      row.passes_completed,
    ]
  );
  return { outcome: "advanced", recorded: changed.length > 0 };
};

/**
 * Tries every request due at `now` (up to `limit`), one PostHog call each. Every update is
 * conditional on the row's pass count, so two overlapping runs never double-advance a request.
 */
export const processDueErasures = async (
  run: ErasureSql,
  eraser: AnalyticsEraser,
  now: Date,
  limit = 50
): Promise<ErasureRunSummary> => {
  const due = decodeDueRows(
    await run(
      `select id, distinct_id, requested_at, passes_completed, failed_attempts
       from analytics_erasure_requests
       where distinct_id is not null and next_attempt_at <= ?
       order by next_attempt_at, id limit ?`,
      [now.getTime(), limit]
    )
  );
  const settled: PassResult[] = [];
  for (const row of due) {
    // oxlint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop -- one PostHog call at a time stays far inside its rate limit.
    settled.push(await settlePass(run, eraser, row, now));
  }
  const count = (match: (result: PassResult) => boolean) =>
    settled.filter(match).length;
  return {
    tried: due.length,
    accepted: count((result) => result.outcome !== "failed"),
    finished: count((result) => result.outcome === "finished"),
    failed: count((result) => result.outcome === "failed"),
    skipped: count((result) => !result.recorded),
  };
};

const statusRow = Schema.Struct({
  waiting: Schema.Finite,
  due: Schema.Finite,
  failing: Schema.Finite,
  completed: Schema.Finite,
  oldest_open_requested_at: Schema.NullOr(Schema.Finite),
});
const decodeStatusRows = Schema.decodeUnknownSync(Schema.Array(statusRow));

export interface ErasureStatus {
  /** Open requests not yet due (in their grace period, or between passes or retries). */
  readonly waiting: number;
  readonly due: number;
  /** Open requests whose last try failed. */
  readonly failing: number;
  readonly completed: number;
  readonly oldestOpenRequestedAt: Date | null;
}

/** Counts only: no distinct ids leave the database. */
export const erasureStatus = async (
  run: ErasureSql,
  now: Date
): Promise<ErasureStatus> => {
  const [row] = decodeStatusRows(
    await run(
      `select
         coalesce(sum(distinct_id is not null and next_attempt_at > ?), 0) as waiting,
         coalesce(sum(distinct_id is not null and next_attempt_at <= ?), 0) as due,
         coalesce(sum(distinct_id is not null and failed_attempts > 0), 0) as failing,
         coalesce(sum(completed_at is not null), 0) as completed,
         min(case when distinct_id is not null then requested_at end) as oldest_open_requested_at
       from analytics_erasure_requests`,
      [now.getTime(), now.getTime()]
    )
  );
  return {
    waiting: row?.waiting ?? 0,
    due: row?.due ?? 0,
    failing: row?.failing ?? 0,
    completed: row?.completed ?? 0,
    oldestOpenRequestedAt:
      row?.oldest_open_requested_at === null ||
      row?.oldest_open_requested_at === undefined
        ? null
        : new Date(row.oldest_open_requested_at),
  };
};

export interface PostHogEraserOptions {
  readonly fetch: typeof globalThis.fetch;
  /** For example `https://us.posthog.com`. */
  readonly host: string;
  readonly projectId: number;
  /** A personal API key with the `person:write` scope. */
  readonly apiKey: string;
}

/**
 * PostHog's `persons/bulk_delete` by distinct id, with the person's events and recordings.
 * Deleting a person who is already gone succeeds, so repeating a pass is harmless. Response
 * bodies are never kept: they can echo the distinct id.
 */
export const postHogEraser = ({
  fetch,
  host,
  projectId,
  apiKey,
}: PostHogEraserOptions): AnalyticsEraser => ({
  erase: async (distinctId) => {
    let response: Response;
    try {
      response = await fetch(
        `${host.replace(/\/+$/u, "")}/api/projects/${projectId}/persons/bulk_delete/`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            distinct_ids: [distinctId],
            delete_events: true,
            delete_recordings: true,
          }),
        }
      );
    } catch {
      return { kind: "failed", reason: "network" };
    }
    await response.body?.cancel();
    return response.ok
      ? { kind: "accepted" }
      : { kind: "failed", reason: `http-${response.status}` };
  },
});
