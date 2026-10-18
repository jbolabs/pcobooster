/**
 * The API Worker as Alchemy runs it under `alchemy dev`: workerd, a migrated local D1, the KV
 * cache, the auth rate limit, and settings bound from `Config`. The unit tests build the Worker's
 * router directly; this catches wiring they cannot, such as a binding that is not provided or a
 * migration that fails to apply. It runs in the `test` stage, so it never touches `local`'s
 * data or ports, and needs no secrets.
 *
 * Beside it runs `TransportStackFixture`: the same router over a fake Planning Center, which
 * proves the product API's runtime behavior in workerd (server reuse across requests,
 * cancellation, write completion, request rejection, defect isolation, outcome lines, bearer and
 * demo sessions, and every fault status the endpoints answer).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

import { assert } from "@effect/vitest";
import { demoSessionToken } from "@pcobooster/api/auth/demo-access";
import { resolveReleaseVersion } from "@pcobooster/api/config/release";
import { testServerConfig } from "@pcobooster/api/testing/server";
import {
  failureStatus,
  makeProductClient,
} from "@pcobooster/client/product-client";
import type { ProductApi } from "@pcobooster/client/product-client";
import { ExternalServiceFailure } from "@pcobooster/contracts/faults/external-service-failure";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { InternalError } from "@pcobooster/contracts/faults/internal-error";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { RateLimited } from "@pcobooster/contracts/faults/rate-limited";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as State from "alchemy/State";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Layer, Result, Schedule, Schema } from "effect";
import type { Cause } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import TransportStackFixture, {
  FIXTURE_ABORT_AFTER_HEADER,
  FIXTURE_DEMO_SETTINGS,
  FIXTURE_RELEASE_VERSION,
  FIXTURE_RETRY_AFTER_SECONDS,
  FIXTURE_SESSION_PATH,
  FIXTURE_STATE_PATH,
  fixtureSessionSchema,
  fixtureStateSchema,
} from "./transport-stack.fixture";
import type { FixtureState } from "./transport-stack.fixture";
import Api from "./worker";

/** Settings the API reads in a local stage; fictional, since nothing here reaches Planning Center. */
const testSettings = {
  BETTER_AUTH_SECRET: "stack-test-secret-that-is-long-enough-000",
  PLANNING_CENTER_OAUTH_CLIENT_ID: "stack-test-client",
  PLANNING_CENTER_OAUTH_CLIENT_SECRET: "stack-test-client-secret",
  // Alchemy resolves Cloudflare credentials even for local providers. Fictional values keep the
  // test secretless in CI and guarantee it can never reach a real account.
  CLOUDFLARE_ACCOUNT_ID: "00000000000000000000000000000000",
  CLOUDFLARE_API_TOKEN: "stack-test-never-reaches-cloudflare",
};
Object.assign(process.env, testSettings);
// `Drizzle.Schema` resolves the schema and migrations from the working directory, as it does
// under `alchemy dev` at the repository root; Turborepo runs this package's tests from here.
process.chdir(path.resolve(import.meta.dirname, "../../.."));

const providers = Layer.mergeAll(Cloudflare.providers(), Drizzle.providers());

const ApiStack = Alchemy.Stack(
  "pcobooster-api-test",
  { providers, state: State.inMemoryState() },
  Effect.gen(function* apiAndFixture() {
    const api = yield* Api;
    const fixture = yield* TransportStackFixture;
    return { url: api.url, fixtureUrl: fixture.url };
  })
);

const { test, beforeAll, deploy } = Test.make({
  providers,
  state: State.inMemoryState(),
  stage: "test",
  dev: true,
});

// State is in memory and the resources are local, so there is nothing to destroy: the harness
// stops workerd when the file finishes.
const stack = beforeAll(
  Effect.gen(function* isolatedStack() {
    const directory = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const parent = path.resolve(".alchemy/tests");
        mkdirSync(parent, { recursive: true });
        return mkdtempSync(path.join(parent, "api-stack-"));
      }),
      (root) =>
        Effect.sync(() => {
          rmSync(root, { recursive: true, force: true });
        })
    );
    // The sidecar reads this context too. Its D1/KV/workflow SQLite files cannot share the
    // main checkout's local state or the independently running read-cache fixture's state.
    return yield* deploy(ApiStack).pipe(
      Effect.updateService(Alchemy.AlchemyContext, (context) => ({
        ...context,
        dotAlchemy: directory,
      }))
    );
  }),
  { timeout: 180_000 }
);

/**
 * The first request waits for workerd to finish starting (the harness retries until it answers),
 * which takes longer than Vitest's 5-second default on CI runners.
 */
const requestTimeout = { timeout: 60_000 };

/** The local API Worker's URL once it answers; `alchemy dev` always serves one. */
const apiUrl = stack.pipe(
  Effect.flatMap(({ url }) =>
    url === undefined
      ? Effect.die(new Error("The API Worker has no local URL"))
      : Effect.succeed(url)
  ),
  Effect.tap((url) =>
    Test.executeWhenReady(HttpClientRequest.get(`${url}/health`))
  )
);

const statusOf = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClient.execute(request).pipe(Effect.map((response) => response.status));

const signOut = (url: string, clientIp: string) =>
  statusOf(
    HttpClientRequest.post(`${url}/api/auth/sign-out`).pipe(
      HttpClientRequest.setHeader("cf-connecting-ip", clientIp)
    )
  );

/** Statuses of `count` sign-outs in a row from one client, and how many were rate limited. */
const repeatedSignOuts = (url: string, clientIp: string, count: number) =>
  Effect.all(
    Array.from({ length: count }, () => signOut(url, clientIp)),
    { concurrency: 1 }
  ).pipe(
    Effect.map((statuses) => ({
      last: statuses.at(-1),
      rateLimited: statuses.filter((status) => status === 429).length,
    }))
  );

