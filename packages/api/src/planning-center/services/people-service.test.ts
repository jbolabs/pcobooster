import { createBasicPlanningCenterClient } from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterPage } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPaginationError } from "@pcobooster/api/planning-center/pagination-error";
import {
  createPlanningCenterPeopleServiceCaches,
  PlanningCenterPeopleService,
} from "@pcobooster/api/planning-center/services/people-service";
import {
  httpClientFor,
  unreachableHttpClient,
} from "@pcobooster/api/testing/http-client";
import {
  planningCenterBudgetFailures,
  planningCenterNotFound,
} from "@pcobooster/api/testing/planning-center-failures";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import type {
  JsonObject,
  JsonValue,
} from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect, Exit, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const resource = (
  id: string,
  type: string,
  attributes: JsonObject = {}
): PCResource => ({
  id,
  type,
  attributes,
});

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input.toString();

interface SentRequest {
  readonly method: string;
  readonly url: URL;
  readonly body: JsonValue | undefined;
}

const emptyList = { data: [], included: [] };

/** A people service over a fake Planning Center: a test sees only the requests that really go out. */
const serviceOver = (
  answer: (request: SentRequest) => object | null = () => emptyList,
  caches = createPlanningCenterPeopleServiceCaches()
) => {
  const sent: SentRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    await Promise.resolve();
    const request: SentRequest = {
      method: init?.method ?? "GET",
      url: new URL(urlOf(input)),
      body:
        init?.body instanceof Uint8Array
          ? Schema.decodeUnknownSync(Schema.fromJsonString(Schema.MutableJson))(
              new TextDecoder().decode(init.body)
            )
          : undefined,
    };
    sent.push(request);
    const answered = answer(request);
    return answered === null
      ? new Response(null, { status: 204 })
      : Response.json(answered);
  };
  const service = new PlanningCenterPeopleService(
    createBasicPlanningCenterClient(
      testPlanningCenterToken,
      httpClientFor(fetch)
    ),
    caches
  );
  const routes = () =>
    sent.map(({ method, url }) => `${method} ${url.pathname}`);
  return { service, sent, routes };
};

describe("PlanningCenterPeopleService.getAllPeople", () => {
  it("loads every directory page, caches by account, and returns independent copies", async () => {
    let scope = "account-a";
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchAll = vi
      .spyOn(core, "fetchAll")
      .mockReturnValue(
        Effect.succeed([
          resource("person-1", "Person", { first_name: "Original" }),
        ])
      );
    vi.spyOn(core, "getCacheScope").mockImplementation(() => scope);
    const service = new PlanningCenterPeopleService(core);
    const first = await Effect.runPromise(service.getAllPeople());
    first[0].attributes.first_name = "Changed";
    const second = await Effect.runPromise(service.getAllPeople());
    expect(second[0].attributes.first_name).toBe("Original");
    expect(fetchAll).toHaveBeenCalledExactlyOnceWith(
      "/people/v2/people",
      {},
      Number.POSITIVE_INFINITY
    );
    scope = "account-b";
    await Effect.runPromise(service.getAllPeople());
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });
});

describe("PlanningCenterPeopleService.getPlanTeamMembers", () => {
  it("reads every page so large rosters are not truncated to the first page", async () => {
    const { service, sent } = serviceOver(({ url }) =>
      url.searchParams.has("offset")
        ? { data: [resource("pp-2", "PlanPerson")], included: [] }
        : {
            data: [resource("pp-1", "PlanPerson")],
            included: [],
            links: { next: `${url.origin}${url.pathname}?offset=100` },
          }
    );

    const roster = await Effect.runPromise(
      service.getPlanTeamMembers("st-123", "plan-456")
    );

    expect(roster.data.map((member) => member.id)).toStrictEqual([
      "pp-1",
      "pp-2",
    ]);
    expect(sent[0]?.url.pathname).toBe(
      "/services/v2/service_types/st-123/plans/plan-456/team_members"
    );
    expect(Object.fromEntries(sent[0]?.url.searchParams ?? [])).toStrictEqual({
      include: "person,team,plan",
      per_page: "100",
      "fields[Person]":
        "first_name,last_name,photo_url,photo_thumbnail_url,archived_at",
      "fields[Plan]":
        "title,series_title,sort_date,created_at,planning_center_url,plan_people_count,series,service_type,plan_times",
    });
  });
});

