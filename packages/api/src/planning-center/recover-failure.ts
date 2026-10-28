import { moduleLog } from "@pcobooster/api/logging";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import { PlanningCenterNetworkError } from "@pcobooster/api/planning-center/network-error";
import { Cause, Effect } from "effect";

const log = moduleLog("planning-center/recover-failure");

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
/** Planning Center's code for a person with no access to the product they called. */
const NO_APP_ACCESS_CODE = "TRASH_PANDA";
const HTTP_TOO_MANY_REQUESTS = 429;
const MAX_LOGGED_ERROR_LENGTH = 280;

/**
 * A Planning Center failure a caller may name as recoverable:
 *
 * - `not-found`: a 404, such as a service type or plan in another organization.
 * - `permission-denied`: a 403, or a 401 `TRASH_PANDA`, when the person's own access
 *   doesn't reach the resource. Listing `provider-failure` recovers these too.
 * - `provider-failure`: any other error status except 429, or a network failure.
 * - `unusable-response`: a defect, such as a response missing the expected resource.
 *
 * Rate limits (the pacer's `PlanningCenterRateLimitError` or a 429 response),
 * subrequest limits, read-only rejections, and interruption are none of these,
 * so no caller can recover from them.
 */
export type RecoverablePlanningCenterFailure =
  | "not-found"
  | "permission-denied"
  | "provider-failure"
  | "unusable-response";

/**
 * The recoverable kind of one part of a cause, or `undefined` when it must
 * propagate: an interruption, a rate or subrequest limit, a read-only
 * rejection, or any error this module does not know.
 */
const classifyReason = (
  reason: Cause.Reason<unknown>
): RecoverablePlanningCenterFailure | undefined => {
  if (Cause.isDieReason(reason)) {
    return "unusable-response";
  }
  if (!Cause.isFailReason(reason)) {
    return undefined;
  }
  const { error } = reason;
  if (error instanceof PlanningCenterNetworkError) {
    return "provider-failure";
  }
  if (
    !(error instanceof PlanningCenterApiError) ||
    error.status === HTTP_TOO_MANY_REQUESTS
  ) {
    return undefined;
  }
  if (error.status === HTTP_NOT_FOUND) {
    return "not-found";
  }
  // A bare 401 is a rejected token, not the person's permissions.
  if (
    error.status === HTTP_FORBIDDEN ||
    (error.status === HTTP_UNAUTHORIZED && error.code === NO_APP_ACCESS_CODE)
  ) {
    return "permission-denied";
  }
  return "provider-failure";
};

/**
 * The listed kind that covers `kind`. A permission denial was a provider failure before it
 * had its own kind, so reads that list provider failures still recover it.
 */
const listedKind = (
  kind: RecoverablePlanningCenterFailure,
  listed: ReadonlySet<RecoverablePlanningCenterFailure>
): RecoverablePlanningCenterFailure | undefined => {
  if (listed.has(kind)) {
    return kind;
  }
  if (kind === "permission-denied" && listed.has("provider-failure")) {
    return "provider-failure";
  }
  return undefined;
};

/** The kinds in `cause` when every part of it is recoverable and listed in `kinds`. */
const listedKindsOf = <Failure>(
  cause: Cause.Cause<Failure>,
  kinds: readonly RecoverablePlanningCenterFailure[]
): ReadonlySet<RecoverablePlanningCenterFailure> | undefined => {
  const listed = new Set(kinds);
  const found = new Set<RecoverablePlanningCenterFailure>();
  for (const reason of cause.reasons) {
    const kind = classifyReason(reason);
    const covered = kind === undefined ? undefined : listedKind(kind, listed);
    if (covered === undefined) {
      return undefined;
    }
    found.add(covered);
  }
  return found.size > 0 ? found : undefined;
};

/**
 * Whether `cause` holds only failures of the listed kinds. Budget failures and
 * interruption are never recoverable, whatever `kinds` lists.
 */
export const isRecoverablePlanningCenterCause = <Failure>(
  cause: Cause.Cause<Failure>,
  kinds: readonly RecoverablePlanningCenterFailure[]
): boolean => listedKindsOf(cause, kinds) !== undefined;

/** A short description of `cause` for logs: never a token or response body. */
export const describePlanningCenterCause = <Failure>(
  cause: Cause.Cause<Failure>
): string => {
  const error = Cause.squash(cause);
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_LOGGED_ERROR_LENGTH);
};

export interface RecoverPlanningCenterFailureOptions<Fallback> {
  /** The failure kinds this read may fall back after; anything else propagates. */
  readonly kinds: readonly RecoverablePlanningCenterFailure[];
  /** Why falling back is correct, logged with every fallback. */
  readonly reason: string;
  /** Identifiers for the log line (ids and paths only, never tokens or bodies). */
  readonly details?: Readonly<Record<string, string>>;
  readonly fallback: () => Fallback;
}

/**
 * Falls back to `fallback()` after a failure of one of the listed kinds, and
 * logs the reason: `not-found` and `permission-denied` at `info`, any other kind at `warn`. Rate-limit
 * and subrequest-limit failures, read-only rejections, and interruption always
 * propagate, so a spent budget can never read as empty data.
 */
export const recoverPlanningCenterFailure =
  <Fallback>({
    kinds,
    reason,
    details,
    fallback,
  }: RecoverPlanningCenterFailureOptions<Fallback>) =>
  <Value, Failure, Requirements>(
    self: Effect.Effect<Value, Failure, Requirements>
  ): Effect.Effect<Value | Fallback, Failure, Requirements> =>
    Effect.catchCause(self, (cause) => {
      const found = listedKindsOf(cause, kinds);
      if (found === undefined) {
        return Effect.failCause(cause);
      }
      const fields = {
        ...details,
        failure: [...found].join(","),
        error: describePlanningCenterCause(cause),
      };
      const expected = [...found].every(
        (kind) => kind === "not-found" || kind === "permission-denied"
      );
      return Effect.andThen(
        expected ? log.info(reason, fields) : log.warn(reason, fields),
        Effect.sync(fallback)
      );
    });

/**
 * Runs optional diagnostics only after an operation has failed. Diagnostic failures,
 * including spent budgets, cannot replace the original failure or become product data.
 * Interruptions and defects still propagate; this is not a read fallback.
 */
export const withPlanningCenterFailureDiagnostics =
  <Failure, DiagnosticFailure, DiagnosticRequirements>(
    diagnose: (
      failure: Failure
    ) => Effect.Effect<void, DiagnosticFailure, DiagnosticRequirements>
  ) =>
  <Value, Requirements>(
    self: Effect.Effect<Value, Failure, Requirements>
  ): Effect.Effect<Value, Failure, Requirements | DiagnosticRequirements> =>
    Effect.tapError(self, (failure) =>
      diagnose(failure).pipe(
        Effect.match({ onSuccess: () => null, onFailure: () => null })
      )
    );
