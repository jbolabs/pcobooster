/**
 * The outermost middleware of every product endpoint: request identity, the client version gate,
 * Planning Center accounting and priority, the outcome line, and fault encoding, around
 * HttpApi's own decode, handler, and encode.
 */
import "@pcobooster/api/http/services";
import {
  createRequestContext,
  RequestContext,
} from "@pcobooster/api/application/context";
import {
  isReportable,
  logProcedureOutcome,
  procedureLogFields,
  procedureOutcome,
  reportedError,
} from "@pcobooster/api/http/outcome";
import type {
  ProcedureCall,
  ProcedureLogFields,
  ProcedureOutcome,
  ReportProcedureFailure,
} from "@pcobooster/api/http/outcome";
import { ResponseCookies } from "@pcobooster/api/http/response-cookies";
import { PlanningCenterAccounting } from "@pcobooster/api/planning-center/accounting";
import { PlanningCenterPacing } from "@pcobooster/api/planning-center/pacing";
import type { PlanningCenterRatePacer } from "@pcobooster/api/planning-center/rate-pacer";
import { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import type { DroppedPlanningCenterRow } from "@pcobooster/api/planning-center/request-accounting";
import { PLANNING_CENTER_REQUEST_CAP } from "@pcobooster/api/planning-center/request-budget";
import {
  PlanningCenterRowsDroppedError,
  groupDroppedRows,
} from "@pcobooster/api/planning-center/rows-dropped-error";
import { Server, serverDependenciesForRequest } from "@pcobooster/api/server";
import type { ServerDependencies } from "@pcobooster/api/server";
import { ClientOutdated } from "@pcobooster/contracts/faults/client-outdated";
import { InternalError } from "@pcobooster/contracts/faults/internal-error";
import { RequestRejected } from "@pcobooster/contracts/faults/request-rejected";
import {
  CLIENT_HEADER,
  isSupportedClient,
  MINIMUM_API_VERSION,
} from "@pcobooster/contracts/http/client-version";
import { procedureKindOf } from "@pcobooster/contracts/http/procedure-kind";
import { ProcedureScope } from "@pcobooster/contracts/http/procedure-scope";
import {
  APP_RELEASE_HEADER,
  parseAppRelease,
} from "@pcobooster/contracts/http/request-diagnostics";
import {
  parseRequestPriority,
  REQUEST_PRIORITY_HEADER,
} from "@pcobooster/contracts/request-priority";
import { Context, Effect, Exit, Layer, Option } from "effect";
import { HttpApiSchemaError } from "effect/http-api/HttpApiError";
import * as Cookies from "effect/http/Cookies";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/**
 * What the Worker hands each request: the isolate's server dependencies (built by the first
 * request, since bindings are only readable inside one) and where reportable outcomes are sent.
 * The router is built before any request, so it reads these per request and never keeps them.
 */
export class IsolateServer extends Context.Service<
  IsolateServer,
  {
    readonly server: ServerDependencies;
    /** Sends reportable outcomes to error tracking; null where the stage has none. */
    readonly report: ReportProcedureFailure | null;
  }
>()("@pcobooster/api/IsolateServer") {}

export interface ProcedureScopeOptions {
  /** The isolate's pacer: every call shares each credential's Planning Center budget. */
  readonly pacer: PlanningCenterRatePacer;
  /** Defaults to `PLANNING_CENTER_REQUEST_CAP`. */
  readonly requestBudget?: number;
  readonly now?: () => number;
}

/**
 * Reads a service the Worker put on the request fiber: Alchemy's per-invocation HTTP client, and
 * the isolate's server. HttpApi middleware cannot declare requirements, so these are the only
 * untyped reads. Missing means the endpoint runs outside a Worker request, which only a wiring
 * bug causes; it dies, and the die is answered as InternalError.
 */
export const fromRequestFiber = <Identifier, Service>(
  key: Context.Key<Identifier, Service>
): Effect.Effect<Service> =>
  Effect.withFiber((fiber) =>
    Option.match(Context.getOption(fiber.context, key), {
      onNone: () =>
        Effect.die(
          new Error(`${key.key} is missing: the endpoint ran outside a request`)
        ),
      onSome: Effect.succeed,
    })
  );

const OUTDATED_MESSAGE =
  "This version of pcobooster is out of date. Reload or update it to continue.";

/**
 * A rejected request's person-facing message: a request this client's own contract could not
 * have produced usually means the client is older than the server.
 */
export const REJECTED_MESSAGE = OUTDATED_MESSAGE;

const clientOutdated = new ClientOutdated({
  message: OUTDATED_MESSAGE,
  minimumProtocolVersion: MINIMUM_API_VERSION,
});

/** Statuses from here up are errors. */
const FIRST_ERROR_STATUS = 400;

const rejected = (reason: RequestRejected["reason"]) =>
  new RequestRejected({ message: REJECTED_MESSAGE, reason });

/**
 * HttpApi fails with `HttpApiSchemaError` when params, query, headers, or payload do not decode
 * (the caller's mistake: `RequestRejected`, 400), and when a success does not encode (the
 * server's: a defect, answered `InternalError`, 500).
 */
const classifySchemaError = <Failure>(
  failure: Failure
): Effect.Effect<never, Failure | RequestRejected> => {
  if (!HttpApiSchemaError.is(failure)) {
    return Effect.fail(failure);
  }
  return failure.kind === "Body" || failure.kind === "ResponseHeaders"
    ? Effect.die(failure)
    : Effect.fail(rejected("invalid-payload"));
};

/**
 * HttpApi answers some requests itself, as a plain response, before any handler: a body that is
 * not JSON (415). Those become `RequestRejected`, so every non-2xx answer is a declared fault
 * the client decodes and the outcome line reports.
 */
const rejectFrameworkAnswer = (
  response: HttpServerResponse.HttpServerResponse
): Effect.Effect<HttpServerResponse.HttpServerResponse, RequestRejected> =>
  response.status >= FIRST_ERROR_STATUS
    ? Effect.fail(rejected("malformed-request"))
    : Effect.succeed(response);

/**
 * A defect, or any failure that is not exactly one fault, answers `InternalError`: what went
 * wrong is in the outcome line and the error report, never on the wire.
 */
const hideUnexpected = <Value, Failure, Services>(
  effect: Effect.Effect<Value, Failure, Services>
): Effect.Effect<Value, Failure | InternalError, Services> =>
  Effect.catchCause(
    effect,
    (cause): Effect.Effect<never, Failure | InternalError> =>
      procedureOutcome(Exit.failCause(cause)).kind === "unexpected"
        ? Effect.fail(new InternalError({}))
        : Effect.failCause(cause)
  );

/** `Retry-After` for a rate-limited answer that knows when to retry. */
const retryAfterSeconds = (outcome: ProcedureOutcome) =>
  outcome.kind === "fault" &&
  outcome.fault._tag === "RateLimited" &&
  outcome.fault.retryAfterSeconds !== undefined
    ? Math.max(0, Math.ceil(outcome.fault.retryAfterSeconds))
    : undefined;

/**
 * What the endpoint's response carries beyond its body: each cookie a procedure set as its own
 * `Set-Cookie` line, and `Retry-After` on a rate-limited answer. Applied as the response is sent,
 * after HttpApi has encoded a success or a fault.
 */
const responseExtras = (
  cookies: readonly Cookies.Cookie[],
  retryAfter: () => number | undefined
) =>
  HttpEffect.appendPreResponseHandler((_request, response) => {
    const seconds = retryAfter();
    const withCookies = HttpServerResponse.mergeCookies(
      response,
      Cookies.fromIterable(cookies)
    );
    return Effect.succeed(
      seconds === undefined
        ? withCookies
        : HttpServerResponse.setHeader(
            withCookies,
            "retry-after",
            String(seconds)
          )
    );
  });

/** Writes the one outcome line and reports a failure; never fails. */
export const writeOutcome = (
  report: ReportProcedureFailure | null,
  fields: ProcedureLogFields,
  outcome: ProcedureOutcome
): Effect.Effect<void> => {
  const line = logProcedureOutcome(fields, outcome);
  return report !== null && isReportable(outcome)
    ? Effect.andThen(line, report({ fields, error: reportedError(outcome) }))
    : line;
};

/**
 * Reports the rows a procedure dropped, one handled event per endpoint, resource type, and
 * failing fields, grouped apart from its failures; never fails.
 */
export const reportDroppedRows = (
  report: ReportProcedureFailure | null,
  fields: ProcedureLogFields,
  rows: readonly DroppedPlanningCenterRow[]
): Effect.Effect<void> =>
  report === null || rows.length === 0
    ? Effect.void
    : Effect.forEach(
        groupDroppedRows(rows),
        (group) =>
          report({
            fields: { ...fields, code: "PROVIDER_ROWS_DROPPED" },
            error: new PlanningCenterRowsDroppedError(group),
          }),
        { discard: true }
      );

/**
 * The non-obvious parts:
 * - Identity comes from the workerd request's own headers (cookie, bearer, account, demo).
 * - Writes run uninterruptibly, so a disconnect cannot cut a provider write or its audit short;
 *   `preparedWrite` reopens the interruptible prepare step.
 * - HttpApi decodes inside middleware, so a request that fails to decode has already passed
 *   the client gate and, on Planning Center groups, session resolution.
 */
export const ProcedureScopeLive = (
  options: ProcedureScopeOptions
): Layer.Layer<ProcedureScope> =>
  Layer.succeed(ProcedureScope)((httpEffect, { endpoint, group }) =>
    Effect.gen(function* procedureScope() {
      const httpRequest = yield* HttpServerRequest.HttpServerRequest;
      const request = yield* HttpServerRequest.toWeb(httpRequest).pipe(
        Effect.orDie
      );
      const isolate = yield* fromRequestFiber(IsolateServer);
      const httpClient = yield* fromRequestFiber(HttpClient.HttpClient);
      const now = options.now ?? Date.now;
      const context = createRequestContext(request);
      const procedure = `${group.identifier}.${endpoint.identifier}`;
      const kind = procedureKindOf(endpoint) ?? "read";
      // Only reads may wait behind the user's own calls; a write is always interactive.
      const priority =
        kind === "read"
          ? parseRequestPriority(request.headers.get(REQUEST_PRIORITY_HEADER))
          : "interactive";
      const client = request.headers.get(CLIENT_HEADER);
      const appRelease = parseAppRelease(
        request.headers.get(APP_RELEASE_HEADER)
      );
      const accounting = new PlanningCenterRequestAccounting({
        requestBudget: options.requestBudget ?? PLANNING_CENTER_REQUEST_CAP,
        priority,
      });
      const call: ProcedureCall = {
        procedure,
        requestId: context.requestId,
        method: request.method,
        route: endpoint.path,
        client,
        appRelease,
        priority,
        kind,
        startedAt: now(),
        accounting,
      };
      const cookies: Cookies.Cookie[] = [];
      let retryAfter: number | undefined;
      yield* responseExtras(cookies, () => retryAfter);
      const gate = isSupportedClient(client)
        ? Effect.void
        : Effect.fail(clientOutdated);
      const program = Effect.andThen(
        gate,
        httpEffect.pipe(
          Effect.catchIf(
            (failure) => HttpApiSchemaError.is(failure),
            (failure) => classifySchemaError(failure)
          ),
          Effect.flatMap(rejectFrameworkAnswer)
        )
      ).pipe(
        Effect.provideService(RequestContext, context),
        Effect.provideService(
          Server,
          serverDependenciesForRequest(isolate.server)
        ),
        Effect.provideService(PlanningCenterAccounting, accounting),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(ResponseCookies, {
          set: (cookie) => {
            cookies.push(cookie);
          },
        }),
        Effect.provideService(PlanningCenterPacing, options.pacer),
        Effect.annotateLogs({ procedure, requestId: context.requestId }),
        Effect.withSpan(`api.${procedure}`, {
          attributes: {
            "api.procedure": procedure,
            "request.id": context.requestId,
          },
        }),
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            const outcome = procedureOutcome(exit);
            retryAfter = retryAfterSeconds(outcome);
            const fields = procedureLogFields(call, outcome, now());
            return Effect.andThen(
              writeOutcome(isolate.report, fields, outcome),
              reportDroppedRows(isolate.report, fields, accounting.droppedRows)
            );
          })
        ),
        hideUnexpected
      );
      return yield* kind === "write"
        ? Effect.uninterruptible(program)
        : program;
    })
  );
