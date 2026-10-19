import { createPostHogCaptureSender } from "@pcobooster/api/modules/analytics/posthog-capture";
import type { PostHogCaptureBody } from "@pcobooster/api/modules/analytics/posthog-capture";
import { InvalidInput } from "@pcobooster/contracts/faults/invalid-input";

const EXCEPTION_MESSAGE_MAX_LENGTH = 500;
const STACK_FRAME =
  /^\s*at (?:(?<fn>.+?) \()?(?<file>[^()]+?):(?<line>\d+):(?<col>\d+)\)?$/u;
/** API exceptions are not tied to a person: the handler would need a session lookup. */
const SERVER_DISTINCT_ID = "pcobooster-api";

/**
 * A 5xx procedure failure or provider-confirmed validation rejection of a write.
 */
export interface ReportedRequestError {
  readonly error: Error;
  /** The answer's code (`BAD_GATEWAY`), or `UNHANDLED` for a defect. */
  readonly code: string;
  /** The endpoint's route template, such as `/api/v1/plan-people/:planPersonId`, so issues group by it. */
  readonly path: string;
  readonly method: string;
  readonly requestId: string;
  readonly procedure: string | null;
}

interface ExceptionFrame {
  readonly platform: "node:javascript";
  readonly filename: string;
  readonly function: string;
  readonly lineno: number;
  readonly colno: number;
  readonly in_app: boolean;
}

const parseStackFrames = (stack: string | undefined): ExceptionFrame[] => {
  if (stack === undefined) {
    return [];
  }
  const frames: ExceptionFrame[] = [];
  for (const line of stack.split("\n")) {
    const groups = STACK_FRAME.exec(line)?.groups;
    if (groups?.file !== undefined) {
      frames.push({
        platform: "node:javascript",
        filename: groups.file,
        function: groups.fn ?? "<anonymous>",
        lineno: Number(groups.line),
        colno: Number(groups.col),
        in_app: !groups.file.includes("node_modules"),
      });
    }
  }
  // PostHog expects the outermost frame first, as V8 lists them last.
  return frames.toReversed();
};

/** The underlying cause explains a 5xx better than the fault wrapping it. */
const rootCause = (error: Error): Error =>
  error.cause instanceof Error ? error.cause : error;

interface ExceptionEntry {
  readonly type: string;
  readonly value: string;
  readonly mechanism: {
    readonly handled: true;
    readonly synthetic: false;
    readonly type: "rpc";
  };
  stacktrace?: { readonly type: "raw"; readonly frames: ExceptionFrame[] };
}

interface ProviderExceptionProperties {
  provider?: "planning-center";
  provider_status?: 422;
  provider_errors?: NonNullable<InvalidInput["providerRejection"]>["errors"];
}

const toExceptionEntry = (cause: Error): ExceptionEntry => {
  const entry: ExceptionEntry = {
    type: cause.name,
    value: cause.message.slice(0, EXCEPTION_MESSAGE_MAX_LENGTH),
    mechanism: { handled: true, synthetic: false, type: "rpc" },
  };
  const frames = parseStackFrames(cause.stack);
  if (frames.length > 0) {
    entry.stacktrace = { type: "raw", frames };
  }
  return entry;
};

export const toPostHogExceptionCapture = (
  apiKey: string,
  reported: ReportedRequestError,
  now: Date
): PostHogCaptureBody => {
  const rejection =
    reported.error instanceof InvalidInput
      ? reported.error.providerRejection
      : undefined;
  const code = rejection === undefined ? reported.code : "PROVIDER_REJECTED";
  const exception =
    rejection === undefined
      ? toExceptionEntry(rootCause(reported.error))
      : {
          type: "ProviderRejected",
          value: "Planning Center rejected a write",
          mechanism: { handled: true, synthetic: false, type: "rpc" },
        };
  const providerProperties: ProviderExceptionProperties = {};
  if (rejection !== undefined) {
    providerProperties.provider = "planning-center";
    providerProperties.provider_status = 422;
    providerProperties.provider_errors = rejection.errors;
  }
  const properties = {
    ...providerProperties,
    source: "server",
    $process_person_profile: false,
    $exception_level: "error",
    $exception_list: [exception],
    // One issue per procedure and failure kind, so varying messages don't split it.
    $exception_fingerprint: `api:${reported.path}:${code}`,
    error_code: code,
    path: reported.path,
    method: reported.method,
    request_id: reported.requestId,
    procedure: reported.procedure,
    operation: reported.procedure,
  };
  return {
    api_key: apiKey,
    event: "$exception",
    distinct_id: SERVER_DISTINCT_ID,
    timestamp: now.toISOString(),
    properties,
  };
};

export type ReportRequestError = (
  reported: ReportedRequestError
) => Promise<void>;

/** Null when the stage has no PostHog project, which is every stage but production. */
export const createPostHogExceptionReporter = ({
  apiKey,
  fetch: send,
  now = () => new Date(),
}: {
  apiKey: string | null | undefined;
  fetch: typeof globalThis.fetch;
  now?: () => Date;
}): ReportRequestError | null => {
  if (apiKey === null || apiKey === undefined || apiKey === "") {
    return null;
  }
  const sendCapture = createPostHogCaptureSender(send);
  return async (reported) => {
    await sendCapture(toPostHogExceptionCapture(apiKey, reported, now()));
  };
};
