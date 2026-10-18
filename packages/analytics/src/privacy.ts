import { Option, Schema } from "effect";
import type { CaptureResult } from "posthog-js";

const PLAN_PATH =
  /^\/services\/[^/]+\/plans\/[^/]+(?:\/(?<view>assign|lineup|plan|times))?\/?$/u;
const OVERVIEW_PATH = /^\/services\/[^/]+\/plans\/[^/]+\/overview\/?$/u;
const SONG_PATH = /^\/songs\/[^/]+\/?$/u;
const PERSON_PATH = /^\/people\/[^/]+\/?$/u;
/** Public key change pages, such as `/key-transitions/g-to-b-flat`; the pair is not private. */
const KEY_TRANSITION_PATH = /^\/key-transitions\/[a-z0-9-]+\/?$/u;
const PUBLIC_PATHS = new Set([
  "/",
  "/about",
  "/key-transitions",
  "/auth",
  "/services",
  "/people",
  "/songs",
]);

export const analyticsPath = (pathname: string): string => {
  const path = pathname.length > 1 ? pathname.replace(/\/$/u, "") : pathname;
  if (PUBLIC_PATHS.has(path) || KEY_TRANSITION_PATH.test(path)) {
    return path;
  }
  const plan = PLAN_PATH.exec(path);
  if (plan) {
    return `/services/:serviceTypeId/plans/:planId/${plan.groups?.view ?? "assign"}`;
  }
  if (OVERVIEW_PATH.test(path)) {
    return "/services/:serviceTypeId/plans/:planId/overview";
  }
  if (SONG_PATH.test(path)) {
    return "/songs/:songId";
  }
  if (PERSON_PATH.test(path)) {
    return "/people/:personId";
  }
  return "/other";
};

/** Neither private demo keys, entity IDs, search text, nor OAuth parameters leave the browser. */
export const analyticsUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.hostname !== "pcobooster.com") {
      return url.origin;
    }
    return `${url.origin}${analyticsPath(url.pathname)}`;
  } catch {
    return "";
  }
};

/** Scalar event properties that leave the browser unchanged. */
export const safeAnalyticsProperties = [
  "token",
  "distinct_id",
  "$device_id",
  "$user_id",
  "$anon_distinct_id",
  "$session_id",
  "$window_id",
  "$pageview_id",
  "$lib",
  "$lib_version",
  "$insert_id",
  "$time",
  "$sent_at",
  "$is_identified",
  "$process_person_profile",
  "$browser",
  "$browser_version",
  "$os",
  "$os_version",
  "$device_type",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$referring_domain",
  "$initial_referring_domain",
  "$host",
  "$session_entry_referring_domain",
  "$session_duration",
  "$prev_pageview_duration",
  "$prev_pageview_last_scroll",
  "$prev_pageview_max_scroll",
  "$prev_pageview_last_scroll_percentage",
  "$prev_pageview_max_scroll_percentage",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "$initial_utm_source",
  "$initial_utm_medium",
  "$initial_utm_campaign",
  "surface",
  "is_authenticated",
  "operation",
  "outcome",
  "error_code",
  "duration_ms",
  "cta_location",
  "$exception_level",
] as const;
const SAFE_PROPERTIES = new Set<string>(safeAnalyticsProperties);
const URL_PROPERTIES = new Set([
  "$current_url",
  "$initial_current_url",
  "$referrer",
  "$initial_referrer",
  "$session_entry_url",
  "$prev_pageview_url",
]);
/** Path properties that leave the browser as route templates. */
export const pathAnalyticsProperties = [
  "$pathname",
  "$initial_pathname",
  "$prev_pageview_pathname",
] as const;
const PATH_PROPERTIES = new Set<string>(pathAnalyticsProperties);

/** Event property keys that saved reports may filter or break down by. */
export type AnalyticsProperty =
  | (typeof safeAnalyticsProperties)[number]
  | (typeof pathAnalyticsProperties)[number];

