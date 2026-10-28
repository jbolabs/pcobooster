import { createHash } from "node:crypto";

import { moduleLog } from "@pcobooster/api/logging";
import { PlanningCenterAccounting } from "@pcobooster/api/planning-center/accounting";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import type { PlanningCenterRateLimitInfo } from "@pcobooster/api/planning-center/api-error";
import { PlanningCenterNetworkError } from "@pcobooster/api/planning-center/network-error";
import { PlanningCenterPacing } from "@pcobooster/api/planning-center/pacing";
import { PlanningCenterPaginationError } from "@pcobooster/api/planning-center/pagination-error";
import { PlanningCenterRateLimitError } from "@pcobooster/api/planning-center/rate-limit-error";
import {
  DEFAULT_MAX_RATE_LIMIT_WAIT_MS,
  PLANNING_CENTER_WINDOW_WAIT_MS,
} from "@pcobooster/api/planning-center/rate-pacer";
import type { PlanningCenterRatePacer } from "@pcobooster/api/planning-center/rate-pacer";
import { PlanningCenterReadOnlyError } from "@pcobooster/api/planning-center/read-only-error";
import type {
  PlanningCenterEndpoint,
  PlanningCenterRequestAccounting,
} from "@pcobooster/api/planning-center/request-accounting";
import {
  pcCollectionResponseSchema,
  pcResourceResponseSchema,
} from "@pcobooster/api/planning-center/resource-schemas";
import {
  PlanningCenterSubrequestLimitError,
  isTooManySubrequestsError,
} from "@pcobooster/api/planning-center/subrequest-limit-error";
import { PLANNING_CENTER_USER_AGENT } from "@pcobooster/api/planning-center/user-agent";
import type { RequestPriority } from "@pcobooster/contracts/request-priority";
import {
  isNonEmptyString,
  isString,
} from "@pcobooster/planning-center-models/json";
import type {
  JsonObject,
  JsonValue,
} from "@pcobooster/planning-center-models/json";
import type {
  PCApiResponse,
  PCResource,
} from "@pcobooster/planning-center-models/types";
import {
  Clock,
  Duration,
  Effect,
  Exit,
  Option,
  Result,
  Schedule,
  Schema,
} from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import type { HttpClientError } from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { HttpClientResponse } from "effect/http/HttpClientResponse";
import type { HttpMethod } from "effect/http/HttpMethod";

const log = moduleLog("planning-center/core");
const PC_BASE_URL = "https://api.planningcenteronline.com";
/** Each attempt (request, error body, and rate-limit pause) and its JSON body share this budget. */
const ATTEMPT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const MS_PER_SECOND = 1000;
const errorBodySchema = Schema.Record(Schema.String, Schema.MutableJson);
type ErrorBody = typeof errorBodySchema.Type;
const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(errorBodySchema)
);

/** Every expected Planning Center failure; anything else is a defect. */
export type PlanningCenterError =
  | PlanningCenterApiError
  | PlanningCenterNetworkError
  | PlanningCenterPaginationError
  | PlanningCenterRateLimitError
  | PlanningCenterReadOnlyError
  | PlanningCenterSubrequestLimitError;

/** Failures that can come from one attempt; only some are retried. */
type AttemptError =
  | PlanningCenterApiError
  | PlanningCenterNetworkError
  | PlanningCenterRateLimitError
  | PlanningCenterSubrequestLimitError;

export const isPlanningCenterError = (
  value: unknown
): value is PlanningCenterError =>
  value instanceof PlanningCenterApiError ||
  value instanceof PlanningCenterNetworkError ||
  value instanceof PlanningCenterPaginationError ||
  value instanceof PlanningCenterRateLimitError ||
  value instanceof PlanningCenterReadOnlyError ||
  value instanceof PlanningCenterSubrequestLimitError;

type ResponseHeaders = HttpClientResponse["headers"];

/** Planning Center's largest page; every collection read asks for it. */
export const PLANNING_CENTER_PAGE_SIZE = 100;

/**
 * Pages after the first that one collection read requests at once. Workers keep six
 * connections open per invocation and queue the rest, so more would only wait.
 */
const PAGE_READ_CONCURRENCY = 6;

/**
 * The links to the pages after `first`, up to `maxPages` in all, when the first page says
 * how many records the collection holds and its next link pages by our page size. Each link
 * is Planning Center's own next link with only its offset changed, so the pages read are
 * the ones following the links one by one would read. Anything else returns no links, and
 * the caller follows the next links instead.
 */
const followingPageUrls = (
  first: PCApiResponse<PCResource[]>,
  maxPages: number
): string[] => {
  const total = first.meta?.total_count;
  const next = first.links?.next;
  if (total === undefined || !isNonEmptyString(next)) {
    return [];
  }
  const nextUrl = new URL(next, PC_BASE_URL);
  if (
    Number(nextUrl.searchParams.get("offset")) !== PLANNING_CENTER_PAGE_SIZE
  ) {
    return [];
  }
  const pages = Math.min(
    Math.ceil(total / PLANNING_CENTER_PAGE_SIZE),
    maxPages
  );
  return Array.from({ length: Math.max(0, pages - 1) }, (_, index) => {
    const url = new URL(nextUrl);
    url.searchParams.set(
      "offset",
      String((index + 1) * PLANNING_CENTER_PAGE_SIZE)
    );
    return url.toString();
  });
};