test(
  "limits auth writes per client IP but never session reads",
  Effect.gen(function* limitAuthWrites() {
    const url = yield* apiUrl;
    // One more than the 30 a minute `worker.ts` allows.
    const statuses = yield* repeatedSignOuts(url, "192.0.2.10", 31);
    const sessionRead = yield* statusOf(
      HttpClientRequest.get(`${url}/api/auth/get-session`).pipe(
        HttpClientRequest.setHeader("cf-connecting-ip", "192.0.2.10")
      )
    );
    const otherClient = yield* signOut(url, "192.0.2.11");

    assert.strictEqual(statuses.rateLimited, 1);
    assert.strictEqual(statuses.last, 429);
    assert.strictEqual(sessionRead, 200);
    assert.notStrictEqual(otherClient, 429);
  }),
  requestTimeout
);

// ---- The API Worker's router ------------------------------------------------------------------

/** The API Worker's browser origin in the `test` stage (`stage.ts`). */
const TEST_STAGE_ORIGIN = "http://127.0.0.1:3010";
/** The fixture serves `testServerConfig()`'s origin. */
const FIXTURE_ORIGIN = "http://localhost:3000";

const httpAnswerSchema = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
});
/** Better Auth answers some reads with a bare `null`. */
const decodeHttpAnswer = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.NullOr(httpAnswerSchema))
);

interface HttpAnswer {
  readonly status: number;
  readonly headers: Headers;
  /** The fault's tag, `ok` for another JSON body, or null for an empty one. */
  readonly tag: string | null;
  readonly message: string | undefined;
  readonly reason: string | undefined;
}

/** One raw HTTP request, as a web client or the native app would send it. */
const sendHttp = (
  url: string,
  route: string,
  {
    method = "GET",
    headers = {},
    body,
  }: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  } = {}
) =>
  Effect.promise(async (): Promise<HttpAnswer> => {
    const sent = new Headers({ "x-pcobooster-client": "web;api=2" });
    if (body !== undefined) {
      sent.set("content-type", "application/json");
    }
    for (const [name, value] of Object.entries(headers)) {
      sent.set(name, value);
    }
    const response = await fetch(`${url}${route}`, {
      method,
      headers: sent,
      body,
    });
    const text = await response.text();
    const answer = text === "" ? null : decodeHttpAnswer(text);
    return {
      status: response.status,
      headers: response.headers,
      tag: answer === null ? null : (answer._tag ?? "ok"),
      message: answer?.message,
      reason: answer?.reason,
    };
  });

const corsAndCache = (answer: HttpAnswer) => [
  answer.headers.get("access-control-allow-origin"),
  answer.headers.get("access-control-allow-credentials"),
  answer.headers.get("cache-control"),
];

const decodeDemoSession = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ demo: Schema.Boolean }))
);

const deployClient = (url: string) =>
  makeProductClient({ url, client: "deploy", credentials: "omit" });

test(
  "serves health through the product client with the deployed version",
  Effect.gen(function* apiHealth() {
    const url = yield* apiUrl;
    const client = deployClient(url);
    const health = yield* Effect.promise(
      async () => await client.run((api) => api.health.get())
    );
    const raw = yield* sendHttp(url, "/api/v1/health");

    assert.deepStrictEqual(health, {
      status: "ok",
      version: resolveReleaseVersion(process.env.GITHUB_SHA),
    });
    assert.deepStrictEqual(
      [raw.status, raw.headers.get("cache-control")],
      [200, "private, no-store"]
    );
  }),
  requestTimeout
);

test(
  "answers iOS update checks and asset downloads from the stage's update bucket",
  Effect.gen(function* updateBucket() {
    const url = yield* apiUrl;
    const [check, asset] = yield* Effect.promise(
      async () =>
        await Promise.all([
          fetch(`${url}/api/updates/manifest`, {
            headers: {
              "expo-protocol-version": "1",
              "expo-platform": "ios",
              "expo-runtime-version": "0".repeat(40),
            },
          }),
          fetch(`${url}/api/updates/assets/${"A".repeat(43)}`),
        ])
    );

    // The local bucket is empty: nothing published, no such asset.
    assert.deepStrictEqual(
      [
        check.status,
        check.headers.get("expo-protocol-version"),
        asset.status,
        asset.headers.get("cache-control"),
      ],
      [204, "1", 404, "private, no-store"]
    );
  }),
  requestTimeout
);

test(
  "answers ClientOutdated (426) to a client below the supported API version or without one",
  Effect.gen(function* outdatedClient() {
    const url = yield* apiUrl;
    const answers = yield* Effect.all(
      ["expo;api=0", "web;api=1", "expo", "android;api=1"].map((client) =>
        sendHttp(url, "/api/v1/health", {
          headers: { "x-pcobooster-client": client },
        })
      )
    );

    assert.deepStrictEqual(
      answers.map((answer) => [answer.status, answer.tag]),
      [
        [426, "ClientOutdated"],
        [426, "ClientOutdated"],
        [426, "ClientOutdated"],
        [426, "ClientOutdated"],
      ]
    );
  }),
  requestTimeout
);