const propertyBagSchema = Schema.Record(Schema.String, Schema.Unknown);
const isPropertyBag = Schema.is(propertyBagSchema);
const isStringProperty = Schema.is(Schema.String);
const isScalarProperty = Schema.is(
  Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
);
interface AnalyticsProperties {
  [key: string]: string | number | boolean | AnalyticsProperties;
}

/** A closed schema also covers SDK-generated person and session properties. */
export const sanitizeAnalyticsProperties = (
  properties: typeof propertyBagSchema.Type
): AnalyticsProperties => {
  const result: AnalyticsProperties = {};
  if (!isPropertyBag(properties)) {
    return result;
  }
  for (const [key, value] of Object.entries(properties)) {
    if (URL_PROPERTIES.has(key) && isStringProperty(value)) {
      result[key] = analyticsUrl(value);
    } else if (PATH_PROPERTIES.has(key) && isStringProperty(value)) {
      result[key] = analyticsPath(value);
    } else if (key === "$set" || key === "$set_once") {
      if (isPropertyBag(value)) {
        result[key] = sanitizeAnalyticsProperties(value);
      }
    } else if (SAFE_PROPERTIES.has(key) && isScalarProperty(value)) {
      result[key] = value;
    }
  }
  return result;
};

const MARKETING_PATHS = new Set([
  "/",
  "/about",
  "/about/",
  "/key-transitions",
  "/key-transitions/",
]);

export const analyticsSurface = (
  pathname: string
): "marketing" | "auth" | "app" => {
  if (MARKETING_PATHS.has(pathname) || KEY_TRANSITION_PATH.test(pathname)) {
    return "marketing";
  }
  return pathname === "/auth" ? "auth" : "app";
};

export const canInitializeAnalytics = (
  key: string | undefined,
  hostname: string,
  production: boolean
): boolean => production && Boolean(key) && hostname === "pcobooster.com";

/** The only events the browser sends. */
export const analyticsEvents = [
  "$exception",
  "$pageview",
  "$pageleave",
  "$identify",
  "marketing cta clicked",
  "sign in started",
  "sign in failed",
  "app opened",
  "workflow completed",
  "workflow failed",
] as const;
export type AnalyticsEvent = (typeof analyticsEvents)[number];
const EVENTS = new Set<string>(analyticsEvents);

export const canRecordSession = (
  pathname: string,
  authenticated: boolean
): boolean =>
  authenticated &&
  (pathname === "/services" ||
    pathname === "/people" ||
    PLAN_PATH.test(pathname) ||
    PERSON_PATH.test(pathname));

/** Error reporting covers every authenticated product surface without expanding replay. */
export const canReportException = (
  pathname: string,
  authenticated: boolean
): boolean =>
  authenticated && /^\/(?:services|people|songs)(?:\/|$)/u.test(pathname);

const EXCEPTION_MESSAGE_MAX_LENGTH = 500;
const exceptionFrameSchema = Schema.Struct({
  platform: Schema.optional(Schema.String),
  filename: Schema.optional(Schema.String),
  function: Schema.optional(Schema.String),
  lineno: Schema.optional(Schema.Finite),
  colno: Schema.optional(Schema.Finite),
  in_app: Schema.optional(Schema.Boolean),
});
const exceptionListSchema = Schema.Array(
  Schema.Struct({
    type: Schema.optional(Schema.String),
    value: Schema.optional(Schema.String),
    mechanism: Schema.optional(
      Schema.Struct({
        handled: Schema.optional(Schema.Boolean),
        synthetic: Schema.optional(Schema.Boolean),
        type: Schema.optional(Schema.String),
      })
    ),
    stacktrace: Schema.optional(
      Schema.Struct({
        type: Schema.String,
        frames: Schema.Array(exceptionFrameSchema),
      })
    ),
  })
);
const isFiniteNumber = Schema.is(Schema.Finite);

/** Bundled script URLs stay intact so stack frames resolve; other URLs are scrubbed. */
const exceptionFrameFilename = (filename: string): string => {
  try {
    const url = new URL(filename);
    return url.hostname === "pcobooster.com" &&
      url.pathname.startsWith("/assets/")
      ? `${url.origin}${url.pathname}`
      : analyticsUrl(filename);
  } catch {
    return "";
  }
};

