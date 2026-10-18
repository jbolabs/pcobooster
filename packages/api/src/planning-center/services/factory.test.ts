import {
  createPlanningCenterReadCaches,
  createPlanningCenterServices,
  createBasicPlanningCenterServices,
} from "@pcobooster/api/planning-center/services/factory";
import { createMemorySharedReadStore } from "@pcobooster/api/planning-center/services/shared-read-store";
import {
  httpClientFor,
  unreachableHttpClient,
} from "@pcobooster/api/testing/http-client";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const TIME_ZONE = "America/Los_Angeles";

const resource = (id: string, type: string): PCResource => ({
  id,
  type,
  attributes: { name: id },
});

const caches = createPlanningCenterReadCaches(null);

const servicesFor = (accessToken: string) =>
  createPlanningCenterServices(
    accessToken,
    TIME_ZONE,
    unreachableHttpClient,
    caches
  );

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input.toString();

/** Answers every Planning Center read with `resource`, so a test can count the requests that get through. */
const fetchFor = (item: PCResource, listPathSuffix: string) =>
  vi.fn<typeof globalThis.fetch>(
    async (input, init) =>
      await Promise.resolve(
        new URL(urlOf(input)).pathname.endsWith(listPathSuffix) &&
          (init?.method ?? "GET") === "GET"
          ? Response.json({ data: [item], included: [] })
          : Response.json({ data: item })
      )
  );

const servicesWith = (
  accessToken: string,
  fetch: ReturnType<typeof fetchFor>
) =>
  createPlanningCenterServices(
    accessToken,
    TIME_ZONE,
    httpClientFor(fetch),
    caches
  );

const requestsOf = (fetch: ReturnType<typeof fetchFor>): string[] =>
  fetch.mock.calls.map(
    ([input, init]) =>
      `${init?.method ?? "GET"} ${new URL(urlOf(input)).pathname}`
  );

describe("createPlanningCenterServices shared caches", () => {
  it("rejects empty request credentials and scopes Basic services by credential", () => {
    expect(() => servicesFor("")).toThrow("requires a non-empty access token");
    expect(
      createBasicPlanningCenterServices(
        testPlanningCenterToken,
        TIME_ZONE,
        unreachableHttpClient,
        caches
      ).core.getCacheScope()
    ).toMatch(/^basic:/u);
  });

  it("reuses cached reads for the same credential without leaking mutations", async () => {
    const first = servicesFor("shared-cache-token");
    const second = servicesFor("shared-cache-token");
    const firstLoad = vi
      .spyOn(first.catalog, "getServiceTypes")
      .mockReturnValue(Effect.succeed([resource("first", "ServiceType")]));
    const secondLoad = vi
      .spyOn(second.catalog, "getServiceTypes")
      .mockReturnValue(Effect.succeed([resource("second", "ServiceType")]));

    const firstResult = await Effect.runPromise(
      first.catalog.getServiceTypesCached()
    );
    firstResult[0].attributes.name = "mutated";
    const secondResult = await Effect.runPromise(
      second.catalog.getServiceTypesCached()
    );

    expect(firstLoad).toHaveBeenCalledOnce();
    expect(secondLoad).not.toHaveBeenCalled();
    expect(secondResult[0].attributes.name).toBe("first");
  });

  it("isolates shared caches by credential scope", async () => {
    const first = servicesFor("isolated-cache-token-a");
    const second = servicesFor("isolated-cache-token-b");
    const firstLoad = vi
      .spyOn(first.catalog, "getServiceTypes")
      .mockReturnValue(Effect.succeed([resource("first", "ServiceType")]));
    const secondLoad = vi
      .spyOn(second.catalog, "getServiceTypes")
      .mockReturnValue(Effect.succeed([resource("second", "ServiceType")]));

    const [firstResult, secondResult] = await Effect.runPromise(
      Effect.all(
        [
          first.catalog.getServiceTypesCached(),
          second.catalog.getServiceTypesCached(),
        ],
        { concurrency: "unbounded" }
      )
    );

    expect(firstLoad).toHaveBeenCalledOnce();
    expect(secondLoad).toHaveBeenCalledOnce();
    expect(firstResult[0].id).toBe("first");
    expect(secondResult[0].id).toBe("second");
  });

  it("reads plan items freshly across independently constructed service caches", async () => {
    let title = "Opening";
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method === "POST") {
        title = "New item";
      }
      const item = { id: "item-1", type: "Item", attributes: { title } };
      return await Promise.resolve(
        Response.json({
          data: init?.method === "POST" ? item : [item],
          included: [],
        })
      );
    });
    const reader = createPlanningCenterServices(
      "mutation-cache-token",
      TIME_ZONE,
      httpClientFor(fetch),
      createPlanningCenterReadCaches(null)
    );
    const writer = createPlanningCenterServices(
      "mutation-cache-token",
      TIME_ZONE,
      httpClientFor(fetch),
      createPlanningCenterReadCaches(null)
    );
    const before = await Effect.runPromise(
      reader.planItems.getPlanItems("service-type", "plan")
    );
    expect(before.data[0].attributes.title).toBe("Opening");
    await Effect.runPromise(
      writer.planItems.createPlanItem("service-type", "plan", {
        title: "New item",
      })
    );
    const after = await Effect.runPromise(
      reader.planItems.getPlanItems("service-type", "plan")
    );
    expect(after.data[0].attributes.title).toBe("New item");
  });

  it("shares schedule invalidation across request-owned services", async () => {
    const accessToken = "schedule-invalidation-token";
    const fetch = fetchFor(
      { id: "plan-person", type: "PlanPerson", attributes: { name: "A" } },
      "/team_members"
    );
    const services = servicesWith(accessToken, fetch);
    const mutationServices = servicesWith(accessToken, fetch);

    await Effect.runPromise(
      services.people.getPlanTeamMembers("service-type", "plan")
    );
    mutationServices.people.invalidateScheduleReadCaches({
      serviceTypeId: "service-type",
      planId: "plan",
    });
    await Effect.runPromise(
      services.people.getPlanTeamMembers("service-type", "plan")
    );

    expect(requestsOf(fetch)).toStrictEqual([
      "GET /services/v2/service_types/service-type/plans/plan/team_members",
      "GET /services/v2/service_types/service-type/plans/plan/team_members",
    ]);
  });
});

