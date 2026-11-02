/**
 * Send permits for one credential's Planning Center requests across every request an isolate
 * serves (`PlanningCenterRatePacer.withSendPermit`).
 */

/** How often a request waiting for a send permit checks for one. */
export const SEND_PERMIT_POLL_MS = 25;
/**
 * A waiter that has not checked for this long is gone: workerd cancelled its request without
 * running its finalizers (a hung request), so it never leaves the line itself.
 */
const SEND_PERMIT_WAITER_STALE_MS = 1000;
/**
 * A permit held this long belongs to a request that ended without releasing it. A live holder
 * gives its permit back within its pacing wait and attempt timeout, well under this.
 */
const SEND_PERMIT_LEASE_MS = 60_000;

interface SendPermitWaiter {
  readonly token: symbol;
  checkedAt: number;
}

/**
 * One credential's send permits, shared by every request the isolate serves. Each waiting
 * request takes its permit itself, on its own timer, when it is first in line.
 *
 * Not an Effect `Semaphore`, or any hand-off from the request that releases a permit: workerd
 * ties I/O and promise continuations to the request that started them. A request that only
 * awaits another request's release has nothing pending of its own, so workerd cancels it as
 * hung, and a fiber resumed by the releasing request would run inside that request's context
 * (`send-permits.test.ts` in apps/server reproduces both). A cancelled request runs no
 * finalizers, so stale waiters and expired permits are cleared as the line moves.
 */
export class SendLane {
  /** Permit holders, with when each took its permit. */
  private readonly holders = new Map<symbol, number>();
  private readonly waiters: SendPermitWaiter[] = [];

  private readonly permits: number;

  constructor(permits: number) {
    this.permits = permits;
  }

  get idle(): boolean {
    return this.holders.size === 0 && this.waiters.length === 0;
  }

  /** Takes a permit for `token` if it is free and nobody still waiting is ahead of it. */
  tryTake(token: symbol, now: number): boolean {
    for (const [holder, takenAt] of this.holders) {
      if (now - takenAt >= SEND_PERMIT_LEASE_MS) {
        this.holders.delete(holder);
      }
    }
    let [first] = this.waiters;
    while (
      first !== undefined &&
      first.token !== token &&
      now - first.checkedAt >= SEND_PERMIT_WAITER_STALE_MS
    ) {
      this.waiters.shift();
      [first] = this.waiters;
    }
    if (
      this.holders.size >= this.permits ||
      (first !== undefined && first.token !== token)
    ) {
      const waiter = this.waiters.find((entry) => entry.token === token);
      if (waiter === undefined) {
        this.waiters.push({ token, checkedAt: now });
      } else {
        waiter.checkedAt = now;
      }
      return false;
    }
    if (first !== undefined) {
      this.waiters.shift();
    }
    this.holders.set(token, now);
    return true;
  }

  /** Gives back `token`'s permit, or its place in line. */
  leave(token: symbol): void {
    this.holders.delete(token);
    const index = this.waiters.findIndex((entry) => entry.token === token);
    if (index !== -1) {
      this.waiters.splice(index, 1);
    }
  }
}
