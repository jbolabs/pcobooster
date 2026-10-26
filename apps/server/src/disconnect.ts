import * as Cloudflare from "@alchemy.run/cloudflare";
import { clientClosedOutcome } from "@pcobooster/contracts/faults";
/**
 * What happens to a product call when its caller disconnects. The call runs on its own fiber,
 * raced against the request's abort signal. When the caller leaves first, the call is
 * interrupted: a read stops, a write finishes (ProcedureScope runs writes uninterruptibly,
 * `preparedWrite` reopens only the prepare step), and its outcome line and audit row are written
 * once it has. The interruption is handed to `afterDisconnect`, which keeps the invocation alive
 * for it (`waitUntil` in workerd), and the request answers 499, which no one receives.
 */
import { API_PREFIX } from "@pcobooster/contracts/http/route";
import { Effect, Fiber, Option } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/** Keeps the invocation alive for work that finishes after the caller left. */
export type AfterDisconnect<Services> = (
  work: Effect.Effect<void>
) => Effect.Effect<void, never, Services>;

/** The Worker's: workerd's `waitUntil`, through Alchemy's execution context. */
export const waitUntilAfterDisconnect = (work: Effect.Effect<void>) =>
  Cloudflare.WorkerExecutionContext.pipe(
    Effect.flatMap((execution) => execution.waitUntil(work))
  );

/** Completes when the workerd request's signal aborts: the caller disconnected. */
const disconnected = (signal: AbortSignal): Effect.Effect<boolean> =>
  signal.aborted
    ? Effect.succeed(true)
    : Effect.callback<boolean>((resume) => {
        const onAbort = () => {
          resume(Effect.succeed(true));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        return Effect.sync(() => {
          signal.removeEventListener("abort", onAbort);
        });
      });

const isProductPath = (url: string): boolean => {
  const { pathname } = new URL(url, "http://api");
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
};

/** Runs product calls (`/api/v1`) so a disconnect stops reads and lets writes finish. */
export const surviveDisconnect =
  <Services>(afterDisconnect: AfterDisconnect<Services>) =>
  <Failure, Requirements>(
    app: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      Failure,
      Requirements
    >
  ): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Failure,
    Requirements | Services | HttpServerRequest.HttpServerRequest
  > =>
    Effect.gen(function* raceDisconnect() {
      const httpRequest = yield* HttpServerRequest.HttpServerRequest;
      if (!isProductPath(httpRequest.url)) {
        return yield* app;
      }
      const { signal } = yield* HttpServerRequest.toWeb(httpRequest).pipe(
        Effect.orDie
      );
      // Its own fiber and scope: the call may outlive this request's answer and its scope.
      const call = yield* Effect.forkDetach(Effect.scoped(app));
      const answered = yield* Effect.raceFirst(
        Fiber.join(call).pipe(Effect.map(Option.some)),
        disconnected(signal).pipe(Effect.as(Option.none()))
      );
      if (Option.isSome(answered)) {
        return answered.value;
      }
      yield* afterDisconnect(Fiber.interrupt(call));
      return HttpServerResponse.empty({ status: clientClosedOutcome.status });
    });
