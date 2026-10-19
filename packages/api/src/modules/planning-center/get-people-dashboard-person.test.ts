import { getPeopleDashboardActivity } from "@pcobooster/api/modules/planning-center/get-people-dashboard";
import {
  getPeopleDashboardPerson,
  getPersonScheduleWindow,
} from "@pcobooster/api/modules/planning-center/get-people-dashboard-person";
import type { PeopleDashboardPersonDependencies } from "@pcobooster/api/modules/planning-center/get-people-dashboard-person";
import type { PeopleDashboardPersonDetail } from "@pcobooster/api/modules/planning-center/people-dashboard-types";
import type { PlanTimesProgress } from "@pcobooster/api/modules/planning-center/people/plan-time-pages";
import { PlanningCenterAccounting } from "@pcobooster/api/planning-center/accounting";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import { PROGRESSIVE_REQUEST_BUDGET } from "@pcobooster/api/planning-center/request-budget";
import { PlanningCenterReadCache } from "@pcobooster/api/planning-center/services/read-cache";
import {
  planningCenterBudgetFailures,
  planningCenterNotFound,
} from "@pcobooster/api/testing/planning-center-failures";
import { countedRead } from "@pcobooster/api/testing/planning-center-requests";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

const LOS_ANGELES = "America/Los_Angeles";
const NOW = new Date("2026-09-24T18:00:00.000Z");

type PeopleReader = PeopleDashboardPersonDependencies["peopleService"];
type Collection = Effect.Success<
  ReturnType<PeopleReader["getPersonSchedulesAfter"]>
>;

const person: PCResource = {
  type: "Person",
  id: "person-1",
  attributes: {
    first_name: "Ada",
    last_name: "Lovelace",
    photo_thumbnail_url: null,
  },
};

const serviceType: PCResource = {
  type: "ServiceType",
  id: "service-type-1",
  attributes: { name: "Sunday" },
};

const planTime = (
  id: string,
  startsAt: string,
  timeType: "service" | "rehearsal" | "other",
  planId = "plan-1"
): PCResource => ({
  type: "PlanTime",
  id,
  attributes: { starts_at: startsAt, time_type: timeType },
  relationships: { plan: { data: { type: "Plan", id: planId } } },
});

const ids = (type: string, values: string[]) =>
  values.map((id) => ({ type, id }));

const schedule = ({
  id,
  planId,
  sortDate,
  status = "C",
  timeIds,
  position = "Keys",
  serviceTypeId = "service-type-1",
}: {
  id: string;
  planId: string;
  sortDate: string;
  status?: string;
  timeIds: string[];
  position?: string;
  serviceTypeId?: string;
}): PCResource => ({
  type: "Schedule",
  id,
  attributes: {
    sort_date: sortDate,
    status,
    team_name: "Band",
    team_position_name: position,
    service_type_name: "Sunday",
  } satisfies JsonObject,
  relationships: {
    plan: { data: { type: "Plan", id: planId } },
    plan_person: { data: { type: "PlanPerson", id } },
    service_type: { data: { type: "ServiceType", id: serviceTypeId } },
    times: { data: ids("PlanTime", timeIds) },
  },
});

const planPerson = ({
  id,
  planId,
  status,
  timeIds,
}: {
  id: string;
  planId: string;
  status: string;
  timeIds: string[];
}): PCResource => ({
  type: "PlanPerson",
  id,
  attributes: { status, team_position_name: "Vocals" },
  relationships: {
    plan: { data: { type: "Plan", id: planId } },
    team: { data: { type: "Team", id: "team-1" } },
    service_type: { data: { type: "ServiceType", id: "service-type-1" } },
    times: { data: ids("PlanTime", timeIds) },
  },
});

const emptyCollection = (): Collection => ({ data: [], included: [] });

