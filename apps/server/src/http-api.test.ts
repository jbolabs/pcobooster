/**
 * Three endpoints that cover the hard cases, served by the Worker's router in Node: a paginated
 * POST read (people.planWindowHistory), an audited write (schedule.updateStatus), and a flagged
 * read with a path param (chordCharts.song). Success, every fault each can answer with its
 * status, malformed input, the outcome line, and the client's `call` shape.
 */
import type {
  PlanningCenterAccessDependencies,
  RequestAuthentication,
} from "@pcobooster/api/application/planning-center-access";
import { demoSessionToken } from "@pcobooster/api/auth/demo-access";
import type { ActivityEventInput } from "@pcobooster/api/db/activity-events";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import {
  createPlanningCenterReadCaches,
  createPlanningCenterServices,
} from "@pcobooster/api/planning-center/services/factory";
import { unreachableHttpClient } from "@pcobooster/api/testing/http-client";
import {
  testFeatureFlags,
  testServer,
  testServerConfig,
} from "@pcobooster/api/testing/server";
import { failureStatus } from "@pcobooster/client/product-client";
import { ExternalServiceFailure } from "@pcobooster/contracts/faults/external-service-failure";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { InternalError } from "@pcobooster/contracts/faults/internal-error";
import { InvalidInput } from "@pcobooster/contracts/faults/invalid-input";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { RateLimited } from "@pcobooster/contracts/faults/rate-limited";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { serveHttpForTest } from "./test-http";

const account: RequestAuthentication = {
  kind: "account",
  userId: "user-1",
  accessToken: "http-test-token",
  accountId: "account-1",
  account: { id: "account-1", accountId: "provider-account-1" },
  scopes: ["services", "people"],
};

const serviceType = (id: string) => ({
  id,
  type: "ServiceType",
  attributes: { name: `Service ${id}`, sequence: 1, archived_at: null },
});

const song = {
  id: "song-1",
  type: "Song",
  attributes: { title: "Amazing Grace", author: "John Newton" },
};

const setup = ({
  chordCharts = false,
  authorize = async () => await Promise.resolve(account),
}: {
  readonly chordCharts?: boolean;
  readonly authorize?: PlanningCenterAccessDependencies["authorize"];
} = {}) => {
  const services = createPlanningCenterServices(
    "http-test-token",
    "America/Los_Angeles",
    unreachableHttpClient,
    createPlanningCenterReadCaches(null)
  );
  const serviceTypes = vi
    .spyOn(services.catalog, "getServiceTypesCached")
    .mockReturnValue(
      Effect.succeed([
        serviceType("st-1"),
        serviceType("st-2"),
        serviceType("st-3"),
      ])
    );
  const planRanges = vi
    .spyOn(services.plans, "getPlanRangePage")
    .mockReturnValue(
      Effect.succeed({ data: [], included: [], nextOffset: null })
    );
  const updateStatus = vi
    .spyOn(services.people, "updatePlanPersonStatus")
    .mockReturnValue(
      Effect.succeed({
        id: "plan-person-1",
        type: "PlanPerson",
        attributes: { status: "C" },
      })
    );
  const getSong = vi
    .spyOn(services.songs, "getSong")
    .mockReturnValue(Effect.succeed(song));
  vi.spyOn(services.songs, "getSongArrangementsForEditing").mockReturnValue(
    Effect.succeed({ data: [], included: [] })
  );
  const recordActivity = vi
    .fn<(event: ActivityEventInput) => Promise<void>>()
    .mockResolvedValue();
  const featureFlags = testFeatureFlags({ chordCharts });
  const app = serveHttpForTest({
    server: testServer({ featureFlags }),
    access: {
      authorize,
      createServices: () => services,
      presentationMode: () => false,
      presentationSeed: "seed",
    },
    scheduleAudit: { recordActivity },
  });
  return {
    app,
    client: app.client(),
    serviceTypes,
    planRanges,
    updateStatus,
    getSong,
    recordActivity,
    featureFlags,
  };
};

type Setup = ReturnType<typeof setup>;

const outcomeLines = (app: Setup["app"]) =>
  app.logs
    .filter((line) => line.message === "rpc")
    .map(({ fields }) => [
      fields.procedure,
      fields.status,
      fields.code,
      fields.kind,
    ]);