/**
 * PostHog's frame builder assigns `lineno` and `colno` even when they are null. `Schema.Finite`
 * rejects null, NaN, and strings, so those coordinates are read separately and omitted.
 */
const rawCoordinateSchema = Schema.Union([
  Schema.Number,
  Schema.Null,
  Schema.String,
]);
const rawExceptionFrameSchema = Schema.Struct({
  platform: Schema.optional(Schema.String),
  filename: Schema.optional(Schema.String),
  function: Schema.optional(Schema.String),
  lineno: Schema.optional(rawCoordinateSchema),
  colno: Schema.optional(rawCoordinateSchema),
  in_app: Schema.optional(Schema.Boolean),
});
const rawExceptionListSchema = Schema.Array(
  Schema.Struct({
    type: Schema.optional(Schema.String),
    value: Schema.optional(Schema.String),
    mechanism: Schema.optional(
      Schema.Struct({
        handled: Schema.optional(Schema.Boolean),
        synthetic: Schema.optional(Schema.Boolean),
        type: Schema.optional(Schema.String),
      })
    ),
    stacktrace: Schema.optional(
      Schema.Struct({
        type: Schema.String,
        frames: Schema.Array(rawExceptionFrameSchema),
      })
    ),
  })
);
const decodeRawExceptionList = Schema.decodeUnknownOption(
  rawExceptionListSchema
);
const salvageEntrySchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
});
const decodeUnknownList = Schema.decodeUnknownOption(
  Schema.Array(Schema.Unknown)
);
const decodeSalvageEntry = Schema.decodeUnknownOption(salvageEntrySchema);

interface WritableExceptionFrame {
  platform?: string;
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}
interface WritableExceptionEntry {
  type?: string;
  value?: string;
  mechanism?: NonNullable<
    (typeof exceptionListSchema.Type)[number]["mechanism"]
  >;
  stacktrace?: {
    type: string;
    frames: WritableExceptionFrame[];
  };
}
type RawFrame = typeof rawExceptionFrameSchema.Type;

const finiteCoordinate = (
  value: number | string | null | undefined
): number | undefined => (isFiniteNumber(value) ? value : undefined);

const cleanFrame = (frame: RawFrame): WritableExceptionFrame => {
  const cleaned: WritableExceptionFrame = {};
  if (frame.platform !== undefined) {
    cleaned.platform = frame.platform;
  }
  if (frame.filename !== undefined) {
    cleaned.filename = frame.filename;
  }
  if (frame.function !== undefined) {
    cleaned.function = frame.function;
  }
  if (frame.in_app !== undefined) {
    cleaned.in_app = frame.in_app;
  }
  const lineno = finiteCoordinate(frame.lineno);
  if (lineno !== undefined) {
    cleaned.lineno = lineno;
  }
  const colno = finiteCoordinate(frame.colno);
  if (colno !== undefined) {
    cleaned.colno = colno;
  }
  return cleaned;
};

const cleanExceptionList = (
  exceptions: typeof rawExceptionListSchema.Type
): typeof exceptionListSchema.Type =>
  exceptions.map((exception) => {
    const cleaned: WritableExceptionEntry = {};
    if (exception.type !== undefined) {
      cleaned.type = exception.type;
    }
    if (exception.value !== undefined) {
      cleaned.value = exception.value;
    }
    if (exception.mechanism !== undefined) {
      cleaned.mechanism = exception.mechanism;
    }
    if (exception.stacktrace !== undefined) {
      cleaned.stacktrace = {
        type: exception.stacktrace.type,
        frames: exception.stacktrace.frames.map(cleanFrame),
      };
    }
    return cleaned;
  });

/**
 * When the list still cannot decode, keep each entry's type and message. Losing the stack is
 * better than dropping the crash. A value that is not a list stays empty so the event is dropped.
 */