interface Fixture {
  readonly schedules?: Collection;
  readonly planPeople?: Collection;
  readonly rangeIncluded?: PCResource[];
  readonly planPlanTimes?: Record<string, PCResource[]>;
  readonly cacheScope?: string;
  readonly detailCache?: PeopleDashboardPersonDependencies["detailCache"];
}

const dependenciesFor = ({
  schedules = emptyCollection(),
  planPeople = emptyCollection(),
  rangeIncluded = [],
  planPlanTimes = {},
  cacheScope = crypto.randomUUID(),
  detailCache = new PlanningCenterReadCache(),
}: Fixture = {}) => {
  const getPerson = vi
    .fn<PeopleReader["getPerson"]>()
    .mockReturnValue(Effect.succeed(person));
  const getPersonSchedulesAfter = vi
    .fn<PeopleReader["getPersonSchedulesAfter"]>()
    .mockReturnValue(Effect.succeed(schedules));
  const getPersonPlanPeople = vi
    .fn<PeopleReader["getPersonPlanPeople"]>()
    .mockReturnValue(Effect.succeed(planPeople));
  // A plan's whole time list; `dependencies` serves it as the plan's only page.
  const getPlanPlanTimes = vi.fn<
    (planId: string) => Effect.Effect<PCResource[], PlanningCenterError>
  >((planId: string) => Effect.succeed(planPlanTimes[planId] ?? []));
  const getServiceTypesCached = vi
    .fn<
      PeopleDashboardPersonDependencies["catalogService"]["getServiceTypesCached"]
    >()
    .mockReturnValue(Effect.succeed([serviceType]));
  const getPlansWithIncludedInDateRange = vi
    .fn<
      PeopleDashboardPersonDependencies["plansService"]["getPlansWithIncludedInDateRange"]
    >()
    .mockReturnValue(
      Effect.succeed({ data: [], included: rangeIncluded, complete: true })
    );
  const dependencies: PeopleDashboardPersonDependencies = {
    peopleService: {
      getCacheScope: () => cacheScope,
      getPerson,
      getPersonSchedulesAfter,
      getPersonPlanPeople,
      getPlanPlanTimesPage: (planId) =>
        Effect.map(getPlanPlanTimes(planId), (data) => ({
          data,
          included: [],
          nextOffset: null,
        })),
    },
    catalogService: { getServiceTypesCached },
    plansService: { getPlansWithIncludedInDateRange },
    resolveTimeZone: Effect.succeed(LOS_ANGELES),
    detailCache,
  };
  return {
    dependencies,
    getPerson,
    getPersonSchedulesAfter,
    getPersonPlanPeople,
    getPlanPlanTimes,
    getPlansWithIncludedInDateRange,
    getServiceTypesCached,
  };
};

const readDetail = async (
  dependencies: PeopleDashboardPersonDependencies,
  month = "2026-09"
) =>
  await Effect.runPromise(
    getPeopleDashboardPerson({ personId: "person-1", month, dependencies })
  );

describe(getPersonScheduleWindow, () => {
  it("reads the dashboard's 181 days of history, or the month when it starts earlier", () => {
    expect(
      getPersonScheduleWindow({ year: 2026, monthIndex: 8 }, NOW, LOS_ANGELES)
    ).toStrictEqual({
      startDayKey: "2026-03-27",
      afterDayKey: "2026-03-26",
      planTimesFromDayKey: "2026-06-25",
      rangeStartDayKey: "2026-06-24",
      rangeEndDayKey: "2026-12-31",
      orgTimeZone: LOS_ANGELES,
    });
    expect(
      getPersonScheduleWindow({ year: 2027, monthIndex: 5 }, NOW, LOS_ANGELES)
    ).toStrictEqual({
      startDayKey: "2026-03-27",
      afterDayKey: "2026-03-26",
      planTimesFromDayKey: "2026-06-25",
      rangeStartDayKey: "2026-06-24",
      rangeEndDayKey: "2027-06-30",
      orgTimeZone: LOS_ANGELES,
    });
    expect(
      getPersonScheduleWindow({ year: 2026, monthIndex: 0 }, NOW, LOS_ANGELES)
    ).toMatchObject({
      startDayKey: "2026-01-01",
      planTimesFromDayKey: "2026-01-01",
    });
  });
});