/** What a call rejected with; fails the test if it resolved. */
const rejection = async (answer: Promise<unknown>): Promise<Error> => {
  try {
    await answer;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("Expected the call to reject with an Error");
};

/** A raw request as the web client sends it, to read what the client does not expose. */
const raw = async (
  app: Setup["app"],
  method: string,
  path: string,
  { body, client = "web;api=2" }: { body?: unknown; client?: string } = {}
) =>
  await app.request(path, {
    method,
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-pcobooster-client": client,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const continuation = {
  plans: [
    {
      serviceTypeId: "st-2",
      planId: "plan-9",
      rosterRequests: 1,
      rangeOffset: 0,
    },
  ],
  ranges: [{ serviceTypeId: "st-3", offset: 0, boundaryPlanId: null }],
};

const HISTORY = "/api/v1/people/plan-window-history";

describe("people.planWindowHistory (a paginated POST read)", () => {
  it("carries the continuation in the body and answers the next batch", async () => {
    const { app, client, planRanges } = setup();
    // plan-9 is still on the page that listed it, with no one to read a roster for.
    planRanges.mockImplementation((serviceTypeId) =>
      Effect.succeed({
        data:
          serviceTypeId === "st-2"
            ? [
                {
                  type: "Plan",
                  id: "plan-9",
                  attributes: {
                    sort_date: "2026-10-11T17:00:00Z",
                    plan_people_count: 0,
                  },
                },
              ]
            : [],
        included: [],
        nextOffset: null,
      })
    );

    const batch = await client.run(
      (api) =>
        api.people.planWindowHistory({
          payload: { date: "2026-10-11T10:00:00-07:00", continuation },
        }),
      { priority: "speculative" }
    );

    // Only the continuation's pages are read: st-2's to locate plan-9, then st-3's first.
    expect(
      planRanges.mock.calls.map((call) => `${call[0]}@${call[3]}`)
    ).toStrictEqual(["st-2@0", "st-3@0"]);
    expect(batch).toMatchObject({
      loadedPlanCount: 1,
      deferredPlans: [],
      deferredRanges: [],
    });
    expect(
      app.logs
        .filter((line) => line.message === "rpc")
        .map(({ fields }) => [
          fields.procedure,
          fields.status,
          fields.priority,
          fields.client,
        ])
    ).toStrictEqual([
      ["people.planWindowHistory", 200, "speculative", "web;api=2"],
    ]);
  });

  it("answers POST with the cache policy and only the declared fields", async () => {
    const { app } = setup();

    const response = await raw(app, "POST", HISTORY, {
      body: { date: "2026-10-11T17:00:00Z" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it.each([
    ["a date that is not an instant", { date: "next-sunday" }],
    [
      "a continuation that is not an object",
      { date: "2026-10-11T17:00:00Z", continuation: "{not" },
    ],
    [
      "a continuation of the wrong shape",
      { date: "2026-10-11T17:00:00Z", continuation: { plans: [{}] } },
    ],
    ["no date at all", {}],
  ])(
    "rejects %s with 400 before any Planning Center request",
    async (_case, body) => {
      const { app, serviceTypes } = setup();

      const response = await raw(app, "POST", HISTORY, { body });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        _tag: "RequestRejected",
        reason: "invalid-payload",
      });
      expect(serviceTypes).not.toHaveBeenCalled();
      expect(outcomeLines(app)).toStrictEqual([
        ["people.planWindowHistory", 400, "BAD_REQUEST", "read"],
      ]);
    }
  );

  it("answers 401 Unauthenticated without a session", async () => {
    const { client } = setup({
      authorize: async () =>
        await Promise.reject(new Unauthenticated({ message: "Sign in" })),
    });

    const answer = client.run((api) =>
      api.people.planWindowHistory({
        payload: { date: "2026-10-11T17:00:00Z" },
      })
    );

    const failure = await rejection(answer);

    expect(failure).toBeInstanceOf(Unauthenticated);
    expect(failureStatus(failure)).toBe(401);
  });

  it("answers 429 RateLimited with Retry-After when Planning Center limits the caller", async () => {
    const { app, client, serviceTypes } = setup();
    serviceTypes.mockReturnValue(
      Effect.fail(
        new PlanningCenterApiError({
          status: 429,
          message: "Too many",
          retryAfterSeconds: 7,
        })
      )
    );

    const response = await raw(app, "POST", HISTORY, {
      body: { date: "2026-10-11T17:00:00Z" },
    });
    const answer = client.run((api) =>
      api.people.planWindowHistory({
        payload: { date: "2026-10-11T17:00:00Z" },
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    await expect(answer).rejects.toBeInstanceOf(RateLimited);
    await expect(answer).rejects.toMatchObject({ retryAfterSeconds: 7 });
  });

  it("answers 502 ExternalServiceFailure without the provider's detail", async () => {
    const { app, client, serviceTypes } = setup();
    serviceTypes.mockReturnValue(
      Effect.fail(
        new PlanningCenterApiError({ status: 500, message: "token=secret" })
      )
    );

    const response = await raw(app, "POST", HISTORY, {
      body: { date: "2026-10-11T17:00:00Z" },
    });
    const answer = client.run((api) =>
      api.people.planWindowHistory({
        payload: { date: "2026-10-11T17:00:00Z" },
      })
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toStrictEqual({
      _tag: "ExternalServiceFailure",
      message: "Planning Center request failed.",
      service: "planning-center",
    });
    await expect(answer).rejects.toBeInstanceOf(ExternalServiceFailure);
  });

  it("answers a defect with 500 InternalError and no internal detail", async () => {
    const { app, client, serviceTypes } = setup();
    serviceTypes.mockReturnValue(
      Effect.die(new Error("adapter crashed at /srv/secret/path"))
    );

    const response = await raw(app, "POST", HISTORY, {
      body: { date: "2026-10-11T17:00:00Z" },
    });
    const answer = client.run((api) =>
      api.people.planWindowHistory({
        payload: { date: "2026-10-11T17:00:00Z" },
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({
      _tag: "InternalError",
      message: "Internal server error",
    });
    await expect(answer).rejects.toBeInstanceOf(InternalError);
    expect(
      app.logs
        .filter((line) => line.message === "rpc")
        .map(({ level, fields }) => [level, fields.status, fields.code])
    ).toStrictEqual([
      ["error", 500, "INTERNAL_SERVER_ERROR"],
      ["error", 500, "INTERNAL_SERVER_ERROR"],
    ]);
  });

  it.each([
    ["an older API version", "web;api=0"],
    ["the API version before paged candidate and dashboard reads", "web;api=1"],
    ["a header without a version", "web"],
  ])("answers 426 ClientOutdated to %s", async (_case, header) => {
    const { app, serviceTypes } = setup();

    const response = await raw(app, "POST", HISTORY, {
      body: { date: "2026-10-11T17:00:00Z" },
      client: header,
    });

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({
      _tag: "ClientOutdated",
      minimumProtocolVersion: 2,
    });
    expect(serviceTypes).not.toHaveBeenCalled();
  });
});

describe("schedule.updateStatus (an audited write)", () => {
  const target = {
    planPersonId: "plan-person-1",
    serviceTypeId: "service-1",
    personId: "person-1",
    planId: "plan-1",
  };

  it("PATCHes the plan person and audits the real method and path", async () => {
    const { client, updateStatus, recordActivity } = setup();

    const updated = await client.run((api) =>
      api.schedule.updateStatus({
        params: { ...target },
        payload: { ...target, status: "C" },
      })
    );

    expect(updated).toStrictEqual({ success: true });
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith("plan-person-1", "C", {
      serviceTypeId: "service-1",
      planId: "plan-1",
      personId: "person-1",
    });
    expect(recordActivity).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        eventType: "schedule_status_change",
        method: "PATCH",
        path: "/api/v1/plan-people/plan-person-1",
        success: true,
        statusCode: 200,
      })
    );
  });

  it.each([
    [404, NotFound, "NOT_FOUND"],
    [403, Forbidden, "FORBIDDEN"],
    [422, InvalidInput, "BAD_REQUEST"],
  ] as const)(
    "answers Planning Center's %i as its fault, audited",
    async (providerStatus, Fault, code) => {
      const { client, updateStatus, recordActivity } = setup();
      updateStatus.mockReturnValue(
        Effect.fail(
          new PlanningCenterApiError({ status: providerStatus, message: "" })
        )
      );

      const answer = client.run((api) =>
        api.schedule.updateStatus({
          params: { ...target },
          payload: { ...target, status: "D" },
        })
      );

      await expect(answer).rejects.toBeInstanceOf(Fault);
      expect(recordActivity).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, errorCode: code })
      );
    }
  );

  it.each([
    ["a status Services does not have", JSON.stringify({ status: "X" })],
    ["a blank optional id", JSON.stringify({ status: "C", planId: " " })],
    ["a body that is not JSON", "{"],
  ])("rejects %s with 400 and never writes", async (_case, body) => {
    const { app, updateStatus, recordActivity } = setup();

    const response = await app.request("/api/v1/plan-people/plan-person-1", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-pcobooster-client": "web;api=2",
      },
      body,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      _tag: "RequestRejected",
    });
    expect(updateStatus).not.toHaveBeenCalled();
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("is reached only by PATCH: another method answers 405 with what the path allows", async () => {
    const { app } = setup();

    const response = await raw(
      app,
      "POST",
      "/api/v1/plan-people/plan-person-1",
      {
        body: { status: "C" },
      }
    );

    expect([response.status, response.headers.get("allow")]).toStrictEqual([
      405,
      "DELETE, PATCH",
    ]);
  });
});

describe("chordCharts.song (a flagged read with a path param)", () => {
  it("answers 404 NotFound while the flag is off, before any Planning Center request", async () => {
    const { app, client, getSong, featureFlags } = setup({
      chordCharts: false,
    });

    const answer = client.run((api) =>
      api.chordCharts.song({ params: { songId: "song-1" } })
    );

    const failure = await rejection(answer);

    expect(failure).toBeInstanceOf(NotFound);
    expect(failureStatus(failure)).toBe(404);
    expect(getSong).not.toHaveBeenCalled();
    expect(featureFlags.evaluations).toContainEqual({
      flag: "chordCharts",
      subject: { userId: "user-1", planningCenterAccountId: "account-1" },
    });
    expect(outcomeLines(app)).toContainEqual([
      "chordCharts.song",
      404,
      "NOT_FOUND",
      "read",
    ]);
  });

  it("serves the song's charts while the flag is on, the id decoded from the path", async () => {
    const { client, getSong } = setup({ chordCharts: true });

    const charts = await client.run((api) =>
      api.chordCharts.song({ params: { songId: " song-1 " } })
    );

    expect(getSong).toHaveBeenCalledExactlyOnceWith("song-1");
    expect(charts).toStrictEqual({
      song: { id: "song-1", title: "Amazing Grace", author: "John Newton" },
      arrangements: [],
    });
  });

  it("rejects a blank song id with 400 and never reads the song", async () => {
    const { app, getSong } = setup({ chordCharts: true });

    const response = await raw(app, "GET", "/api/v1/songs/%20/chord-charts");

    expect(response.status).toBe(400);
    expect(getSong).not.toHaveBeenCalled();
  });

  it("checks the flag before input: a malformed call to a flag-off endpoint answers 404", async () => {
    const { app } = setup({ chordCharts: false });

    const response = await raw(app, "GET", "/api/v1/songs/%20/chord-charts");

    expect(response.status).toBe(404);
  });
});

describe("routes outside the API's endpoints", () => {
  it("answer an unknown /api/v1 path RequestRejected, keeping CORS and the cache policy", async () => {
    const { app } = setup();

    const response = await raw(app, "GET", "/api/v1/retired-endpoint");

    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      _tag: "RequestRejected",
      reason: "unknown-endpoint",
    });
  });
});

describe("demo sessions", () => {
  it("reads the demo header and refuses a write as read-only before Planning Center", async () => {
    const config = testServerConfig({
      DEMO_ACCESS_KEY: "http-demo-access-key-long-enough",
      DEMO_PLANNING_CENTER_CLIENT: "demo-client",
      DEMO_PLANNING_CENTER_PAT: "demo-pat",
    });
    if (config.demo === null) {
      throw new Error("The demo settings above must configure the demo");
    }
    const demoToken = demoSessionToken(config.demo);
    const app = serveHttpForTest({ server: testServer({ config }) });
    const client = app.client({
      client: "expo",
      httpHeaders: () => ({ "x-pcobooster-demo": demoToken }),
    });

    const answer = client.run((api) =>
      api.schedule.updateStatus({
        params: { planPersonId: "plan-person-1" },
        payload: { status: "C", serviceTypeId: "service-1", planId: "plan-1" },
      })
    );

    await expect(answer).rejects.toBeInstanceOf(Forbidden);
    await expect(answer).rejects.toMatchObject({
      message:
        "This Planning Center connection is read-only, so changes aren't saved.",
    });
  });
});