describe("PlanningCenterPeopleService.getPersonTeamPositionAssignments", () => {
  it("caches assignment validation reads used by schedule POST", async () => {
    const { service, sent } = serviceOver(() => ({
      data: [resource("assignment-1", "PersonTeamPositionAssignment")],
      included: [],
    }));

    await Effect.runPromise(
      service.getPersonTeamPositionAssignments("person-123")
    );
    const second = await Effect.runPromise(
      service.getPersonTeamPositionAssignments("person-123")
    );

    expect(second.data.map((assignment) => assignment.id)).toStrictEqual([
      "assignment-1",
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url.pathname).toBe(
      "/services/v2/people/person-123/person_team_position_assignments"
    );
    expect(sent[0]?.url.searchParams.get("include")).toBe(
      "team_position,team_position.team"
    );
  });
});

describe("PlanningCenterPeopleService.searchPeopleByName", () => {
  it("caches normalized people search reads and returns mutation-safe copies", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetch = vi.spyOn(core, "fetchCollection").mockReturnValue(
      Effect.succeed({
        data: [resource("person-1", "Person", { first_name: "Andrew" })],
      })
    );
    const service = new PlanningCenterPeopleService(core);

    const first = await Effect.runPromise(
      service.searchPeopleByName("  Andrew  ")
    );
    first[0].attributes.first_name = "Mutated";
    const second = await Effect.runPromise(
      service.searchPeopleByName("andrew")
    );

    expect(fetch).toHaveBeenCalledOnce();
    const requestedUrl = new URL(fetch.mock.calls[0][0]);
    expect(requestedUrl.pathname).toBe("/people/v2/people");
    expect(Object.fromEntries(requestedUrl.searchParams)).toStrictEqual({
      "where[search_name]": "Andrew",
      order: "last_name,first_name",
      per_page: "15",
    });
    expect(second[0].attributes.first_name).toBe("Andrew");
  });
});

const team = (
  id: string,
  name: string,
  personIds: string[],
  archivedAt: string | null = null
): PCResource => ({
  id,
  type: "Team",
  attributes: { name, archived_at: archivedAt },
  relationships: {
    people: {
      data: personIds.map((personId) => ({ id: personId, type: "Person" })),
    },
  },
});

describe("PlanningCenterPeopleService.getAllPeopleFromTeams", () => {
  it("reads every team roster and its leaders in one request and returns mutation-safe copies", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const band = team("team-1", "Band", ["person-1", "person-2"]);
    band.relationships = {
      ...band.relationships,
      team_leaders: { data: [{ id: "leader-1", type: "TeamLeader" }] },
      service_type: { data: { id: "st-1", type: "ServiceType" } },
    };
    const fetchAllWithIncluded = vi
      .spyOn(core, "fetchFirstPages")
      .mockReturnValue(
        Effect.succeed({
          data: [
            band,
            team("team-2", "Hosts", ["person-1"]),
            team("team-3", "Retired", ["person-3"], "2026-01-01T00:00:00Z"),
          ],
          included: [
            resource("person-1", "Person", { first_name: "Alex" }),
            resource("person-2", "Person", { first_name: "Blair" }),
            resource("person-3", "Person", { first_name: "Casey" }),
            {
              ...resource("leader-1", "TeamLeader", {}),
              relationships: {
                person: { data: { id: "person-2", type: "Person" } },
              },
            },
            resource("st-1", "ServiceType", { name: "Sunday" }),
          ],
          next: null,
        })
      );
    const service = new PlanningCenterPeopleService(core);

    const first = await Effect.runPromise(service.getAllPeopleFromTeams());
    first.people[0].attributes.first_name = "Mutated";
    first.teams[0]?.personIds.push("mutated");
    const second = await Effect.runPromise(service.getAllPeopleFromTeams());

    expect(fetchAllWithIncluded).toHaveBeenCalledOnce();
    expect(fetchAllWithIncluded.mock.calls[0]?.slice(0, 2)).toStrictEqual([
      "/services/v2/teams",
      {
        include: "people,team_leaders,service_types",
        "fields[Person]":
          "first_name,last_name,photo_url,photo_thumbnail_url,archived_at",
      },
    ]);
    expect(second.people.map((person) => person.id)).toStrictEqual([
      "person-1",
      "person-2",
    ]);
    expect(second.people[0].attributes.first_name).toBe("Alex");
    expect(second.teams).toStrictEqual([
      {
        id: "team-1",
        name: "Band",
        serviceTypeName: "Sunday",
        personIds: ["person-1", "person-2"],
        leaderPersonIds: ["person-2"],
      },
      {
        id: "team-2",
        name: "Hosts",
        serviceTypeName: null,
        personIds: ["person-1"],
        leaderPersonIds: [],
      },
    ]);
  });
});