const augustAndSeptemberFixture = () =>
  dependenciesFor({
    schedules: {
      data: [
        schedule({
          id: "schedule-aug",
          planId: "plan-aug",
          sortDate: "2026-08-16T17:00:00Z",
          timeIds: ["time-aug-service"],
        }),
        schedule({
          id: "schedule-sep",
          planId: "plan-1",
          sortDate: "2026-09-13T17:00:00Z",
          timeIds: ["time-sep-rehearsal", "time-sep-service"],
        }),
      ],
      included: [
        planTime("time-aug-service", "2026-08-16T17:00:00Z", "service"),
        planTime("time-sep-service", "2026-09-13T17:00:00Z", "service"),
      ],
    },
    rangeIncluded: [
      planTime("time-sep-rehearsal", "2026-09-10T02:00:00Z", "rehearsal"),
    ],
  });

const plansOf = (serviceTypeId: string) =>
  [6, 13, 20].map((day) => ({
    planId: `${serviceTypeId}-plan-${day}`,
    sortDate: `2026-09-${String(day).padStart(2, "0")}T17:00:00Z`,
    rehearsal: planTime(
      `${serviceTypeId}-rehearsal-${day}`,
      `2026-09-${String(day - 2).padStart(2, "0")}T17:00:00Z`,
      "rehearsal",
      `${serviceTypeId}-plan-${day}`
    ),
  }));