const salvageExceptionList = (
  value: CaptureResult["properties"][string]
): typeof exceptionListSchema.Type => {
  const entries = decodeUnknownList(value);
  if (Option.isNone(entries)) {
    return [];
  }
  const salvaged: WritableExceptionEntry[] = [];
  for (const entry of entries.value) {
    const decoded = decodeSalvageEntry(entry);
    if (Option.isNone(decoded)) {
      continue;
    }
    const exception: WritableExceptionEntry = {};
    if (decoded.value.type !== undefined) {
      exception.type = decoded.value.type;
    }
    if (decoded.value.value !== undefined) {
      exception.value = decoded.value.value;
    }
    if (exception.type === undefined && exception.value === undefined) {
      continue;
    }
    salvaged.push(exception);
  }
  return salvaged;
};

/**
 * Keeps an exception's type, message, and stack frames. Messages come from code, not from
 * people, but are truncated in case one embeds a payload.
 */
export const sanitizeExceptionList = (
  properties: CaptureResult["properties"]
): typeof exceptionListSchema.Type => {
  const parsed = decodeRawExceptionList(properties.$exception_list);
  const exceptions = Option.isSome(parsed)
    ? cleanExceptionList(parsed.value)
    : salvageExceptionList(properties.$exception_list);
  return exceptions.map((exception) => ({
    ...exception,
    value: exception.value?.slice(0, EXCEPTION_MESSAGE_MAX_LENGTH),
    stacktrace:
      exception.stacktrace === undefined
        ? undefined
        : {
            type: exception.stacktrace.type,
            frames: exception.stacktrace.frames.map((frame) => ({
              ...frame,
              filename:
                frame.filename === undefined
                  ? undefined
                  : exceptionFrameFilename(frame.filename),
            })),
          },
  }));
};

export const prepareAnalyticsEvent = (
  event: CaptureResult | null,
  pathname: string,
  authenticated: boolean
): CaptureResult | null => {
  if (event?.event === "$snapshot") {
    if (!canRecordSession(pathname, authenticated)) {
      return null;
    }
    const snapshots: unknown = event.properties.$snapshot_data;
    if (!Array.isArray(snapshots)) {
      return null;
    }
    const bytes: unknown = event.properties.$snapshot_bytes;
    return {
      uuid: event.uuid,
      event: event.event,
      timestamp: event.timestamp,
      properties: {
        ...sanitizeAnalyticsProperties(event.properties),
        // rrweb masks DOM content before producing these replay frames.
        $snapshot_data: snapshots,
        $snapshot_bytes: isFiniteNumber(bytes) ? bytes : undefined,
      },
    };
  }
  if (
    event === null ||
    !EVENTS.has(event.event) ||
    pathname.startsWith("/demo/")
  ) {
    return null;
  }
  const surface = analyticsSurface(pathname);
  if (surface === "app" && !authenticated) {
    return null;
  }
  if (event.event === "$exception") {
    // Exception capture covers all authenticated product routes; replay has its own gate.
    const exceptionList = sanitizeExceptionList(event.properties);
    if (
      !canReportException(pathname, authenticated) ||
      exceptionList.length === 0
    ) {
      return null;
    }
    return {
      uuid: event.uuid,
      event: event.event,
      timestamp: event.timestamp,
      properties: {
        ...sanitizeAnalyticsProperties({
          ...event.properties,
          surface,
          is_authenticated: authenticated,
        }),
        $exception_list: exceptionList,
      },
    };
  }
  return {
    uuid: event.uuid,
    event: event.event,
    timestamp: event.timestamp,
    properties: sanitizeAnalyticsProperties({
      ...event.properties,
      surface,
      is_authenticated: authenticated,
    }),
    // The SDK puts initial attribution outside properties when creating a person.
    $set:
      event.$set === undefined
        ? undefined
        : sanitizeAnalyticsProperties(event.$set),
    $set_once:
      event.$set_once === undefined
        ? undefined
        : sanitizeAnalyticsProperties(event.$set_once),
  };
};