/** One page of a collection, and the offset of the next when there is one. */
export interface PlanningCenterPage {
  readonly data: PCResource[];
  readonly included: PCResource[];
  readonly nextOffset: number | null;
}

/** The first pages of a collection, and the next page's link when it goes on. */
export interface PlanningCenterPages {
  readonly data: PCResource[];
  readonly included: PCResource[];
  readonly next: string | null;
}

interface SentResponse {
  readonly response: HttpClientResponse;
  readonly startedAt: number;
}

const endpointUrl = (endpoint: string): string =>
  new URL(endpoint, PC_BASE_URL).toString();

const invalidProviderResponse = (
  status: number,
  cause: unknown
): PlanningCenterApiError =>
  new PlanningCenterApiError({
    message: "Planning Center returned an invalid response",
    status,
    code: "INVALID_RESPONSE",
    cause,
  });

const attemptTimedOut = (): PlanningCenterNetworkError =>
  new PlanningCenterNetworkError({
    cause: new DOMException(
      "Planning Center request timed out",
      "TimeoutError"
    ),
  });

const networkFailure = (error: HttpClientError): PlanningCenterNetworkError =>
  new PlanningCenterNetworkError({ cause: error.cause ?? error });

/** What one attempt knows about its request and invocation. */
interface AttemptContext {
  readonly accounting: PlanningCenterRequestAccounting | undefined;
  readonly pacer: PlanningCenterRatePacer | undefined;
  readonly endpoint: PlanningCenterEndpoint;
  /** 1 for the first attempt. */
  readonly attempt: number;
  /** A write's attributes as `describeSentAttributes` logs them. */
  readonly sentAttributes?: JsonObject;
  readonly readAction?: true;
}

