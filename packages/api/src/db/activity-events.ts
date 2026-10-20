import type { ServerConfig } from "@pcobooster/api/config/server-config";
import type { Db } from "@pcobooster/api/db/client";
import { activityEvents } from "@pcobooster/api/db/schema";
import { boundaryLog } from "@pcobooster/api/logging";
import { createPostHogActivityForwarder } from "@pcobooster/api/modules/analytics/posthog-activity";
import type { PostHogPersonProperties } from "@pcobooster/api/modules/analytics/posthog-capture";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import { sql } from "drizzle-orm";

const analyticsLog = boundaryLog("analytics/posthog");

export type ActivityEventType =
  | "schedule_attempt"
  | "schedule_status_change"
  | "schedule_remove"
  | "auth_session_created"
  | "auth_session_deleted"
  | "auth_account_linked"
  | "auth_sign_in_failed";

export interface ActivityEventInput {
  eventType: ActivityEventType;
  actorUserId?: string | null;
  actorAccountId?: string | null;
  requestId?: string | null;
  path?: string | null;
  method?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean | null;
  statusCode?: number | null;
  errorCode?: string | null;
  serviceTypeId?: string | null;
  personId?: string | null;
  planId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  metadata?: JsonObject | null;
}

interface HeadersLike {
  get: (name: string) => string | null;
}

interface RequestLike {
  method?: string;
  url?: string;
  headers?: HeadersLike;
}

type RequestContextSource =
  | (RequestLike & { request?: RequestLike })
  | null
  | undefined;

export interface ActivityRequestContext {
  requestId: string | null;
  path: string | null;
  method: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

const toNullableString = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && value.length > 0 ? value : null;

const toNullableNumber = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value)
    ? value
    : null;

const getHeader = (
  headers: HeadersLike | undefined,
  name: string
): string | null => toNullableString(headers?.get(name));

const pathFromUrl = (url: string | undefined): string | null => {
  if (!(url !== undefined && url !== "")) {
    return null;
  }
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
};

export const getActivityRequestContext = (
  source: RequestContextSource
): ActivityRequestContext => {
  const request = source?.request ?? source;
  const headers = source?.headers ?? request?.headers;

  return {
    requestId: getHeader(headers, "x-request-id"),
    path: pathFromUrl(request?.url),
    method: toNullableString(request?.method),
    ipAddress:
      getHeader(headers, "x-forwarded-for") ?? getHeader(headers, "x-real-ip"),
    userAgent: getHeader(headers, "user-agent"),
  };
};

/** The database row is the audit record; PostHog delivery is best effort. */
export interface ActivityRecorder {
  readonly database: Db;
  readonly config: Pick<ServerConfig, "postHogProjectKey">;
}

export const recordActivityEvent = async (
  { database, config }: ActivityRecorder,
  input: ActivityEventInput,
  person: PostHogPersonProperties | null = null
): Promise<void> => {
  const values = {
    eventType: input.eventType,
    actorUserId: toNullableString(input.actorUserId),
    actorAccountId: toNullableString(input.actorAccountId),
    requestId: toNullableString(input.requestId),
    path: toNullableString(input.path),
    method: toNullableString(input.method),
    ipAddress: toNullableString(input.ipAddress),
    userAgent: toNullableString(input.userAgent),
    success: input.success ?? null,
    statusCode: toNullableNumber(input.statusCode),
    errorCode: toNullableString(input.errorCode),
    serviceTypeId: toNullableString(input.serviceTypeId),
    personId: toNullableString(input.personId),
    planId: toNullableString(input.planId),
    teamId: toNullableString(input.teamId),
    positionId: toNullableString(input.positionId),
    metadata: input.metadata ?? {},
  };
  if (values.actorUserId === null) {
    await database.insert(activityEvents).values(values);
  } else {
    // A provider operation can finish after account deletion. Keep its result successful,
    // but never recreate personal audit data (or forward it) once that user is gone.
    const inserted = await database.all<{ id: number }>(sql`
      insert into activity_events (
        event_type, actor_user_id, actor_account_id, request_id, path, method,
        ip_address, user_agent, success, status_code, error_code, service_type_id,
        person_id, plan_id, team_id, position_id, metadata
      )
      select ${values.eventType}, ${values.actorUserId}, ${values.actorAccountId},
        ${values.requestId}, ${values.path}, ${values.method}, ${values.ipAddress},
        ${values.userAgent}, ${values.success === null ? null : Number(values.success)},
        ${values.statusCode}, ${values.errorCode}, ${values.serviceTypeId},
        ${values.personId}, ${values.planId}, ${values.teamId}, ${values.positionId},
        ${JSON.stringify(values.metadata)}
      where exists (select 1 from user where id = ${values.actorUserId})
      returning id
    `);
    if (inserted.length === 0) {
      return;
    }
  }
  try {
    await createPostHogActivityForwarder({
      apiKey: config.postHogProjectKey ?? undefined,
      fetch: globalThis.fetch,
    })(input, person);
  } catch (error) {
    analyticsLog.warn(
      "Failed to forward activity event to PostHog",
      { eventType: input.eventType },
      error instanceof Error ? error : new Error(String(error))
    );
  }
};
