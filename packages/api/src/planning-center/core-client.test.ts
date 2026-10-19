import { createHash } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import { PlanningCenterAccounting } from "@pcobooster/api/planning-center/accounting";
import {
  PlanningCenterCoreClient,
  createBasicPlanningCenterClient,
} from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPacing } from "@pcobooster/api/planning-center/pacing";
import { PlanningCenterPaginationError } from "@pcobooster/api/planning-center/pagination-error";
import { PlanningCenterRatePacer } from "@pcobooster/api/planning-center/rate-pacer";
import { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import { PLANNING_CENTER_USER_AGENT } from "@pcobooster/api/planning-center/user-agent";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { recordLogs } from "@pcobooster/api/testing/logs";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import type { JsonValue } from "@pcobooster/planning-center-models/json";
import { Cause, Clock, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";

type FetchMock = ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

const jsonResponse = (body: JsonValue, init?: ResponseInit): Response =>
  Response.json(body, init);
const person = { id: "1", type: "Person", attributes: { name: "Alex" } };

const fetchMock = (): FetchMock => vi.fn<typeof globalThis.fetch>();

const songsPageUrl = (offset: number) =>
  `https://api.planningcenteronline.com/services/v2/songs?offset=${offset}&per_page=100`;
const titledSongsPageUrl = (offset: number) =>
  `https://api.planningcenteronline.com/services/v2/songs?offset=${offset}&order=title&per_page=100`;

const basicClient = (fetch: FetchMock): PlanningCenterCoreClient =>
  createBasicPlanningCenterClient(
    testPlanningCenterToken,
    httpClientFor(fetch)
  );

const run = async <Value>(
  effect: Effect.Effect<Value, PlanningCenterError>
): Promise<Value> => await Effect.runPromise(effect);

const failureOf = async <Value>(
  effect: Effect.Effect<Value, PlanningCenterError>
): Promise<PlanningCenterError | undefined> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return undefined;
  }
  return exit.cause.reasons.find(Cause.isFailReason)?.error;
};

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input.toString();

const isInterrupted = <Value, Failure>(
  exit: Exit.Exit<Value, Failure>
): boolean => Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);

const requestHeaders = (fetch: FetchMock, call = 0): Headers =>
  new Headers(fetch.mock.calls[call]?.[1]?.headers);

/** Resolves once the request is aborted, like `fetch` does. */
const hangUntilAborted: typeof globalThis.fetch = async (_input, init) => {
  const signal = init?.signal;
  if (signal) {
    await once(signal, "abort");
  }
  throw new DOMException("The operation was aborted", "AbortError");
};

/** Lets mocked fetch promises and body reads settle before the test clock moves. */
const settle = Effect.promise(async () => {
  await delay(20);
});