export const buildPlanningCenterUrl = (
  endpoint: string,
  params: Record<string, string> = {}
): string => {
  const url = new URL(endpoint, PC_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  return url.toString();
};

const isReadMethod = (method: HttpMethod): boolean =>
  method === "GET" || method === "HEAD";

/**
 * Longest rate-limit wait a read resends after. An interactive read waits out up to one
 * window: resending costs one request, while failing hands the browser a retry that reruns
 * the whole procedure and every request it already made. Speculative reads fail fast, so
 * work nobody is waiting on never holds a connection through a window.
 */
const readRateLimitWaitCapMs = (priority: RequestPriority): number =>
  priority === "speculative"
    ? DEFAULT_MAX_RATE_LIMIT_WAIT_MS
    : PLANNING_CENTER_WINDOW_WAIT_MS;

const exceedsRetryAfterCap = (
  retryAfterSeconds: number | undefined,
  priority: RequestPriority
): boolean =>
  retryAfterSeconds !== undefined &&
  retryAfterSeconds * MS_PER_SECOND > readRateLimitWaitCapMs(priority);

const isRetryableError = (
  error: AttemptError,
  priority: RequestPriority
): boolean => {
  if (error instanceof PlanningCenterApiError) {
    return (
      RETRYABLE_STATUS_CODES.has(error.status) &&
      !(
        error.status === 429 &&
        exceedsRetryAfterCap(error.retryAfterSeconds, priority)
      )
    );
  }
  if (error instanceof PlanningCenterRateLimitError) {
    // The pacer sent nothing, so waiting out its block costs no budget. A speculative
    // hold-back is the caller's to resend at interactive priority.
    return (
      error.reason === "budget" &&
      !exceedsRetryAfterCap(error.retryAfterSeconds, priority)
    );
  }
  if (!(error instanceof PlanningCenterNetworkError)) {
    return false;
  }
  const { cause } = error;
  return (
    cause instanceof Error &&
    (cause.name === "AbortError" || cause.name === "TimeoutError")
  );
};

/** `retry` is 1 for the first retry. */
const retryDelayMs = (retry: number, error: AttemptError): number => {
  if (error instanceof PlanningCenterRateLimitError) {
    return Math.max(error.retryAfterSeconds, 1) * MS_PER_SECOND;
  }
  if (!(error instanceof PlanningCenterApiError)) {
    return retry * 300;
  }
  if (error.status === 429 && error.retryAfterSeconds !== undefined) {
    return Math.max(error.retryAfterSeconds, 1) * MS_PER_SECOND;
  }
  return retry * 500;
};

const describePlanningCenterEndpoint = (
  value: string
): PlanningCenterEndpoint => {
  const url = new URL(value, PC_BASE_URL);
  return {
    path: url.pathname,
    queryKeys: [...url.searchParams.keys()].toSorted(),
  };
};

/** A 429 or pacer rejection, whose `info` line comes from the attempt. */
const isRateLimited = (error: AttemptError): boolean =>
  error instanceof PlanningCenterRateLimitError ||
  (error instanceof PlanningCenterApiError && error.status === 429);

/**
 * Idempotent reads retry transient failures; writes retry only a 429 (see
 * `rateLimitedWriteRetry`). A read's 429 or pacer rejection is retried only
 * when its Retry-After fits `readRateLimitWaitCapMs`.
 */
const transientReadRetries = (
  endpoint: PlanningCenterEndpoint,
  method: HttpMethod,
  priority: RequestPriority
) =>
  Schedule.recurs(MAX_RETRIES).pipe(
    Schedule.setInputType<AttemptError>(),
    Schedule.while(({ input }) => isRetryableError(input, priority)),
    Schedule.addDelay(({ attempt, input }) => {
      const delayMs = retryDelayMs(attempt, input);
      const delay = Effect.succeed(Duration.millis(delayMs));
      return isRateLimited(input)
        ? delay
        : Effect.andThen(
            log.warn("Planning Center request failed, retrying", {
              endpoint,
              method,
              attempt,
              retryDelayMs: delayMs,
              error: input.message.slice(0, 100),
            }),
            delay
          );
    })
  );

/**
 * Planning Center answers 429 before acting on a request, so resending a rate-limited write
 * cannot apply it twice. It is resent once, when its Retry-After fits the write wait cap.
 */
const isRetryableWriteRateLimit = (error: AttemptError): boolean =>
  error instanceof PlanningCenterApiError &&
  error.status === 429 &&
  (error.retryAfterSeconds ?? 0) * MS_PER_SECOND <=
    PLANNING_CENTER_WINDOW_WAIT_MS;

const MAX_WRITE_RATE_LIMIT_RETRIES = 1;

const rateLimitedWriteRetry = Schedule.recurs(
  MAX_WRITE_RATE_LIMIT_RETRIES
).pipe(
  Schedule.setInputType<AttemptError>(),
  Schedule.while(({ input }) => isRetryableWriteRateLimit(input)),
  Schedule.addDelay(({ attempt, input }) =>
    Effect.succeed(Duration.millis(retryDelayMs(attempt, input)))
  )
);

const willRetryRateLimit = (
  method: HttpMethod,
  attempt: number,
  error: AttemptError,
  priority: RequestPriority
): boolean =>
  isReadMethod(method)
    ? attempt <= MAX_RETRIES && isRetryableError(error, priority)
    : attempt <= MAX_WRITE_RATE_LIMIT_RETRIES &&
      isRetryableWriteRateLimit(error);

const readIntegerHeader = (
  headers: ResponseHeaders,
  name: string
): number | undefined => {
  const value = headers[name];
  if (!isNonEmptyString(value)) {
    return undefined;
  }
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readRateLimitInfo = (
  headers: ResponseHeaders
): PlanningCenterRateLimitInfo => ({
  limit: readIntegerHeader(headers, "x-pco-api-request-rate-limit"),
  count: readIntegerHeader(headers, "x-pco-api-request-rate-count"),
  period: headers["x-pco-api-request-rate-period"] ?? undefined,
  retryAfterSeconds: readIntegerHeader(headers, "retry-after"),
});

/** Planning Center reports JSON:API errors as `{ errors: [{ code, title, detail }] }`. */
const decodeListedErrorCode = Schema.decodeUnknownOption(
  Schema.Struct({
    errors: Schema.Array(Schema.Struct({ code: Schema.String })).check(
      Schema.isMinLength(1)
    ),
  })
);

/**
 * What a JSON:API error list says went wrong; validation errors put it in `detail` and name
 * the rejected attribute in `source` (`{ parameter: "length" }`), not in the detail itself.
 */
const decodeListedErrors = Schema.decodeUnknownOption(
  Schema.Struct({
    errors: Schema.Array(
      Schema.Struct({
        title: Schema.optional(Schema.String),
        detail: Schema.optional(Schema.String),
        source: Schema.optional(
          Schema.Struct({
            parameter: Schema.optional(Schema.String),
            pointer: Schema.optional(Schema.String),
          })
        ),
      })
    ).check(Schema.isMinLength(1)),
  })
);

/** `length` from `{ parameter: "length" }` or `{ pointer: "/data/attributes/length" }`. */
const rejectedAttribute = (source?: {
  readonly parameter?: string;
  readonly pointer?: string;
}): string | undefined => {
  const name = source?.parameter ?? source?.pointer?.split("/").at(-1);
  return isNonEmptyString(name) ? name : undefined;
};

/** `service_position` reads as "Service position". */
const attributeLabel = (attribute: string): string => {
  const words = attribute.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

/**
 * Each listed error's detail (led by the attribute it names, when the detail doesn't already),
 * or its title when it has none; nothing when `body` is not a JSON:API error list.
 */
export const listedErrorDetails = (body: JsonValue | undefined): string[] =>
  Option.match(decodeListedErrors(body), {
    onNone: () => [],
    onSome: ({ errors }) =>
      errors.flatMap(({ detail, title, source }) => {
        const attribute = rejectedAttribute(source);
        if (isNonEmptyString(detail) && attribute !== undefined) {
          const label = attributeLabel(attribute);
          return detail.toLowerCase().startsWith(label.toLowerCase())
            ? [detail]
            : [`${label} ${detail}`];
        }
        const text = detail ?? title;
        return isNonEmptyString(text) ? [text] : [];
      }),
  });

/** Whole validation phrases with no slot for submitted text; unknown wording stays private. */
const VALUE_FREE_VALIDATION_DETAIL =
  /^(?:can(?: ?not|'t) be longer than \d+ (?:hours?|minutes?|seconds?)|(?:can(?: ?not|'t)|must not) be blank|is (?:invalid|not included in the list|reserved)|has already been taken|must be (?:a number|an integer|(?:greater|less) than(?: or equal to)? -?\d+(?:\.\d+)?|other than -?\d+(?:\.\d+)?)|is too (?:long|short) \((?:maximum|minimum) is \d+ characters?\))$/iu;
const PRIVATE_VALIDATION_DETAIL =
  "Validation failed (detail omitted for privacy)";
const DIAGNOSTIC_ATTRIBUTE = /^[a-z][a-z0-9_]*$/u;

const validationDiagnostic = (
  detail: string | undefined,
  attribute: string | undefined
): string => {
  if (detail === undefined) {
    return "Validation failed";
  }
  const label = attribute === undefined ? undefined : attributeLabel(attribute);
  const phrase =
    label !== undefined &&
    detail.toLowerCase().startsWith(`${label.toLowerCase()} `)
      ? detail.slice(label.length + 1)
      : detail;
  return VALUE_FREE_VALIDATION_DETAIL.test(phrase)
    ? phrase.slice(0, 500)
    : PRIVATE_VALIDATION_DETAIL;
};

/** Only value-free provider diagnostics, never reflected write text or raw response bodies. */
export const listedValidationErrors = (
  body: JsonValue | undefined,
  sentAttributeNames: readonly string[]
) => {
  const sentNames = new Set(sentAttributeNames);
  return Option.match(decodeListedErrors(body), {
    onNone: () => [],
    onSome: ({ errors }) =>
      errors.slice(0, 10).map(({ detail, source }) => {
        const name = rejectedAttribute(source);
        const attribute =
          name !== undefined &&
          sentNames.has(name) &&
          DIAGNOSTIC_ATTRIBUTE.test(name)
            ? name.slice(0, 100)
            : undefined;
        return {
          attribute,
          detail:
            source !== undefined && attribute === undefined
              ? PRIVATE_VALIDATION_DETAIL
              : validationDiagnostic(detail, attribute),
        };
      }),
  });
};

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A write body's attributes fit for logs: numbers, booleans, nulls, and ids as sent, other
 * text only as its length, since titles and notes are the church's own words.
 */
const describeSentAttributes = (
  body: JsonObject | undefined
): JsonObject | undefined => {
  const data = body?.data;
  const attributes =
    isJsonObject(data) && isJsonObject(data.attributes)
      ? data.attributes
      : undefined;
  if (attributes === undefined) {
    return undefined;
  }
  const described: JsonObject = {};
  for (const [key, value] of Object.entries(attributes)) {
    described[key] =
      isString(value) && !key.endsWith("_id")
        ? `<${value.length} characters>`
        : value;
  }
  return described;
};

const errorTitle = (body: ErrorBody): string | undefined => {
  if (isString(body.error)) {
    return body.error;
  }
  if (isString(body.message)) {
    return body.message;
  }
  const details = listedErrorDetails(body);
  return details.length > 0 ? details.join("; ") : undefined;
};

const errorCode = (body: ErrorBody): string | undefined => {
  if (isString(body.code)) {
    return body.code;
  }
  return Option.getOrUndefined(decodeListedErrorCode(body))?.errors[0]?.code;
};

const parseErrorBody = (responseBody: string): ErrorBody | null =>
  Option.getOrNull(decodeErrorBody(responseBody));

const buildApiError = (
  status: number,
  responseBody: string,
  headers: ResponseHeaders,
  method: string,
  isWrite: boolean,
  sentAttributeNames: readonly string[]
): PlanningCenterApiError => {
  let code: string | undefined;
  let details: JsonValue | undefined;
  let message = `Planning Center API error: ${status}`;
  const rateLimit = readRateLimitInfo(headers);
  const errorJson = parseErrorBody(responseBody);
  if (errorJson === null) {
    if (responseBody !== "") {
      message += ` - ${responseBody}`;
    }
  } else {
    code = errorCode(errorJson);
    details = errorJson;
    const title = errorTitle(errorJson);
    if (isNonEmptyString(title)) {
      message += ` - ${title}`;
    }
  }
  return new PlanningCenterApiError({
    message,
    status,
    method,
    isWrite,
    sentAttributeNames,
    code,
    details,
    responseBody,
    rateLimit,
    retryAfterSeconds: rateLimit.retryAfterSeconds,
  });
};

const readResponseText = (
  response: HttpClientResponse
): Effect.Effect<string, PlanningCenterNetworkError> =>
  Effect.mapError(response.text, networkFailure);

/** Parses a JSON body and decodes it, failing with the schema's issue when either step fails. */
type JsonBodyDecoder<Output> = (
  text: string
) => Result.Result<Output, Schema.SchemaError>;

const decodeResourceResponse: JsonBodyDecoder<PCApiResponse<PCResource>> =
  Schema.decodeUnknownResult(Schema.fromJsonString(pcResourceResponseSchema));
const decodeCollectionResponse: JsonBodyDecoder<PCApiResponse<PCResource[]>> =
  Schema.decodeUnknownResult(Schema.fromJsonString(pcCollectionResponseSchema));

/**
 * Reads the JSON body within whatever remains of the attempt's time budget and decodes it with
 * `decode`. The schema is the only validation pass: `JSON.parse` output is JSON by
 * construction, and re-walking a 100-plan page as generic JSON cost ~14 ms of Worker CPU.
 */
const readJsonBody =
  <Output>(decode: JsonBodyDecoder<Output>) =>
  ({
    response,
    startedAt,
  }: SentResponse): Effect.Effect<Output, AttemptError> =>
    Effect.gen(function* readJson() {
      const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
      const text = yield* readResponseText(response).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(
            Math.max(ATTEMPT_TIMEOUT_MS - elapsedMs, 0)
          ),
          orElse: () => Effect.fail(attemptTimedOut()),
        })
      );
      if (response.status === 204 || text.trim() === "") {
        return yield* Effect.fail(
          new PlanningCenterApiError({
            message:
              "Planning Center returned an empty response where JSON was required",
            status: response.status,
            code: "INVALID_RESPONSE",
          })
        );
      }
      const decoded = decode(text);
      if (Result.isFailure(decoded)) {
        return yield* Effect.fail(
          invalidProviderResponse(response.status, decoded.failure)
        );
      }
      return decoded.success;
    });