test(
  "sets a procedure's cookie on the API Worker's response as its own Set-Cookie line",
  Effect.gen(function* setCookieFromProcedure() {
    const url = yield* apiUrl;
    const response = yield* Effect.promise(
      async () =>
        await fetch(`${url}/api/v1/demo/session`, {
          method: "DELETE",
          headers: { "x-pcobooster-client": "web;api=2" },
        })
    );
    const body = yield* Effect.promise(async () =>
      decodeDemoSession(await response.text())
    );

    assert.deepStrictEqual(
      [response.status, response.headers.get("cache-control"), body],
      [200, "private, no-store", { demo: false }]
    );
    // Plain-HTTP local development, so not Secure.
    assert.deepStrictEqual(response.headers.getSetCookie(), [
      "pcobooster-demo=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    ]);
  }),
  requestTimeout
);

test(
  "answers preflights and keeps CORS and no-store on successes, faults, unknown paths, and preflights",
  Effect.gen(function* httpCors() {
    const url = yield* apiUrl;
    const origin = { origin: TEST_STAGE_ORIGIN };
    const preflight = yield* sendHttp(url, "/api/v1/plan-people/pp-1", {
      method: "OPTIONS",
      headers: {
        ...origin,
        "access-control-request-method": "PATCH",
        "access-control-request-headers":
          "authorization,x-pcobooster-account,x-pcobooster-demo,x-pcobooster-client,x-pcobooster-priority",
      },
    });
    const foreign = yield* sendHttp(url, "/api/v1/plan-people/pp-1", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "PATCH",
      },
    });
    const answers = yield* Effect.all([
      sendHttp(url, "/health", { headers: origin }),
      sendHttp(url, "/api/v1/songs/song-1/chord-charts", { headers: origin }),
      sendHttp(url, "/api/v1/retired-endpoint", { headers: origin }),
    ]);

    assert.deepStrictEqual(
      [
        preflight.status,
        preflight.headers.get("access-control-allow-origin"),
        preflight.headers.get("cache-control"),
        preflight.headers.get("x-pcobooster-version") !== null,
      ],
      [204, TEST_STAGE_ORIGIN, "private, no-store", true]
    );
    assert.include(
      preflight.headers.get("access-control-allow-methods") ?? "",
      "PATCH"
    );
    assert.include(
      preflight.headers.get("access-control-allow-headers") ?? "",
      "x-pcobooster-priority"
    );
    assert.isNull(foreign.headers.get("access-control-allow-origin"));
    assert.deepStrictEqual(
      answers.map((answer) => [
        answer.status,
        answer.tag,
        ...corsAndCache(answer),
      ]),
      [
        [200, "ok", TEST_STAGE_ORIGIN, "true", "private, no-store"],
        [
          401,
          "Unauthenticated",
          TEST_STAGE_ORIGIN,
          "true",
          "private, no-store",
        ],
        [
          400,
          "RequestRejected",
          TEST_STAGE_ORIGIN,
          "true",
          "private, no-store",
        ],
      ]
    );
    assert.strictEqual(answers[2]?.reason, "unknown-endpoint");
    assert.include(
      answers[1]?.headers.get("access-control-expose-headers") ?? "",
      "Retry-After"
    );
  }),
  requestTimeout
);

test(
  "answers 401 without a session before reading input, and 426 to a client without a version",
  Effect.gen(function* httpUnauthenticated() {
    const url = yield* apiUrl;
    const unauthenticated = yield* Effect.all([
      sendHttp(url, "/api/v1/people/plan-window-history", {
        method: "POST",
        body: JSON.stringify({ date: "2026-10-11T17:00:00Z" }),
      }),
      sendHttp(url, "/api/v1/plan-people/pp-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "C" }),
      }),
      sendHttp(url, "/api/v1/songs/song-1/chord-charts"),
      // Malformed input: auth runs before input validation (a documented exception).
      sendHttp(url, "/api/v1/service-types/%20/plans/plan-1/team-members", {
        method: "POST",
        body: JSON.stringify({ personId: "" }),
      }),
    ]);
    const outdated = yield* sendHttp(url, "/api/v1/songs/song-1/chord-charts", {
      headers: { "x-pcobooster-client": "web" },
    });

    assert.deepStrictEqual(
      unauthenticated.map((answer) => [answer.status, answer.tag]),
      [
        [401, "Unauthenticated"],
        [401, "Unauthenticated"],
        [401, "Unauthenticated"],
        [401, "Unauthenticated"],
      ]
    );
    assert.deepStrictEqual(
      [outdated.status, outdated.tag],
      [426, "ClientOutdated"]
    );
  }),
  requestTimeout
);

test(
  "still answers Better Auth on the Effect router: a session read and a sign-in start",
  Effect.gen(function* betterAuthRoutes() {
    const url = yield* apiUrl;
    const sessionRead = yield* sendHttp(url, "/api/auth/get-session");
    // Better Auth validates the native start's PKCE query before it does anything else.
    const nativeStart = yield* sendHttp(url, "/api/auth/native/start");
    const unknownAuthPath = yield* sendHttp(url, "/api/auth/no-such-route");

    assert.strictEqual(sessionRead.status, 200);
    assert.strictEqual(
      sessionRead.headers.get("cache-control"),
      "private, no-store"
    );
    assert.strictEqual(nativeStart.status, 400);
    assert.notStrictEqual(nativeStart.tag, null);
    assert.strictEqual(unknownAuthPath.status, 404);
  }),
  requestTimeout
);

// ---- The router over a fake Planning Center ---------------------------------------------------

/** The transport fixture Worker's local URL, once it answers. */
const fixtureUrl = stack.pipe(
  Effect.flatMap(({ fixtureUrl: url }) =>
    url === undefined
      ? Effect.die(new Error("The transport fixture Worker has no local URL"))
      : Effect.succeed(url)
  ),
  Effect.tap((url) =>
    Test.executeWhenReady(HttpClientRequest.get(`${url}${FIXTURE_STATE_PATH}`))
  )
);

const decodeFixtureState = Schema.decodeUnknownSync(
  Schema.fromJsonString(fixtureStateSchema)
);

const fixtureState = (url: string, requestId?: string) =>
  Effect.promise(async () => {
    const query = requestId === undefined ? "" : `?requestId=${requestId}`;
    const response = await fetch(`${url}${FIXTURE_STATE_PATH}${query}`);
    return decodeFixtureState(await response.text());
  });

/** Polls the fixture until `ready` holds, so tests wait on what happened instead of a guess. */
const fixtureStateWhen = (
  url: string,
  requestId: string,
  ready: (state: FixtureState) => boolean
) =>
  fixtureState(url, requestId).pipe(
    Effect.filterOrFail(ready, () => new Error("Fixture state not ready yet")),
    Effect.retry(Schedule.spaced("50 millis")),
    Effect.timeout("10 seconds"),
    Effect.orDie
  );