const scheduleQueries = (sent: readonly SentRequest[]) =>
  sent.map(({ url }) => Object.fromEntries(url.searchParams));

describe("PlanningCenterPeopleService.getPersonSchedulesAfter", () => {
  it("reads past and future schedules after a day without per-plan reads", async () => {
    const { service, sent } = serviceOver(() => ({
      data: [resource("schedule-1", "Schedule")],
      included: [],
    }));

    const first = await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-06-24", 2)
    );
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-06-24", 2)
    );

    expect(first.data.map((schedule) => schedule.id)).toStrictEqual([
      "schedule-1",
    ]);
    expect(sent.map(({ url }) => url.pathname)).toStrictEqual([
      "/services/v2/people/person-1/schedules",
    ]);
    expect(scheduleQueries(sent)).toStrictEqual([
      {
        filter: "after",
        after: "2026-06-24",
        include: "plan_times",
        order: "starts_at",
        per_page: "100",
        "fields[Schedule]":
          "status,sort_date,team_name,team_position_name,service_type_name,decline_reason,plan,team,service_type,plan_person,plan_times,times",
        "fields[PlanTime]": "name,starts_at,ends_at,time_type",
      },
    ]);
  });

  it("adds declined schedules only when asked, under their own cache entry", async () => {
    const { service, sent } = serviceOver();

    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-24", 2)
    );
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-24", 2, {
        includeDeclined: true,
      })
    );

    expect(scheduleQueries(sent).map((query) => query.filter)).toStrictEqual([
      "after",
      "after,with_declined",
    ]);
  });

  it("reads newest first when asked, so a capped read keeps upcoming dates", async () => {
    const { service, sent } = serviceOver();

    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-24", 2, {
        includeDeclined: true,
      })
    );
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-24", 2, {
        includeDeclined: true,
        newestFirst: true,
      })
    );

    expect(scheduleQueries(sent).map((query) => query.order)).toStrictEqual([
      "starts_at",
      "-starts_at",
    ]);
  });
});

/** Serves `schedules` in pages of `per_page`, the way Planning Center pages, counting requests. */
const pagedSchedules = (schedules: readonly PCResource[]) => {
  const sent: { path: string; offset: number }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    await Promise.resolve();
    const url = new URL(
      (input instanceof Request ? input : new Request(input, init)).url
    );
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const perPage = Number(url.searchParams.get("per_page"));
    sent.push({ path: url.pathname, offset });
    const next = new URL(url);
    next.searchParams.set("offset", String(offset + perPage));
    return Response.json({
      data: schedules.slice(offset, offset + perPage),
      included: [],
      links:
        offset + perPage < schedules.length ? { next: next.toString() } : {},
    });
  };
  const service = new PlanningCenterPeopleService(
    createBasicPlanningCenterClient(
      testPlanningCenterToken,
      httpClientFor(fetch)
    )
  );
  return { sent, service };
};

const manySchedules = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    resource(`schedule-${index}`, "Schedule")
  );