describe(PlanningCenterCoreClient, () => {
  it("binds bearer requests and cache scope to the constructor credential", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    const client = new PlanningCenterCoreClient(
      { kind: "bearer", accessToken: "selected-account-token" },
      { httpClient: httpClientFor(fetch) }
    );
    await run(client.fetch("/services/v2/people/1"));
    const headers = requestHeaders(fetch);
    expect(headers.get("Authorization")).toBe("Bearer selected-account-token");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.has("traceparent")).toBeFalsy();
    expect(client.getCacheScope()).toBe(
      `bearer:${createHash("sha256").update("selected-account-token").digest("hex")}`
    );
  });

  it("identifies itself to Planning Center with a User-Agent", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    await run(basicClient(fetch).fetch("/services/v2/people/1"));
    expect(requestHeaders(fetch).get("User-Agent")).toBe(
      PLANNING_CENTER_USER_AGENT
    );
  });

  it.each(["", "   "])("rejects empty bearer credential %j", (accessToken) => {
    expect(
      () =>
        new PlanningCenterCoreClient(
          { kind: "bearer", accessToken },
          { httpClient: httpClientFor(fetchMock()) }
        )
    ).toThrow("requires a non-empty access token");
  });

  it("uses application credentials only with the explicit Basic factory", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    const client = createBasicPlanningCenterClient(
      { applicationId: "client", secret: "pat" },
      httpClientFor(fetch)
    );
    await run(client.fetch("/services/v2/people/1"));
    expect(requestHeaders(fetch).get("Authorization")).toBe(
      `Basic ${Buffer.from("client:pat").toString("base64")}`
    );
    expect(client.getCacheScope()).toBe(
      `basic:${createHash("sha256").update("client:pat").digest("hex")}`
    );
  });

  it("sends a JSON body with a write", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    await run(
      basicClient(fetch).fetch("/services/v2/people", {
        method: "POST",
        body: { data: { type: "Person" } },
      })
    );
    const init = fetch.mock.calls[0]?.[1];
    const body = init?.body;
    expect(init?.method).toBe("POST");
    expect(
      body instanceof Uint8Array ? new TextDecoder().decode(body) : body
    ).toBe(JSON.stringify({ data: { type: "Person" } }));
    expect(requestHeaders(fetch).get("Content-Type")).toBe("application/json");
  });

  it("rejects writes from a read-only client before they reach Planning Center", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    const client = new PlanningCenterCoreClient(
      { kind: "basic", applicationId: "demo", secret: "demo-pat" },
      { httpClient: httpClientFor(fetch), readOnly: true }
    );

    await expect(
      failureOf(
        client.fetch("/services/v2/people/1", { method: "PATCH", body: {} })
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterReadOnlyError",
      method: "PATCH",
      path: "/services/v2/people/1",
    });
    await expect(
      failureOf(
        client.request("/services/v2/plan_times/1", { method: "DELETE" })
      )
    ).resolves.toMatchObject({ _tag: "PlanningCenterReadOnlyError" });
    expect(fetch).not.toHaveBeenCalled();

    await expect(
      run(client.fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({ data: person });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("lets a read-only client send a POST action that only reads", async () => {
    const fetch = fetchMock().mockResolvedValue(jsonResponse({ data: person }));
    const client = new PlanningCenterCoreClient(
      { kind: "basic", applicationId: "demo", secret: "demo-pat" },
      { httpClient: httpClientFor(fetch), readOnly: true }
    );

    await expect(
      run(
        client.fetch("/services/v2/songs/1/attachments/2/open", {
          method: "POST",
          body: {},
          readAction: true,
        })
      )
    ).resolves.toMatchObject({ data: person });
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("accepts empty writes through the transport method", async () => {
    const fetch = fetchMock().mockResolvedValue(
      new Response(null, { status: 204 })
    );
    const response = await run(
      basicClient(fetch).request("/services/v2/plan_times/1", {
        method: "DELETE",
      })
    );
    expect(response.status).toBe(204);
  });

  it("reads the error code from a JSON:API errors list", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(
        {
          errors: [
            {
              status: "401",
              code: "TRASH_PANDA",
              title: "Unauthorized",
              detail: "You do not have access to this application",
            },
          ],
        },
        { status: 401 }
      )
    );
    await expect(
      failureOf(basicClient(fetch).fetch("/services/v2/me"))
    ).resolves.toMatchObject({ status: 401, code: "TRASH_PANDA" });
  });

  it("names a JSON:API validation failure's detail in its message", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(
        {
          errors: [
            {
              status: "422",
              title: "Unprocessable Entity",
              detail: "Length must be a number",
            },
          ],
        },
        { status: 422 }
      )
    );
    await expect(
      failureOf(basicClient(fetch).fetch("/services/v2/items/1"))
    ).resolves.toMatchObject({
      status: 422,
      message: "Planning Center API error: 422 - Length must be a number",
    });
  });

  it("logs a rejected write with what was sent, keeping the church's text out", async () => {
    // Planning Center's answer to a song item 86,401 seconds long (sandbox, 2026-10-18).
    const rejection = {
      errors: [
        {
          detail: "can not be longer than 24 hours",
          status: "422",
          title: "Validation Error",
          source: { parameter: "length" },
          meta: { resource: "PlanItem", associated_resources: [] },
        },
      ],
    };
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(rejection, { status: 422 })
    );
    const { lines, capture: logger } = recordLogs();
    await expect(
      Effect.runPromise(
        logger(
          Effect.flip(
            basicClient(fetch).fetch(
              "/services/v2/service_types/1/plans/2/items",
              {
                method: "POST",
                body: {
                  data: {
                    type: "Item",
                    attributes: {
                      title: "King of My Heart",
                      song_id: "15813603",
                      length: 86_401,
                    },
                  },
                },
              }
            )
          )
        )
      )
    ).resolves.toMatchObject({
      status: 422,
      message:
        "Planning Center API error: 422 - Length can not be longer than 24 hours",
    });
    expect(lines).toStrictEqual([
      {
        level: "warn",
        message: "Planning Center rejected a write",
        fields: {
          endpoint: {
            path: "/services/v2/service_types/1/plans/2/items",
            queryKeys: [],
          },
          method: "POST",
          status: 422,
          errors: rejection,
          sentAttributes: {
            title: "<16 characters>",
            song_id: "15813603",
            length: 86_401,
          },
        },
      },
    ]);
  });

  it("rejects an empty response where a JSON resource is required", async () => {
    const fetch = fetchMock().mockResolvedValue(
      new Response(null, { status: 204 })
    );
    await expect(
      failureOf(basicClient(fetch).fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([200, 503])(
    "classifies a failed %i response body stream as a provider network failure",
    async (status) => {
      const fetch = fetchMock().mockImplementation(
        async () =>
          await Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new TypeError("body stream failed"));
                },
              }),
              { status }
            )
          )
      );

      await expect(
        failureOf(basicClient(fetch).fetch("/services/v2/people/1"))
      ).resolves.toMatchObject({
        _tag: "PlanningCenterNetworkError",
        cause: { message: "body stream failed" },
      });
      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  it("rejects malformed resource identifiers before they enter service code", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({ data: { id: 1, type: "Person" } })
    );
    await expect(
      failureOf(basicClient(fetch).fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterApiError",
      code: "INVALID_RESPONSE",
    });
  });

  it("keeps nested attribute values exactly as Planning Center sent them", async () => {
    const attributes = {
      title: "Sunday",
      length: 5400,
      public: false,
      series_title: null,
      notes: [{ category: "Band", lines: ["Capo 2", null] }],
      layout: { columns: { order: [3, 1, 2] } },
    };
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({ data: [{ id: "1", type: "Plan", attributes }] })
    );
    const response = await run(
      basicClient(fetch).fetchCollection("/services/v2/plans")
    );
    expect(response.data).toStrictEqual([
      { id: "1", type: "Plan", attributes },
    ]);
  });

  it("rejects a body that is not JSON", async () => {
    const fetch = fetchMock().mockResolvedValue(
      new Response("<html>Bad gateway</html>", { status: 200 })
    );
    await expect(
      failureOf(basicClient(fetch).fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });

  it("normalizes a singleton collection and preserves null relationships", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({
        data: { ...person, relationships: { team: { data: null } } },
        links: { next: null },
      })
    );
    const response = await run(
      basicClient(fetch).fetchCollection("/services/v2/people")
    );
    expect(response.data).toStrictEqual([
      { ...person, relationships: { team: { data: null } } },
    ]);
    expect(response.links?.next).toBeUndefined();
  });

  it("accepts an absent relationship URL in schedule collections", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({
        data: [
          {
            type: "Schedule",
            id: "schedule-1",
            relationships: { plan_times: { links: { related: null } } },
          },
        ],
      })
    );
    const response = await run(
      basicClient(fetch).fetchCollection("/services/v2/people/me/schedules")
    );
    expect(response.data).toStrictEqual([
      {
        type: "Schedule",
        id: "schedule-1",
        attributes: {},
        relationships: { plan_times: { links: { related: undefined } } },
      },
    ]);
  });

  it("follows pagination to the end and deduplicates included resources", async () => {
    const firstUrl =
      "https://api.planningcenteronline.com/services/v2/people?per_page=100";
    const secondUrl =
      "https://api.planningcenteronline.com/services/v2/people?offset=100";
    const team = { type: "Team", id: "team-1", attributes: { name: "Band" } };
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [person],
          included: [team],
          links: { next: secondUrl },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ ...person, id: "2" }],
          included: [team],
          links: {},
        })
      );
    const response = await run(
      basicClient(fetch).fetchAllWithIncluded("/services/v2/people")
    );
    expect(response.data.map((item) => item.id)).toStrictEqual(["1", "2"]);
    expect(response.included).toStrictEqual([team]);
    expect(fetch.mock.calls.map(([input]) => urlOf(input))).toStrictEqual([
      firstUrl,
      secondUrl,
    ]);
  });

  it("requests the pages after the first together once the first reports the collection's size", async () => {
    const thirdPageRequested = Promise.withResolvers<null>();
    const fetch = fetchMock().mockImplementation(async (input) => {
      const url = urlOf(input);
      if (url === titledSongsPageUrl(200)) {
        thirdPageRequested.resolve(null);
        return jsonResponse({ data: [{ ...person, id: "3" }], links: {} });
      }
      if (url === titledSongsPageUrl(100)) {
        // Answers only once the third page was asked for, so reading page by page never ends.
        await thirdPageRequested.promise;
        return jsonResponse({
          data: [{ ...person, id: "2" }],
          links: { next: titledSongsPageUrl(200) },
        });
      }
      return jsonResponse({
        data: [person],
        meta: { total_count: 250 },
        links: { next: titledSongsPageUrl(100) },
      });
    });

    const response = await run(
      basicClient(fetch).fetchAllWithIncluded(
        "/services/v2/songs",
        { order: "title" },
        10
      )
    );

    expect({
      ids: response.data.map((item) => item.id),
      urls: fetch.mock.calls.map(([input]) => urlOf(input)),
    }).toStrictEqual({
      ids: ["1", "2", "3"],
      urls: [
        "https://api.planningcenteronline.com/services/v2/songs?order=title&per_page=100",
        titledSongsPageUrl(100),
        titledSongsPageUrl(200),
      ],
    });
  });

  it("follows the next link past a collection's reported size when it grew meanwhile", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [person],
          meta: { total_count: 150 },
          links: { next: songsPageUrl(100) },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ ...person, id: "2" }],
          links: { next: songsPageUrl(200) },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ ...person, id: "3" }], links: {} })
      );

    const response = await run(
      basicClient(fetch).fetchAllWithIncluded("/services/v2/songs")
    );

    expect({
      ids: response.data.map((item) => item.id),
      urls: fetch.mock.calls.map(([input]) => urlOf(input)),
    }).toStrictEqual({
      ids: ["1", "2", "3"],
      urls: [
        "https://api.planningcenteronline.com/services/v2/songs?per_page=100",
        songsPageUrl(100),
        songsPageUrl(200),
      ],
    });
  });

  it("fails rather than return part of a collection longer than its page limit", async () => {
    const pageWithNext = (offset: number) =>
      jsonResponse({
        data: [{ ...person, id: String(offset) }],
        links: {
          next: `https://api.planningcenteronline.com/services/v2/people?offset=${offset + 100}`,
        },
      });
    const fetch = fetchMock()
      .mockResolvedValueOnce(pageWithNext(0))
      .mockResolvedValueOnce(pageWithNext(100));

    const exit = await Effect.runPromiseExit(
      basicClient(fetch).fetchAllWithIncluded("/services/v2/people", {}, 2)
    );

    expect(exit).toStrictEqual(
      Exit.fail(
        new PlanningCenterPaginationError({
          reason: "page-limit",
          path: "/services/v2/people",
          pages: 2,
        })
      )
    );
  });

  it("returns the next link with the first pages of a collection that goes on", async () => {
    const nextUrl =
      "https://api.planningcenteronline.com/services/v2/people?offset=100";
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({ data: [person], links: { next: nextUrl } })
    );

    const response = await run(
      basicClient(fetch).fetchFirstPages("/services/v2/people", {}, 1)
    );

    expect(response).toStrictEqual({
      data: [person],
      included: [],
      next: nextUrl,
    });
  });

  it("fails on a next link that repeats a page instead of looping or stopping early", async () => {
    const firstUrl =
      "https://api.planningcenteronline.com/services/v2/people?per_page=100";
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({ data: [person], links: { next: firstUrl } })
    );

    const exit = await Effect.runPromiseExit(
      basicClient(fetch).fetchAllWithIncluded("/services/v2/people")
    );

    expect(exit).toStrictEqual(
      Exit.fail(
        new PlanningCenterPaginationError({
          reason: "invalid-next",
          path: "/services/v2/people",
          pages: 1,
        })
      )
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reads one page from an offset and returns the next page's offset", async () => {
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({
        data: [person],
        included: [],
        links: {
          next: "https://api.planningcenteronline.com/services/v2/people/1/blockouts?offset=300&per_page=100",
        },
      })
    );

    const page = await run(
      basicClient(fetch).fetchPage("/services/v2/people/1/blockouts", {}, 200)
    );

    expect({
      page,
      urls: fetch.mock.calls.map(([input]) => urlOf(input)),
    }).toStrictEqual({
      page: { data: [person], included: [], nextOffset: 300 },
      urls: [
        "https://api.planningcenteronline.com/services/v2/people/1/blockouts?per_page=100&offset=200",
      ],
    });
  });

  it("fails on a next page whose offset does not advance", async () => {
    const fetch = fetchMock().mockResolvedValueOnce(
      jsonResponse({
        data: [person],
        links: {
          next: "https://api.planningcenteronline.com/services/v2/people?offset=100",
        },
      })
    );

    const exit = await Effect.runPromiseExit(
      basicClient(fetch).fetchPage("/services/v2/people", {}, 100)
    );

    expect(exit).toStrictEqual(
      Exit.fail(
        new PlanningCenterPaginationError({
          reason: "invalid-next",
          path: "/services/v2/people",
          pages: 1,
        })
      )
    );
  });

  it("stops pagination and aborts the in-flight page when interrupted", async () => {
    const controller = new AbortController();
    const nextUrl =
      "https://api.planningcenteronline.com/services/v2/people?offset=100";
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({ data: [person], links: { next: nextUrl } })
      )
      .mockImplementationOnce(async (input, init) => {
        controller.abort();
        return await hangUntilAborted(input, init);
      });

    const exit = await Effect.runPromiseExit(
      basicClient(fetch).fetchAllWithIncluded("/services/v2/people"),
      { signal: controller.signal }
    );
    expect(isInterrupted(exit)).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBeTruthy();
  });

  it("retries a transient GET failure after a backoff", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({ error: "Temporarily unavailable" }, { status: 503 })
      )
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    const result = await Effect.runPromise(
      Effect.gen(function* retryAfterBackoff() {
        const fiber = yield* Effect.forkChild(
          basicClient(fetch).fetch("/services/v2/people/1")
        );
        yield* settle;
        yield* TestClock.adjust("499 millis");
        expect(fetch).toHaveBeenCalledOnce();
        yield* TestClock.adjust("1 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(result.data.id).toBe("1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits for Retry-After before retrying a rate-limited read", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "Rate limited" },
          { status: 429, headers: { "retry-after": "2" } }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    const result = await Effect.runPromise(
      Effect.gen(function* retryAfterRateLimit() {
        const fiber = yield* Effect.forkChild(
          basicClient(fetch).fetch("/services/v2/people/1")
        );
        yield* settle;
        yield* TestClock.adjust("1999 millis");
        expect(fetch).toHaveBeenCalledOnce();
        yield* TestClock.adjust("1 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(result.data.id).toBe("1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("resends a rate-limited write once its Retry-After passes", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "Rate limited" },
          { status: 429, headers: { "retry-after": "8" } }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    const result = await Effect.runPromise(
      Effect.gen(function* retryRateLimitedWrite() {
        const fiber = yield* Effect.forkChild(
          basicClient(fetch).fetch("/services/v2/people/1", {
            method: "PATCH",
            body: {},
          })
        );
        yield* settle;
        yield* TestClock.adjust("7999 millis");
        expect(fetch).toHaveBeenCalledOnce();
        yield* TestClock.adjust("1 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(result.data.id).toBe("1");
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toStrictEqual([
      "PATCH",
      "PATCH",
    ]);
  });

  it("resends a rate-limited write only once", async () => {
    const fetch = fetchMock().mockImplementation(
      async () =>
        await Promise.resolve(
          jsonResponse(
            { error: "Rate limited" },
            { status: 429, headers: { "retry-after": "1" } }
          )
        )
    );
    const failure = await Effect.runPromise(
      Effect.gen(function* exhaustWriteRetry() {
        const fiber = yield* Effect.forkChild(
          Effect.flip(
            basicClient(fetch).fetch("/services/v2/people", {
              method: "POST",
              body: {},
            })
          )
        );
        yield* settle;
        yield* TestClock.adjust("1 second");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(failure).toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up on a read after two retries", async () => {
    const fetch = fetchMock().mockImplementation(
      async () =>
        await Promise.resolve(
          jsonResponse({ error: "Temporarily unavailable" }, { status: 503 })
        )
    );
    const failure = await Effect.runPromise(
      Effect.gen(function* exhaustRetries() {
        const fiber = yield* Effect.forkChild(
          Effect.flip(basicClient(fetch).fetch("/services/v2/people/1"))
        );
        yield* settle;
        yield* TestClock.adjust("500 millis");
        yield* settle;
        yield* TestClock.adjust("1000 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(failure).toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("times out a stalled read attempt and retries it", async () => {
    const fetch = fetchMock()
      .mockImplementationOnce(hangUntilAborted)
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    await Effect.runPromise(
      Effect.gen(function* retryTimedOutAttempt() {
        const fiber = yield* Effect.forkChild(
          basicClient(fetch).fetch("/services/v2/people/1")
        );
        yield* settle;
        yield* TestClock.adjust("15 seconds");
        yield* settle;
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBeTruthy();
        yield* TestClock.adjust("300 millis");
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a write after a transient error", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse({ error: "Temporarily unavailable" }, { status: 503 })
    );
    await expect(
      failureOf(
        basicClient(fetch).fetch("/services/v2/people", {
          method: "POST",
          body: {},
        })
      )
    ).resolves.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("labels fetch failures and malformed provider responses", async () => {
    const fetch = fetchMock()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(
        new Response("not json", {
          headers: { "content-type": "application/json" },
        })
      );
    const client = basicClient(fetch);
    await expect(
      failureOf(client.fetch("/services/v2/people/1"))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterNetworkError",
      cause: { message: "network unavailable" },
    });
    await expect(
      failureOf(client.fetch("/services/v2/people/2"))
    ).resolves.toMatchObject({
      _tag: "PlanningCenterApiError",
      code: "INVALID_RESPONSE",
    });
  });

  it("stops an in-flight read without retrying when interrupted", async () => {
    const controller = new AbortController();
    const fetch = fetchMock().mockImplementation(async (input, init) => {
      controller.abort();
      return await hangUntilAborted(input, init);
    });
    const exit = await Effect.runPromiseExit(
      basicClient(fetch).fetch("/services/v2/people/1"),
      { signal: controller.signal }
    );
    expect(isInterrupted(exit)).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
  });
});

const recordingLogger = () => {
  const { lines, capture } = recordLogs();
  return { lines, logger: capture };
};

const rateLimitedResponse = (count: number): Response =>
  jsonResponse(
    { data: person },
    {
      headers: {
        "x-pco-api-request-rate-limit": "100",
        "x-pco-api-request-rate-count": String(count),
        // Successful responses report bare seconds; only 429s spell out the unit.
        "x-pco-api-request-rate-period": "20",
      },
    }
  );

interface Limits {
  readonly pacer: PlanningCenterRatePacer;
  readonly accounting: PlanningCenterRequestAccounting;
}

const limits = (
  accounting = new PlanningCenterRequestAccounting(),
  pacer = new PlanningCenterRatePacer()
): Limits => ({ pacer, accounting });

type LogCapture = ReturnType<typeof recordLogs>["capture"];

const withLimits =
  ({ pacer, accounting }: Limits, logger?: LogCapture) =>
  <Value, Failure>(
    effect: Effect.Effect<Value, Failure>
  ): Effect.Effect<Value, Failure> => {
    const limited = effect.pipe(
      Effect.provideService(PlanningCenterPacing, pacer),
      Effect.provideService(PlanningCenterAccounting, accounting)
    );
    return logger === undefined ? limited : logger(limited);
  };

const pacedClient = (fetch: FetchMock): PlanningCenterCoreClient =>
  new PlanningCenterCoreClient(
    { kind: "bearer", accessToken: "paced-account-token" },
    { httpClient: httpClientFor(fetch) }
  );

describe("Planning Center pacing and accounting", () => {
  it("spreads concurrent reads over the rest of the reported window", async () => {
    const fetch = fetchMock().mockImplementation(
      async () => await Promise.resolve(rateLimitedResponse(70))
    );
    const { lines, logger } = recordingLogger();
    const scope = limits();
    const client = pacedClient(fetch);
    await Effect.runPromise(
      Effect.gen(function* paceConcurrentReads() {
        yield* client.fetch("/services/v2/people/1");
        const fiber = yield* Effect.forkChild(
          Effect.all(
            [
              client.fetch("/services/v2/people/2"),
              client.fetch("/services/v2/people/3"),
            ],
            { concurrency: "unbounded" }
          )
        );
        yield* settle;
        expect(fetch).toHaveBeenCalledTimes(2);
        // 20 reads left (10 more are kept for writes) over 20 s: the next slot opens a second later.
        yield* TestClock.adjust("999 millis");
        yield* settle;
        expect(fetch).toHaveBeenCalledTimes(2);
        yield* TestClock.adjust("1 millis");
        yield* Fiber.join(fiber);
      }).pipe(withLimits(scope, logger), Effect.provide(TestClock.layer()))
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(scope.accounting.totals).toStrictEqual({
      requests: 3,
      pacedRequests: 1,
      pacedWaitMs: 1000,
      rateLimited: 0,
      rateLimitRejections: 0,
      subrequestLimitHits: 0,
    });
    expect(lines).toStrictEqual([
      {
        level: "info",
        message: "Planning Center request paced",
        fields: {
          endpoint: { path: "/services/v2/people/3", queryKeys: [] },
          method: "GET",
          attempt: 1,
          waitMs: 1000,
          // In flight before this request: the other concurrent read.
          rateLimit: { limit: 100, count: 70, periodMs: 20_000, inFlight: 1 },
        },
      },
    ]);
  });

  it("fails fast on a 429 whose Retry-After exceeds the wait cap", async () => {
    const fetch = fetchMock().mockResolvedValue(
      jsonResponse(
        { error: "Rate limited" },
        {
          status: 429,
          headers: {
            "retry-after": "30",
            "x-pco-api-request-rate-limit": "100",
            "x-pco-api-request-rate-count": "100",
            "x-pco-api-request-rate-period": "20 seconds",
          },
        }
      )
    );
    const { lines, logger } = recordingLogger();
    const scope = limits();
    const client = pacedClient(fetch);

    await expect(
      failureOf(
        client
          .fetch("/services/v2/people?where[id]=1")
          .pipe(withLimits(scope, logger))
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterApiError",
      status: 429,
      retryAfterSeconds: 30,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(lines).toStrictEqual([
      {
        level: "info",
        message: "Planning Center rate limited a request",
        fields: {
          endpoint: { path: "/services/v2/people", queryKeys: ["where[id]"] },
          method: "GET",
          attempt: 1,
          retryAfterSeconds: 30,
          rateLimit: {
            limit: 100,
            count: 100,
            period: "20 seconds",
            retryAfterSeconds: 30,
          },
          willRetry: false,
        },
      },
    ]);

    // The credential stays blocked, so the next read is refused without a request.
    await expect(
      failureOf(
        client.fetch("/services/v2/people/2").pipe(withLimits(scope, logger))
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterRateLimitError",
      retryAfterSeconds: 30,
    });
    expect({
      fetches: fetch.mock.calls.length,
      totals: scope.accounting.totals,
      lastLine: lines.at(-1)?.message,
    }).toMatchObject({
      fetches: 1,
      totals: { requests: 1, rateLimited: 1, rateLimitRejections: 1 },
      lastLine: "Planning Center request rejected: rate limit budget is spent",
    });
  });

  it("holds a speculative read back without sending it once the window is mostly used", async () => {
    const fetch = fetchMock().mockImplementation(
      async () =>
        await Promise.resolve(
          jsonResponse(
            { data: person },
            {
              headers: {
                "x-pco-api-request-rate-limit": "100",
                "x-pco-api-request-rate-count": "45",
                "x-pco-api-request-rate-period": "20 seconds",
              },
            }
          )
        )
    );
    const { lines, logger } = recordingLogger();
    const pacer = new PlanningCenterRatePacer();
    const client = pacedClient(fetch);
    const interactive = limits(new PlanningCenterRequestAccounting(), pacer);
    const speculative = limits(
      new PlanningCenterRequestAccounting({ priority: "speculative" }),
      pacer
    );

    await Effect.runPromise(
      client
        .fetch("/services/v2/people/1")
        .pipe(withLimits(interactive, logger))
    );
    await expect(
      failureOf(
        client
          .fetch("/services/v2/people/2")
          .pipe(withLimits(speculative, logger))
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterRateLimitError",
      reason: "speculative",
    });
    // The same read from an interactive procedure still goes out.
    await Effect.runPromise(
      client
        .fetch("/services/v2/people/2")
        .pipe(withLimits(interactive, logger))
    );
    expect({
      fetches: fetch.mock.calls.length,
      speculative: speculative.accounting.totals,
      lastLine: lines.at(-1),
    }).toMatchObject({
      fetches: 2,
      speculative: { requests: 0, rateLimitRejections: 1 },
      lastLine: {
        level: "info",
        message:
          "Planning Center speculative request held back: budget kept for interactive requests",
        fields: { priority: "speculative" },
      },
    });
  });

  it("does not release another read's slot when a speculative read is held back", async () => {
    const rateHeaders = {
      "x-pco-api-request-rate-limit": "100",
      "x-pco-api-request-rate-count": "45",
      "x-pco-api-request-rate-period": "20 seconds",
    };
    const { promise: pending, resolve: answerPending } =
      Promise.withResolvers<Response>();
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({ data: person }, { headers: rateHeaders })
      )
      .mockReturnValueOnce(pending);
    const { lines, logger } = recordingLogger();
    const pacer = new PlanningCenterRatePacer();
    const client = pacedClient(fetch);
    const interactive = limits(new PlanningCenterRequestAccounting(), pacer);
    const speculative = limits(
      new PlanningCenterRequestAccounting({ priority: "speculative" }),
      pacer
    );

    await Effect.runPromise(
      client
        .fetch("/services/v2/people/1")
        .pipe(withLimits(interactive, logger))
    );
    const inFlightRead = Effect.runPromise(
      client
        .fetch("/services/v2/people/2")
        .pipe(withLimits(interactive, logger))
    );
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    await expect(
      failureOf(
        client
          .fetch("/services/v2/people/3")
          .pipe(withLimits(speculative, logger))
      )
    ).resolves.toMatchObject({ reason: "speculative" });
    await expect(
      failureOf(
        client
          .fetch("/services/v2/people/4")
          .pipe(withLimits(speculative, logger))
      )
    ).resolves.toMatchObject({ reason: "speculative" });
    answerPending(jsonResponse({ data: person }, { headers: rateHeaders }));
    await inFlightRead;

    // Each held-back read still sees the one interactive read in flight.
    expect(
      lines.filter((line) => line.fields?.priority === "speculative")
    ).toMatchObject([
      { fields: { rateLimit: { inFlight: 1 } } },
      { fields: { rateLimit: { inFlight: 1 } } },
    ]);
  });

  it("retries a short Retry-After once, without pacing the retry again", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "Rate limited" },
          { status: 429, headers: { "retry-after": "2" } }
        )
      )
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    const { lines, logger } = recordingLogger();
    const scope = limits();
    await Effect.runPromise(
      Effect.gen(function* retryShortRateLimit() {
        const fiber = yield* Effect.forkChild(
          pacedClient(fetch).fetch("/services/v2/people/1")
        );
        yield* settle;
        yield* TestClock.adjust("2 seconds");
        yield* settle;
        expect(fetch).toHaveBeenCalledTimes(2);
        yield* Fiber.join(fiber);
      }).pipe(withLimits(scope, logger), Effect.provide(TestClock.layer()))
    );
    expect(lines).toMatchObject([
      {
        message: "Planning Center rate limited a request",
        fields: { willRetry: true },
      },
    ]);
    expect(scope.accounting.totals).toMatchObject({
      requests: 2,
      rateLimited: 1,
      pacedRequests: 0,
    });
  });

  it.each([1, 40])(
    "keeps concurrent paced sends within budget %i",
    async (budget) => {
      const fetch = fetchMock().mockImplementation(
        async () => await Promise.resolve(jsonResponse({ data: person }))
      );
      const scope = limits(
        new PlanningCenterRequestAccounting({ requestBudget: budget })
      );
      const reserve = scope.pacer.reserve.bind(scope.pacer);
      vi.spyOn(scope.pacer, "reserve").mockImplementation((...args) => {
        const decision = reserve(...args);
        return decision.kind === "send"
          ? { ...decision, waitMs: 1000 }
          : decision;
      });
      const client = pacedClient(fetch);
      const outcomes = await Effect.runPromise(
        Effect.gen(function* simultaneousPacedSends() {
          const fiber = yield* Effect.forkChild(
            Effect.forEach(
              Array.from({ length: budget + 1 }, (_, index) => index),
              (index) =>
                client.fetch(`/services/v2/people/${index}`).pipe(
                  Effect.match({
                    onSuccess: () => "sent",
                    onFailure: (error) =>
                      error._tag === "PlanningCenterSubrequestLimitError"
                        ? error.source
                        : error._tag,
                  })
                ),
              { concurrency: "unbounded" }
            )
          );
          yield* settle;
          expect(fetch).not.toHaveBeenCalled();
          yield* TestClock.adjust("1 second");
          const results = yield* Fiber.join(fiber);
          const now = yield* Clock.currentTimeMillis;
          expect(
            reserve(client.getCacheScope(), now, "write").window.inFlight
          ).toBe(0);
          scope.pacer.complete(client.getCacheScope(), now);
          return results;
        }).pipe(withLimits(scope), Effect.provide(TestClock.layer()))
      );
      expect(outcomes.filter((outcome) => outcome === "sent")).toHaveLength(
        budget
      );
      expect(outcomes.filter((outcome) => outcome === "budget")).toHaveLength(
        1
      );
      expect(fetch).toHaveBeenCalledTimes(budget);
      expect(scope.accounting.totals).toMatchObject({
        requests: budget,
        subrequestLimitHits: 1,
      });
    }
  );

  it("stops at the invocation's request budget", async () => {
    const fetch = fetchMock().mockImplementation(
      async () => await Promise.resolve(jsonResponse({ data: person }))
    );
    const { lines, logger } = recordingLogger();
    const scope = limits(
      new PlanningCenterRequestAccounting({ requestBudget: 1 })
    );
    const client = pacedClient(fetch);

    await Effect.runPromise(
      client.fetch("/services/v2/people/1").pipe(withLimits(scope, logger))
    );
    expect(scope.accounting.remainingBudget).toBe(0);
    await expect(
      failureOf(
        client.fetch("/services/v2/people/2").pipe(withLimits(scope, logger))
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterSubrequestLimitError",
      source: "budget",
      requests: 1,
      limit: 1,
      rateLimitedResponses: 0,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(lines).toStrictEqual([
      {
        level: "info",
        message: "Planning Center request budget for this invocation is spent",
        fields: {
          endpoint: { path: "/services/v2/people/2", queryKeys: [] },
          method: "GET",
          requests: 1,
          requestBudget: 1,
        },
      },
    ]);
  });

  it("refuses redirects without sending an uncounted hop or retry", async () => {
    const fetch = fetchMock().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://api.planningcenteronline.com/services/v2/people/2",
        },
      })
    );
    const scope = limits(
      new PlanningCenterRequestAccounting({ requestBudget: 1 })
    );
    await expect(
      failureOf(
        pacedClient(fetch)
          .fetch("/services/v2/people/1")
          .pipe(withLimits(scope))
      )
    ).resolves.toMatchObject({ _tag: "PlanningCenterApiError", status: 302 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(scope.accounting.requestCount).toBe(1);
  });

  it("counts retries against the request budget and does not retry past it", async () => {
    const fetch = fetchMock().mockImplementation(
      async () =>
        await Promise.resolve(
          jsonResponse({ error: "Temporarily unavailable" }, { status: 503 })
        )
    );
    const scope = limits(
      new PlanningCenterRequestAccounting({ requestBudget: 2 })
    );
    const failure = await Effect.runPromise(
      Effect.gen(function* retryUntilBudget() {
        const fiber = yield* Effect.forkChild(
          Effect.flip(pacedClient(fetch).fetch("/services/v2/people/1"))
        );
        yield* settle;
        yield* TestClock.adjust("500 millis");
        yield* settle;
        yield* TestClock.adjust("1 second");
        yield* settle;
        return yield* Fiber.join(fiber);
      }).pipe(withLimits(scope), Effect.provide(TestClock.layer()))
    );
    expect({
      failure: {
        tag: failure._tag,
        source: "source" in failure ? failure.source : undefined,
      },
      sent: fetch.mock.calls.length,
      requests: scope.accounting.requestCount,
    }).toStrictEqual({
      failure: { tag: "PlanningCenterSubrequestLimitError", source: "budget" },
      sent: 2,
      requests: 2,
    });
  });

  it("reports Cloudflare's subrequest cap distinctly and stops sending", async () => {
    const fetch = fetchMock().mockRejectedValue(
      new Error("Too many subrequests.")
    );
    const { lines, logger } = recordingLogger();
    const scope = limits();
    const client = pacedClient(fetch);

    await expect(
      failureOf(
        client.fetch("/services/v2/people/1").pipe(withLimits(scope, logger))
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterSubrequestLimitError",
      source: "worker",
      requests: 1,
    });
    await expect(
      failureOf(
        client.fetch("/services/v2/people/2").pipe(withLimits(scope, logger))
      )
    ).resolves.toMatchObject({
      _tag: "PlanningCenterSubrequestLimitError",
      source: "worker",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(lines).toStrictEqual([
      {
        level: "warn",
        message:
          "Cloudflare refused a Planning Center request: too many subrequests",
        fields: {
          endpoint: { path: "/services/v2/people/1", queryKeys: [] },
          method: "GET",
          requests: 1,
        },
      },
    ]);
    expect({
      reached: scope.accounting.subrequestLimitReached,
      hits: scope.accounting.totals.subrequestLimitHits,
    }).toStrictEqual({ reached: true, hits: 1 });
  });

  it("sends writes into the budget reads leave for them, without pacing", async () => {
    const fetch = fetchMock()
      .mockResolvedValueOnce(rateLimitedResponse(95))
      .mockResolvedValueOnce(jsonResponse({ data: person }));
    const scope = limits();
    const client = pacedClient(fetch);
    await Effect.runPromise(
      client.fetch("/services/v2/people/1").pipe(withLimits(scope))
    );
    await Effect.runPromise(
      client
        .fetch("/services/v2/people", { method: "POST", body: {} })
        .pipe(withLimits(scope))
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(scope.accounting.totals.pacedRequests).toBe(0);
  });

  it("releases a paced reservation when the wait is interrupted", async () => {
    const fetch = fetchMock().mockResolvedValue(rateLimitedResponse(100));
    const pacer = new PlanningCenterRatePacer({ maxWaitMs: 60_000 });
    const scope = limits(
      new PlanningCenterRequestAccounting({ requestBudget: 2 }),
      pacer
    );
    const client = pacedClient(fetch);
    await Effect.runPromise(
      Effect.gen(function* interruptPacedRead() {
        yield* client.fetch("/services/v2/people/1");
        const fiber = yield* Effect.forkChild(
          client.fetch("/services/v2/people/2")
        );
        yield* settle;
        yield* Fiber.interrupt(fiber);
        const now = yield* Clock.currentTimeMillis;
        expect(
          pacer.reserve(client.getCacheScope(), now, "write").window.inFlight
        ).toBe(0);
      }).pipe(withLimits(scope), Effect.provide(TestClock.layer()))
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(scope.accounting.requestCount).toBe(1);
    expect(scope.accounting.remainingBudget).toBe(1);
  });
});