/** A call's settled result, so a test can assert on rejections without throwing. */
const settled = <Value>(call: () => Promise<Value>) =>
  Effect.result(Effect.tryPromise(call));

/** Whether a settled call rejected with the server's InternalError. */
const rejectedWithInternalError = <Value>(
  result: Result.Result<Value, Cause.UnknownError>
): boolean =>
  Result.isFailure(result) && result.failure.cause instanceof InternalError;

const isAbortError = <Value>(
  result: Result.Result<Value, Cause.UnknownError>
): boolean =>
  Result.isFailure(result) &&
  result.failure.cause instanceof DOMException &&
  result.failure.cause.name === "AbortError";

const decodeAuditMetadata = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ planPersonId: Schema.String }))
);

const uniqueId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const decodeFixtureSession = Schema.decodeUnknownSync(
  Schema.fromJsonString(fixtureSessionSchema)
);

/** A fresh user with its own credential, so a rate-limited answer never holds another test. */
const nativeSession = (url: string) =>
  Effect.promise(async () => {
    const response = await fetch(`${url}${FIXTURE_SESSION_PATH}`, {
      method: "POST",
    });
    return decodeFixtureSession(await response.text());
  });

const bearerHeaders = (token: string, accountId: string) => ({
  authorization: `Bearer ${token}`,
  "x-pcobooster-account": accountId,
});

/** Headers for a fresh session acting as its account with every flag off. */
const flagOffSession = (url: string) =>
  Effect.map(nativeSession(url), (session) =>
    bearerHeaders(session.token, session.flagOffAccountId)
  );

const fixtureDemoToken = (() => {
  const { demo } = testServerConfig(FIXTURE_DEMO_SETTINGS);
  if (demo === null) {
    throw new Error("FIXTURE_DEMO_SETTINGS must configure a demo");
  }
  return demoSessionToken(demo);
})();

/** The product client as the native app builds it, sending `headers` on every call. */
const nativeClient = (url: string, headers: Record<string, string>) =>
  makeProductClient({
    url,
    client: "expo",
    credentials: "omit",
    httpHeaders: () => headers,
  });

test(
  "serves later and concurrent requests from the server the first request built",
  Effect.gen(function* serverReuse() {
    const url = yield* fixtureUrl;
    const client = nativeClient(url, yield* flagOffSession(url));
    const first = yield* Effect.promise(
      async () => await client.run((api) => api.health.get())
    );
    const second = yield* Effect.promise(
      async () => await client.run((api) => api.health.get())
    );
    const concurrent = yield* Effect.promise(
      async () =>
        await Promise.all([
          client.run((api) =>
            api.catalog.plan({
              params: { serviceTypeId: "st-reuse", planId: "plan-a" },
            })
          ),
          client.run((api) =>
            api.catalog.plan({
              params: { serviceTypeId: "st-reuse", planId: "plan-b" },
            })
          ),
        ])
    );
    const state = yield* fixtureState(url);

    assert.strictEqual(first.version, FIXTURE_RELEASE_VERSION);
    assert.strictEqual(second.version, FIXTURE_RELEASE_VERSION);
    assert.deepStrictEqual(
      concurrent.map((plan) => plan?.id),
      ["plan-a", "plan-b"]
    );
    assert.strictEqual(state.serverBuilds, 1);
  }),
  requestTimeout
);

/**
 * Calls `tag` and walks away after `abortAfterMs`: the client aborts its fetch, and the fixture
 * aborts the request's signal at the same moment (local workerd never reports the disconnect
 * itself; see `transport-stack.fixture.ts`). Resolves with how the call settled.
 */
const abandonedCall = <Value, Failure>(
  url: string,
  headers: Record<string, string>,
  call: (api: ProductApi) => Effect.Effect<Value, Failure>,
  requestId: string,
  abortAfterMs: number
) => {
  const client = nativeClient(url, headers);
  const controller = new AbortController();
  const clientAbort = setTimeout(() => {
    controller.abort();
  }, abortAfterMs);
  return settled(
    async () =>
      await client.run(call, {
        signal: controller.signal,
        httpHeaders: {
          "x-request-id": requestId,
          [FIXTURE_ABORT_AFTER_HEADER]: String(abortAfterMs),
        },
      })
  ).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        clearTimeout(clientAbort);
      })
    )
  );
};

const assignInput = (serviceTypeId: string) => ({
  serviceTypeId,
  personId: "person-1",
  planId: "plan-1",
  teamId: "team-1",
  positionId: "position-1",
  positionName: "Vocals",
  oneOff: true,
});

test(
  "stops a read and logs 499 when its caller aborts",
  Effect.gen(function* abortRead() {
    const url = yield* fixtureUrl;
    const requestId = uniqueId("abort-read");
    const planId = uniqueId("slow-read");
    const outcome = yield* abandonedCall(
      url,
      yield* flagOffSession(url),
      (api) =>
        api.catalog.plan({ params: { serviceTypeId: "st-abort", planId } }),
      requestId,
      400
    );
    yield* fixtureStateWhen(url, requestId, (state) => state.logs.length > 0);
    // Unaborted, the read would have sent its retry by now: attempts take 1.5 s, then wait 0.3 s.
    yield* Effect.sleep("3 seconds");
    const state = yield* fixtureState(url, requestId);
    const reads = state.planningCenterCalls.filter((entry) =>
      entry.path.endsWith(planId)
    );

    assert.isTrue(isAbortError(outcome));
    assert.strictEqual(state.disconnects.length, 1);
    assert.deepStrictEqual(
      reads.map((entry) => entry.startedAt < (state.disconnects[0]?.at ?? 0)),
      [true]
    );
    assert.deepStrictEqual(
      state.logs.map(({ fields }) => [
        fields.procedure,
        fields.status,
        fields.code,
      ]),
      [["catalog.plan", 499, "CLIENT_CLOSED_REQUEST"]]
    );
  }),
  { timeout: 30_000 }
);