/** Fails before sending when this invocation may not make another request. */
const ensureSubrequestAvailable = (
  { accounting, endpoint }: AttemptContext,
  method: HttpMethod,
  reserve = false
): Effect.Effect<void, PlanningCenterSubrequestLimitError> =>
  Effect.suspend(() => {
    if (accounting === undefined) {
      return Effect.void;
    }
    const requests = accounting.requestCount;
    if (accounting.subrequestLimitReached) {
      return Effect.fail(
        new PlanningCenterSubrequestLimitError({ source: "worker", requests })
      );
    }
    const limit = accounting.requestBudget;
    if (limit === undefined || requests < limit) {
      // Check and charge in the same synchronous turn: paced callers may wake together.
      if (reserve) {
        accounting.recordRequest();
      }
      return Effect.void;
    }
    accounting.recordSubrequestLimit("budget");
    return Effect.andThen(
      log.info("Planning Center request budget for this invocation is spent", {
        endpoint,
        method,
        requests,
        requestBudget: limit,
      }),
      Effect.fail(
        new PlanningCenterSubrequestLimitError({
          source: "budget",
          requests,
          limit,
          rateLimitedResponses: accounting.totals.rateLimited,
        })
      )
    );
  });

/** Cloudflare's subrequest cap is final for the invocation, so it is not a network error. */
const transportFailure = (
  error: HttpClientError,
  { accounting }: AttemptContext
): PlanningCenterNetworkError | PlanningCenterSubrequestLimitError => {
  const cause = error.cause ?? error;
  if (!isTooManySubrequestsError(cause)) {
    return networkFailure(error);
  }
  accounting?.recordSubrequestLimit("worker");
  return new PlanningCenterSubrequestLimitError({
    source: "worker",
    requests: accounting?.requestCount ?? 0,
    cause,
  });
};