describe("PlanningCenterPeopleService schedule reads past one page", () => {
  it("fails a whole read that has more pages than allowed, and caches only complete reads", async () => {
    const { sent, service } = pagedSchedules(manySchedules(201));

    const capped = await Effect.runPromiseExit(
      service.getPersonSchedulesAfter("person-1", "2026-04-05", 2)
    );
    const again = await Effect.runPromiseExit(
      service.getPersonSchedulesAfter("person-1", "2026-04-05", 2)
    );
    const whole = await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-04-05", 3)
    );
    const sentBeforeWarm = sent.length;
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-04-05", 3)
    );

    expect({
      capped,
      retried: Exit.isFailure(again),
      whole: whole.data.length,
      sentByWarm: sent.length - sentBeforeWarm,
    }).toStrictEqual({
      capped: Exit.fail(
        new PlanningCenterPaginationError({
          reason: "page-limit",
          path: "/services/v2/people/person-1/schedules",
          pages: 2,
        })
      ),
      retried: true,
      whole: 201,
      sentByWarm: 0,
    });
    // The failed reads were not cached: the second one asked again.
    expect(sent.filter(({ offset }) => offset === 0)).toHaveLength(3);
  });

  it("says when a read of the first pages left schedules unread", async () => {
    const { service } = pagedSchedules(manySchedules(201));

    const prefix = await Effect.runPromise(
      service.getPersonSchedulesFirstPages("person-1", "2026-04-05", 2)
    );
    const whole = await Effect.runPromise(
      service.getPersonSchedulesFirstPages("person-1", "2026-04-05", 3)
    );

    expect([
      [prefix.data.length, prefix.complete],
      [whole.data.length, whole.complete],
    ]).toStrictEqual([
      [200, false],
      [201, true],
    ]);
  });

  it("caches schedule pages until the person's schedule or a plan's times change", async () => {
    const { sent, service } = pagedSchedules(manySchedules(150));
    const readPages = async () => {
      const first = await Effect.runPromise(
        service.getPersonSchedulesPage("person-1", "2026-04-05", 0)
      );
      const second = await Effect.runPromise(
        service.getPersonSchedulesPage(
          "person-1",
          "2026-04-05",
          first.nextOffset ?? 0
        )
      );
      return [first.data.length, first.nextOffset, second.nextOffset];
    };

    const pages = await readPages();
    await readPages();
    const afterWarm = sent.length;
    service.invalidateScheduleReadCaches({
      personId: "person-1",
      serviceTypeId: "st-1",
      planId: "plan-1",
    });
    await readPages();
    const afterScheduleWrite = sent.length;
    service.invalidatePlanTimeSensitiveReadCaches("plan-1");
    await readPages();

    expect({
      pages,
      afterWarm,
      afterScheduleWrite,
      afterPlanTimeWrite: sent.length,
    }).toStrictEqual({
      pages: [100, 100, null],
      afterWarm: 2,
      afterScheduleWrite: 4,
      afterPlanTimeWrite: 6,
    });
  });
});

const planPersonAnswer = ({ method }: SentRequest) =>
  method === "PATCH"
    ? { data: { id: "pp-123", type: "PlanPerson", attributes: {} } }
    : emptyList;

describe("PlanningCenterPeopleService.updatePlanPersonStatus", () => {
  it("invalidates cached plan team members when plan context is available", async () => {
    const { service, sent, routes } = serviceOver(planPersonAnswer);

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));

    await Effect.runPromise(
      service.updatePlanPersonStatus("pp-123", "C", {
        personId: "person-456",
        serviceTypeId: "st-789",
        planId: "plan-101",
      })
    );

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));

    expect(routes()).toStrictEqual([
      "GET /services/v2/service_types/st-789/plans/plan-101/team_members",
      "PATCH /services/v2/service_types/st-789/plans/plan-101/team_members/pp-123",
      "GET /services/v2/service_types/st-789/plans/plan-101/team_members",
    ]);
    expect(sent[1]?.body).toStrictEqual({
      data: {
        type: "PlanPerson",
        id: "pp-123",
        attributes: {
          status: "C",
        },
      },
    });
  });

  it("patches through the person when no plan is known", async () => {
    const { service, routes } = serviceOver(planPersonAnswer);

    await Effect.runPromise(
      service.updatePlanPersonStatus("pp-123", "D", { personId: "person-456" })
    );

    expect(routes()).toStrictEqual([
      "PATCH /services/v2/people/person-456/plan_people/pp-123",
    ]);
  });
});

