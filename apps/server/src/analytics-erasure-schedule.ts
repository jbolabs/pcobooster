/**
 * The production API Worker's Cron Trigger for the PostHog erasure that account deletion queues
 * (`packages/api/src/modules/account-deletion/analytics-erasure.ts`). It runs the queue over the
 * Worker's own D1 binding, so no D1 API token exists anywhere, with a PostHog key limited to
 * `person:write` read from the `pcobooster-secrets/prod` Secrets Store.
 *
 * Overlapping runs (a slow hour, or an operator's `bun run analytics:erase -- --process`) are
 * safe: every row update is conditional on the pass count it read, and PostHog treats a repeated
 * deletion as done. A run that fails, a failed pass, or a request open past `OVERDUE_AFTER_MS`
 * becomes a PostHog `$exception` (production's existing error alerting) and a Workers Logs error.
 */
import { moduleLog } from "@pcobooster/api/logging";
import {
  CONFIRMATION_PASS_DELAY_MS,
  erasureStatus,
  postHogEraser,
  processDueErasures,
} from "@pcobooster/api/modules/account-deletion/analytics-erasure";
import type {
  ErasureRunSummary,
  ErasureSql,
  ErasureStatus,
  SqlValue,
} from "@pcobooster/api/modules/account-deletion/analytics-erasure";
import { createPostHogExceptionReporter } from "@pcobooster/api/modules/analytics/posthog-exception";
import { Effect } from "effect";

/**
 * Hourly, off the top of the hour. The first pass is due an hour after a deletion and failed
 * passes retry after 15 minutes or more, so an hour adds at most an hour to either.
 */
export const ANALYTICS_ERASURE_CRON = "17 * * * *";

/**
 * Requests per run: one status read, one due read, then a PostHog call and a D1 update each, plus
 * up to two failure reports, stays well inside the API Worker's 80-subrequest limit.
 */
export const ERASURES_PER_RUN = 25;

/**
 * The confirmation pass is due seven days after a deletion; two more days covers its retries
 * (at most a day apart). The privacy policy allows two weeks, so this alerts with days to spare.
 */
export const OVERDUE_AFTER_MS =
  CONFIRMATION_PASS_DELAY_MS + 2 * 24 * 60 * 60 * 1000;

const POSTHOG_HOST = "https://us.posthog.com";
/** The pcobooster.com PostHog project (`packages/analytics/src/reports.ts`). */
const POSTHOG_PROJECT_ID = 614_621;

const log = moduleLog("analytics-erasure");

/** The slice of a D1 binding the queue needs. */
export interface ErasureDatabase {
  readonly prepare: (query: string) => {
    readonly bind: (...values: SqlValue[]) => {
      readonly all: () => Promise<{ readonly results: readonly unknown[] }>;
    };
  };
}

export const d1ErasureSql =
  (binding: ErasureDatabase): ErasureSql =>
  async (query, params) => {
    const { results } = await binding
      .prepare(query)
      .bind(...params)
      .all();
    return results;
  };

export interface ScheduledErasureRun {
  readonly database: ErasureDatabase;
  /** The `person:write` PostHog key; empty when the stored secret is missing. */
  readonly erasureApiKey: string;
  /** The project key failures are reported with; empty disables reporting. */
  readonly reportingKey: string;
  readonly fetch: typeof globalThis.fetch;
  readonly now: Date;
}

/** Why a run needs a person to look, as a stable code. Never carries a distinct id. */
type ErasureProblem =
  | "ANALYTICS_ERASURE_NOT_CONFIGURED"
  | "ANALYTICS_ERASURE_RUN_FAILED"
  | "ANALYTICS_ERASURE_PASS_FAILED"
  | "ANALYTICS_ERASURE_OVERDUE";

export interface ScheduledErasureResult {
  readonly ran: ErasureRunSummary | null;
  readonly status: ErasureStatus | null;
  readonly problems: readonly ErasureProblem[];
}

const problemsIn = (
  ran: ErasureRunSummary,
  status: ErasureStatus,
  now: Date
): ErasureProblem[] => {
  const overdue =
    status.oldestOpenRequestedAt !== null &&
    now.getTime() - status.oldestOpenRequestedAt.getTime() > OVERDUE_AFTER_MS;
  return [
    ...(ran.failed > 0 ? (["ANALYTICS_ERASURE_PASS_FAILED"] as const) : []),
    ...(overdue ? (["ANALYTICS_ERASURE_OVERDUE"] as const) : []),
  ];
};

const runQueue = async ({
  database,
  erasureApiKey,
  fetch,
  now,
}: ScheduledErasureRun): Promise<ScheduledErasureResult> => {
  if (erasureApiKey === "") {
    return {
      ran: null,
      status: null,
      problems: ["ANALYTICS_ERASURE_NOT_CONFIGURED"],
    };
  }
  const run = d1ErasureSql(database);
  const ran = await processDueErasures(
    run,
    postHogEraser({
      fetch,
      host: POSTHOG_HOST,
      projectId: POSTHOG_PROJECT_ID,
      apiKey: erasureApiKey,
    }),
    now,
    ERASURES_PER_RUN
  );
  // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- the counts must include the rows this run just advanced.
  const status = await erasureStatus(run, now);
  return { ran, status, problems: problemsIn(ran, status, now) };
};

/** One scheduled run: erase what is due, log counts only, and report anything needing a person. */
export const runScheduledErasures = (
  options: ScheduledErasureRun
): Effect.Effect<ScheduledErasureResult> =>
  Effect.gen(function* scheduledRun() {
    const result = yield* Effect.tryPromise(
      async () => await runQueue(options)
    ).pipe(
      // The cause stays out of logs and reports: a decode failure can echo a row's distinct id.
      Effect.catchCause(() =>
        Effect.succeed<ScheduledErasureResult>({
          ran: null,
          status: null,
          problems: ["ANALYTICS_ERASURE_RUN_FAILED"],
        })
      )
    );
    const fields = {
      ...result.ran,
      waiting: result.status?.waiting,
      due: result.status?.due,
      failing: result.status?.failing,
      completed: result.status?.completed,
      oldestOpenRequestedAt:
        result.status?.oldestOpenRequestedAt?.toISOString(),
      problems: result.problems.join(","),
    };
    yield* result.problems.length === 0
      ? log.info("Analytics erasure run", fields)
      : log.error("Analytics erasure run needs attention", fields);
    const report = createPostHogExceptionReporter({
      apiKey: options.reportingKey,
      fetch: options.fetch,
      now: () => options.now,
    });
    if (report !== null) {
      for (const code of result.problems) {
        yield* Effect.tryPromise(async () => {
          await report({
            error: new Error(`Analytics erasure: ${code}`),
            code,
            path: "cron:analytics-erasure",
            method: "SCHEDULED",
            requestId: `analytics-erasure-${options.now.getTime()}`,
            procedure: "analyticsErasure",
          });
        }).pipe(
          Effect.catchCause(() =>
            log.error("Failed to report analytics erasure problem", { code })
          )
        );
      }
    }
    return result;
  });
