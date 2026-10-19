/**
 * What every endpoint gets from the product API: fault mapping, input decoding on the server,
 * per-call Planning Center accounting, and a span per call, through the Worker's router.
 */
import type {
  PlanningCenterAccessDependencies,
  RequestAuthentication,
} from "@pcobooster/api/application/planning-center-access";
import type { ReportProcedureFailure } from "@pcobooster/api/http/outcome";
import {
  createPlanningCenterReadCaches,
  createPlanningCenterServices,
} from "@pcobooster/api/planning-center/services/factory";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { testServer } from "@pcobooster/api/testing/server";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { InternalError } from "@pcobooster/contracts/faults/internal-error";
import { RequestRejected } from "@pcobooster/contracts/faults/request-rejected";
import { Effect, Tracer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { postHogProcedureReporter } from "./procedure-reporting";
import { serveHttpForTest, TEST_API_ORIGIN } from "./test-http";
import type { HttpAppTestOptions } from "./test-http";

const privateNoStore = "private, no-store";
const PLAN_PATH = /\/plans\/(?<planId>[^/]+)$/u;

const accountAuthentication: RequestAuthentication = {
  kind: "account",
  userId: "user-1",
  accessToken: "access-token",
  scopes: ["services"],
  accountId: "account-1",
  account: { id: "account-1", accountId: "provider-account-1" },
};

/** Access that `authorize` decides; services send through the router's HTTP client. */
const accessWith = (
  authorize: PlanningCenterAccessDependencies["authorize"]
): PlanningCenterAccessDependencies => ({
  authorize,
  createServices: (_authentication, httpClient) =>
    createPlanningCenterServices(
      "access-token",
      "America/Los_Angeles",
      httpClient,
      createPlanningCenterReadCaches(null)
    ),
  presentationMode: () => false,
  presentationSeed: "seed",
});

const signedIn = accessWith(
  async () => await Promise.resolve(accountAuthentication)
);

/** A Planning Center that answers every plan read, counting requests. */
const planningCenter = () => {
  const requests: string[] = [];
  const httpClient = httpClientFor(async (input) => {
    const url = new URL(new Request(input).url);
    requests.push(url.pathname);
    const planId = PLAN_PATH.exec(url.pathname)?.groups?.planId ?? "missing";
    return await Promise.resolve(
      Response.json({
        data: {
          type: "Plan",
          id: planId,
          attributes: {
            title: "Sunday",
            sort_date: "2026-10-11T17:00:00Z",
            created_at: "2026-09-01T00:00:00Z",
            planning_center_url: null,
          },
          relationships: { series: { data: null } },
        },
        included: [],
      })
    );
  });
  return { requests, httpClient };
};

/** A Planning Center whose people search finds Ann, recording each search term it was sent. */
const peopleDirectory = () => {
  const searches: (string | null)[] = [];
  const httpClient = httpClientFor(async (input) => {
    searches.push(
      new URL(new Request(input).url).searchParams.get("where[search_name]")
    );
    return await Promise.resolve(
      Response.json({
        data: [
          {
            type: "Person",
            id: "person-1",
            attributes: { first_name: "Ann", last_name: "Lee", avatar: null },
            relationships: {},
          },
        ],
        included: [],
        meta: { total_count: 1 },
      })
    );
  });
  return { searches, httpClient };
};

/** A raw GET from a current web client, to read what the client does not expose. */
const rawGet = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${TEST_API_ORIGIN}${path}`, {
    headers: { "x-pcobooster-client": "web;api=2", ...headers },
  });

const serve = (options: Partial<HttpAppTestOptions> = {}) =>
  serveHttpForTest({ server: testServer(), access: signedIn, ...options });

const outcomeLines = (route: ReturnType<typeof serveHttpForTest>) =>
  route.logs.filter((line) => line.message === "rpc");

const recordingReporter = () => {
  const reports: Parameters<ReportProcedureFailure>[0][] = [];
  const report: ReportProcedureFailure = (failure) =>
    Effect.sync(() => {
      reports.push(failure);
    });
  return { reports, report };
};

describe("faults", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("alerts on a provider's rejected write while keeping the client's BAD_REQUEST", async () => {
    const captures: Request[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        captures.push(new Request(input, init));
        return await Promise.resolve(new Response("ok"));
      }
    );
    const route = serve({
      report: postHogProcedureReporter("phc_test_key"),
      httpClient: httpClientFor(
        async () =>
          await Promise.resolve(
            Response.json(
              {
                errors: [
                  {
                    source: { parameter: "length" },
                    detail: "can not be longer than 24 hours",
                  },
                  {
                    source: { pointer: "/data/attributes/service_position" },
                    detail: "is not included in the list",
                  },
                  {
                    source: { parameter: "title" },
                    detail: "Private church title is already taken",
                  },
                ],
                privateData: "private provider response",
              },
              { status: 422 }
            )
          )
      ),
    });
    const response = await route.request(
      "/api/v1/service-types/1/plans/2/items",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "request-422",
          "x-pcobooster-client": "web;api=2",
        },
        body: JSON.stringify({
          title: "Private church title",
          description: "Private church notes",
          length: 90_000,
        }),
      }
    );
    const body: unknown = await response.json();
    expect({ status: response.status, body }).toStrictEqual({
      status: 400,
      body: {
        _tag: "InvalidInput",
        message:
          "Planning Center didn't accept that change: Length can not be longer than 24 hours; Service position is not included in the list; Title Private church title is already taken",
      },
    });
    expect(outcomeLines(route)[0]?.fields).toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
    expect(captures).toHaveLength(1);
    const capture = await captures[0]?.text();
    expect(JSON.parse(capture ?? "{}")).toMatchObject({
      event: "$exception",
      distinct_id: "pcobooster-api",
      properties: {
        error_code: "PROVIDER_REJECTED",
        $exception_fingerprint:
          "api:/api/v1/service-types/:serviceTypeId/plans/:planId/items:PROVIDER_REJECTED",
        $exception_list: [
          {
            type: "ProviderRejected",
            value: "Planning Center rejected a write",
          },
        ],
        path: "/api/v1/service-types/:serviceTypeId/plans/:planId/items",
        method: "POST",
        request_id: "request-422",
        procedure: "planItems.create",
        provider: "planning-center",
        provider_status: 422,
        provider_errors: [
          { attribute: "length", detail: "can not be longer than 24 hours" },
          {
            attribute: "service_position",
            detail: "is not included in the list",
          },
          {
            attribute: "title",
            detail: "Validation failed (detail omitted for privacy)",
          },
        ],
      },
    });
    expect({
      leaksChurchText: capture?.includes("Private church"),
      leaksResponse: capture?.includes("private provider response"),
      url: captures[0]?.url,
    }).toStrictEqual({
      leaksChurchText: false,
      leaksResponse: false,
      url: "https://us.i.posthog.com/i/v0/e/",
    });
  });

  it("keeps ordinary invalid input and provider read validation quiet", async () => {
    const { reports, report } = recordingReporter();
    const route = serve({
      report,
      httpClient: httpClientFor(
        async () =>
          await Promise.resolve(
            Response.json(
              { errors: [{ detail: "invalid filter" }] },
              { status: 422 }
            )
          )
      ),
    });
    const invalid = await route.request(
      "/api/v1/service-types/1/plans/2/items",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pcobooster-client": "web;api=2",
        },
        body: JSON.stringify({ length: -1 }),
      }
    );
    const read = await route.fetch(rawGet("/api/v1/service-types/1/plans/2"));
    expect({
      statuses: [invalid.status, read.status],
      errors: reports.map(({ error }) => error.message),
    }).toStrictEqual({ statuses: [400, 400], errors: [] });
    await expect(read.json()).resolves.toMatchObject({
      _tag: "InvalidInput",
      message: "Planning Center didn't accept that change: invalid filter",
    });
    expect(reports).toStrictEqual([]);
  });

  it("answers a product fault with its status and code, logs it at info, and never reports it", async () => {
    const { reports, report } = recordingReporter();
    const route = serve({
      access: accessWith(async () => {
        await Promise.resolve();
        throw new Forbidden({ message: "Admin access required" });
      }),
      report,
    });

    const raw = await route.fetch(
      rawGet("/api/v1/access/me", { "x-request-id": "request-403" })
    );
    const answer = route.client().run((api) => api.access.me());

    await expect(answer).rejects.toBeInstanceOf(Forbidden);
    await expect(answer).rejects.toMatchObject({
      message: "Admin access required",
    });
    expect([raw.status, raw.headers.get("cache-control")]).toStrictEqual([
      403,
      privateNoStore,
    ]);
    expect(outcomeLines(route)[0]).toMatchObject({
      level: "info",
      fields: {
        procedure: "access.me",
        requestId: "request-403",
        status: 403,
        code: "FORBIDDEN",
      },
    });
    expect(reports).toStrictEqual([]);
  });

  it("keeps a defect out of the response, logs it with the request id, and reports it", async () => {
    const { reports, report } = recordingReporter();
    const route = serve({
      access: accessWith(async () => {
        await Promise.resolve();
        throw new Error("private database diagnostic");
      }),
      report,
    });

    const raw = await route.fetch(
      rawGet("/api/v1/access/me", { "x-request-id": "request-123" })
    );
    const body = await raw.text();

    await expect(
      route.client().run((api) => api.access.me())
    ).rejects.toBeInstanceOf(InternalError);
    expect({
      status: raw.status,
      cacheControl: raw.headers.get("cache-control"),
      answersInternalError: body.includes("InternalError"),
      leaksDiagnostic: body.includes("private database diagnostic"),
    }).toStrictEqual({
      status: 500,
      cacheControl: privateNoStore,
      answersInternalError: true,
      leaksDiagnostic: false,
    });
    expect(outcomeLines(route)[0]).toMatchObject({
      level: "error",
      fields: {
        procedure: "access.me",
        requestId: "request-123",
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
      },
    });
    expect(reports[0]?.fields).toMatchObject({
      procedure: "access.me",
      requestId: "request-123",
      status: 500,
    });
    expect(reports[0]?.error.message).toBe("private database diagnostic");
  });

  it("still answers when error reporting fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        await Promise.reject(new Error("PostHog down"));
        return new Response();
      })
    );
    const route = serve({
      access: accessWith(async () => {
        await Promise.resolve();
        throw new Error("private database diagnostic");
      }),
      report: postHogProcedureReporter("phc_test_key"),
    });

    const raw = await route.fetch(rawGet("/api/v1/access/me"));

    expect(raw.status).toBe(500);
    expect(
      route.logs.find(
        (line) => line.message === "Failed to report exception to PostHog"
      )
    ).toMatchObject({ level: "error", fields: { procedure: "access.me" } });
  });

  it("answers an unknown endpoint with 400 RequestRejected, logged and never reported", async () => {
    const { reports, report } = recordingReporter();
    const route = serve({ report });

    const raw = await route.fetch(rawGet("/api/v1/access/missing"));

    expect([raw.status, raw.headers.get("cache-control")]).toStrictEqual([
      400,
      privateNoStore,
    ]);
    await expect(raw.json()).resolves.toMatchObject({
      _tag: "RequestRejected",
      reason: "unknown-endpoint",
    });
    expect(outcomeLines(route)).toMatchObject([
      {
        level: "info",
        fields: {
          procedure: null,
          method: "GET",
          route: "/api/v1/access/missing",
          status: 400,
          kind: null,
        },
      },
    ]);
    expect(reports).toStrictEqual([]);
  });
});

describe("payload decoding", () => {
  it("sends input as the caller wrote it, so the server trims a people search", async () => {
    const { searches, httpClient } = peopleDirectory();
    const route = serve({ httpClient });

    const results = await route
      .client()
      .run((api) => api.people.search({ query: { query: " ann " } }));

    expect({ results, searches }).toStrictEqual({
      results: [
        {
          id: "person-1",
          firstName: "Ann",
          lastName: "Lee",
          fullName: "Ann Lee",
          photoThumbnailUrl: null,
        },
      ],
      searches: ["ann"],
    });
  });

  it("leaves rejecting input to the server, which answers RequestRejected", async () => {
    const { searches, httpClient } = peopleDirectory();
    const route = serve({ httpClient });

    const call = route
      .client()
      .run((api) => api.people.search({ query: { query: " a " } }));

    await expect(call).rejects.toBeInstanceOf(RequestRejected);
    expect(searches).toStrictEqual([]);
  });
});

describe("what each call runs with", () => {
  it("carries Dates over the wire as ISO strings, decoded back into Dates", async () => {
    const { httpClient } = planningCenter();
    const route = serve({ httpClient });

    const plan = await route.client().run((api) =>
      api.catalog.plan({
        params: { serviceTypeId: "st-1", planId: "plan-1" },
      })
    );
    const raw = await route.fetch(
      rawGet("/api/v1/service-types/st-1/plans/plan-1")
    );

    expect(plan?.createdAt).toStrictEqual(new Date("2026-09-01T00:00:00Z"));
    await expect(raw.text()).resolves.toContain(
      '"createdAt":"2026-09-01T00:00:00.000Z"'
    );
  });

  it("gives every call its own Planning Center accounting under the 40-request cap", async () => {
    const { httpClient, requests } = planningCenter();
    const route = serve({ httpClient });
    const client = route.client();

    await client.run((api) =>
      api.catalog.plan({ params: { serviceTypeId: "st-1", planId: "a" } })
    );
    await client.run(
      (api) =>
        api.catalog.plan({ params: { serviceTypeId: "st-1", planId: "b" } }),
      { priority: "speculative" }
    );

    expect(requests).toHaveLength(2);
    expect(
      outcomeLines(route).map(({ fields }) => ({
        priority: fields.priority,
        planningCenterRequests: fields.planningCenterRequests,
        rateLimitPauses: fields.rateLimitPauses,
        rateLimitRejections: fields.rateLimitRejections,
        requestBudget: fields.requestBudget,
      }))
    ).toStrictEqual([
      {
        priority: "interactive",
        planningCenterRequests: 1,
        rateLimitPauses: 0,
        rateLimitRejections: 0,
        requestBudget: 40,
      },
      {
        priority: "speculative",
        planningCenterRequests: 1,
        rateLimitPauses: 0,
        rateLimitRejections: 0,
        requestBudget: 40,
      },
    ]);
  });

  it("runs each call in a span named after its procedure, with its request id", async () => {
    const spans: Tracer.NativeSpan[] = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    const { httpClient } = planningCenter();
    const route = serve({ httpClient, tracer });

    await route.fetch(
      rawGet("/api/v1/service-types/st-1/plans/plan-1", {
        "x-request-id": "request-span",
      })
    );
    const procedureSpan = spans.find(
      (span) => span.name === "api.catalog.plan"
    );

    expect({
      procedure: procedureSpan?.attributes.get("api.procedure"),
      requestId: procedureSpan?.attributes.get("request.id"),
    }).toStrictEqual({ procedure: "catalog.plan", requestId: "request-span" });
  });
});
