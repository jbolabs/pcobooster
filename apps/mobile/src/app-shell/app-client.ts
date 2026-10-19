import type { ProductClient } from "@pcobooster/client/product-client";
import type { RequestScheduler } from "@pcobooster/client/request-scheduler";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import { REQUEST_ID_HEADER } from "@pcobooster/contracts/http/request-diagnostics";
import { uuidv7 } from "@posthog/core/vendor/uuidv7";

import { recordCallFailure } from "../diagnostics/call-failures";
import type { ReportOrigin } from "../diagnostics/diagnostics-client";
import { credentialHeaders } from "../session/session-store";
import type {
  RequestCredentials,
  SessionStore,
} from "../session/session-store";
import { ScopeChangedError } from "./scope-changed";

/** The product client screens use: every call scheduled, and 401s reported to the session. */
export type AppClient = Pick<ProductClient, "run">;

/** The app client, plus copies bound to one account scope for that scope's query cache. */
export interface AppClients extends AppClient {
  readonly forScope: (scope: string) => AppClient;
  /** Pin transport and unauthorized attribution for session operations queued across switches. */
  readonly forCredentials: (credentials: RequestCredentials) => AppClient;
}

/** What the app client reads from the session. */
export type AppClientSession = Pick<
  SessionStore,
  "credentials" | "handleUnauthorized"
> & {
  /** The account scope requests are sent for now (`SessionSnapshot.scope`). */
  readonly scope: () => string;
};

/** How calls are told apart in diagnostics; tests pass fixed values. */
export interface CallIdentity {
  readonly newRequestId: () => string;
  readonly now: () => number;
  /** The diagnostics context a call starts in (`Diagnostics.origin`). */
  readonly origin?: () => ReportOrigin;
}

export const liveCallIdentity: CallIdentity = {
  newRequestId: uuidv7,
  now: Date.now,
};

/**
 * Wraps the product client for screens. Every call goes through the scheduler, so interactive
 * calls hold speculative work back. A call records the credentials in use when it starts; an
 * `Unauthenticated` answer is reported with them, so a late answer for an account the person has
 * already left never signs out the current one. Per-call headers pin that same snapshot over
 * the live header getter, including empty headers that remove an older credential.
 *
 * A client from `forScope` belongs to one account scope's query cache. Each of its calls, retries
 * included, checks when it actually starts (after any wait behind the scheduler) that the session
 * is still in that scope, and otherwise fails with `ScopeChangedError` without sending anything.
 *
 * Each call also sends a fresh `x-request-id`, which the API logs on its outcome line; a call
 * that fails leaves that ID, its procedure, its duration, and the diagnostics context it started
 * in with the rejection (`diagnostics/call-failures.ts`) for the query cache to report if the
 * failure is terminal.
 */
export const makeAppClient = (
  client: ProductClient,
  session: AppClientSession,
  scheduler: RequestScheduler,
  identity: CallIdentity = liveCallIdentity
): AppClients => {
  const sendWith =
    (pinnedCredentials?: RequestCredentials): AppClient["run"] =>
    async (call, options) => {
      const sent = pinnedCredentials ?? session.credentials();
      const origin = identity.origin?.() ?? null;
      const requestId = identity.newRequestId();
      const startedAt = identity.now();
      let procedure: string | null = null;
      try {
        const pinnedOptions = {
          ...options,
          httpHeaders: {
            authorization: "",
            "x-pcobooster-account": "",
            "x-pcobooster-demo": "",
            ...credentialHeaders(sent),
            ...Object.fromEntries(new Headers(options?.httpHeaders)),
            [REQUEST_ID_HEADER]: requestId,
          },
          onProcedure: (name: string) => {
            procedure = name;
            options?.onProcedure?.(name);
          },
        };
        return await client.run(call, pinnedOptions);
      } catch (error) {
        recordCallFailure(error, {
          requestId,
          procedure,
          durationMs: identity.now() - startedAt,
          origin,
        });
        if (error instanceof Unauthenticated) {
          session.handleUnauthorized(sent);
        }
        throw error;
      }
    };
  const runIn =
    (
      scope: string | null,
      credentials?: RequestCredentials
    ): AppClient["run"] =>
    async (call, options) =>
      await scheduler.track(
        options?.priority ?? "interactive",
        async () => {
          if (scope !== null && session.scope() !== scope) {
            throw new ScopeChangedError();
          }
          return await sendWith(credentials)(call, options);
        },
        options?.signal
      );
  return {
    run: runIn(null),
    forScope: (scope) => ({ run: runIn(scope) }),
    forCredentials: (credentials) => ({ run: runIn(null, { ...credentials }) }),
  };
};

/** A demo link that did not start a demo (the server answered, but with no demo token). */
export class DemoLinkFailureError extends Error {
  override readonly name = "DemoLinkFailureError";
  override readonly message = "That demo link isn't valid anymore.";
}
