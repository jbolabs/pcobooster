/**
 * What one procedure answered, and the one log line it writes. ProcedureScope classifies a
 * handler's Exit, including successes that failed to encode; the router fallback classifies
 * unmatched requests. Both write the same line through `logProcedureOutcome`.
 */
import { moduleLog } from "@pcobooster/api/logging";
import type { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import {
  clientClosedOutcome,
  faultOutcome,
  isProductFault,
} from "@pcobooster/contracts/faults";
import type { ProductFault } from "@pcobooster/contracts/faults";
import type { ProcedureKindValue } from "@pcobooster/contracts/http/procedure-kind";
import type { RequestPriority } from "@pcobooster/contracts/request-priority";
import type { Effect } from "effect";
import { Cause, Exit } from "effect";

export type ProcedureOutcome =
  | { readonly kind: "success"; readonly status: 200; readonly code: null }
  | {
      readonly kind: "fault";
      readonly status: number;
      readonly code: string;
      readonly fault: ProductFault;
    }
  | {
      readonly kind: "interrupted";
      readonly status: typeof clientClosedOutcome.status;
      readonly code: typeof clientClosedOutcome.code;
    }
  /** A defect, several failures, a failure that is not a ProductFault, or an encode failure. */
  | {
      readonly kind: "unexpected";
      readonly status: 500;
      readonly code: "INTERNAL_SERVER_ERROR";
      readonly cause: Cause.Cause<unknown>;
    };

/** The single error a cause stands for, for logs and error reports. */
export const causeError = (cause: Cause.Cause<unknown>): Error => {
  const squashed = Cause.squash(cause);
  return squashed instanceof Error ? squashed : new Error(String(squashed));
};

export const successOutcome: ProcedureOutcome = {
  kind: "success",
  status: 200,
  code: null,
};

export const unexpectedOutcome = (
  cause: Cause.Cause<unknown>
): ProcedureOutcome => ({
  kind: "unexpected",
  status: 500,
  code: "INTERNAL_SERVER_ERROR",
  cause,
});

export const faultOutcomeOf = (fault: ProductFault): ProcedureOutcome => ({
  kind: "fault",
  ...faultOutcome[fault._tag],
  fault,
});

/**
 * Exactly one ProductFault and nothing else is a fault (status from `faultOutcome`); only
 * interrupts is 499; anything else is unexpected (500).
 */
export const procedureOutcome = (
  exit: Exit.Exit<unknown, unknown>
): ProcedureOutcome => {
  if (Exit.isSuccess(exit)) {
    return successOutcome;
  }
  const { cause } = exit;
  if (Cause.hasInterruptsOnly(cause)) {
    return { kind: "interrupted", ...clientClosedOutcome };
  }
  const [only, ...others] = cause.reasons;
  if (
    only !== undefined &&
    others.length === 0 &&
    Cause.isFailReason(only) &&
    isProductFault(only.error)
  ) {
    return faultOutcomeOf(only.error);
  }
  return unexpectedOutcome(cause);
};

/** Provider-confirmed write rejections alert independently of the client's BAD_REQUEST. */
export const isReportable = (outcome: ProcedureOutcome): boolean =>
  outcome.status >= 500 ||
  (outcome.kind === "fault" &&
    outcome.fault._tag === "InvalidInput" &&
    outcome.fault.providerRejection !== undefined);

/** Who called and how; everything in the outcome line besides the outcome itself. */
export interface ProcedureCall {
  /** A known tag, whatever an old client sent, or null when no procedure matched. */
  readonly procedure: string | null;
  /** The HTTP method and the matched route's path template (null when none matched). */
  readonly method?: string;
  readonly route?: string | null;
  readonly requestId: string;
  readonly client: string | null;
  /** The native app's installed release (`x-pcobooster-app`), or null. */
  readonly appRelease: string | null;
  readonly priority: RequestPriority;
  /** Null when the request never reached a handler. */
  readonly kind: ProcedureKindValue | null;
  readonly startedAt: number;
  readonly accounting: PlanningCenterRequestAccounting | null;
}

/** Fields of the one `rpc` line per procedure, which Workers Logs indexes. */
export interface ProcedureLogFields {
  readonly procedure: string | null;
  readonly requestId: string;
  readonly method: string | null;
  /** The route template, so one line groups every id; null when no route matched. */
  readonly route: string | null;
  readonly status: number;
  readonly code: string | null;
  readonly durationMs: number;
  readonly priority: RequestPriority;
  readonly client: string | null;
  /** The native app's release, `0.1.0(372)+1a2b3c4`, kept apart from the API version in `client`. */
  readonly appRelease: string | null;
  readonly kind: ProcedureKindValue | null;
  /** Planning Center requests the procedure sent, retries included. */
  readonly planningCenterRequests: number;
  /** Requests the pacer held back, and for how long in total. */
  readonly rateLimitPauses: number;
  readonly rateLimitPauseMs: number;
  /** Speculative requests the pacer refused outright. */
  readonly rateLimitRejections: number;
  readonly rateLimited429s: number;
  readonly budgetExhausted: boolean;
  /** The procedure's Planning Center request cap; null when it never reached a handler. */
  readonly requestBudget: number | null;
}

export const procedureLogFields = (
  call: ProcedureCall,
  outcome: ProcedureOutcome,
  now: number
): ProcedureLogFields => {
  const totals = call.accounting?.totals;
  return {
    procedure: call.procedure,
    requestId: call.requestId,
    method: call.method ?? null,
    route: call.route ?? null,
    status: outcome.status,
    code: outcome.code,
    durationMs: now - call.startedAt,
    priority: call.priority,
    client: call.client,
    appRelease: call.appRelease,
    kind: call.kind,
    planningCenterRequests: totals?.requests ?? 0,
    rateLimitPauses: totals?.pacedRequests ?? 0,
    rateLimitPauseMs: totals?.pacedWaitMs ?? 0,
    rateLimitRejections: totals?.rateLimitRejections ?? 0,
    rateLimited429s: totals?.rateLimited ?? 0,
    budgetExhausted: (totals?.subrequestLimitHits ?? 0) > 0,
    requestBudget: call.accounting?.requestBudget ?? null,
  };
};

const rpcLog = moduleLog("rpc");

/** The message of the outcome line, so log queries and tests can find it. */
export const PROCEDURE_LOG_MESSAGE = "rpc";

/** Status below 500 (4xx, 499) logs at info; 500 and above at error, with the cause. */
export const logProcedureOutcome = (
  fields: ProcedureLogFields,
  outcome: ProcedureOutcome
): Effect.Effect<void> => {
  if (outcome.kind === "unexpected") {
    return rpcLog.error(
      PROCEDURE_LOG_MESSAGE,
      fields,
      causeError(outcome.cause)
    );
  }
  return outcome.status >= 500
    ? rpcLog.error(PROCEDURE_LOG_MESSAGE, fields)
    : rpcLog.info(PROCEDURE_LOG_MESSAGE, fields);
};

/** What error tracking receives for a reportable procedure; never fails. */
export type ReportProcedureFailure = (report: {
  readonly fields: ProcedureLogFields;
  readonly error: Error;
}) => Effect.Effect<void>;

/** The underlying error of a 5xx outcome, with its cause when a fault carries one. */
export const reportedError = (outcome: ProcedureOutcome): Error => {
  if (outcome.kind === "unexpected") {
    return causeError(outcome.cause);
  }
  if (outcome.kind === "fault") {
    return outcome.fault;
  }
  return new Error(`Procedure ended with status ${outcome.status}`);
};