const reportError = (message: string, error: Error) => {
  throw new Error(message, { cause: error });
};

describe("createPlanningCenterServices shared tier", () => {
  it("shares the song catalog across isolates for the same credential only", async () => {
    const store = createMemorySharedReadStore();
    const isolate = () =>
      createPlanningCenterReadCaches({ store, reportError });
    const secondIsolate = isolate();
    const servicesIn = (
      token: string,
      readCaches: ReturnType<typeof isolate>
    ) =>
      createPlanningCenterServices(
        token,
        TIME_ZONE,
        unreachableHttpClient,
        readCaches
      );
    const first = servicesIn("token-a", isolate());
    vi.spyOn(first.core, "fetchFirstPages").mockReturnValue(
      Effect.succeed({
        data: [resource("first", "Song")],
        included: [],
        next: null,
      })
    );
    await Effect.runPromise(
      first.songs
        .getSongsCatalogCached("catalog")
        .pipe(Effect.ensuring(first.settleReadCaches))
    );

    const sameCredential = servicesIn("token-a", secondIsolate);
    const sameLoad = vi
      .spyOn(sameCredential.core, "fetchFirstPages")
      .mockReturnValue(
        Effect.succeed({
          data: [resource("reloaded", "Song")],
          included: [],
          next: null,
        })
      );
    const otherCredential = servicesIn("token-b", secondIsolate);
    const otherLoad = vi
      .spyOn(otherCredential.core, "fetchFirstPages")
      .mockReturnValue(
        Effect.succeed({
          data: [resource("other", "Song")],
          included: [],
          next: null,
        })
      );

    await expect(
      Effect.runPromise(sameCredential.songs.getSongsCatalogCached("catalog"))
    ).resolves.toMatchObject([{ id: "first" }]);
    await expect(
      Effect.runPromise(otherCredential.songs.getSongsCatalogCached("catalog"))
    ).resolves.toMatchObject([{ id: "other" }]);
    expect(sameLoad).not.toHaveBeenCalled();
    expect(otherLoad).toHaveBeenCalledOnce();
    expect([...store.entries.keys()].join(",")).not.toContain("token-");
  });
});