test(
  "skips the commit when a write is aborted during prepare, and audits 499",
  Effect.gen(function* abortPrepare() {
    const url = yield* fixtureUrl;
    const requestId = uniqueId("abort-prepare");
    const serviceTypeId = uniqueId("slow-prepare");
    const outcome = yield* abandonedCall(
      url,
      yield* flagOffSession(url),
      (api) => {
        const input = assignInput(serviceTypeId);
        return api.schedule.assign({ params: input, payload: input });
      },
      requestId,
      400
    );
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length > 0 && current.audit.length > 0
    );

    assert.isTrue(isAbortError(outcome));
    assert.deepStrictEqual(
      state.planningCenterCalls
        .filter((entry) => entry.path.includes(serviceTypeId))
        .map((entry) => entry.method),
      ["GET"]
    );
    assert.deepStrictEqual(
      state.audit.map((row) => [row.status_code, row.error_code, row.success]),
      [[499, "CLIENT_CLOSED_REQUEST", 0]]
    );
    assert.deepStrictEqual(
      state.logs.map(({ fields }) => [fields.procedure, fields.status]),
      [["schedule.assign", 499]]
    );
  }),
  { timeout: 30_000 }
);

test(
  "finishes a write aborted during commit and audits its real result",
  Effect.gen(function* abortCommit() {
    const url = yield* fixtureUrl;
    const requestId = uniqueId("abort-commit");
    const serviceTypeId = uniqueId("slow-commit");
    const outcome = yield* abandonedCall(
      url,
      yield* flagOffSession(url),
      (api) => {
        const input = assignInput(serviceTypeId);
        return api.schedule.assign({ params: input, payload: input });
      },
      requestId,
      600
    );
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length > 0 && current.audit.length > 0
    );
    const commit = state.planningCenterCalls.find(
      (entry) => entry.method === "POST" && entry.path.includes(serviceTypeId)
    );
    const abortedAt = state.disconnects[0]?.at ?? 0;

    assert.isTrue(isAbortError(outcome));
    // The caller left after the provider write started and before it finished.
    assert.isTrue((commit?.startedAt ?? Infinity) < abortedAt);
    assert.isTrue((commit?.finishedAt ?? 0) > abortedAt);
    assert.deepStrictEqual(
      state.audit.map((row) => [
        row.method,
        row.path,
        row.status_code,
        row.error_code,
        row.success,
        decodeAuditMetadata(row.metadata).planPersonId,
      ]),
      [
        [
          "POST",
          `/api/v1/service-types/${serviceTypeId}/plans/plan-1/team-members`,
          200,
          null,
          1,
          "plan-person-slow",
        ],
      ]
    );
    assert.deepStrictEqual(
      state.logs.map(({ fields }) => [
        fields.procedure,
        fields.status,
        fields.code,
      ]),
      [["schedule.assign", 200, null]]
    );
  }),
  { timeout: 30_000 }
);

test(
  "answers unknown endpoints 400, a known path's other methods 405 with Allow, and logs both",
  Effect.gen(function* unmatchedRequests() {
    const url = yield* fixtureUrl;
    const unknownId = uniqueId("unknown-endpoint");
    const methodId = uniqueId("wrong-method");
    const unknown = yield* sendHttp(url, "/api/v1/catalog/retired", {
      headers: { "x-request-id": unknownId },
    });
    const wrongMethod = yield* sendHttp(url, "/api/v1/plan-people/pp-1", {
      headers: { "x-request-id": methodId },
    });
    const unknownState = yield* fixtureStateWhen(
      url,
      unknownId,
      (state) => state.logs.length > 0
    );
    const methodState = yield* fixtureStateWhen(
      url,
      methodId,
      (state) => state.logs.length > 0
    );

    assert.deepStrictEqual(
      [unknown.status, unknown.tag, unknown.reason],
      [400, "RequestRejected", "unknown-endpoint"]
    );
    assert.deepStrictEqual(
      [wrongMethod.status, wrongMethod.headers.get("allow"), wrongMethod.tag],
      [405, "DELETE, PATCH", "RequestRejected"]
    );
    assert.deepStrictEqual(
      [...unknownState.logs, ...methodState.logs].map(({ level, fields }) => [
        level,
        fields.procedure,
        fields.method,
        fields.route,
        fields.status,
        fields.kind,
      ]),
      [
        ["Info", null, "GET", "/api/v1/catalog/retired", 400, null],
        ["Info", null, "GET", "/api/v1/plan-people/:planPersonId", 405, null],
      ]
    );
  }),
  requestTimeout
);

test(
  "answers a success that fails to encode with 500 InternalError",
  Effect.gen(function* encodeFailure() {
    const url = yield* fixtureUrl;
    const headers = yield* flagOffSession(url);
    const requestId = uniqueId("unencodable");
    const raw = yield* sendHttp(
      url,
      `/api/v1/service-types/${uniqueId("unencodable")}/plans/plan-1/team-members`,
      {
        method: "POST",
        headers: { ...headers, "x-request-id": requestId },
        body: JSON.stringify({
          personId: "person-1",
          teamId: "team-1",
          positionId: "position-1",
          positionName: "Vocals",
          oneOff: true,
        }),
      }
    );
    const client = nativeClient(url, headers);
    const typed = yield* settled(
      async () =>
        await client.run((api) =>
          api.schedule.assign({
            params: assignInput(uniqueId("unencodable")),
            payload: assignInput(uniqueId("unencodable")),
          })
        )
    );
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length > 0
    );

    assert.deepStrictEqual(
      [raw.status, raw.tag, raw.message],
      [500, "InternalError", "Internal server error"]
    );
    assert.isTrue(rejectedWithInternalError(typed));
    assert.deepStrictEqual(
      state.logs.map(({ level, fields }) => [
        level,
        fields.procedure,
        fields.status,
        fields.code,
      ]),
      [["Error", "schedule.assign", 500, "INTERNAL_SERVER_ERROR"]]
    );
  }),
  requestTimeout
);