describe("PlanningCenterPeopleService.updatePlanPersonTimes", () => {
  it("patches PlanPerson time relationships and invalidates cached plan members", async () => {
    const { service, sent, routes } = serviceOver(planPersonAnswer);

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));

    await Effect.runPromise(
      service.updatePlanPersonTimes({
        personId: "person-456",
        planPersonId: "pp-123",
        serviceTypeId: "st-789",
        planId: "plan-101",
        planTimeIds: ["time-1", "time-2"],
      })
    );

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));

    expect(routes()).toStrictEqual([
      "GET /services/v2/service_types/st-789/plans/plan-101/team_members",
      "PATCH /services/v2/people/person-456/plan_people/pp-123",
      "GET /services/v2/service_types/st-789/plans/plan-101/team_members",
    ]);
    expect(sent[1]?.body).toStrictEqual({
      data: {
        type: "PlanPerson",
        id: "pp-123",
        relationships: {
          times: {
            data: [
              { type: "PlanTime", id: "time-1" },
              { type: "PlanTime", id: "time-2" },
            ],
          },
        },
      },
    });
  });
});

describe("PlanningCenterPeopleService.invalidateScheduleReadCaches", () => {
  it("clears cached plan team members and person schedules for conflict reconciliation", async () => {
    const { service, routes } = serviceOver();

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-456", "2026-09-28")
    );
    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-456", "2026-09-28")
    );

    service.invalidateScheduleReadCaches({
      personId: "person-456",
      serviceTypeId: "st-789",
      planId: "plan-101",
    });

    await Effect.runPromise(service.getPlanTeamMembers("st-789", "plan-101"));
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-456", "2026-09-28")
    );

    expect(routes()).toStrictEqual([
      "GET /services/v2/service_types/st-789/plans/plan-101/team_members",
      "GET /services/v2/people/person-456/schedules",
      "GET /services/v2/service_types/st-789/plans/plan-101/team_members",
      "GET /services/v2/people/person-456/schedules",
    ]);
  });
});

const page = (
  data: PCResource[],
  nextOffset: number | null = null
): PlanningCenterPage => ({ data, included: [], nextOffset });

describe("PlanningCenterPeopleService.getPlanPlanTimesPage", () => {
  it("reads one page from its offset and caches it under that offset", async () => {
    const { service, sent } = serviceOver(({ url }) => ({
      data: [resource("time-1", "PlanTime")],
      included: [],
      links: {
        next: `${url.origin}${url.pathname}?offset=200&per_page=100`,
      },
    }));

    const first = await Effect.runPromise(
      service.getPlanPlanTimesPage("plan-456", 100)
    );
    await Effect.runPromise(service.getPlanPlanTimesPage("plan-456", 100));

    expect(first).toStrictEqual(page([resource("time-1", "PlanTime")], 200));
    expect(
      sent.map(({ url }) => `${url.pathname}?${url.searchParams.toString()}`)
    ).toStrictEqual([
      "/services/v2/plans/plan-456/plan_times?per_page=100&offset=100",
    ]);
  });

  it("reads a plan Planning Center does not find as having no times", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    vi.spyOn(core, "fetchPage").mockReturnValue(
      Effect.fail(planningCenterNotFound())
    );
    const service = new PlanningCenterPeopleService(core);

    await expect(
      Effect.runPromise(service.getPlanPlanTimesPage("plan-456", 0))
    ).resolves.toStrictEqual(page([]));
  });

  it.each(planningCenterBudgetFailures())(
    "fails with %s instead of caching no times",
    async (failure) => {
      const core = createBasicPlanningCenterClient(
        testPlanningCenterToken,
        unreachableHttpClient
      );
      const fetchPage = vi
        .spyOn(core, "fetchPage")
        .mockReturnValueOnce(Effect.fail(failure))
        .mockReturnValueOnce(
          Effect.succeed(page([resource("time-1", "PlanTime")]))
        );
      const service = new PlanningCenterPeopleService(core);

      await expect(
        Effect.runPromiseExit(service.getPlanPlanTimesPage("plan-456", 0))
      ).resolves.toStrictEqual(Exit.fail(failure));
      await expect(
        Effect.runPromise(service.getPlanPlanTimesPage("plan-456", 0))
      ).resolves.toStrictEqual(page([resource("time-1", "PlanTime")]));
      expect(fetchPage).toHaveBeenCalledTimes(2);
    }
  );

  it("drops every cached page of a plan when its times change", async () => {
    const { service, sent } = serviceOver();
    const readBoth = Effect.all([
      service.getPlanPlanTimesPage("plan-456", 0),
      service.getPlanPlanTimesPage("plan-456", 100),
    ]);

    await Effect.runPromise(readBoth);
    service.invalidatePlanTimeSensitiveReadCaches("plan-456");
    await Effect.runPromise(readBoth);

    // The first page is read without an offset.
    expect(sent.map(({ url }) => url.searchParams.get("offset"))).toStrictEqual(
      [null, "100", null, "100"]
    );
  });
});