const logWorkerSubrequestLimit = (
  failure: PlanningCenterNetworkError | PlanningCenterSubrequestLimitError,
  { endpoint }: AttemptContext,
  method: HttpMethod
): Effect.Effect<void> =>
  failure instanceof PlanningCenterSubrequestLimitError
    ? log.warn(
        "Cloudflare refused a Planning Center request: too many subrequests",
        { endpoint, method, requests: failure.requests }
      )
    : Effect.void;

/**
 * Reserves a pacer slot and returns how long to wait before sending. A
 * rejection reserves nothing, so it must not be released.
 */
const reserveSlot = (
  pacer: PlanningCenterRatePacer,
  scope: string,
  { accounting, endpoint, attempt }: AttemptContext,
  method: HttpMethod
): Effect.Effect<number, PlanningCenterRateLimitError> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => {
      const priority = accounting?.priority ?? "interactive";
      const decision = pacer.reserve(
        scope,
        now,
        isReadMethod(method) ? "read" : "write",
        priority
      );
      if (decision.kind === "reject") {
        accounting?.recordRateLimitRejection();
        return Effect.andThen(
          log.info(
            decision.reason === "speculative"
              ? "Planning Center speculative request held back: budget kept for interactive requests"
              : "Planning Center request rejected: rate limit budget is spent",
            {
              endpoint,
              method,
              attempt,
              priority,
              retryAfterMs: decision.retryAfterMs,
              rateLimit: decision.window,
            }
          ),
          Effect.fail(
            new PlanningCenterRateLimitError({
              retryAfterSeconds: Math.ceil(
                decision.retryAfterMs / MS_PER_SECOND
              ),
              reason: decision.reason,
            })
          )
        );
      }
      if (decision.waitMs === 0) {
        return Effect.succeed(0);
      }
      accounting?.recordPaced(decision.waitMs);
      return Effect.as(
        log.info("Planning Center request paced", {
          endpoint,
          method,
          attempt,
          waitMs: decision.waitMs,
          rateLimit: decision.window,
        }),
        decision.waitMs
      );
    })
  );