describe(getPeopleDashboardPerson, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("separates cached dashboard details by account service scope", async () => {
    vi.useFakeTimers({ now: NOW });
    const detailCache =
      new PlanningCenterReadCache<PeopleDashboardPersonDetail>();
    const first = dependenciesFor({ cacheScope: "bearer:first", detailCache });
    const second = dependenciesFor({
      cacheScope: "bearer:second",
      detailCache,
    });

    const detail = await readDetail(first.dependencies);
    await readDetail(first.dependencies);
    await readDetail(second.dependencies);

    expect(detail.person.id).toBe("person-1");
    expect(first.getPerson).toHaveBeenCalledOnce();
    expect(second.getPerson).toHaveBeenCalledOnce();
  });

  it("reads the person's own schedules and one plan range per service type", async () => {
    vi.useFakeTimers({ now: NOW });
    const fixture = augustAndSeptemberFixture();

    await readDetail(fixture.dependencies);

    expect(fixture.getPersonSchedulesAfter).toHaveBeenCalledExactlyOnceWith(
      "person-1",
      "2026-03-26T07:00:00.000Z",
      5,
      { includeDeclined: true }
    );
    expect(
      fixture.getPlansWithIncludedInDateRange
    ).toHaveBeenCalledExactlyOnceWith(
      "service-type-1",
      "2026-06-24",
      "2026-12-31",
      "plan_times",
      LOS_ANGELES
    );
    expect(fixture.getPlanPlanTimes).not.toHaveBeenCalled();
    expect(fixture.getServiceTypesCached).not.toHaveBeenCalled();
  });

  it("builds the month and the rhythm from distinct org calendar days", async () => {
    vi.useFakeTimers({ now: NOW });
    const fixture = augustAndSeptemberFixture();

    const detail = await readDetail(fixture.dependencies);
    const { person: summary } = detail;

    expect({
      teams: summary.teams,
      roles: summary.roles,
      rhythm: summary.rhythm,
    }).toStrictEqual({
      teams: ["Band"],
      roles: ["Keys"],
      rhythm: {
        lastServedOn: "2026-09-13",
        nextServingOn: null,
        servedDays30: 1,
        servedDays90: 2,
        servedDays180: 2,
        upcomingDays30: 0,
        typicalGapDays: null,
        requests180: 2,
        declined180: 0,
        pendingUpcoming: 0,
        nextPendingOn: null,
      },
    });
    expect(summary.monthDays).toStrictEqual([
      {
        day: 9,
        kind: "rehearsal",
        positionName: "Keys",
        serviceTypeName: "Sunday",
        status: "C",
        planUrl: "/services/service-type-1/plans/plan-1/lineup",
      },
      {
        day: 13,
        kind: "service",
        positionName: "Keys",
        serviceTypeName: "Sunday",
        status: "C",
        planUrl: "/services/service-type-1/plans/plan-1/lineup",
      },
    ]);
  });

  it("places services by the organization's calendar day, not the UTC day", async () => {
    vi.useFakeTimers({ now: NOW });
    const fixture = dependenciesFor({
      schedules: {
        data: [
          schedule({
            id: "schedule-late",
            planId: "plan-late",
            sortDate: "2026-10-01T05:00:00Z",
            timeIds: ["time-late"],
          }),
        ],
        included: [planTime("time-late", "2026-10-01T05:00:00Z", "service")],
      },
    });

    const september = await readDetail(fixture.dependencies, "2026-09");

    expect(september.person.monthDays.map((day) => day.day)).toStrictEqual([
      30,
    ]);
    expect(september.person.rhythm.nextServingOn).toBe("2026-09-30");
  });

  it("counts declines as responses, never as serving", async () => {
    vi.useFakeTimers({ now: NOW });
    const fixture = dependenciesFor({
      schedules: {
        data: [
          schedule({
            id: "schedule-declined",
            planId: "plan-1",
            sortDate: "2026-09-13T17:00:00Z",
            status: "D",
            timeIds: ["time-sep-service"],
          }),
        ],
        included: [
          planTime("time-sep-service", "2026-09-13T17:00:00Z", "service"),
        ],
      },
      planPeople: {
        data: [
          planPerson({
            id: "plan-person-declined",
            planId: "plan-2",
            status: "D",
            timeIds: ["time-oct-service"],
          }),
        ],
        included: [],
      },
    });

    const detail = await readDetail(fixture.dependencies);

    expect(detail.person.monthDays).toStrictEqual([]);
    expect(detail.person.rhythm).toMatchObject({
      lastServedOn: null,
      nextServingOn: null,
      servedDays180: 0,
      requests180: 1,
      declined180: 1,
    });
    expect(fixture.getServiceTypesCached).not.toHaveBeenCalled();
  });

  it("shows upcoming requests that were prepared but not sent, without counting them as asked", async () => {
    vi.useFakeTimers({ now: NOW });
    const fixture = dependenciesFor({
      schedules: {
        data: [
          schedule({
            id: "plan-person-sent",
            planId: "plan-1",
            sortDate: "2026-09-27T17:00:00Z",
            timeIds: ["time-sent"],
          }),
        ],
        included: [planTime("time-sent", "2026-09-27T17:00:00Z", "service")],
      },
      planPeople: {
        data: [
          planPerson({
            id: "plan-person-sent",
            planId: "plan-1",
            status: "C",
            timeIds: ["time-sent"],
          }),
          planPerson({
            id: "plan-person-pending",
            planId: "plan-2",
            status: "U",
            timeIds: ["time-pending"],
          }),
        ],
        included: [
          {
            type: "Plan",
            id: "plan-2",
            attributes: { sort_date: "2026-09-26T15:00:00Z" },
          },
          { type: "Team", id: "team-1", attributes: { name: "Choir" } },
        ],
      },
      rangeIncluded: [
        planTime("time-pending", "2026-09-26T15:00:00Z", "service", "plan-2"),
      ],
    });

    const detail = await readDetail(fixture.dependencies);

    // The person has not been asked yet, so the rhythm (like the dashboard's) leaves it out.
    expect(detail.person.rhythm).toMatchObject({
      nextServingOn: "2026-09-27",
      upcomingDays30: 1,
      pendingUpcoming: 0,
    });
    expect(detail.person.monthDays).toContainEqual({
      day: 26,
      kind: "service",
      positionName: "Vocals",
      serviceTypeName: "Sunday",
      status: "U",
      planUrl: "/services/service-type-1/plans/plan-2/lineup",
    });
    // Most recent first.
    expect(detail.person.teams).toStrictEqual(["Band", "Choir"]);
  });

  it("reads a plan's own times only when the plan range lacks them", async () => {
    vi.useFakeTimers({ now: NOW });
    const fixture = dependenciesFor({
      schedules: {
        data: [
          schedule({
            id: "schedule-sep",
            planId: "plan-1",
            sortDate: "2026-09-13T17:00:00Z",
            timeIds: ["time-sep-rehearsal", "time-sep-service"],
          }),
        ],
        included: [
          planTime("time-sep-service", "2026-09-13T17:00:00Z", "service"),
        ],
      },
      planPlanTimes: {
        "plan-1": [
          planTime("time-sep-rehearsal", "2026-09-12T17:00:00Z", "rehearsal"),
          planTime("time-sep-other", "2026-09-12T19:00:00Z", "other"),
        ],
      },
    });

    const detail = await readDetail(fixture.dependencies);

    expect(fixture.getPlanPlanTimes).toHaveBeenCalledExactlyOnceWith("plan-1");
    expect(
      detail.person.monthDays.map(({ day, kind }) => `${day}:${kind}`)
    ).toStrictEqual(["12:rehearsal", "13:service"]);
    expect(detail.requestBudget.unresolvedRehearsalTimes).toBe(0);
  });

  it("gives the person the same serving rhythm the dashboard reads", async () => {
    vi.useFakeTimers({ now: NOW });
    const fixture = dependenciesFor({
      schedules: {
        data: [
          // Older than the rehearsal window on both pages.
          schedule({
            id: "schedule-may",
            planId: "plan-may",
            sortDate: "2026-05-03T17:00:00Z",
            timeIds: ["time-may-rehearsal"],
          }),
          schedule({
            id: "schedule-jul",
            planId: "plan-jul",
            sortDate: "2026-07-19T17:00:00Z",
            timeIds: ["time-jul-service"],
          }),
          schedule({
            id: "schedule-aug-declined",
            planId: "plan-aug",
            sortDate: "2026-08-16T17:00:00Z",
            status: "D",
            timeIds: ["time-aug-service"],
          }),
          schedule({
            id: "schedule-sep",
            planId: "plan-1",
            sortDate: "2026-09-13T17:00:00Z",
            timeIds: ["time-sep-rehearsal", "time-sep-service"],
          }),
          schedule({
            id: "schedule-oct",
            planId: "plan-oct",
            sortDate: "2026-10-04T17:00:00Z",
            status: "U",
            timeIds: ["time-oct-service"],
          }),
        ],
        included: [
          planTime("time-jul-service", "2026-07-19T17:00:00Z", "service"),
          planTime("time-aug-service", "2026-08-16T17:00:00Z", "service"),
          planTime("time-sep-service", "2026-09-13T17:00:00Z", "service"),
          planTime("time-oct-service", "2026-10-04T17:00:00Z", "service"),
        ],
      },
      rangeIncluded: [
        planTime("time-sep-rehearsal", "2026-09-10T02:00:00Z", "rehearsal"),
      ],
    });

    const [detail, activity] = await Promise.all([
      readDetail(fixture.dependencies),
      Effect.runPromise(
        getPeopleDashboardActivity({
          personIds: ["person-1"],
          dependencies: {
            peopleService: {
              getPersonSchedulesFirstPages: (...args) =>
                Effect.map(
                  fixture.dependencies.peopleService.getPersonSchedulesAfter(
                    ...args
                  ),
                  (schedules) => ({ ...schedules, complete: true })
                ),
            },
            plansService: fixture.dependencies.plansService,
            resolveTimeZone: Effect.succeed(LOS_ANGELES),
          },
        })
      ),
    ]);

    expect(detail.person.rhythm).toStrictEqual(activity.people[0]?.rhythm);
    expect(detail.person.rhythm).toMatchObject({
      lastServedOn: "2026-09-13",
      nextServingOn: "2026-10-04",
      servedDays30: 1,
      servedDays90: 2,
      servedDays180: 3,
      requests180: 4,
      declined180: 1,
      pendingUpcoming: 1,
      nextPendingOn: "2026-10-04",
    });
  });

  it("stays within the budget for someone serving in 12 service types and continues to every rehearsal time", async () => {
    vi.useFakeTimers({ now: NOW });
    const serviceTypeIds = Array.from(
      { length: 12 },
      (_, index) => `service-type-${index}`
    );
    const schedules = serviceTypeIds.flatMap((serviceTypeId) =>
      plansOf(serviceTypeId).map(({ planId, sortDate, rehearsal }) =>
        schedule({
          id: `schedule-${planId}`,
          planId,
          sortDate,
          serviceTypeId,
          timeIds: [rehearsal.id],
        })
      )
    );
    const rehearsalsByPlanId = new Map(
      serviceTypeIds.flatMap((serviceTypeId) =>
        plansOf(serviceTypeId).map(({ planId, rehearsal }) => [
          planId,
          rehearsal,
        ])
      )
    );
    const fixture = dependenciesFor();
    fixture.getPerson.mockReturnValue(countedRead(person));
    fixture.getPersonSchedulesAfter.mockReturnValue(
      countedRead({ data: schedules, included: [] })
    );
    fixture.getPersonPlanPeople.mockReturnValue(countedRead(emptyCollection()));
    fixture.getPlansWithIncludedInDateRange.mockImplementation(
      (serviceTypeId) =>
        countedRead(
          {
            data: [],
            included: plansOf(serviceTypeId).map(({ rehearsal }) => rehearsal),
            complete: true,
          },
          3
        )
    );
    fixture.getPlanPlanTimes.mockImplementation((planId) => {
      const rehearsal = rehearsalsByPlanId.get(planId);
      return countedRead(rehearsal === undefined ? [] : [rehearsal]);
    });
    // Each call is its own invocation, as the browser follows the continuation.
    const readCall = async (
      continuation?: PlanTimesProgress
    ): Promise<{ requests: number; detail: PeopleDashboardPersonDetail }[]> => {
      const accounting = new PlanningCenterRequestAccounting();
      const detail: PeopleDashboardPersonDetail = await Effect.runPromise(
        getPeopleDashboardPerson({
          personId: "person-1",
          month: "2026-09",
          continuation,
          dependencies: fixture.dependencies,
        }).pipe(Effect.provideService(PlanningCenterAccounting, accounting))
      );
      const call = { requests: accounting.requestCount, detail };
      return detail.continuation === null
        ? [call]
        : [call, ...(await readCall(detail.continuation))];
    };
    const calls = await readCall();

    // A partial detail is never left in the cache: a later visit reads again.
    const personReads = fixture.getPerson.mock.calls.length;
    await Effect.runPromise(
      getPeopleDashboardPerson({
        personId: "person-1",
        month: "2026-09",
        dependencies: fixture.dependencies,
      })
    );

    const [first] = calls;
    const last = calls.at(-1);
    expect({
      everyCallWithinBudget: calls.every(
        ({ requests }) => requests <= PROGRESSIVE_REQUEST_BUDGET
      ),
      firstReported: first?.detail.requestBudget.planningCenterRequests,
      firstContinues: first?.detail.continuation !== null,
      calls: calls.length,
      unresolved: last?.detail.requestBudget.unresolvedRehearsalTimes,
      rehearsalDays: last?.detail.person.monthDays.filter(
        ({ kind }) => kind === "rehearsal"
      ).length,
      revisitReadAgain: fixture.getPerson.mock.calls.length > personReads,
    }).toStrictEqual({
      everyCallWithinBudget: true,
      firstReported: first?.requests,
      firstContinues: true,
      calls: 2,
      unresolved: 0,
      rehearsalDays: 3,
      revisitReadAgain: true,
    });
  });
});