describe("PlanningCenterPeopleService.getPersonBlockouts", () => {
  it("reads every page, and fails rather than return part of a list past ten pages", async () => {
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      unreachableHttpClient
    );
    const fetchPage = vi
      .spyOn(core, "fetchPage")
      .mockImplementation((_endpoint, _params, offset) =>
        Effect.succeed({
          data: [resource(`blockout-${offset}`, "Blockout")],
          included: [],
          nextOffset: offset + 100,
        })
      );
    const service = new PlanningCenterPeopleService(core);

    const exit = await Effect.runPromiseExit(
      service.getPersonBlockouts("person-1")
    );

    expect({
      exit,
      pages: fetchPage.mock.calls.map((call) => call[2]),
    }).toStrictEqual({
      exit: Exit.fail(
        new PlanningCenterPaginationError({
          reason: "page-limit",
          path: "/services/v2/people/person-1/blockouts",
          pages: 10,
        })
      ),
      pages: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    });
  });
});

describe("PlanningCenterPeopleService.deletePlanPerson", () => {
  it("uses the plan team_members endpoint when plan context is available", async () => {
    const { service, routes } = serviceOver(() => null);

    await Effect.runPromise(
      service.deletePlanPerson("pp-123", {
        personId: "person-456",
        serviceTypeId: "st-789",
        planId: "plan-101",
      })
    );

    expect(routes()).toStrictEqual([
      "DELETE /services/v2/service_types/st-789/plans/plan-101/team_members/pp-123",
    ]);
  });

  it("uses the person-scoped plan_people endpoint without plan context", async () => {
    const { service, routes } = serviceOver(() => null);

    await Effect.runPromise(
      service.deletePlanPerson("pp-123", {
        personId: "person-456",
      })
    );

    expect(routes()).toStrictEqual([
      "DELETE /services/v2/people/person-456/plan_people/pp-123",
    ]);
  });
});

const rosterRead = (planId: string) =>
  `GET /services/v2/service_types/st-1/plans/${planId}/team_members`;

const readWindowRoster = async (service: PlanningCenterPeopleService) =>
  await Effect.runPromise(
    service.getPlanWindowRoster("st-1", "plan-1", { settled: false })
  );

describe("PlanningCenterPeopleService plan rosters", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the selected plan fresh even while the window keeps a settled copy", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T18:00:00.000Z") });
    const { service, routes } = serviceOver();
    const readBoth = async () => {
      await Effect.runPromise(
        service.getPlanWindowRoster("st-1", "plan-past", { settled: true })
      );
      await Effect.runPromise(service.getPlanTeamMembers("st-1", "plan-past"));
    };

    await readBoth();
    vi.advanceTimersByTime(31 * 1000);
    await readBoth();

    expect(routes()).toStrictEqual([
      rosterRead("plan-past"),
      rosterRead("plan-past"),
      rosterRead("plan-past"),
    ]);
  });

  it("keeps a settled window roster for 30 minutes and a live one for 5", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T18:00:00.000Z") });
    const { service, routes } = serviceOver();
    const readBoth = async () => {
      await Effect.runPromise(
        service.getPlanWindowRoster("st-1", "plan-past", { settled: true })
      );
      await Effect.runPromise(
        service.getPlanWindowRoster("st-1", "plan-next", { settled: false })
      );
    };

    await readBoth();
    vi.advanceTimersByTime(6 * 60 * 1000);
    await readBoth();

    expect(routes()).toStrictEqual([
      rosterRead("plan-past"),
      rosterRead("plan-next"),
      rosterRead("plan-next"),
    ]);
  });

  it("clears the fresh roster and the window's copy when this app changes the plan", async () => {
    const { service, routes } = serviceOver();
    const read = async () => {
      await Effect.runPromise(
        service.getPlanWindowRoster("st-1", "plan-past", { settled: true })
      );
      await Effect.runPromise(service.getPlanTeamMembers("st-1", "plan-past"));
    };

    await read();
    service.invalidateScheduleReadCaches({
      serviceTypeId: "st-1",
      planId: "plan-past",
    });
    await read();

    expect(routes()).toStrictEqual([
      rosterRead("plan-past"),
      rosterRead("plan-past"),
      rosterRead("plan-past"),
      rosterRead("plan-past"),
    ]);
  });

  it("shares window rosters across requests of the isolate until a write clears them", async () => {
    const caches = createPlanningCenterPeopleServiceCaches();
    const first = serviceOver(undefined, caches);
    const second = serviceOver(undefined, caches);

    await readWindowRoster(first.service);
    await readWindowRoster(second.service);
    second.service.invalidatePlanWindowRosters();
    await readWindowRoster(first.service);

    expect([first.sent.length, second.sent.length]).toStrictEqual([2, 0]);
  });
});

