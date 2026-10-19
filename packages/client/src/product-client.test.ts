import {
  failureCode,
  failureMessage,
  failureStatus,
  makeProductClient,
  TransportFailure,
} from "@pcobooster/client/product-client";
import type { ProductClient } from "@pcobooster/client/product-client";
import { ClientOutdated } from "@pcobooster/contracts/faults/client-outdated";
import { Conflict } from "@pcobooster/contracts/faults/conflict";
import { InternalError } from "@pcobooster/contracts/faults/internal-error";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { PersistenceFailure } from "@pcobooster/contracts/faults/persistence-failure";
import { RateLimited } from "@pcobooster/contracts/faults/rate-limited";
import { describe, expect, it } from "vitest";

/** A client whose every call is answered by `respond`, recording each request it sent. */
const clientAnswering = (respond: (request: Request) => Response) => {
  const sent: Request[] = [];
  const client = makeProductClient({
    url: "https://api.example",
    client: "web",
    credentials: "include",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      sent.push(request);
      return await Promise.resolve(respond(request));
    },
  });
  return { client, sent };
};

/** Never called: a procedure that takes input cannot be called without it. */
const missingInput = async (typed: ProductClient) =>
  // @ts-expect-error catalog.plan needs its service type and plan.
  await typed.run((api) => api.catalog.plan());