/** A Planning Center personal access token: application ID plus secret. */
export interface PlanningCenterPersonalAccessToken {
  readonly applicationId: string;
  readonly secret: string;
}

export type PlanningCenterAuthentication =
  | ({ readonly kind: "basic" } & PlanningCenterPersonalAccessToken)
  | { readonly kind: "bearer"; readonly accessToken: string };

export interface PlanningCenterCoreClientOptions {
  /** Sends every request; the Worker provides `FetchHttpClient`. */
  readonly httpClient: HttpClient.HttpClient;
  /** Rejects every non-read request before it reaches Planning Center. */
  readonly readOnly?: boolean;
}

export interface PlanningCenterRequestOptions {
  readonly method?: HttpMethod;
  /** Sent as the `application/json` request body. */
  readonly body?: JsonObject;
  /**
   * The request is a Planning Center action that only returns data, such as an
   * attachment's `open`, so a read-only client may send it despite its method.
   */
  readonly readAction?: true;
}

/**
 * Binds one credential to its Authorization header and cache scope for its entire lifetime.
 * Interrupting a returned Effect aborts its in-flight fetch.
 *
 * Requests read two optional services from the Effect context: the isolate's
 * `PlanningCenterPacing`, which paces this credential's requests by cache
 * scope, and the procedure's `PlanningCenterAccounting`, which counts them and
 * may cap them. Without either, requests are sent unpaced and uncounted.
 */
export class PlanningCenterCoreClient {
  private readonly authorization: string;
  private readonly cacheScope: string;
  private readonly httpClient: HttpClient.HttpClient;
  private readonly readOnly: boolean;