test(
  "joins a native app's 5xx to exactly one outcome line by request ID, with its release",
  Effect.gen(function* nativeFailureCorrelation() {
    const url = yield* fixtureUrl;
    const headers = yield* flagOffSession(url);
    const requestId = uniqueId("mobile-5xx");
    const client = nativeClient(url, headers);
    const failed = yield* settled(
      async () =>
        await client.run(
          (api) =>
            api.schedule.assign({
              params: assignInput(uniqueId("unencodable")),
              payload: assignInput(uniqueId("unencodable")),
            }),
          {
            httpHeaders: {
              "x-request-id": requestId,
              "x-pcobooster-app": "0.1.0(372)+1a2b3c4",
            },
          }
        )
    );
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length > 0
    );

    assert.isTrue(rejectedWithInternalError(failed));
    assert.deepStrictEqual(
      state.logs.map(({ fields }) => [
        fields.requestId,
        fields.appRelease,
        fields.client,
        fields.procedure,
        fields.status,
      ]),
      [[requestId, "0.1.0(372)+1a2b3c4", "expo;api=2", "schedule.assign", 500]]
    );
  }),
  requestTimeout
);

test(
  "keeps a sibling call alive when another call's handler dies",
  Effect.gen(function* defectIsolation() {
    const url = yield* fixtureUrl;
    const client = nativeClient(url, yield* flagOffSession(url));
    const [died, survived] = yield* Effect.all(
      [
        settled(
          async () =>
            await client.run((api) =>
              api.catalog.plan({
                params: {
                  serviceTypeId: "st-defect",
                  planId: uniqueId("defect"),
                },
              })
            )
        ),
        settled(
          async () =>
            await client.run((api) =>
              api.catalog.plan({
                params: { serviceTypeId: "st-defect", planId: "plan-ok" },
              })
            )
        ),
      ],
      { concurrency: "unbounded" }
    );

    assert.isTrue(rejectedWithInternalError(died));
    assert.strictEqual(
      Result.isSuccess(survived) ? survived.success?.id : null,
      "plan-ok"
    );
  }),
  requestTimeout
);

test(
  "writes one outcome line per call with its route, status, priority, and Planning Center requests",
  Effect.gen(function* outcomeLine() {
    const url = yield* fixtureUrl;
    const client = nativeClient(url, yield* flagOffSession(url));
    const requestId = uniqueId("outcome-line");
    yield* Effect.promise(
      async () =>
        await client.run(
          (api) =>
            api.catalog.plan({
              params: { serviceTypeId: "st-outcome", planId: "plan-outcome" },
            }),
          {
            priority: "speculative",
            httpHeaders: { "x-request-id": requestId },
          }
        )
    );
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length > 0
    );

    assert.deepStrictEqual(
      state.logs.map(({ level, fields }) => ({
        level,
        procedure: fields.procedure,
        method: fields.method,
        route: fields.route,
        status: fields.status,
        code: fields.code,
        priority: fields.priority,
        kind: fields.kind,
        client: fields.client,
        planningCenterRequests: fields.planningCenterRequests,
      })),
      [
        {
          level: "Info",
          procedure: "catalog.plan",
          method: "GET",
          route: "/api/v1/service-types/:serviceTypeId/plans/:planId",
          status: 200,
          code: null,
          priority: "speculative",
          kind: "read",
          client: "expo;api=2",
          planningCenterRequests: 1,
        },
      ]
    );
  }),
  requestTimeout
);

test(
  "answers a flagged read NotFound while its flag is off, before any Planning Center request",
  Effect.gen(function* flaggedReadOff() {
    const url = yield* fixtureUrl;
    const requestId = uniqueId("flag-off");
    const client = nativeClient(url, yield* flagOffSession(url));
    const outcome = yield* settled(
      async () =>
        await client.run((api) => api.people.dashboardRoster(), {
          httpHeaders: { "x-request-id": requestId },
        })
    );
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length > 0
    );

    assert.isTrue(
      Result.isFailure(outcome) && outcome.failure.cause instanceof NotFound
    );
    assert.deepStrictEqual(
      state.logs.map(({ level, fields }) => [
        level,
        fields.procedure,
        fields.status,
        fields.code,
        fields.planningCenterRequests,
      ]),
      [["Info", "people.dashboardRoster", 404, "NOT_FOUND", 0]]
    );
  }),
  requestTimeout
);

const STATUS_WRITE = (planPersonId: string) => ({
  planPersonId,
  status: "C" as const,
  serviceTypeId: "st-1",
  personId: "person-1",
  planId: "plan-1",
});

test(
  "authenticates calls by bearer token and picks the account the header names",
  Effect.gen(function* httpBearer() {
    const url = yield* fixtureUrl;
    const session = yield* nativeSession(url);
    const onClient = nativeClient(
      url,
      bearerHeaders(session.token, session.flagOnAccountId)
    );
    const offClient = nativeClient(
      url,
      bearerHeaders(session.token, session.flagOffAccountId)
    );
    const charts = yield* Effect.promise(
      async () =>
        await onClient.run((api) =>
          api.chordCharts.song({ params: { songId: " song-1 " } })
        )
    );
    const flagOff = yield* settled(
      async () =>
        await offClient.run((api) =>
          api.chordCharts.song({ params: { songId: "song-1" } })
        )
    );

    assert.deepStrictEqual(charts, {
      song: { id: "song-1", title: "Amazing Grace", author: "John Newton" },
      arrangements: [],
    });
    assert.isTrue(
      Result.isFailure(flagOff) &&
        flagOff.failure.cause instanceof NotFound &&
        failureStatus(flagOff.failure.cause) === 404
    );
  }),
  requestTimeout
);