type FailingRead =
  | "getPersonPlanPeople"
  | "getServiceTypesCached"
  | "getPlansWithIncludedInDateRange"
  | "getPlanPlanTimes";

/** Reaches every read: a pending request, and a rehearsal time no plan range holds. */
const everyReadFixture = () =>
  dependenciesFor({
    schedules: {
      data: [
        schedule({
          id: "schedule-sep",
          planId: "plan-1",
          sortDate: "2026-09-13T17:00:00Z",
          timeIds: ["time-sep-rehearsal", "time-sep-service"],
        }),
      ],
      included: [
        planTime("time-sep-service", "2026-09-13T17:00:00Z", "service"),
      ],
    },
    planPeople: {
      data: [
        planPerson({
          id: "plan-person-pending",
          planId: "plan-2",
          status: "U",
          timeIds: [],
        }),
      ],
      included: [],
    },
  });

const failRead = (
  fixture: ReturnType<typeof everyReadFixture>,
  read: FailingRead,
  error: PlanningCenterError
) => {
  if (read === "getPersonPlanPeople") {
    fixture.getPersonPlanPeople.mockReturnValue(Effect.fail(error));
  } else if (read === "getServiceTypesCached") {
    fixture.getServiceTypesCached.mockReturnValue(Effect.fail(error));
  } else if (read === "getPlansWithIncludedInDateRange") {
    fixture.getPlansWithIncludedInDateRange.mockReturnValue(Effect.fail(error));
  } else {
    fixture.getPlanPlanTimes.mockReturnValue(Effect.fail(error));
  }
};

