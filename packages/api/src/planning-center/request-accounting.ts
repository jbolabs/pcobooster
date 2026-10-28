import type { PlanningCenterRateLimitInfo } from "@pcobooster/api/planning-center/api-error";
import type { PlanningCenterRateSnapshot } from "@pcobooster/api/planning-center/rate-pacer";
import type { DroppedRow } from "@pcobooster/api/planning-center/resource-schemas";
import type { RequestPriority } from "@pcobooster/contracts/request-priority";

/** A request's path and query parameter names; never values, tokens, or bodies. */
export interface PlanningCenterEndpoint {
  readonly path: string;
  readonly queryKeys: readonly string[];
}

/** Fields of one Planning Center request line (pacing, 429, retry, or limit). */
export interface PlanningCenterRequestLogFields {
  readonly endpoint: PlanningCenterEndpoint;
  readonly method: string;
  readonly attempt?: number;
  readonly priority?: RequestPriority;
  readonly waitMs?: number;
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
  readonly retryDelayMs?: number;
  readonly rateLimit?: PlanningCenterRateLimitInfo | PlanningCenterRateSnapshot;
  readonly willRetry?: boolean;
  readonly requests?: number;
  readonly requestBudget?: number;
  readonly error?: string;
}

/** What one Worker invocation spent on Planning Center. */
export interface PlanningCenterRequestTotals {
  /** Explicit Planning Center API attempts, retries included. Core refuses redirect hops. */
  readonly requests: number;
  /** Requests the pacer held before sending. */
  readonly pacedRequests: number;
  readonly pacedWaitMs: number;
  /** 429 responses from Planning Center. */
  readonly rateLimited: number;
  /** Requests rejected before sending because the credential's budget was spent. */
  readonly rateLimitRejections: number;
  /** Cloudflare "Too many subrequests" refusals and budget rejections. */
  readonly subrequestLimitHits: number;
}

/** A row Planning Center sent that could not be read, and the endpoint that sent it. */
export interface DroppedPlanningCenterRow extends DroppedRow {
  readonly endpoint: string;
}

/** Bounds memory when a whole collection is unreadable; reports group rows by field anyway. */
const DROPPED_ROWS_KEPT = 200;

export interface PlanningCenterRequestAccountingOptions {
  /**
   * Planning Center requests this invocation may send before the client
   * fails with `PlanningCenterSubrequestLimitError`. Omit for no limit.
   */
  readonly requestBudget?: number;
  /** Who waits on this invocation; the pacer holds back speculative reads. Default interactive. */
  readonly priority?: RequestPriority;
}

/**
 * Counts one invocation's Planning Center traffic. The client records into
 * it; transport reads it for the per-procedure summary, and budget-aware
 * programs read `requestCount` to stop early with partial results.
 */
export class PlanningCenterRequestAccounting {
  readonly requestBudget: number | undefined;
  readonly priority: RequestPriority;
  private requests = 0;
  private pacedRequests = 0;
  private pacedWaitMs = 0;
  private rateLimited = 0;
  private rateLimitRejections = 0;
  private subrequestLimitHits = 0;
  private workerLimitReached = false;
  private readonly dropped: DroppedPlanningCenterRow[] = [];

  constructor(options: PlanningCenterRequestAccountingOptions = {}) {
    this.requestBudget = options.requestBudget;
    this.priority = options.priority ?? "interactive";
  }

  get requestCount(): number {
    return this.requests;
  }

  /** Requests left before the budget; `undefined` when no budget is set. */
  get remainingBudget(): number | undefined {
    return this.requestBudget === undefined
      ? undefined
      : Math.max(this.requestBudget - this.requests, 0);
  }

  /** Cloudflare refused a fetch, so every later one in this invocation fails too. */
  get subrequestLimitReached(): boolean {
    return this.workerLimitReached;
  }

  get totals(): PlanningCenterRequestTotals {
    return {
      requests: this.requests,
      pacedRequests: this.pacedRequests,
      pacedWaitMs: this.pacedWaitMs,
      rateLimited: this.rateLimited,
      rateLimitRejections: this.rateLimitRejections,
      subrequestLimitHits: this.subrequestLimitHits,
    };
  }

  /** Rows this invocation dropped because they could not be read, the first few kept. */
  get droppedRows(): readonly DroppedPlanningCenterRow[] {
    return this.dropped;
  }

  recordDroppedRows(endpoint: string, rows: readonly DroppedRow[]): void {
    for (const row of rows.slice(0, DROPPED_ROWS_KEPT - this.dropped.length)) {
      this.dropped.push({ ...row, endpoint });
    }
  }

  recordRequest(): void {
    this.requests += 1;
  }

  recordPaced(waitMs: number): void {
    this.pacedRequests += 1;
    this.pacedWaitMs += waitMs;
  }

  recordRateLimited(): void {
    this.rateLimited += 1;
  }

  recordRateLimitRejection(): void {
    this.rateLimitRejections += 1;
  }

  recordSubrequestLimit(source: "worker" | "budget"): void {
    this.subrequestLimitHits += 1;
    if (source === "worker") {
      this.workerLimitReached = true;
    }
  }
}