test(
  "pages people.planWindowHistory with a continuation in a POST body and logs its outcome line",
  Effect.gen(function* httpPagedRead() {
    const url = yield* fixtureUrl;
    const requestId = uniqueId("http-paged");
    const since = Date.now();
    const client = nativeClient(url, {
      ...(yield* flagOffSession(url)),
      "x-request-id": requestId,
    });
    const batch = yield* Effect.promise(
      async () =>
        await client.run(
          (api) =>
            api.people.planWindowHistory({
              payload: {
                date: "2026-10-11T10:00:00-07:00",
                continuation: {
                  plans: [],
                  ranges: [
                    { serviceTypeId: "st-2", offset: 0, boundaryPlanId: null },
                  ],
                },
              },
            }),
          { priority: "speculative" }
        )
    );
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length > 0
    );

    assert.deepStrictEqual(
      [batch.loadedPlanCount, batch.deferredPlans, batch.deferredRanges],
      [0, [], []]
    );
    assert.deepStrictEqual(
      state.planningCenterCalls
        .filter(
          (entry) => entry.startedAt >= since && entry.path.endsWith("/plans")
        )
        .map((entry) => entry.path),
      ["/services/v2/service_types/st-2/plans"]
    );
    assert.deepStrictEqual(
      state.logs.map(({ fields }) => [
        fields.procedure,
        fields.method,
        fields.status,
        fields.priority,
        fields.kind,
        fields.client,
      ]),
      [
        [
          "people.planWindowHistory",
          "POST",
          200,
          "speculative",
          "read",
          "expo;api=2",
        ],
      ]
    );
  }),
  requestTimeout
);

test(
  "answers RateLimited on a progressive people read when Planning Center rate limits",
  Effect.gen(function* rateLimitedProgressiveRead() {
    const url = yield* fixtureUrl;
    const client = nativeClient(url, yield* flagOffSession(url));
    const outcome = yield* settled(
      async () =>
        await client.run((api) =>
          api.people.planWindowHistory({
            payload: {
              date: "2026-10-11T10:00:00-07:00",
              continuation: {
                plans: [],
                ranges: [
                  {
                    serviceTypeId: "rate-limit-st-2",
                    offset: 0,
                    boundaryPlanId: null,
                  },
                ],
              },
            },
          })
        )
    );

    assert.isTrue(
      Result.isFailure(outcome) && outcome.failure.cause instanceof RateLimited
    );
  }),
  requestTimeout
);

test(
  "answers RateLimited on catalog.plans when Planning Center rate limits, not an empty list",
  Effect.gen(function* rateLimitedCatalogRead() {
    const url = yield* fixtureUrl;
    const client = nativeClient(url, yield* flagOffSession(url));
    const outcome = yield* settled(
      async () =>
        await client.run((api) =>
          api.catalog.plans({
            params: { serviceTypeId: "rate-limit-st-1" },
          })
        )
    );

    assert.isTrue(Result.isFailure(outcome));
    if (!Result.isFailure(outcome)) {
      return;
    }
    assert.isTrue(outcome.failure.cause instanceof RateLimited);
  }),
  requestTimeout
);

test(
  "answers ExternalServiceFailure on catalog.plans when Cloudflare refuses a Planning Center subrequest",
  Effect.gen(function* subrequestLimitedCatalogRead() {
    const url = yield* fixtureUrl;
    const client = nativeClient(url, yield* flagOffSession(url));
    const outcome = yield* settled(
      async () =>
        await client.run((api) =>
          api.catalog.plans({
            params: { serviceTypeId: "subrequest-limit-st-1" },
          })
        )
    );

    assert.isTrue(Result.isFailure(outcome));
    if (!Result.isFailure(outcome)) {
      return;
    }
    const { cause } = outcome.failure;
    assert.isTrue(cause instanceof ExternalServiceFailure);
    if (!(cause instanceof ExternalServiceFailure)) {
      return;
    }
    assert.include(
      cause.message,
      "more Planning Center calls than one request allows"
    );
  }),
  requestTimeout
);

test(
  "PATCHes a plan person's status through the typed client and audits the real path",
  Effect.gen(function* httpWrite() {
    const url = yield* fixtureUrl;
    const requestId = uniqueId("http-write");
    const planPersonId = uniqueId("plan-person");
    const client = nativeClient(url, {
      ...(yield* flagOffSession(url)),
      "x-request-id": requestId,
    });
    const updated = yield* Effect.promise(
      async () =>
        await client.run((api) =>
          api.schedule.updateStatus({
            params: STATUS_WRITE(planPersonId),
            payload: STATUS_WRITE(planPersonId),
          })
        )
    );
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length > 0 && current.audit.length > 0
    );

    assert.deepStrictEqual(updated, { success: true });
    assert.deepStrictEqual(
      state.audit.map((row) => [
        row.method,
        row.path,
        row.status_code,
        row.success,
      ]),
      [["PATCH", `/api/v1/plan-people/${planPersonId}`, 200, 1]]
    );
    assert.deepStrictEqual(
      state.logs.map(({ fields }) => [
        fields.procedure,
        fields.status,
        fields.kind,
      ]),
      [["schedule.updateStatus", 200, "write"]]
    );
  }),
  requestTimeout
);

