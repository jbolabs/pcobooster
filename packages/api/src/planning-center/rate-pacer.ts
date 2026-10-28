import type { PlanningCenterRateLimitInfo } from "@pcobooster/api/planning-center/api-error";
import {
  SEND_PERMIT_POLL_MS,
  SendLane,
} from "@pcobooster/api/planning-center/send-lane";
import type { RequestPriority } from "@pcobooster/contracts/request-priority";
import { Clock, Duration, Effect } from "effect";

/** Budget used freely before pacing starts, as a share of the reported limit. */
const DEFAULT_PACE_FROM_SHARE = 0.5;
/**
 * Budget speculative reads may use, as a share of the reported limit. Below the pacing share,
 * so work nobody is waiting on never takes a paced slot and at least this much of every window
 * beyond it stays for interactive reads.
 */
const DEFAULT_SPECULATIVE_SHARE = 0.4;
/**
 * Budget interactive reads leave unused, as a share of the reported limit, so a change the
 * person just made still has room when a screen's reads have spent the rest.
 */
const DEFAULT_WRITE_RESERVE_SHARE = 0.1;
/** Longest an interactive request waits for budget before failing fast. */
export const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 5000;
/**
 * One Planning Center rate window: the longest a write waits for budget, and the longest
 * Retry-After an interactive read waits out before resending. A write is a change the person
 * already made (the screen shows it optimistically), so it waits rather than failing.
 */
export const PLANNING_CENTER_WINDOW_WAIT_MS = 20_000;
/**
 * Requests one credential may have in flight from an isolate at once, across every procedure.
 * Workers hold six connections per invocation, so this lets two procedures read at full speed
 * while a plan page's wider fan-out (window history, candidate details, songs) queues. Fewer
 * requests committed at once means each response's rate headers, which count every isolate and
 * device on the account, reach the pacer before the next requests are sent.
 */
const DEFAULT_MAX_IN_FLIGHT = 12;
/** Retry wait after a 429 that names no Retry-After and no known window. */
const UNKNOWN_BLOCK_MS = 1000;
/** Credentials tracked before idle ones are pruned; OAuth tokens rotate every 2 hours. */
const PRUNE_ABOVE_CREDENTIALS = 64;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const PERIOD_PATTERN = /^(?<amount>\d+)(?:\s*(?<unit>second|minute)s?)?$/iu;

/**
 * Parses `X-PCO-API-Request-Rate-Period`. Successful responses send bare seconds ("20");
 * 429s send "20 seconds".
 */
export const parseRatePeriodMs = (
  period: string | undefined
): number | undefined => {
  const match = PERIOD_PATTERN.exec(period?.trim() ?? "");
  const amount = Number(match?.groups?.amount);
  if (!(Number.isFinite(amount) && amount > 0)) {
    return undefined;
  }
  const unit = match?.groups?.unit?.toLowerCase();
  return amount * (unit === "minute" ? MS_PER_MINUTE : MS_PER_SECOND);
};

interface CredentialWindow {
  limit: number | undefined;
  periodMs: number | undefined;
  /** Highest `Rate-Count` reported in the current window. */
  reportedCount: number;
  /** Estimated end of the current window; conservative when unknown. */
  windowEndsAt: number;
  /** Requests reserved (waiting or in flight) and not yet answered. */
  inFlight: number;
  /** Earliest time the next paced request may be sent. */
  nextSlotAt: number;
  /** Set by a 429 until its Retry-After passes. */
  blockedUntil: number;
}

export interface PlanningCenterRateSnapshot {
  readonly limit: number | undefined;
  readonly count: number;
  readonly periodMs: number | undefined;
  /** Other reserved requests not yet answered, excluding this one. */
  readonly inFlight: number;
}

export type PlanningCenterPacingDecision =
  | {
      readonly kind: "send";
      readonly waitMs: number;
      readonly window: PlanningCenterRateSnapshot;
    }
  | {
      readonly kind: "reject";
      /**
       * `budget`: the wait would pass the cap. `speculative`: the rest of the window is kept for
       * interactive reads; nothing is wrong with the credential.
       */
      readonly reason: "budget" | "speculative";
      readonly retryAfterMs: number;
      readonly window: PlanningCenterRateSnapshot;
    };

