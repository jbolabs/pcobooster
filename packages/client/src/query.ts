/**
 * TanStack Query glue for product calls, shared by web and Expo: which lane a query's call goes
 * out in (`speculativeQuery`, `callForQuery`), which read failures are worth one retry, and when
 * a batched read may start behind the one ahead (`batchHasAnswered`).
 */
import type {
  ProductClient,
  ProductReadApi,
} from "@pcobooster/client/product-client";
import { failureStatus } from "@pcobooster/client/product-client";
import { RateLimited } from "@pcobooster/contracts/faults/rate-limited";
import type { RequestPriority } from "@pcobooster/contracts/request-priority";
import type {
  QueryFunctionContext,
  QueryMeta,
  QueryState,
} from "@tanstack/query-core";
import type { Effect } from "effect";

const SPECULATIVE_META: QueryMeta = { requestPriority: "speculative" };

/**
 * Marks a prefetch speculative. Its calls go out in the speculative lane until something on
 * screen observes the query; a mounted `useQuery` replaces the options, and with them this mark.
 */
export const speculativeQuery = <Options extends object>(
  options: Options & { meta?: QueryMeta }
): Options & { meta: QueryMeta } => ({
  ...options,
  meta: { ...options.meta, ...SPECULATIVE_META },
});

/**
 * The priority of a query's next call: speculative only while the fetch was started
 * speculatively and nothing on screen observes the query yet.
 */
export const queryCallPriority = ({
  client,
  meta,
  queryKey,
}: QueryFunctionContext): RequestPriority => {
  if (meta?.requestPriority !== "speculative") {
    return "interactive";
  }
  const observers =
    client
      .getQueryCache()
      .find({ queryKey, exact: true })
      ?.getObserversCount() ?? 0;
  return observers > 0 ? "interactive" : "speculative";
};

/** Abort signal and read priority supplied by TanStack Query. */
export interface QueryCallOptions {
  readonly signal: AbortSignal;
  readonly priority: RequestPriority;
}

/**
 * Runs a native HttpApi read with the query's signal and current priority. A held-back
 * speculative call is sent again as interactive when the user opens the prefetched data.
 * Writes are absent from the API this callback receives.
 */
export const callForQuery = async <Result, Failure>(
  context: QueryFunctionContext,
  client: Pick<ProductClient, "run">,
  call: (api: ProductReadApi) => Effect.Effect<Result, Failure>
): Promise<Result> => {
  const { signal } = context;
  const priority = queryCallPriority(context);
  try {
    return await client.run(call, { signal, priority });
  } catch (error) {
    if (
      priority === "speculative" &&
      error instanceof RateLimited &&
      queryCallPriority(context) === "interactive"
    ) {
      return await client.run(call, { signal, priority: "interactive" });
    }
    throw error;
  }
};

/** Automatic retries a failed read gets (`retryTransientReadFailure`). */
export const MAX_READ_RETRIES = 1;
/** Retries a rate-limited read gets, each after the Retry-After the API named. */
export const MAX_RATE_LIMITED_READ_RETRIES = 2;
/** Longest Retry-After a read waits out (one Planning Center window) instead of failing. */
const MAX_RATE_LIMITED_WAIT_SECONDS = 20;
const SERVER_ERROR_STATUS = 500;
const MS_PER_SECOND = 1000;
const MAX_BACKOFF_MS = 30_000;

/** The wait a rate-limited answer names, when a read should wait it out. */
const rateLimitWaitSeconds = (error: Error): number | undefined =>
  error instanceof RateLimited &&
  error.retryAfterSeconds !== undefined &&
  error.retryAfterSeconds <= MAX_RATE_LIMITED_WAIT_SECONDS
    ? error.retryAfterSeconds
    : undefined;

/**
 * Retries a failed read once, unless the API answered with a 4xx fault. Sign-in, permission,
 * and missing-record answers come back the same on a retry, which would only spend another
 * Planning Center request. A rate limit that names a short Retry-After passes once that wait
 * does, so it is retried (see `readRetryDelay`). Server and network failures may be transient.
 */
export const retryTransientReadFailure = (
  failureCount: number,
  error: Error
): boolean => {
  if (rateLimitWaitSeconds(error) !== undefined) {
    return failureCount < MAX_RATE_LIMITED_READ_RETRIES;
  }
  return (
    failureCount < MAX_READ_RETRIES &&
    (failureStatus(error) ?? SERVER_ERROR_STATUS) >= SERVER_ERROR_STATUS
  );
};

/** Waits out a rate limit's Retry-After; other failures keep TanStack Query's backoff. */
export const readRetryDelay = (failureCount: number, error: Error): number => {
  const waitSeconds = rateLimitWaitSeconds(error);
  return waitSeconds === undefined
    ? Math.min(MS_PER_SECOND * 2 ** failureCount, MAX_BACKOFF_MS)
    : Math.max(waitSeconds, 1) * MS_PER_SECOND;
};

/** What a batch's gate reads from the query ahead of it. */
export type GateQueryState = Pick<
  QueryState,
  "status" | "fetchStatus" | "dataUpdatedAt"
>;

/**
 * Whether the batch ahead lets the next one start: it failed, or its data dates from
 * `freshSince` (the visit's start less the stale time) or later, so it will not refetch.
 * Saved data older than that refetches on arrival and keeps its place in line until it
 * answers; counting it as answered starts every stale saved batch at once, past the user's
 * Planning Center budget.
 */
export const batchHasAnswered = (
  state: GateQueryState | undefined,
  freshSince: number
): boolean =>
  state !== undefined &&
  state.fetchStatus !== "fetching" &&
  (state.status === "error" ||
    (state.status === "success" && state.dataUpdatedAt >= freshSince));