test(
  "answers Planning Center's failures on a write with each fault's status, CORS, and no-store",
  Effect.gen(function* httpWriteFaults() {
    const url = yield* fixtureUrl;
    const answers = yield* Effect.all(
      ["limited", "down", "missing", "refused"].map((script) =>
        Effect.gen(function* scriptedWrite() {
          // Each its own credential: a 429 holds back its credential's later requests.
          const headers = yield* flagOffSession(url);
          return yield* sendHttp(
            url,
            `/api/v1/plan-people/${uniqueId(script)}`,
            {
              method: "PATCH",
              headers: { origin: FIXTURE_ORIGIN, ...headers },
              body: JSON.stringify({
                status: "D",
                serviceTypeId: "st-1",
                planId: "plan-1",
              }),
            }
          );
        })
      )
    );
    const client = nativeClient(url, yield* flagOffSession(url));
    const typed = yield* Effect.all(
      ["limited", "down"].map((script) =>
        settled(
          async () =>
            await client.run((api) =>
              api.schedule.updateStatus({
                params: STATUS_WRITE(uniqueId(script)),
                payload: STATUS_WRITE(uniqueId(script)),
              })
            )
        )
      )
    );

    assert.deepStrictEqual(
      answers.map((answer) => [
        answer.status,
        answer.tag,
        ...corsAndCache(answer),
      ]),
      [
        [429, "RateLimited", FIXTURE_ORIGIN, "true", "private, no-store"],
        [
          502,
          "ExternalServiceFailure",
          FIXTURE_ORIGIN,
          "true",
          "private, no-store",
        ],
        [404, "NotFound", FIXTURE_ORIGIN, "true", "private, no-store"],
        [403, "Forbidden", FIXTURE_ORIGIN, "true", "private, no-store"],
      ]
    );
    assert.strictEqual(
      answers[0]?.headers.get("retry-after"),
      String(FIXTURE_RETRY_AFTER_SECONDS)
    );
    const [limited, down] = typed;
    assert.isTrue(
      limited !== undefined &&
        Result.isFailure(limited) &&
        limited.failure.cause instanceof RateLimited &&
        limited.failure.cause.retryAfterSeconds === FIXTURE_RETRY_AFTER_SECONDS
    );
    assert.isTrue(
      down !== undefined &&
        Result.isFailure(down) &&
        down.failure.cause instanceof ExternalServiceFailure
    );
  }),
  { timeout: 60_000 }
);

test(
  "answers a defect behind an endpoint with 500 InternalError and no detail",
  Effect.gen(function* httpDefect() {
    const url = yield* fixtureUrl;
    const session = yield* nativeSession(url);
    const headers = bearerHeaders(session.token, session.flagOnAccountId);
    const answer = yield* sendHttp(url, "/api/v1/songs/defect-1/chord-charts", {
      headers,
    });
    const client = nativeClient(url, headers);
    const typed = yield* settled(
      async () =>
        await client.run((api) =>
          api.chordCharts.song({ params: { songId: "defect-2" } })
        )
    );

    assert.deepStrictEqual(
      [answer.status, answer.tag, answer.message],
      [500, "InternalError", "Internal server error"]
    );
    assert.isTrue(rejectedWithInternalError(typed));
  }),
  requestTimeout
);

test(
  "rejects malformed input with 400 before any Planning Center request",
  Effect.gen(function* httpMalformed() {
    const url = yield* fixtureUrl;
    const session = yield* nativeSession(url);
    const requestId = uniqueId("http-malformed");
    const headers = {
      ...bearerHeaders(session.token, session.flagOnAccountId),
      "x-request-id": requestId,
    };
    const planPersonId = uniqueId("never-written");
    const history = "/api/v1/people/plan-window-history";
    const answers = yield* Effect.all([
      sendHttp(url, history, {
        method: "POST",
        headers,
        body: JSON.stringify({ date: "next-sunday" }),
      }),
      sendHttp(url, history, {
        method: "POST",
        headers,
        body: JSON.stringify({
          date: "2026-10-11T17:00:00Z",
          continuation: "{not json",
        }),
      }),
      sendHttp(url, "/api/v1/songs/%20/chord-charts", { headers }),
      sendHttp(url, `/api/v1/plan-people/${planPersonId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "X" }),
      }),
      sendHttp(url, `/api/v1/plan-people/${planPersonId}`, {
        method: "PATCH",
        headers,
        body: "{",
      }),
      sendHttp(url, `/api/v1/plan-people/${planPersonId}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "text/plain" },
        body: "status=C",
      }),
    ]);
    const state = yield* fixtureStateWhen(
      url,
      requestId,
      (current) => current.logs.length >= answers.length
    );

    assert.deepStrictEqual(
      answers.map((answer) => [answer.status, answer.tag, answer.reason]),
      [
        [400, "RequestRejected", "invalid-payload"],
        [400, "RequestRejected", "invalid-payload"],
        [400, "RequestRejected", "invalid-payload"],
        [400, "RequestRejected", "invalid-payload"],
        [400, "RequestRejected", "invalid-payload"],
        [400, "RequestRejected", "malformed-request"],
      ]
    );
    assert.isFalse(
      state.planningCenterCalls.some((entry) =>
        entry.path.includes(planPersonId)
      )
    );
    assert.deepStrictEqual(
      state.logs.map(({ fields }) => [
        fields.status,
        fields.planningCenterRequests,
      ]),
      Array.from({ length: answers.length }, () => [400, 0])
    );
  }),
  requestTimeout
);

test(
  "serves a demo session from the demo header: reads answer, writes are refused as read-only",
  Effect.gen(function* httpDemo() {
    const url = yield* fixtureUrl;
    const client = nativeClient(url, {
      "x-pcobooster-demo": fixtureDemoToken,
    });
    const read = yield* Effect.promise(
      async () =>
        await client.run((api) =>
          api.people.planWindowHistory({
            payload: {
              date: "2026-10-11T17:00:00Z",
              serviceTypeId: "st-1",
            },
          })
        )
    );
    const write = yield* settled(
      async () =>
        await client.run((api) =>
          api.schedule.updateStatus({
            params: STATUS_WRITE(uniqueId("demo")),
            payload: STATUS_WRITE(uniqueId("demo")),
          })
        )
    );
    const unknownDemo = yield* sendHttp(
      url,
      "/api/v1/people/plan-window-history",
      {
        method: "POST",
        headers: { "x-pcobooster-demo": "not-the-demo-token" },
        body: JSON.stringify({ date: "2026-10-11T17:00:00Z" }),
      }
    );

    assert.strictEqual(read.loadedPlanCount, 0);
    assert.isTrue(
      Result.isFailure(write) &&
        write.failure.cause instanceof Forbidden &&
        write.failure.cause.message ===
          "This demo is read-only, so changes aren't saved."
    );
    assert.deepStrictEqual(
      [unknownDemo.status, unknownDemo.tag],
      [401, "Unauthenticated"]
    );
  }),
  requestTimeout
);