export interface PlanningCenterRatePacerOptions {
  /** Share of the reported limit used without pacing (default 0.5). */
  readonly paceFromShare?: number;
  /** Longest wait before a read fails fast (default 5 s). */
  readonly maxWaitMs?: number;
  /** Longest wait before a write fails fast (default 20 s). */
  readonly maxWriteWaitMs?: number;
  /** Share of the reported limit interactive reads leave for writes (default 0.1). */
  readonly writeReserveShare?: number;
  /** Share of the reported limit speculative reads may use (default 0.4). */
  readonly speculativeShare?: number;
  /** Requests one credential may have in flight at once (default 12). */
  readonly maxInFlight?: number;
}

export interface PlanningCenterRateObservation {
  readonly status: number;
  readonly rateLimit: PlanningCenterRateLimitInfo;
}

const snapshotOf = (window: CredentialWindow): PlanningCenterRateSnapshot => ({
  limit: window.limit,
  count: window.reportedCount,
  periodMs: window.periodMs,
  inFlight: window.inFlight,
});

/** Updates the window from one response's rate headers and status. */
const learnFromResponse = (
  window: CredentialWindow,
  now: number,
  { status, rateLimit }: PlanningCenterRateObservation
): void => {
  const periodMs = parseRatePeriodMs(rateLimit.period);
  window.limit = rateLimit.limit ?? window.limit;
  window.periodMs = periodMs ?? window.periodMs;
  const { count } = rateLimit;
  if (count !== undefined) {
    // A count well below what we saw means a new window began. Responses
    // can arrive out of order within a window, hence the in-flight slack.
    const startedNewWindow =
      now >= window.windowEndsAt ||
      count + window.inFlight < window.reportedCount;
    if (startedNewWindow) {
      window.reportedCount = count;
      // The window start is not reported; assuming it just began keeps
      // pacing conservative.
      window.windowEndsAt = now + (window.periodMs ?? 0);
      window.nextSlotAt = now;
    } else {
      window.reportedCount = Math.max(window.reportedCount, count);
    }
  }
  if (status === 429) {
    window.reportedCount = Math.max(
      window.reportedCount,
      window.limit ?? window.reportedCount
    );
    let blockMs = UNKNOWN_BLOCK_MS;
    if (rateLimit.retryAfterSeconds !== undefined) {
      blockMs = rateLimit.retryAfterSeconds * MS_PER_SECOND;
    } else if (window.windowEndsAt > now) {
      blockMs = window.windowEndsAt - now;
    }
    window.blockedUntil = Math.max(window.blockedUntil, now + blockMs);
    // Retry-After is authoritative: the budget returns when it passes.
    window.windowEndsAt = window.blockedUntil;
  }
};

/**
 * Paces one isolate's Planning Center requests per credential (cache scope)
 * from the rate headers Planning Center reports, never from hard-coded
 * limits. Below `paceFromShare` of the limit requests go straight out; above
 * it, concurrent requests take evenly spaced slots that spread the remaining
 * budget, less `writeReserveShare` kept for writes, over the rest of the
 * window. A wait longer than `maxWaitMs` is rejected so the caller can fail
 * fast. Writes skip that pacing and wait (up to `maxWriteWaitMs`) only while
 * a 429 blocks the credential or the window is spent. Speculative reads never wait: they go
 * out only while the window is below `speculativeShare` and nothing is paced,
 * and are rejected otherwise, so prefetches cannot take budget from what the
 * user is waiting on. Isolates do not share state, so this cannot prevent 429s
 * caused by another isolate or tab.
 *
 * Methods are synchronous and take the current time, so callers read the
 * Effect `Clock` and tests can drive time directly.
 */
export class PlanningCenterRatePacer {
  readonly maxWaitMs: number;
  private readonly maxWriteWaitMs: number;
  private readonly writeReserveShare: number;
  private readonly paceFromShare: number;
  private readonly speculativeShare: number;
  private readonly maxInFlight: number;
  private readonly windows = new Map<string, CredentialWindow>();
  private readonly lanes = new Map<string, SendLane>();