const readDetailExit = async (
  dependencies: PeopleDashboardPersonDependencies
) =>
  await Effect.runPromiseExit(
    getPeopleDashboardPerson({
      personId: "person-1",
      month: "2026-09",
      dependencies,
    })
  );

const failingReads: readonly FailingRead[] = [
  "getPersonPlanPeople",
  "getServiceTypesCached",
  "getPlansWithIncludedInDateRange",
  "getPlanPlanTimes",
];

describe("getPeopleDashboardPerson Planning Center failures", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(
    failingReads.flatMap((read) =>
      planningCenterBudgetFailures().map((error) => ({ read, error }))
    )
  )("fails when $read fails with $error._tag", async ({ read, error }) => {
    vi.useFakeTimers({ now: NOW });
    const fixture = everyReadFixture();
    failRead(fixture, read, error);

    await expect(readDetailExit(fixture.dependencies)).resolves.toStrictEqual(
      Exit.fail(error)
    );
  });

  it.each(failingReads)(
    "fails when %s fails with a provider error",
    async (read) => {
      vi.useFakeTimers({ now: NOW });
      const fixture = everyReadFixture();
      const error = new PlanningCenterApiError({
        message: "Server error",
        status: 500,
      });
      failRead(fixture, read, error);

      await expect(readDetailExit(fixture.dependencies)).resolves.toStrictEqual(
        Exit.fail(error)
      );
    }
  );

  it("keeps a schedule's plan date when its service type is not found", async () => {
    vi.useFakeTimers({ now: NOW });
    const fixture = everyReadFixture();
    failRead(
      fixture,
      "getPlansWithIncludedInDateRange",
      planningCenterNotFound()
    );

    const detail = await readDetail(fixture.dependencies);

    expect(fixture.getPlanPlanTimes).toHaveBeenCalledExactlyOnceWith("plan-1");
    expect(detail.person.monthDays).toContainEqual(
      expect.objectContaining({ day: 13, kind: "service" })
    );
    expect(
      detail.person.monthDays.some(({ kind }) => kind === "rehearsal")
    ).toBeFalsy();
  });
});