describe(makeProductClient, () => {
  it("sends each part of the input where its route puts it", async () => {
    const { client, sent } = clientAnswering((request) => {
      const { pathname } = new URL(request.url);
      if (pathname.endsWith("/adjacent")) {
        return Response.json([]);
      }
      return pathname.endsWith("/plan-window-history")
        ? Response.json({
            generatedAt: "2026-10-11T17:00:00Z",
            loadedPlanCount: 0,
            plans: [],
            planTimes: [],
            people: [],
            deferredPlans: [],
            deferredRanges: [],
            requestBudget: {
              limit: 40,
              planningCenterRequests: 0,
              planRangeRequests: 0,
              rosterRequests: 0,
            },
          })
        : Response.json({ success: true });
    });

    await client.run((api) =>
      api.catalog.adjacentPlans({
        params: { serviceTypeId: "st 1", planId: "plan-1" },
        query: { direction: "next" },
      })
    );
    await client.run((api) =>
      api.people.planWindowHistory({
        payload: {
          date: "2026-10-11T17:00:00Z",
          continuation: {
            plans: [],
            ranges: [
              { serviceTypeId: "st-2", offset: 0, boundaryPlanId: null },
            ],
          },
        },
      })
    );
    await client.run((api) =>
      api.schedule.remove({
        params: { planPersonId: "pp-1" },
        query: { serviceTypeId: "st-1", planId: "plan-1" },
      })
    );
    const requests = await Promise.all(
      sent.map(async (request) => [
        request.method,
        request.url,
        await request.clone().text(),
      ])
    );

    expect(requests).toStrictEqual([
      [
        "GET",
        "https://api.example/api/v1/service-types/st%201/plans/plan-1/adjacent?direction=next",
        "",
      ],
      [
        "POST",
        "https://api.example/api/v1/people/plan-window-history",
        JSON.stringify({
          date: "2026-10-11T17:00:00Z",
          continuation: {
            plans: [],
            ranges: [
              { serviceTypeId: "st-2", offset: 0, boundaryPlanId: null },
            ],
          },
        }),
      ],
      [
        "DELETE",
        "https://api.example/api/v1/plan-people/pp-1?serviceTypeId=st-1&planId=plan-1",
        "",
      ],
    ]);
  });

  it("calls a procedure that takes no input without one", async () => {
    const { client, sent } = clientAnswering(() =>
      Response.json({ people: true, chordCharts: false, practice: false })
    );

    await expect(
      client.run((api) => api.features.status())
    ).resolves.toStrictEqual({
      people: true,
      chordCharts: false,
      practice: false,
    });
    expect(missingInput).toBeTypeOf("function");
    expect(sent.map((request) => request.url)).toStrictEqual([
      "https://api.example/api/v1/features",
    ]);
  });

  it("rejects with the fault class the server answered with, decoded by status", async () => {
    const { client, sent } = clientAnswering(() =>
      Response.json(
        { _tag: "NotFound", message: "No plan", resource: "plan" },
        { status: 404 }
      )
    );

    await expect(
      client.run((api) =>
        api.catalog.plan({ params: { serviceTypeId: "1", planId: "2" } })
      )
    ).rejects.toBeInstanceOf(NotFound);
    expect(
      sent.map((request) => request.headers.get("x-pcobooster-client"))
    ).toStrictEqual(["web;api=2"]);
  });

  it("reports a response the API does not declare as a transport failure", async () => {
    const { client } = clientAnswering(
      () => new Response("<html>Bad gateway</html>", { status: 502 })
    );
    const call = client.run((api) => api.health.get());

    await expect(call).rejects.toBeInstanceOf(TransportFailure);
    await expect(call).rejects.toMatchObject({
      procedure: "health.get",
      reason: "undecodable",
    });
  });

  it("gives a network failure a message a person can act on", async () => {
    const client = makeProductClient({
      url: "https://api.example",
      client: "web",
      fetch: async () => {
        await Promise.resolve();
        throw new TypeError("Failed to fetch");
      },
    });
    const call = client.run((api) => api.health.get());

    await expect(call).rejects.toBeInstanceOf(TransportFailure);
    await expect(call).rejects.toMatchObject({
      reason: "network",
      message:
        "Couldn't reach pcobooster. Check your connection and try again.",
    });
  });

  it("rejects with AbortError when the signal aborts", async () => {
    const { client, sent } = clientAnswering(() => Response.json([]));
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.run((api) => api.health.get(), { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sent).toStrictEqual([]);
  });

  it("sends reads at speculative priority, writes always interactive, and names each procedure", async () => {
    const { client, sent } = clientAnswering((request) =>
      Response.json(request.method === "GET" ? [] : { success: true })
    );
    const named: string[] = [];
    const onProcedure = (procedure: string) => {
      named.push(procedure);
    };

    await client.run((api) => api.catalog.serviceTypes(), {
      priority: "speculative",
      onProcedure,
    });
    await client.run(
      (api) =>
        api.schedule.remove({ params: { planPersonId: "1" }, query: {} }),
      {
        priority: "speculative",
        onProcedure,
        httpHeaders: {
          "x-pcobooster-priority": "speculative",
          "x-pcobooster-client": "obsolete",
        },
      }
    );

    expect(
      sent.map((request) => request.headers.get("x-pcobooster-priority"))
    ).toStrictEqual(["speculative", "interactive"]);
    expect(named).toStrictEqual(["catalog.serviceTypes", "schedule.remove"]);
    expect(
      sent.map((request) => request.headers.get("x-pcobooster-client"))
    ).toStrictEqual(["web;api=2", "web;api=2"]);
  });
});

describe(failureStatus, () => {
  it.each([
    [new NotFound({ message: "No plan", resource: "plan" }), 404, "NOT_FOUND"],
    [
      new RateLimited({ message: "held back", service: "planning-center" }),
      429,
      "TOO_MANY_REQUESTS",
    ],
    [
      new ClientOutdated({ message: "Reload", minimumProtocolVersion: 2 }),
      426,
      "CLIENT_OUTDATED",
    ],
    [
      new TransportFailure({
        procedure: "health.get",
        reason: "network",
        cause: null,
      }),
      503,
      "NETWORK_ERROR",
    ],
    [new TypeError("not a call failure"), undefined, undefined],
  ])("reads %o as %s", (failure, status, code) => {
    expect({
      status: failureStatus(failure),
      code: failureCode(failure),
    }).toStrictEqual({ status, code });
  });
});

describe(failureMessage, () => {
  it.each([
    [
      new Conflict({ message: "Someone else saved first", reason: "stale" }),
      "Someone else saved first",
    ],
    [new Conflict({ message: "", reason: "stale" }), "Fallback"],
    [
      new TransportFailure({
        procedure: "health.get",
        reason: "network",
        cause: null,
      }),
      "Couldn't reach pcobooster. Check your connection and try again.",
    ],
    [
      new PersistenceFailure({
        detail: "D1 DB is overloaded",
        operation: "session",
      }),
      "Something went wrong on our side. Try again in a moment.",
    ],
    [
      new InternalError({}),
      "Something went wrong on our side. Try again in a moment.",
    ],
    [new TypeError("private diagnostic"), "Fallback"],
  ])("reads %o as %s", (failure, message) => {
    expect(failureMessage(failure, "Fallback")).toBe(message);
  });
});
