import type { JsonValue } from "@pcobooster/planning-center-models/json";
import { Data } from "effect";

export interface PlanningCenterRateLimitInfo {
  limit?: number;
  count?: number;
  period?: string;
  retryAfterSeconds?: number;
}

/** Planning Center answered with an error status or a response we cannot use. */
export class PlanningCenterApiError extends Data.TaggedError(
  "PlanningCenterApiError"
)<{
  readonly message: string;
  readonly status: number;
  readonly method?: string;
  /** Semantic provider mutation: POST read actions are false, like GET/HEAD. */
  readonly isWrite?: boolean;
  /** Fixed keys supplied by the service adapter, never submitted attribute values. */
  readonly sentAttributeNames?: readonly string[];
  readonly cause?: unknown;
  readonly code?: string;
  readonly details?: JsonValue;
  readonly responseBody?: string;
  readonly rateLimit?: PlanningCenterRateLimitInfo;
  readonly retryAfterSeconds?: number;
}> {}