  constructor(options: PlanningCenterRatePacerOptions = {}) {
    this.paceFromShare = options.paceFromShare ?? DEFAULT_PACE_FROM_SHARE;
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_RATE_LIMIT_WAIT_MS;
    this.maxWriteWaitMs =
      options.maxWriteWaitMs ?? PLANNING_CENTER_WINDOW_WAIT_MS;
    this.writeReserveShare =
      options.writeReserveShare ?? DEFAULT_WRITE_RESERVE_SHARE;
    this.speculativeShare = Math.min(
      options.speculativeShare ?? DEFAULT_SPECULATIVE_SHARE,
      this.paceFromShare
    );
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  }

  /**
   * Sends `effect` once fewer than `maxInFlight` of the credential's requests are in flight.
   * Waiting requests take permits in arrival order, each checking every `SEND_PERMIT_POLL_MS`.
   * A lane lives only while a request holds or waits for one of its permits.
   */
  withSendPermit<Value, Failure, Requirements>(
    scope: string,
    effect: Effect.Effect<Value, Failure, Requirements>
  ): Effect.Effect<Value, Failure, Requirements> {
    const { lanes, maxInFlight } = this;
    const laneFor = () => {
      const existing = lanes.get(scope);
      if (existing !== undefined) {
        return existing;
      }
      const lane = new SendLane(maxInFlight);
      lanes.set(scope, lane);
      return lane;
    };
    return Effect.suspend(() => {
      const token = Symbol("send permit");
      const takePermit = Effect.gen(function* waitForPermit() {
        while (!laneFor().tryTake(token, yield* Clock.currentTimeMillis)) {
          yield* Effect.sleep(Duration.millis(SEND_PERMIT_POLL_MS));
        }
      });
      const leave = Effect.sync(() => {
        const lane = lanes.get(scope);
        lane?.leave(token);
        if (lane?.idle === true) {
          lanes.delete(scope);
        }
      });
      return Effect.uninterruptibleMask((restore) =>
        restore(takePermit).pipe(
          Effect.onInterrupt(() => leave),
          Effect.flatMap(() => restore(effect).pipe(Effect.ensuring(leave)))
        )
      );
    });
  }

  private windowFor(scope: string, now: number): CredentialWindow {
    let window = this.windows.get(scope);
    if (window === undefined) {
      window = {
        limit: undefined,
        periodMs: undefined,
        reportedCount: 0,
        windowEndsAt: now,
        inFlight: 0,
        nextSlotAt: now,
        blockedUntil: now,
      };
      this.windows.set(scope, window);
    }
    if (now >= window.windowEndsAt && now >= window.blockedUntil) {
      // The window we knew about has ended; the next response reports the new one.
      window.reportedCount = 0;
      window.nextSlotAt = now;
    }
    return window;
  }

  /**
   * Reserves a send slot. Reads may wait or be rejected; speculative reads
   * are sent at once or rejected; writes take the budget reads leave for them
   * and wait only while the window is known to be spent. Every `send` must be
   * followed by `complete`.
   */
  reserve(
    scope: string,
    now: number,
    kind: "read" | "write",
    priority: RequestPriority = "interactive"
  ): PlanningCenterPacingDecision {
    const window = this.windowFor(scope, now);
    let decision: PlanningCenterPacingDecision;
    if (kind === "write") {
      decision = this.decideWrite(window, now);
    } else if (priority === "speculative") {
      decision = this.decideSpeculative(window, now);
    } else {
      decision = this.decide(window, now);
    }
    if (decision.kind === "send") {
      window.inFlight += 1;
    }
    return decision;
  }