describe("PlanningCenterPeopleService.getPersonSchedulesAfter with an instant", () => {
  it("reads past and future schedules after an instant without per-plan time reads", async () => {
    const { service, sent } = serviceOver(() => ({
      data: [resource("schedule-1", "Schedule")],
      included: [],
    }));

    const first = await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-31T07:00:00.000Z", 5)
    );
    await Effect.runPromise(
      service.getPersonSchedulesAfter("person-1", "2026-03-31T07:00:00.000Z", 5)
    );

    expect(first.data.map((schedule) => schedule.id)).toStrictEqual([
      "schedule-1",
    ]);
    expect(sent.map(({ url }) => url.pathname)).toStrictEqual([
      "/services/v2/people/person-1/schedules",
    ]);
    expect(scheduleQueries(sent)).toStrictEqual([
      {
        filter: "after",
        after: "2026-03-31T07:00:00.000Z",
        include: "plan_times",
        order: "starts_at",
        per_page: "100",
        "fields[Schedule]":
          "status,sort_date,team_name,team_position_name,service_type_name,decline_reason,plan,team,service_type,plan_person,plan_times,times",
        "fields[PlanTime]": "name,starts_at,ends_at,time_type",
      },
    ]);
  });

  it("drops cached schedules and plan people when the person's schedule changes", async () => {
    const { service, routes, sent } = serviceOver();
    const readBoth = async () => {
      await Effect.runPromise(
        service.getPersonSchedulesAfter("person-1", "2026-03-31T07:00:00.000Z")
      );
      await Effect.runPromise(service.getPersonPlanPeople("person-1"));
    };

    await readBoth();
    await readBoth();
    service.invalidateScheduleReadCaches({
      personId: "person-1",
      serviceTypeId: "st-1",
      planId: "plan-1",
    });
    await readBoth();

    expect(routes()).toStrictEqual([
      "GET /services/v2/people/person-1/schedules",
      "GET /services/v2/people/person-1/plan_people",
      "GET /services/v2/people/person-1/schedules",
      "GET /services/v2/people/person-1/plan_people",
    ]);
    expect(sent[1]?.url.searchParams.get("include")).toBe("plan,team");
  });
});

describe("personal schedule archive", () => {
  it("reads one page of personal assignments across all dates without per-plan calls", async () => {
    const { service, sent } = serviceOver(() => ({
      data: [
        resource("assignment-1", "Schedule", {
          sort_date: "2024-12-25T19:00:00Z",
        }),
      ],
      links: {
        next: "https://api.planningcenteronline.com/services/v2/people/person-7/schedules?offset=200&per_page=100",
      },
    }));
    const schedulePage = await Effect.runPromise(
      service.getPersonAllSchedulesPage("person-7", 100)
    );
    expect(schedulePage).toStrictEqual({
      data: [
        resource("assignment-1", "Schedule", {
          sort_date: "2024-12-25T19:00:00Z",
        }),
      ],
      included: [],
      nextOffset: 200,
    });
    expect(
      sent.map(({ url }) => ({
        path: url.pathname,
        filter: url.searchParams.get("filter"),
        order: url.searchParams.get("order"),
        offset: url.searchParams.get("offset"),
        perPage: url.searchParams.get("per_page"),
        include: url.searchParams.get("include"),
      }))
    ).toStrictEqual([
      {
        path: "/services/v2/people/person-7/schedules",
        filter: "all,not_across_organizations",
        order: "-starts_at",
        offset: "100",
        perPage: "100",
        include: null,
      },
    ]);
  });
});