  constructor(
    auth: PlanningCenterAuthentication,
    options: PlanningCenterCoreClientOptions
  ) {
    if (auth.kind === "bearer" && !isNonEmptyString(auth.accessToken.trim())) {
      throw new Error(
        "Planning Center bearer authentication requires a non-empty access token"
      );
    }
    if (
      auth.kind === "basic" &&
      !(
        isNonEmptyString(auth.applicationId.trim()) &&
        isNonEmptyString(auth.secret.trim())
      )
    ) {
      throw new Error(
        "Planning Center basic authentication requires an application ID and secret"
      );
    }
    const credential =
      auth.kind === "bearer"
        ? auth.accessToken
        : `${auth.applicationId}:${auth.secret}`;
    this.authorization =
      auth.kind === "bearer"
        ? `Bearer ${auth.accessToken}`
        : `Basic ${Buffer.from(credential).toString("base64")}`;
    this.cacheScope = `${auth.kind}:${createHash("sha256").update(credential).digest("hex")}`;
    // Trace headers would leak internal span IDs to a third party.
    this.httpClient = HttpClient.transform(options.httpClient, (effect) =>
      effect.pipe(
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        // Canonical API URLs must answer directly; implicit redirect hops evade accounting.
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "manual",
        })
      )
    );
    this.readOnly = options.readOnly ?? false;
  }

  getCacheScope(): string {
    return this.cacheScope;
  }

  private attempt(
    request: HttpClientRequest.HttpClientRequest,
    context: AttemptContext
  ): Effect.Effect<SentResponse, AttemptError> {
    const { cacheScope, httpClient } = this;
    const { method } = request;
    const isWrite = !isReadMethod(method) && context.readAction !== true;
    const { accounting, endpoint, pacer } = context;
    const execute = Effect.gen(function* sendRequest() {
      const startedAt = yield* Clock.currentTimeMillis;
      yield* ensureSubrequestAvailable(context, method, true);
      const response = yield* httpClient.execute(request).pipe(
        Effect.mapError((error) => transportFailure(error, context)),
        Effect.tapError((failure) =>
          logWorkerSubrequestLimit(failure, context, method)
        )
      );
      return { response, startedAt };
    });
    const paced =
      pacer === undefined
        ? execute
        : Effect.acquireUseRelease(
            reserveSlot(pacer, cacheScope, context, method),
            (waitMs) =>
              waitMs === 0
                ? execute
                : Effect.andThen(
                    Effect.sleep(Duration.millis(waitMs)),
                    execute
                  ),
            // A granted reservation is released after the response, a
            // failure, or an interruption; responses also report the window.
            (_waitMs, exit) =>
              Effect.gen(function* releaseSlot() {
                const now = yield* Clock.currentTimeMillis;
                pacer.complete(
                  cacheScope,
                  now,
                  Exit.isSuccess(exit)
                    ? {
                        status: exit.value.response.status,
                        rateLimit: readRateLimitInfo(
                          exit.value.response.headers
                        ),
                      }
                    : undefined
                );
              })
          );
    return Effect.gen(function* attemptRequest() {
      yield* ensureSubrequestAvailable(context, method);
      const sent = yield* paced;
      const { response } = sent;
      if (response.status >= 200 && response.status < 300) {
        return sent;
      }
      const responseBody = yield* readResponseText(response);
      const error = buildApiError(
        response.status,
        responseBody,
        response.headers,
        method,
        isWrite,
        Object.keys(context.sentAttributes ?? {})
      );
      if (error.status === 429) {
        accounting?.recordRateLimited();
        yield* log.info("Planning Center rate limited a request", {
          endpoint,
          method,
          attempt: context.attempt,
          retryAfterSeconds: error.retryAfterSeconds,
          rateLimit: error.rateLimit,
          willRetry: willRetryRateLimit(
            method,
            context.attempt,
            error,
            accounting?.priority ?? "interactive"
          ),
        });
      } else if (isWrite) {
        // Retain provider details and redacted inputs independently of the user-facing message.
        yield* log.warn("Planning Center rejected a write", {
          endpoint,
          method,
          status: error.status,
          errors: error.details,
          sentAttributes: context.sentAttributes,
        });
      }
      return yield* Effect.fail(error);
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(ATTEMPT_TIMEOUT_MS),
        orElse: () => Effect.fail(attemptTimedOut()),
      })
    );
  }

  private send(
    endpoint: string,
    options: PlanningCenterRequestOptions
  ): Effect.Effect<SentResponse, PlanningCenterError> {
    const method = options.method ?? "GET";
    const url = endpointUrl(endpoint);
    const description = describePlanningCenterEndpoint(url);
    if (this.readOnly && !isReadMethod(method) && options.readAction !== true) {
      return Effect.fail(
        new PlanningCenterReadOnlyError({ method, path: description.path })
      );
    }
    const headers = HttpClientRequest.setHeaders({
      Accept: "application/json",
      Authorization: this.authorization,
      "User-Agent": PLANNING_CENTER_USER_AGENT,
    });
    const request =
      options.body === undefined
        ? headers(HttpClientRequest.make(method)(url))
        : HttpClientRequest.bodyText(
            headers(HttpClientRequest.make(method)(url)),
            JSON.stringify(options.body),
            "application/json"
          );
    const sentAttributes = describeSentAttributes(options.body);
    const { cacheScope } = this;
    const attemptRequest = (context: AttemptContext) => {
      const attempt = this.attempt(request, {
        ...context,
        sentAttributes,
        readAction: options.readAction,
      });
      // The permit comes before the pacing slot, so a queued request is paced by what the
      // responses ahead of it reported (a 429's block included), and its wait for a permit
      // does not count against the attempt's timeout.
      return context.pacer === undefined
        ? attempt
        : context.pacer.withSendPermit(cacheScope, attempt);
    };
    return Effect.gen(function* sendWithRetries() {
      const pacer = Option.getOrUndefined(
        yield* Effect.serviceOption(PlanningCenterPacing)
      );
      const accounting = Option.getOrUndefined(
        yield* Effect.serviceOption(PlanningCenterAccounting)
      );
      let attempt = 0;
      const nextAttempt = Effect.suspend(() => {
        attempt += 1;
        return attemptRequest({
          accounting,
          pacer,
          endpoint: description,
          attempt,
        });
      });
      return yield* isReadMethod(method)
        ? Effect.retry(
            nextAttempt,
            transientReadRetries(
              description,
              method,
              accounting?.priority ?? "interactive"
            )
          )
        : Effect.retry(nextAttempt, rateLimitedWriteRetry);
    });
  }

  /** Sends a request whose body is not needed, such as a DELETE. */
  request(
    endpoint: string,
    options: PlanningCenterRequestOptions = {}
  ): Effect.Effect<HttpClientResponse, PlanningCenterError> {
    return Effect.map(this.send(endpoint, options), ({ response }) => response);
  }

  private fetchJson<Output>(
    endpoint: string,
    options: PlanningCenterRequestOptions,
    decode: JsonBodyDecoder<Output>
  ): Effect.Effect<Output, PlanningCenterError> {
    return Effect.flatMap(this.send(endpoint, options), readJsonBody(decode));
  }

  fetch(
    endpoint: string,
    options: PlanningCenterRequestOptions = {}
  ): Effect.Effect<PCApiResponse<PCResource>, PlanningCenterError> {
    return this.fetchJson(endpoint, options, decodeResourceResponse);
  }

  fetchCollection(
    endpoint: string,
    options: PlanningCenterRequestOptions = {}
  ): Effect.Effect<PCApiResponse<PCResource[]>, PlanningCenterError> {
    return this.fetchJson(endpoint, options, decodeCollectionResponse);
  }

  /** Every page of a collection; fails rather than return part of it past `maxPages`. */
  fetchAll(
    endpoint: string,
    params: Record<string, string> = {},
    maxPages = 10
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    return Effect.map(
      this.fetchAllWithIncluded(endpoint, params, maxPages),
      ({ data }) => data
    );
  }

  /**
   * Every page of a collection with its included resources, deduplicated. A collection longer
   * than `maxPages` fails with `PlanningCenterPaginationError`; callers that only need its start
   * read `fetchFirstPages` instead.
   */
  fetchAllWithIncluded(
    endpoint: string,
    params: Record<string, string> = {},
    maxPages = 5
  ): Effect.Effect<
    { data: PCResource[]; included: PCResource[] },
    PlanningCenterError
  > {
    return Effect.flatMap(
      this.fetchFirstPages(endpoint, params, maxPages),
      ({ data, included, next }) =>
        next === null
          ? Effect.succeed({ data, included })
          : Effect.fail(
              new PlanningCenterPaginationError({
                reason: "page-limit",
                path: describePlanningCenterEndpoint(endpoint).path,
                pages: maxPages,
              })
            )
    );
  }

  /**
   * At most `maxPages` pages from the start of a collection, for reads whose order puts what
   * they need first. `next` is the following page's link when the collection goes on. When
   * the first page reports the collection's size, the pages after it are read together
   * rather than one after another; a collection that grew meanwhile is followed on by link.
   */
  fetchFirstPages(
    endpoint: string,
    params: Record<string, string> = {},
    maxPages = 5
  ): Effect.Effect<PlanningCenterPages, PlanningCenterError> {
    const fetchPage = (url: string) => this.fetchCollection(url);
    return Effect.gen(function* fetchPages() {
      const data: PCResource[] = [];
      const included: PCResource[] = [];
      const seenIncluded = new Set<string>();
      const seenUrls = new Set<string>();
      let pages = 0;
      let url: string | null = buildPlanningCenterUrl(endpoint, {
        ...params,
        per_page: String(PLANNING_CENTER_PAGE_SIZE),
      });
      /** Keeps a page's records and returns its next link. */
      const collect = (
        response: PCApiResponse<PCResource[]>
      ): string | null => {
        data.push(...response.data);
        for (const resource of response.included ?? []) {
          const key = `${resource.type}:${resource.id}`;
          if (!seenIncluded.has(key)) {
            seenIncluded.add(key);
            included.push(resource);
          }
        }
        const nextUrl: string | undefined = response.links?.next;
        return isNonEmptyString(nextUrl) ? nextUrl : null;
      };
      while (url !== null && pages < maxPages) {
        if (seenUrls.has(url)) {
          return yield* Effect.fail(
            new PlanningCenterPaginationError({
              reason: "invalid-next",
              path: describePlanningCenterEndpoint(url).path,
              pages,
            })
          );
        }
        seenUrls.add(url);
        pages += 1;
        const response: PCApiResponse<PCResource[]> = yield* fetchPage(url);
        url = collect(response);
        const following =
          pages === 1 ? followingPageUrls(response, maxPages) : [];
        if (following.length > 0) {
          const responses = yield* Effect.forEach(following, fetchPage, {
            concurrency: PAGE_READ_CONCURRENCY,
          });
          for (const page of responses) {
            url = collect(page);
          }
          for (const followingUrl of following) {
            seenUrls.add(followingUrl);
          }
          pages += following.length;
        }
      }
      if (url !== null) {
        yield* log.info("Planning Center read stopped at its page limit", {
          endpoint: describePlanningCenterEndpoint(endpoint),
          pages,
        });
      }
      return { data, included, next: url };
    });
  }

  /**
   * One page of a collection from `offset`. `nextOffset` comes from Planning Center's next
   * link, so a caller can resume the collection in a later invocation from its endpoint and
   * an offset alone, never from a link a client sent.
   */
  fetchPage(
    endpoint: string,
    params: Record<string, string>,
    offset: number
  ): Effect.Effect<PlanningCenterPage, PlanningCenterError> {
    const firstPage = {
      ...params,
      per_page: String(PLANNING_CENTER_PAGE_SIZE),
    };
    const url = buildPlanningCenterUrl(
      endpoint,
      offset > 0 ? { ...firstPage, offset: String(offset) } : firstPage
    );
    return Effect.flatMap(
      this.fetchCollection(url),
      (response): Effect.Effect<PlanningCenterPage, PlanningCenterError> => {
        const next = response.links?.next;
        if (!isNonEmptyString(next)) {
          return Effect.succeed({
            data: response.data,
            included: response.included ?? [],
            nextOffset: null,
          });
        }
        const nextOffset = Number(
          new URL(next, PC_BASE_URL).searchParams.get("offset")
        );
        return Number.isSafeInteger(nextOffset) && nextOffset > offset
          ? Effect.succeed({
              data: response.data,
              included: response.included ?? [],
              nextOffset,
            })
          : Effect.fail(
              new PlanningCenterPaginationError({
                reason: "invalid-next",
                path: describePlanningCenterEndpoint(url).path,
                pages: 1,
              })
            );
      }
    );
  }
}

/** Explicit application credentials for scripts and the development auth bypass. */
export const createBasicPlanningCenterClient = (
  token: PlanningCenterPersonalAccessToken,
  httpClient: HttpClient.HttpClient
): PlanningCenterCoreClient =>
  new PlanningCenterCoreClient({ kind: "basic", ...token }, { httpClient });