  /** Writes skip read pacing and wait only for a 429's block or a spent window. */
  private decideWrite(
    window: CredentialWindow,
    now: number
  ): PlanningCenterPacingDecision {
    const { limit } = window;
    const spent =
      limit !== undefined && window.reportedCount + window.inFlight >= limit;
    const earliest = Math.max(
      now,
      window.blockedUntil,
      spent ? window.windowEndsAt : now
    );
    const waitMs = Math.ceil(earliest - now);
    if (waitMs > this.maxWriteWaitMs) {
      return {
        kind: "reject",
        reason: "budget",
        retryAfterMs: waitMs,
        window: snapshotOf(window),
      };
    }
    return { kind: "send", waitMs, window: snapshotOf(window) };
  }

  private decide(
    window: CredentialWindow,
    now: number
  ): PlanningCenterPacingDecision {
    const { limit } = window;
    const blocked = window.blockedUntil > now;
    const used = window.reportedCount + window.inFlight;
    const windowKnown = limit !== undefined && window.periodMs !== undefined;
    if (!(blocked || (windowKnown && used >= limit * this.paceFromShare))) {
      return { kind: "send", waitMs: 0, window: snapshotOf(window) };
    }
    if (limit === undefined || window.periodMs === undefined) {
      // A 429 arrived before any response reported the window: wait out its block only.
      return this.sendAfter(window, now, window.blockedUntil);
    }
    const readLimit = Math.floor(limit * (1 - this.writeReserveShare));
    const remaining = readLimit - used;
    const earliest = Math.max(
      now,
      window.nextSlotAt,
      window.blockedUntil,
      remaining > 0 ? now : window.windowEndsAt
    );
    const windowLeftMs = Math.max(window.windowEndsAt - earliest, 0);
    const spacingMs =
      remaining > 0 && windowLeftMs > 0
        ? windowLeftMs / remaining
        : window.periodMs / readLimit;
    const decision = this.sendAfter(window, now, earliest);
    if (decision.kind === "send") {
      window.nextSlotAt = earliest + spacingMs;
    }
    return decision;
  }

  /** Sends at `earliest`, or rejects when that is further away than a read may wait. */
  private sendAfter(
    window: CredentialWindow,
    now: number,
    earliest: number
  ): PlanningCenterPacingDecision {
    const waitMs = Math.ceil(earliest - now);
    if (waitMs > this.maxWaitMs) {
      return {
        kind: "reject",
        reason: "budget",
        retryAfterMs: waitMs,
        window: snapshotOf(window),
      };
    }
    return { kind: "send", waitMs, window: snapshotOf(window) };
  }

  private decideSpeculative(
    window: CredentialWindow,
    now: number
  ): PlanningCenterPacingDecision {
    const { limit } = window;
    const blocked = window.blockedUntil > now;
    if (!blocked && (limit === undefined || window.periodMs === undefined)) {
      // Nothing is known about this credential yet; the first response teaches the window.
      return { kind: "send", waitMs: 0, window: snapshotOf(window) };
    }
    const used = window.reportedCount + window.inFlight;
    const interactiveQueued = window.nextSlotAt > now;
    if (
      !blocked &&
      !interactiveQueued &&
      limit !== undefined &&
      used < limit * this.speculativeShare
    ) {
      return { kind: "send", waitMs: 0, window: snapshotOf(window) };
    }
    return {
      kind: "reject",
      reason: "speculative",
      retryAfterMs: Math.max(
        window.windowEndsAt - now,
        window.blockedUntil - now,
        0
      ),
      window: snapshotOf(window),
    };
  }

  /** Releases a reservation and learns from the response's rate headers, if any. */
  complete(
    scope: string,
    now: number,
    observation?: PlanningCenterRateObservation
  ): void {
    const window = this.windowFor(scope, now);
    window.inFlight = Math.max(window.inFlight - 1, 0);
    if (observation !== undefined) {
      learnFromResponse(window, now, observation);
    }
    if (this.windows.size > PRUNE_ABOVE_CREDENTIALS) {
      this.prune(now);
    }
  }

  private prune(now: number): void {
    for (const [scope, window] of this.windows) {
      if (
        window.inFlight === 0 &&
        window.windowEndsAt <= now &&
        window.blockedUntil <= now
      ) {
        this.windows.delete(scope);
      }
    }
  }
}
