/**
 * Paged Planning Center collections read through the real core client and people service, over
 * an injected HTTP fake that pages like Planning Center (`per_page`, `offset`, `links.next`).
 * Each follow-up call runs as its own invocation: fresh accounting, and fresh services and
 * caches unless a test shares them on purpose. Results continued call by call must equal one
 * exhaustive read that no request budget limits.
 */
import { getCandidateDetails } from "@pcobooster/api/modules/planning-center/get-candidate-details";
import type {
  CandidateDetail,
  CandidateDetailsBatch,
  CandidateDetailsDependencies,
  CandidateDetailsInput,
} from "@pcobooster/api/modules/planning-center/get-candidate-details";
import { getPeopleDashboardPerson } from "@pcobooster/api/modules/planning-center/get-people-dashboard-person";
import { getPlanWindowHistory } from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import type {
  PlanWindowHistoryBatch,
  PlanWindowHistoryDependencies,
  PlanWindowHistoryInput,
} from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import type { PeopleDashboardPersonDetail } from "@pcobooster/api/modules/planning-center/people-dashboard-types";
import type { PlanTimesProgress } from "@pcobooster/api/modules/planning-center/people/plan-time-pages";
import { PlanningCenterAccounting } from "@pcobooster/api/planning-center/accounting";
import {
  createBasicPlanningCenterClient,
  PLANNING_CENTER_PAGE_SIZE,
} from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterPage } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPaginationError } from "@pcobooster/api/planning-center/pagination-error";
import { PlanningCenterRequestAccounting } from "@pcobooster/api/planning-center/request-accounting";
import {
  PLANNING_CENTER_REQUEST_CAP,
  PROGRESSIVE_REQUEST_BUDGET,
} from "@pcobooster/api/planning-center/request-budget";
import { PlanningCenterCatalogService } from "@pcobooster/api/planning-center/services/catalog-service";
import {
  createPlanningCenterPeopleServiceCaches,
  PlanningCenterPeopleService,
} from "@pcobooster/api/planning-center/services/people-service";
import type { PlanningCenterPeopleServiceCaches } from "@pcobooster/api/planning-center/services/people-service";
import {
  createPlanningCenterPlansServiceCaches,
  PlanningCenterPlansService,
} from "@pcobooster/api/planning-center/services/plans-service";
import type { PlanningCenterPlansServiceCaches } from "@pcobooster/api/planning-center/services/plans-service";
import { PlanningCenterReadCache } from "@pcobooster/api/planning-center/services/read-cache";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { countedRead } from "@pcobooster/api/testing/planning-center-requests";
import {
  peopleCandidateDetailsInputSchema,
  peoplePlanWindowHistoryInputSchema,
} from "@pcobooster/contracts/http/people";
import {
  candidateDetailsBatchSchema,
  MAX_PENDING_BLOCKOUTS,
  MAX_PROGRESS_TIMES,
  MAX_SERVICE_TYPES,
  planTimesProgressSchema,
} from "@pcobooster/contracts/http/people-schemas";
import { buildFrequencyFromServiceHistory } from "@pcobooster/planning-center-models/candidate-frequency";
import {
  candidateDetailsAdvanced,
  nextWindowContinuation,
  windowHistoryAdvanced,
} from "@pcobooster/planning-center-models/candidate-list";
import { expandPlanWindowHistory } from "@pcobooster/planning-center-models/plan-window-history";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect, Exit, Option, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each test here compares whole paged reads, fresh and warm, with an exhaustive read: hundreds of
// pages decoded through the real client. That takes well under a second locally but several
// seconds on a busy CI runner, past Vitest's 5 s default.
vi.setConfig({ testTimeout: 20_000 });

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sunday May 3, 2026, 10:00 UTC: the selected plan's full instant. */
const PLAN_DATE = "2026-05-03T10:00:00.000Z";
const PLAN_DAY = "2026-05-03";
const ORG_TIME_ZONE = "America/Los_Angeles";

interface Collection {
  readonly data: readonly PCResource[];
  readonly included?: readonly PCResource[];
}

/** Planning Center as paged collections and single resources, keyed by path. */
interface FakeOrg {
  readonly collections: Map<string, Collection>;
  readonly resources: Map<string, PCResource>;
}

interface SentRequest {
  readonly path: string;
  readonly offset: number;
  readonly credential: string;
}

/** Serves `org` the way Planning Center pages: `per_page` records from `offset`, then `next`. */
const fakePlanningCenter = (org: FakeOrg) => {
  const sent: SentRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    await Promise.resolve();
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    sent.push({
      path: url.pathname,
      offset,
      credential: request.headers.get("authorization") ?? "",
    });
    const resource = org.resources.get(url.pathname);
    if (resource !== undefined) {
      return Response.json({ data: resource });
    }
    const { data = [], included = [] } =
      org.collections.get(url.pathname) ?? {};
    const perPage = Number(url.searchParams.get("per_page") ?? 25);
    const next = new URL(url);
    next.searchParams.set("offset", String(offset + perPage));
    return Response.json({
      data: data.slice(offset, offset + perPage),
      included,
      links: offset + perPage < data.length ? { next: next.toString() } : {},
    });
  };
  return { fetch, sent };
};

const peopleService = (
  fetch: typeof globalThis.fetch,
  caches: PlanningCenterPeopleServiceCaches = createPlanningCenterPeopleServiceCaches(),
  secret = "test-token"
) =>
  new PlanningCenterPeopleService(
    createBasicPlanningCenterClient(
      { applicationId: "test-client", secret },
      httpClientFor(fetch)
    ),
    caches
  );

const onlyPage = (collection: Collection | undefined): PlanningCenterPage => ({
  data: structuredClone([...(collection?.data ?? [])]),
  included: structuredClone([...(collection?.included ?? [])]),
  nextOffset: null,
});

/** Every collection whole, as one page, costing nothing: a read no budget limits. */
const exhaustivePeople = (org: FakeOrg) => {
  const collection = (path: string) => org.collections.get(path);
  return {
    getPersonBlockoutsPage: (personId: string) =>
      Effect.succeed(
        onlyPage(collection(`/services/v2/people/${personId}/blockouts`))
      ),
    getPersonBlockoutDatesPage: (personId: string, blockoutId: string) =>
      Effect.succeed(
        onlyPage(
          collection(
            `/services/v2/people/${personId}/blockouts/${blockoutId}/blockout_dates`
          )
        )
      ),
    getPersonSchedulesAfter: (personId: string) => {
      const { data, included } = onlyPage(
        collection(`/services/v2/people/${personId}/schedules`)
      );
      return Effect.succeed({ data, included });
    },
    getPersonSchedulesPage: (personId: string) =>
      Effect.succeed(
        onlyPage(collection(`/services/v2/people/${personId}/schedules`))
      ),
    getPlanPlanTimesPage: (planId: string) =>
      Effect.succeed(
        onlyPage(collection(`/services/v2/plans/${planId}/plan_times`))
      ),
    getPersonPlanPeople: (personId: string) => {
      const { data, included } = onlyPage(
        collection(`/services/v2/people/${personId}/plan_people`)
      );
      return Effect.succeed({ data, included });
    },
    getPerson: (personId: string) => {
      const person = org.resources.get(`/services/v2/people/${personId}`);
      return person === undefined
        ? Effect.die(new Error(`No person ${personId} in the fixture`))
        : Effect.succeed(structuredClone(person));
    },
    getCacheScope: () => "exhaustive",
  };
};

const blockout = (
  id: string,
  attributes: Record<string, string | null>
): PCResource => ({
  type: "Blockout",
  id,
  attributes: { time_zone: "UTC", share: false, ...attributes },
});

/** A blockout lasting one UTC day; repeating ones generate these as dates. */
const dayBlockout = (type: string, id: string, day: Date): PCResource => ({
  type,
  id,
  attributes: {
    starts_at: day.toISOString(),
    ends_at: new Date(day.getTime() + DAY_MS - 1000).toISOString(),
    time_zone: "UTC",
    repeat_frequency: "no_repeat",
  },
});

const dailyRepeating = (id: string) =>
  blockout(id, {
    starts_at: "2026-01-01T00:00:00Z",
    ends_at: "2026-01-01T23:59:59Z",
    repeat_frequency: "every_1_day",
    repeat_until: null,
  });

const daysFrom = (start: string, count: number, skipDay?: string): Date[] =>
  Array.from(
    { length: count },
    (_, index) => new Date(Date.parse(`${start}T00:00:00Z`) + index * DAY_MS)
  ).filter((day) => day.toISOString().slice(0, 10) !== skipDay);

const datesOf = (blockoutId: string, days: readonly Date[]): PCResource[] =>
  days.map((day, index) =>
    dayBlockout("BlockoutDate", `${blockoutId}-date-${index}`, day)
  );

/**
 * Sixteen candidates whose blockouts need every kind of paging:
 *
 * - p0 to p9: a daily blockout whose 365 dates span four pages; the plan day is on the second.
 * - p10: the same, skipping the plan day: every page must be read.
 * - p11: 1,201 dates (thirteen pages), the only covering one last.
 * - p12: 250 one-time blockouts over three pages, the covering one last.
 * - p13: a blockout list of three pages whose covering repeating blockout is on the third.
 * - p14: no blockouts. p15: a daily blockout whose one page misses the plan day.
 */
const blockoutOrg = (): FakeOrg => {
  const collections = new Map<string, Collection>();
  const list = (personId: string, parents: PCResource[]) =>
    collections.set(`/services/v2/people/${personId}/blockouts`, {
      data: parents,
    });
  const dates = (personId: string, blockoutId: string, data: PCResource[]) =>
    collections.set(
      `/services/v2/people/${personId}/blockouts/${blockoutId}/blockout_dates`,
      { data }
    );
  for (let index = 0; index <= 10; index += 1) {
    const personId = `p${index}`;
    const id = `${personId}-daily`;
    list(personId, [dailyRepeating(id)]);
    dates(
      personId,
      id,
      datesOf(id, daysFrom("2026-01-01", 365, index === 10 ? PLAN_DAY : ""))
    );
  }
  list("p11", [dailyRepeating("p11-daily")]);
  dates("p11", "p11-daily", [
    ...datesOf("p11-daily", daysFrom("2022-01-01", 1200)),
    dayBlockout("BlockoutDate", "p11-daily-covering", new Date(PLAN_DAY)),
  ]);
  list("p12", [
    ...daysFrom("2024-01-01", 249).map((day, index) =>
      dayBlockout("Blockout", `p12-old-${index}`, day)
    ),
    dayBlockout("Blockout", "p12-covering", new Date(PLAN_DAY)),
  ]);
  list("p13", [
    ...daysFrom("2024-01-01", 230).map((day, index) =>
      dayBlockout("Blockout", `p13-old-${index}`, day)
    ),
    dailyRepeating("p13-daily"),
  ]);
  dates("p13", "p13-daily", datesOf("p13-daily", daysFrom("2026-04-01", 60)));
  list("p15", [dailyRepeating("p15-daily")]);
  dates(
    "p15",
    "p15-daily",
    datesOf("p15-daily", daysFrom("2026-04-01", 60, PLAN_DAY))
  );
  return { collections, resources: new Map() };
};

const personIds = Array.from({ length: 16 }, (_, index) => `p${index}`);

interface ContinuedRead {
  readonly details: CandidateDetail[];
  readonly batches: CandidateDetailsBatch[];
  readonly requests: number[];
}

const MAX_CALLS = 20;

const decodeCandidateDetailsInput = Schema.decodeUnknownOption(
  peopleCandidateDetailsInputSchema
);
const decodeWindowHistoryInput = Schema.decodeUnknownOption(
  peoplePlanWindowHistoryInputSchema
);
const decodePlanTimesProgress = Schema.decodeUnknownOption(
  planTimesProgressSchema
);

/** Follows the continuation the way the browser does, each call its own invocation. */
const continueCandidateDetails = async (
  input: CandidateDetailsInput,
  servicesForCall: () => CandidateDetailsDependencies["people"],
  calls = 0,
  maxCalls = MAX_CALLS
): Promise<ContinuedRead> => {
  if (calls === maxCalls) {
    throw new Error("Candidate details did not finish");
  }
  const accounting = new PlanningCenterRequestAccounting({
    requestBudget: PLANNING_CENTER_REQUEST_CAP,
  });
  const batch: CandidateDetailsBatch = await Effect.runPromise(
    getCandidateDetails(input, {
      people: servicesForCall(),
      resolveTimeZone: countedRead(ORG_TIME_ZONE),
    }).pipe(Effect.provideService(PlanningCenterAccounting, accounting))
  );
  const call = {
    details: batch.people,
    batches: [batch],
    requests: [accounting.requestCount],
  };
  if (batch.deferredPersonIds.length === 0) {
    return call;
  }
  if (!candidateDetailsAdvanced(input.continuation, batch)) {
    throw new Error("Candidate details made no progress");
  }
  const next = {
    ...input,
    personIds: batch.deferredPersonIds,
    continuation: batch.continuation,
  };
  // The browser sends the cursor back as is; the API must accept it.
  if (Option.isNone(decodeCandidateDetailsInput(next))) {
    throw new Error(`Call ${calls + 1} returned a cursor the API rejects`);
  }
  const rest = await continueCandidateDetails(
    next,
    servicesForCall,
    calls + 1,
    maxCalls
  );
  return {
    details: [...call.details, ...rest.details],
    batches: [...call.batches, ...rest.batches],
    requests: [...call.requests, ...rest.requests],
  };
};

const exhaustiveCandidateDetails = async (
  input: CandidateDetailsInput,
  org: FakeOrg
): Promise<CandidateDetail[]> => {
  const batch = await Effect.runPromise(
    getCandidateDetails(input, {
      people: exhaustivePeople(org),
      resolveTimeZone: Effect.succeed(ORG_TIME_ZONE),
    })
  );
  expect(batch.deferredPersonIds).toStrictEqual([]);
  return batch.people;
};

const byPerson = (details: readonly CandidateDetail[]) =>
  Object.fromEntries(details.map((detail) => [detail.personId, detail]));

const datesPath = (personId: string, blockoutId: string) =>
  `/services/v2/people/${personId}/blockouts/${blockoutId}/blockout_dates`;

const pagesRead = (sent: readonly SentRequest[], path: string) =>
  sent.filter((request) => request.path === path).map(({ offset }) => offset);

describe("candidate details over paged collections", () => {
  const input: CandidateDetailsInput = {
    personIds,
    planId: "plan-selected",
    date: PLAN_DATE,
    scheduleHistory: false,
  };

  it("continues every blockout page within the budget and equals an exhaustive read", async () => {
    const org = blockoutOrg();
    const server = fakePlanningCenter(org);

    const continued = await continueCandidateDetails(input, () =>
      peopleService(server.fetch)
    );
    const exhaustive = await exhaustiveCandidateDetails(input, org);

    expect({
      details: byPerson(continued.details),
      blocked: continued.details
        .filter(({ isBlockedForDate }) => isBlockedForDate)
        .map(({ personId }) => personId)
        .toSorted(),
      everyCallWithinBudget: continued.requests.every(
        (requests) => requests <= PROGRESSIVE_REQUEST_BUDGET
      ),
      severalCalls: continued.batches.length > 1,
    }).toStrictEqual({
      details: byPerson(exhaustive),
      blocked: [
        "p0",
        "p1",
        "p11",
        "p12",
        "p13",
        "p2",
        "p3",
        "p4",
        "p5",
        "p6",
        "p7",
        "p8",
        "p9",
      ],
      everyCallWithinBudget: true,
      severalCalls: true,
    });
  });

  it("reads each page once, stops a repeating blockout at its covering page, and reads past ten pages", async () => {
    const server = fakePlanningCenter(blockoutOrg());

    await continueCandidateDetails(input, () => peopleService(server.fetch));

    const sentKeys = server.sent.map(
      ({ path, offset }) => `${path}?offset=${offset}`
    );
    expect({
      readOnce: new Set(sentKeys).size === sentKeys.length,
      // The plan day is on the second page; later pages cannot change the answer.
      coveredEarly: pagesRead(server.sent, datesPath("p0", "p0-daily")),
      // Without a covering date every page is read before the person counts as available.
      everyPage: pagesRead(server.sent, datesPath("p10", "p10-daily")),
      longCollection: pagesRead(server.sent, datesPath("p11", "p11-daily")),
      listPages: pagesRead(server.sent, "/services/v2/people/p13/blockouts"),
    }).toStrictEqual({
      readOnce: true,
      coveredEarly: [0, 100],
      everyPage: [0, 100, 200, 300],
      longCollection: Array.from({ length: 13 }, (_, page) => page * 100),
      listPages: [0, 100, 200],
    });
  });

  it("never reports someone available while their blockout pages remain", async () => {
    const org = blockoutOrg();
    const server = fakePlanningCenter(org);
    const exhaustive = byPerson(await exhaustiveCandidateDetails(input, org));

    const { batches } = await continueCandidateDetails(input, () =>
      peopleService(server.fetch)
    );

    // Every batch reports only finished people, each exactly as the exhaustive read does.
    expect(
      batches.flatMap(({ people }) =>
        people.filter(
          (detail) =>
            JSON.stringify(detail) !==
            JSON.stringify(exhaustive[detail.personId])
        )
      )
    ).toStrictEqual([]);
  });

  it("gives the same answers from warm caches and keeps accounts' cached pages apart", async () => {
    const org = blockoutOrg();
    const server = fakePlanningCenter(org);
    const caches = createPlanningCenterPeopleServiceCaches();
    const warmService = peopleService(server.fetch, caches);

    const cold = await continueCandidateDetails(input, () =>
      peopleService(server.fetch)
    );
    const warmFirst = await continueCandidateDetails(input, () => warmService);
    const sentBeforeWarm = server.sent.length;
    const warm = await continueCandidateDetails(input, () => warmService);
    const sentByWarm = server.sent.length - sentBeforeWarm;
    const otherAccount = await continueCandidateDetails(input, () =>
      peopleService(server.fetch, caches, "other-token")
    );
    const credentials = new Set(
      server.sent.slice(sentBeforeWarm).map(({ credential }) => credential)
    );

    expect({
      warmFirst: byPerson(warmFirst.details),
      warm: byPerson(warm.details),
      warmCalls: warm.batches.length,
      sentByWarm,
      otherAccount: byPerson(otherAccount.details),
      otherAccountSent: credentials.size,
    }).toStrictEqual({
      warmFirst: byPerson(cold.details),
      warm: byPerson(cold.details),
      warmCalls: 1,
      sentByWarm: 0,
      otherAccount: byPerson(cold.details),
      otherAccountSent: 1,
    });
  });
});

/**
 * A plan's times over pages: its service time first, and rehearsals from `rehearsalIndex` on,
 * the second a day after the first, for people who rehearse separately.
 */
const planTimes = (
  planId: string,
  serviceAt: Date,
  count: number,
  rehearsalIndex: number
): PCResource[] =>
  Array.from({ length: count }, (_, index) => {
    const rehearsal = index - rehearsalIndex;
    const isRehearsal = rehearsal === 0 || rehearsal === 1;
    return {
      type: "PlanTime",
      id: `${planId}-time-${index}`,
      attributes: {
        starts_at: isRehearsal
          ? new Date(
              serviceAt.getTime() - (3 - rehearsal) * DAY_MS
            ).toISOString()
          : serviceAt.toISOString(),
        ends_at: serviceAt.toISOString(),
        time_type: isRehearsal ? "rehearsal" : "other",
      },
    };
  });

const scheduleOn = (
  personId: string,
  planId: string,
  serviceAt: Date,
  rehearsalIndex: number
): PCResource => ({
  type: "Schedule",
  id: `${personId}-${planId}`,
  attributes: {
    sort_date: serviceAt.toISOString(),
    status: "C",
    team_position_name: "Vocals",
    team_name: "Band",
    service_type_name: "Sunday",
  },
  relationships: {
    plan: { data: { type: "Plan", id: planId } },
    times: {
      data: [
        { type: "PlanTime", id: `${planId}-time-0` },
        { type: "PlanTime", id: `${planId}-time-${rehearsalIndex}` },
      ],
    },
  },
});

/**
 * Sixteen candidates with schedule history from their own schedules. Each serves three of six
 * shared plans; each plan lists 102 times, its two rehearsals on the second page, and one lists
 * 250 with them on the third. Every other person attends the plan's second rehearsal, so people
 * on the same plan look for different times, and some start only after others finished it.
 */
const historyOrg = (): FakeOrg => {
  const collections = new Map<string, Collection>();
  const plans = [-21, -14, -7, 7, 14, 21].map((days, index) => {
    const planId = `shared-plan-${index}`;
    const serviceAt = new Date(Date.parse(PLAN_DATE) + days * DAY_MS);
    const count = index === 5 ? 250 : 102;
    const rehearsalIndex = index === 5 ? 230 : 100;
    const times = planTimes(planId, serviceAt, count, rehearsalIndex);
    collections.set(`/services/v2/plans/${planId}/plan_times`, { data: times });
    return { planId, serviceAt, rehearsalIndex, service: times[0] };
  });
  for (const [index, personId] of personIds.entries()) {
    const served = [0, 1, 2].map(
      (offset) => plans[(index + offset) % plans.length]
    );
    collections.set(`/services/v2/people/${personId}/schedules`, {
      data: served.flatMap((plan) =>
        plan === undefined
          ? []
          : [
              scheduleOn(
                personId,
                plan.planId,
                plan.serviceAt,
                plan.rehearsalIndex + (index % 2)
              ),
            ]
      ),
      // `include=plan_times` sideloads the service time only.
      included: served.flatMap((plan) =>
        plan?.service === undefined ? [] : [plan.service]
      ),
    });
  }
  return { collections, resources: new Map() };
};

const rehearsals = (detail: CandidateDetail | undefined) =>
  detail?.history?.serviceHistory.filter(
    ({ timeType }) => timeType === "rehearsal"
  ).length;

describe("candidate schedule history over paged plan times", () => {
  const input: CandidateDetailsInput = {
    personIds,
    planId: "plan-selected",
    date: PLAN_DATE,
    scheduleHistory: true,
  };

  it("continues rehearsal plan pages within the budget and equals an exhaustive read", async () => {
    const org = historyOrg();
    const server = fakePlanningCenter(org);

    const continued = await continueCandidateDetails(input, () =>
      peopleService(server.fetch)
    );
    const exhaustive = await exhaustiveCandidateDetails(input, org);

    expect({
      details: byPerson(continued.details),
      rehearsalsPerPerson: new Set(continued.details.map(rehearsals)),
      everyCallWithinBudget: continued.requests.every(
        (requests) => requests <= PROGRESSIVE_REQUEST_BUDGET
      ),
      // A plan's pages are read until its rehearsals turn up, and no further.
      latePlanPages: new Set(
        pagesRead(server.sent, "/services/v2/plans/shared-plan-5/plan_times")
      ),
    }).toStrictEqual({
      details: byPerson(exhaustive),
      rehearsalsPerPerson: new Set([3]),
      everyCallWithinBudget: true,
      latePlanPages: new Set([0, 100, 200]),
    });
  });
});

const SELECTED_PLAN = "plan-selected";

/** One Sunday-band schedule on `planId`, listing the times `timeIds`. */
const datedSchedule = (
  personId: string,
  index: number,
  planId: string,
  sortDate: string,
  timeIds: readonly string[] = []
): PCResource => ({
  type: "Schedule",
  id: `${personId}-schedule-${index}`,
  attributes: {
    sort_date: sortDate,
    status: "C",
    team_position_name: "Vocals",
    team_name: "Band",
    service_type_name: "Sunday",
  },
  relationships: {
    plan: { data: { type: "Plan", id: planId } },
    times: { data: timeIds.map((id) => ({ type: "PlanTime", id })) },
  },
});

const schedulesPath = (personId: string) =>
  `/services/v2/people/${personId}/schedules`;

const atDay = (start: string, days: number) =>
  new Date(Date.parse(start) + days * DAY_MS).toISOString();

/**
 * Sixteen people, each with 201 schedules in the plan window (three pages, the selected plan's
 * on the third) and 150 after it, in date order: four pages in all. No one has blockouts.
 */
const longScheduleOrg = (): FakeOrg => {
  const collections = new Map<string, Collection>();
  for (const personId of personIds) {
    const inWindow = Array.from({ length: 200 }, (_, index) =>
      datedSchedule(
        personId,
        index,
        `${personId}-plan-${index}`,
        atDay("2026-04-06T17:00:00Z", Math.floor(index / 8))
      )
    );
    const selected = datedSchedule(personId, 200, SELECTED_PLAN, PLAN_DATE);
    const later = Array.from({ length: 150 }, (_, index) =>
      datedSchedule(
        personId,
        201 + index,
        `${personId}-later-${index}`,
        atDay("2026-06-20T17:00:00Z", index)
      )
    );
    collections.set(`/services/v2/people/${personId}/schedules`, {
      data: [...inWindow, selected, ...later],
    });
  }
  return { collections, resources: new Map() };
};

describe("candidate schedule history past one page of schedules", () => {
  const input: CandidateDetailsInput = {
    personIds,
    planId: SELECTED_PLAN,
    date: PLAN_DATE,
    scheduleHistory: true,
  };

  it("reads every schedule page from the window's start, from fresh and warm caches, and equals an exhaustive read", async () => {
    const org = longScheduleOrg();
    const server = fakePlanningCenter(org);
    const caches = createPlanningCenterPeopleServiceCaches();
    const warmService = peopleService(server.fetch, caches);

    const fresh = await continueCandidateDetails(input, () =>
      peopleService(server.fetch)
    );
    const exhaustive = await exhaustiveCandidateDetails(input, org);
    await continueCandidateDetails(input, () => warmService);
    const sentBeforeWarm = server.sent.length;
    const warm = await continueCandidateDetails(input, () => warmService);

    expect({
      fresh: byPerson(fresh.details),
      warm: byPerson(warm.details),
      sentByWarm: server.sent.length - sentBeforeWarm,
      historyLengths: new Set(
        fresh.details.map(({ history }) => history?.serviceHistory.length)
      ),
      selected: new Set(
        fresh.details.map(
          ({ history }) => history?.selectedPlanAssignments[0]?.planId
        )
      ),
      everyCallWithinBudget: fresh.requests.every(
        (requests) => requests <= PROGRESSIVE_REQUEST_BUDGET
      ),
      severalCalls: fresh.batches.length > 1,
      // No page's dates prove the later pages hold nothing, so every one is read.
      pages: new Set(pagesRead(server.sent, schedulesPath("p0"))),
    }).toStrictEqual({
      fresh: byPerson(exhaustive),
      warm: byPerson(exhaustive),
      sentByWarm: 0,
      historyLengths: new Set([351]),
      selected: new Set([SELECTED_PLAN]),
      everyCallWithinBudget: true,
      severalCalls: true,
      pages: new Set([0, 100, 200, 300]),
    });
  });

  it("finishes someone every call when everyone still needs only several schedule pages", async () => {
    // Availability came in earlier calls; schedule pages are never part of the cursor.
    const collections = new Map<string, Collection>(
      personIds.map((personId) => [
        schedulesPath(personId),
        {
          data: Array.from({ length: 450 }, (_, index) =>
            datedSchedule(
              personId,
              index,
              `${personId}-plan-${index}`,
              atDay("2026-04-06T17:00:00Z", Math.floor(index / 8))
            )
          ),
        },
      ])
    );
    const org = { collections, resources: new Map() };
    const server = fakePlanningCenter(org);
    const resumed: CandidateDetailsInput = {
      ...input,
      continuation: {
        people: personIds.map((personId) => ({
          personId,
          blocked: false,
          blockoutsOffset: null,
          pendingBlockouts: [],
          rehearsalTimes: { plans: [], times: [] },
        })),
      },
    };

    const continued = await continueCandidateDetails(resumed, () =>
      peopleService(server.fetch)
    );
    const exhaustive = await exhaustiveCandidateDetails(resumed, org);

    expect({
      details: byPerson(continued.details),
      everyCallFinishesSomeone: continued.batches.every(
        ({ people }) => people.length > 0
      ),
    }).toStrictEqual({
      details: byPerson(exhaustive),
      everyCallFinishesSomeone: true,
    });
  });

  it("fails typed, never short, when a window holds more schedule pages than allowed", async () => {
    const collections = new Map<string, Collection>([
      [
        schedulesPath("p0"),
        {
          data: Array.from({ length: 1001 }, (_, index) =>
            datedSchedule("p0", index, `plan-${index}`, PLAN_DATE)
          ),
        },
      ],
    ]);
    const server = fakePlanningCenter({ collections, resources: new Map() });

    const exit = await Effect.runPromiseExit(
      getCandidateDetails(
        { ...input, personIds: ["p0"] },
        {
          people: peopleService(server.fetch),
          resolveTimeZone: Effect.succeed(ORG_TIME_ZONE),
        }
      )
    );

    expect(exit).toStrictEqual(
      Exit.fail(
        new PlanningCenterPaginationError({
          reason: "page-limit",
          path: schedulesPath("p0"),
          pages: 10,
        })
      )
    );
  });
});

/** A PlanTime as `include=plan_times` sideloads it. */
const sideloadedTime = (
  id: string,
  startsAt: string,
  timeType: "service" | "rehearsal"
): PCResource => ({
  type: "PlanTime",
  id,
  attributes: { time_type: timeType, starts_at: startsAt },
});

describe("candidate schedule history whose dates disagree with the read order", () => {
  const input: CandidateDetailsInput = {
    personIds: ["p0"],
    planId: SELECTED_PLAN,
    date: PLAN_DATE,
    scheduleHistory: true,
  };
  const readOne = async (org: FakeOrg) => {
    const server = fakePlanningCenter(org);
    const continued = await continueCandidateDetails(input, () =>
      peopleService(server.fetch)
    );
    return { server, continued };
  };

  it("finds the selected plan on a page after schedules dated past the window", async () => {
    // Planning Center orders schedules by their times' `starts_at`, not by `sort_date`.
    const late = Array.from({ length: 100 }, (_, index) =>
      datedSchedule("p0", index, `late-${index}`, "2026-06-15T17:00:00Z", [
        `late-${index}-time`,
      ])
    );
    const selected = datedSchedule("p0", 100, SELECTED_PLAN, PLAN_DATE, [
      "selected-time",
    ]);
    const org: FakeOrg = {
      collections: new Map([
        [
          schedulesPath("p0"),
          {
            data: [...late, selected],
            included: [
              ...late.map((_, index) =>
                sideloadedTime(
                  `late-${index}-time`,
                  "2026-06-15T17:00:00Z",
                  "service"
                )
              ),
              sideloadedTime(
                "selected-time",
                "2026-07-15T17:00:00Z",
                "service"
              ),
            ],
          },
        ],
      ]),
      resources: new Map(),
    };

    const { server, continued } = await readOne(org);
    const exhaustive = await exhaustiveCandidateDetails(input, org);

    expect({
      details: continued.details,
      selected: continued.details[0]?.history?.selectedPlanAssignments.map(
        ({ planId }) => planId
      ),
      pages: pagesRead(server.sent, schedulesPath("p0")),
    }).toStrictEqual({
      details: exhaustive,
      selected: [SELECTED_PLAN],
      pages: [0, 100],
    });
  });

  it("keeps a rehearsal inside the window whose plan is dated after it", async () => {
    const org: FakeOrg = {
      collections: new Map([
        [
          schedulesPath("p0"),
          {
            data: [
              datedSchedule("p0", 0, "later-plan", "2026-06-15T17:00:00Z", [
                "inside",
              ]),
            ],
            included: [
              sideloadedTime("inside", "2026-05-20T17:00:00Z", "rehearsal"),
            ],
          },
        ],
      ]),
      resources: new Map(),
    };

    const { continued } = await readOne(org);
    const history = continued.details[0]?.history?.serviceHistory ?? [];

    expect({
      rehearsals: history.flatMap(({ date, timeType }) =>
        timeType === "rehearsal" ? [date.toISOString()] : []
      ),
      upcomingRehearsals: buildFrequencyFromServiceHistory(
        history,
        new Date(PLAN_DATE),
        ORG_TIME_ZONE
      ).upcomingRehearsals,
    }).toStrictEqual({
      rehearsals: ["2026-05-20T17:00:00.000Z"],
      upcomingRehearsals: 1,
    });
  });
});

/** Two people, each serving 40 plans in the window whose rehearsal times come only from the plan. */
const manyRehearsalPlansOrg = (): FakeOrg => {
  const collections = new Map<string, Collection>();
  for (const personId of ["p0", "p1"]) {
    const schedules: PCResource[] = [];
    for (let index = 0; index < 40; index += 1) {
      const planId = `${personId}-rehearsed-${index}`;
      const serviceAt = atDay("2026-04-06T17:00:00Z", index);
      collections.set(`/services/v2/plans/${planId}/plan_times`, {
        data: [
          {
            type: "PlanTime",
            id: `${planId}-rehearsal`,
            attributes: {
              time_type: "rehearsal",
              starts_at: atDay(serviceAt, -1),
            },
          },
        ],
      });
      schedules.push(
        datedSchedule(personId, index, planId, serviceAt, [
          `${planId}-rehearsal`,
        ])
      );
    }
    collections.set(`/services/v2/people/${personId}/schedules`, {
      data: schedules,
    });
  }
  return { collections, resources: new Map() };
};

describe("candidate schedule history over many rehearsal plans", () => {
  const input: CandidateDetailsInput = {
    personIds: ["p0", "p1"],
    planId: SELECTED_PLAN,
    date: PLAN_DATE,
    scheduleHistory: true,
  };

  it("reads every rehearsal plan in the window across calls and equals an exhaustive read", async () => {
    const org = manyRehearsalPlansOrg();
    const server = fakePlanningCenter(org);

    const continued = await continueCandidateDetails(input, () =>
      peopleService(server.fetch)
    );
    const exhaustive = await exhaustiveCandidateDetails(input, org);

    expect({
      details: byPerson(continued.details),
      rehearsals: continued.details.map(rehearsals),
      everyCallWithinBudget: continued.requests.every(
        (requests) => requests <= PROGRESSIVE_REQUEST_BUDGET
      ),
      severalCalls: continued.batches.length > 1,
      // No partial batch reports a person before their last plan is read.
      partialsHoldBack: continued.batches
        .slice(0, -1)
        .every(({ people }) =>
          people.every((detail) => rehearsals(detail) === 40)
        ),
    }).toStrictEqual({
      details: byPerson(exhaustive),
      rehearsals: [40, 40],
      everyCallWithinBudget: true,
      severalCalls: true,
      partialsHoldBack: true,
    });
  });
});

/**
 * One person serving `plans` plans in the window, each listing 100 rehearsal times that
 * `include=plan_times` leaves out, on one plan-time page per plan.
 */
const manyTimesOrg = (personId: string, plans: number): FakeOrg => {
  const collections = new Map<string, Collection>();
  const schedules = Array.from({ length: plans }, (_unused, index) => {
    const planId = `${personId}-times-${index}`;
    const times = Array.from(
      { length: PLANNING_CENTER_PAGE_SIZE },
      (_, time): PCResource => ({
        type: "PlanTime",
        id: `${planId}-${time}`,
        attributes: {
          time_type: "rehearsal",
          starts_at: atDay(PLAN_DATE, -1 - (time % 3)),
        },
      })
    );
    collections.set(`/services/v2/plans/${planId}/plan_times`, {
      data: times,
    });
    return datedSchedule(
      personId,
      index,
      planId,
      PLAN_DATE,
      times.map(({ id }) => id)
    );
  });
  collections.set(schedulesPath(personId), { data: schedules });
  return { collections, resources: new Map() };
};

const decodeCandidateDetailsBatch = Schema.decodeUnknownOption(
  candidateDetailsBatchSchema
);

describe("candidate schedule history with more rehearsal times than one call reads", () => {
  const input: CandidateDetailsInput = {
    personIds: ["p0"],
    planId: SELECTED_PLAN,
    date: PLAN_DATE,
    scheduleHistory: true,
  };
  const plansAtBound = MAX_PROGRESS_TIMES / PLANNING_CENTER_PAGE_SIZE;

  it("carries every time found, up to the cursor's bound, in answers and cursors the API accepts", async () => {
    const org = manyTimesOrg("p0", plansAtBound);
    const server = fakePlanningCenter(org);

    const continued = await continueCandidateDetails(input, () =>
      peopleService(server.fetch)
    );
    const exhaustive = await exhaustiveCandidateDetails(input, org);

    expect({
      details: continued.details,
      rehearsals: continued.details.map(rehearsals),
      severalCalls: continued.batches.length > 1,
      everyAnswerValid: continued.batches.every((batch) =>
        Option.isSome(decodeCandidateDetailsBatch(batch))
      ),
    }).toStrictEqual({
      details: exhaustive,
      rehearsals: [MAX_PROGRESS_TIMES],
      severalCalls: true,
      everyAnswerValid: true,
    });
  });

  it("fails typed, before reading their plans, when the times would outgrow the cursor", async () => {
    const server = fakePlanningCenter(manyTimesOrg("p0", plansAtBound + 1));

    const exit = await Effect.runPromiseExit(
      getCandidateDetails(input, {
        people: peopleService(server.fetch),
        resolveTimeZone: Effect.succeed(ORG_TIME_ZONE),
      })
    );

    expect({
      exit,
      planTimePages: server.sent.filter(({ path }) =>
        path.endsWith("/plan_times")
      ).length,
    }).toStrictEqual({
      exit: Exit.fail(
        new PlanningCenterPaginationError({
          reason: "cursor-limit",
          path: schedulesPath("p0"),
          pages: 1,
        })
      ),
      planTimePages: 0,
    });
  });
});

/** 2,000 repeating blockouts that may cover the plan day, none of whose dates do. */
const manyParentsOrg = (): FakeOrg => {
  const parents = Array.from({ length: 2000 }, (_, index) =>
    dailyRepeating(`parent-${index}`)
  );
  return {
    collections: new Map([
      ["/services/v2/people/p0/blockouts", { data: parents }],
    ]),
    resources: new Map(),
  };
};

describe("candidate availability over thousands of repeating blockouts", () => {
  const input: CandidateDetailsInput = {
    personIds: ["p0"],
    planId: SELECTED_PLAN,
    date: PLAN_DATE,
    scheduleHistory: false,
  };

  it("keeps every cursor within what the API accepts and finishes as an exhaustive read does", async () => {
    const org = manyParentsOrg();
    const server = fakePlanningCenter(org);

    const continued = await continueCandidateDetails(
      input,
      () => peopleService(server.fetch),
      0,
      80
    );
    const exhaustive = await exhaustiveCandidateDetails(input, org);
    const sentKeys = server.sent.map(
      ({ path, offset }) => `${path}?offset=${offset}`
    );

    expect({
      details: continued.details,
      // Near the cursor's limit, and never past it.
      largestCursor:
        Math.max(
          ...continued.batches.map(
            ({ continuation }) =>
              continuation.people[0]?.pendingBlockouts.length ?? 0
          )
        ) >
        MAX_PENDING_BLOCKOUTS - 100,
      readOnce: new Set(sentKeys).size === sentKeys.length,
      everyCallWithinBudget: continued.requests.every(
        (requests) => requests <= PROGRESSIVE_REQUEST_BUDGET
      ),
    }).toStrictEqual({
      details: exhaustive,
      largestCursor: true,
      readOnce: true,
      everyCallWithinBudget: true,
    });
    // Usually well under a second; CI runs this beside every other package's suite, and one
    // merge-queue run hit the 5 s default under that contention.
  }, 20_000);
});

/** Forty September plans of a service type the ranges cannot read, rehearsals on page two. */
const detailOrg = (): FakeOrg => {
  const collections = new Map<string, Collection>();
  const schedules: PCResource[] = [];
  const included: PCResource[] = [];
  for (let index = 0; index < 40; index += 1) {
    const planId = `september-plan-${index}`;
    const serviceAt = new Date(
      Date.parse("2026-09-01T17:00:00Z") + (index % 28) * DAY_MS
    );
    const times = planTimes(planId, serviceAt, 101, 100);
    collections.set(`/services/v2/plans/${planId}/plan_times`, {
      data: times,
    });
    schedules.push(scheduleOn("person-1", planId, serviceAt, 100));
    if (times[0] !== undefined) {
      included.push(times[0]);
    }
  }
  collections.set("/services/v2/people/person-1/schedules", {
    data: schedules,
    included,
  });
  return {
    collections,
    resources: new Map([
      [
        "/services/v2/people/person-1",
        {
          type: "Person",
          id: "person-1",
          attributes: { first_name: "Alex", last_name: "Rivera" },
        },
      ],
    ]),
  };
};

/** September plans each listing 100 rehearsal times that only their own pages hold. */
const manyTimesDetailOrg = (plans: number): FakeOrg => {
  const org = manyTimesOrg("person-1", plans);
  const schedules = org.collections.get(schedulesPath("person-1"));
  org.collections.set(schedulesPath("person-1"), {
    data: (schedules?.data ?? []).map((schedule, index) => ({
      ...schedule,
      attributes: {
        ...schedule.attributes,
        sort_date: atDay("2026-09-01T17:00:00Z", index % 28),
      },
    })),
  });
  return { ...org, resources: detailOrg().resources };
};

describe("person detail over paged plan times", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const otherServices = {
    catalogService: {
      getServiceTypesCached: () => Effect.succeed([]),
    },
    plansService: {
      getPlansWithIncludedInDateRange: () =>
        Effect.die(new Error("No service type to read a range of")),
    },
    resolveTimeZone: countedRead(ORG_TIME_ZONE),
  };

  /** Follows the detail's continuation, each call its own invocation with fresh services. */
  const continuePersonDetail = async (
    fetch: typeof globalThis.fetch,
    continuation?: PlanTimesProgress,
    calls = 0
  ): Promise<{ requests: number; detail: PeopleDashboardPersonDetail }[]> => {
    if (calls === MAX_CALLS) {
      throw new Error("Person detail did not finish");
    }
    const accounting = new PlanningCenterRequestAccounting({
      requestBudget: PLANNING_CENTER_REQUEST_CAP,
    });
    const detail: PeopleDashboardPersonDetail = await Effect.runPromise(
      getPeopleDashboardPerson({
        personId: "person-1",
        month: "2026-09",
        continuation,
        dependencies: {
          ...otherServices,
          peopleService: peopleService(fetch),
          detailCache: new PlanningCenterReadCache(),
        },
      }).pipe(Effect.provideService(PlanningCenterAccounting, accounting))
    );
    const call = { requests: accounting.requestCount, detail };
    return detail.continuation === null
      ? [call]
      : [
          call,
          ...(await continuePersonDetail(
            fetch,
            detail.continuation,
            calls + 1
          )),
        ];
  };

  it("follows its continuation to every rehearsal time, within the budget, and equals an exhaustive read", async () => {
    vi.useFakeTimers({
      now: Date.parse("2026-09-16T12:00:00Z"),
      toFake: ["Date"],
    });
    const org = detailOrg();
    const server = fakePlanningCenter(org);
    const calls = await continuePersonDetail(server.fetch);
    const exhaustive = await Effect.runPromise(
      getPeopleDashboardPerson({
        personId: "person-1",
        month: "2026-09",
        dependencies: {
          ...otherServices,
          resolveTimeZone: Effect.succeed(ORG_TIME_ZONE),
          peopleService: exhaustivePeople(org),
          detailCache: new PlanningCenterReadCache(),
        },
      })
    );
    const last = calls.at(-1)?.detail;

    expect({
      person: last?.person,
      unresolved: last?.requestBudget.unresolvedRehearsalTimes,
      continuation: last?.continuation,
      severalCalls: calls.length > 1,
      everyCallWithinBudget: calls.every(
        ({ requests }) => requests <= PROGRESSIVE_REQUEST_BUDGET
      ),
      partialsContinue: calls
        .slice(0, -1)
        .every(({ detail }) => detail.continuation !== null),
    }).toStrictEqual({
      person: exhaustive.person,
      unresolved: 0,
      continuation: null,
      severalCalls: true,
      everyCallWithinBudget: true,
      partialsContinue: true,
    });
  });

  const plansAtBound = MAX_PROGRESS_TIMES / PLANNING_CENTER_PAGE_SIZE;

  it("keeps every continuation within what the API accepts at the cursor's bound", async () => {
    vi.useFakeTimers({
      now: Date.parse("2026-09-16T12:00:00Z"),
      toFake: ["Date"],
    });
    const server = fakePlanningCenter(manyTimesDetailOrg(plansAtBound));

    const calls = await continuePersonDetail(server.fetch);

    expect({
      unresolved: calls.at(-1)?.detail.requestBudget.unresolvedRehearsalTimes,
      severalCalls: calls.length > 1,
      everyCursorValid: calls.every(
        ({ detail }) =>
          detail.continuation === null ||
          Option.isSome(decodePlanTimesProgress(detail.continuation))
      ),
    }).toStrictEqual({
      unresolved: 0,
      severalCalls: true,
      everyCursorValid: true,
    });
  });

  it("fails typed when the missing times would outgrow the cursor", async () => {
    vi.useFakeTimers({
      now: Date.parse("2026-09-16T12:00:00Z"),
      toFake: ["Date"],
    });
    const server = fakePlanningCenter(manyTimesDetailOrg(plansAtBound + 1));

    const exit = await Effect.runPromiseExit(
      getPeopleDashboardPerson({
        personId: "person-1",
        month: "2026-09",
        dependencies: {
          ...otherServices,
          peopleService: peopleService(server.fetch),
          detailCache: new PlanningCenterReadCache(),
        },
      })
    );

    expect(exit).toStrictEqual(
      Exit.fail(
        new PlanningCenterPaginationError({
          reason: "cursor-limit",
          path: schedulesPath("person-1"),
          pages: 1,
        })
      )
    );
  });
});

/**
 * Two service types: Sunday with 250 plans in the window (three range pages) and 100 after it,
 * unless told otherwise,
 * and Midweek with 30. Every plan has one person on its roster, spread over twenty people.
 */
const windowOrg = (
  sundayPlans = 250
): FakeOrg & { readonly windowPlanIds: string[] } => {
  const collections = new Map<string, Collection>();
  const windowPlanIds: string[] = [];
  const addServiceType = (
    serviceTypeId: string,
    inWindow: number,
    after: number
  ) => {
    const plans = Array.from(
      { length: inWindow + after },
      (_, index): PCResource => {
        const id = `${serviceTypeId}-plan-${index}`;
        const sortDate =
          index < inWindow
            ? atDay("2026-04-06T17:00:00Z", (index * 55) / inWindow)
            : atDay("2026-06-15T17:00:00Z", index - inWindow);
        if (index < inWindow) {
          windowPlanIds.push(id);
        }
        collections.set(
          `/services/v2/service_types/${serviceTypeId}/plans/${id}/team_members`,
          {
            data: [
              {
                type: "PlanPerson",
                id: `${id}-pp`,
                attributes: {
                  status: "C",
                  team_position_name: "Band - Vocals",
                  created_at: "2026-01-01T00:00:00Z",
                },
                relationships: {
                  person: {
                    data: { type: "Person", id: `person-${index % 20}` },
                  },
                  plan: { data: { type: "Plan", id } },
                },
              },
            ],
          }
        );
        return {
          type: "Plan",
          id,
          attributes: { sort_date: sortDate, plan_people_count: 1 },
        };
      }
    );
    collections.set(`/services/v2/service_types/${serviceTypeId}/plans`, {
      data: plans,
    });
  };
  addServiceType("st-sunday", sundayPlans, 100);
  addServiceType("st-midweek", 30, 0);
  return { collections, resources: new Map(), windowPlanIds };
};

const windowServiceTypes: PCResource[] = ["st-sunday", "st-midweek"].map(
  (id) => ({
    type: "ServiceType",
    id,
    attributes: { archived_at: null, name: id },
  })
);

const windowServices = (
  fetch: typeof globalThis.fetch,
  caches?: {
    readonly people: PlanningCenterPeopleServiceCaches;
    readonly plans: PlanningCenterPlansServiceCaches;
  }
): PlanWindowHistoryDependencies => {
  const core = createBasicPlanningCenterClient(
    { applicationId: "test-client", secret: "test-token" },
    httpClientFor(fetch)
  );
  return {
    catalog: {
      getServiceTypesCached: () => Effect.succeed(windowServiceTypes),
    },
    people: new PlanningCenterPeopleService(
      core,
      caches?.people ?? createPlanningCenterPeopleServiceCaches()
    ),
    plans: new PlanningCenterPlansService(
      core,
      Effect.succeed(ORG_TIME_ZONE),
      caches?.plans ?? createPlanningCenterPlansServiceCaches()
    ),
    resolveTimeZone: Effect.succeed(ORG_TIME_ZONE),
  };
};

/** Follows the window's continuation the way the browser does, each call its own invocation. */
const continueWindowHistory = async (
  servicesForCall: () => PlanWindowHistoryDependencies,
  continuation?: PlanWindowHistoryInput["continuation"],
  calls = 0
): Promise<{ batch: PlanWindowHistoryBatch; requests: number }[]> => {
  if (calls === MAX_CALLS) {
    throw new Error("Plan window history did not finish");
  }
  const accounting = new PlanningCenterRequestAccounting({
    requestBudget: PLANNING_CENTER_REQUEST_CAP,
  });
  const batch = await Effect.runPromise(
    getPlanWindowHistory(
      { date: PLAN_DATE, continuation },
      servicesForCall()
    ).pipe(Effect.provideService(PlanningCenterAccounting, accounting))
  );
  const call = { batch, requests: accounting.requestCount };
  const next = nextWindowContinuation(batch);
  if (next === null) {
    return [call];
  }
  if (
    continuation !== undefined &&
    !windowHistoryAdvanced(continuation, batch)
  ) {
    throw new Error("Plan window history made no progress");
  }
  if (
    Option.isNone(
      decodeWindowHistoryInput({ date: PLAN_DATE, continuation: next })
    )
  ) {
    throw new Error(`Call ${calls + 1} returned a cursor the API rejects`);
  }
  return [
    call,
    ...(await continueWindowHistory(servicesForCall, next, calls + 1)),
  ];
};

/** Each person's history item ids, sorted: one per roster row the window read. */
const historyRows = (calls: readonly { batch: PlanWindowHistoryBatch }[]) =>
  Object.fromEntries(
    [
      ...expandPlanWindowHistory(
        calls.map(({ batch }) => batch),
        SELECTED_PLAN
      ),
    ]
      .map(([personId, history]): [string, string[]] => [
        personId,
        history.serviceHistory.map(({ id }) => id).toSorted(),
      ])
      .toSorted(([a], [b]) => a.localeCompare(b))
  );

describe("plan window history over paged plan ranges", () => {
  it("lists every range page and reads every roster across calls, from fresh and warm caches", async () => {
    const org = windowOrg();
    const server = fakePlanningCenter(org);
    const caches = {
      people: createPlanningCenterPeopleServiceCaches(),
      plans: createPlanningCenterPlansServiceCaches(),
    };

    const fresh = await continueWindowHistory(() =>
      windowServices(server.fetch)
    );
    await continueWindowHistory(() => windowServices(server.fetch, caches));
    const sentBeforeWarm = server.sent.length;
    const warm = await continueWindowHistory(() =>
      windowServices(server.fetch, caches)
    );
    const expected = Object.fromEntries(
      Array.from({ length: 20 }, (_, person): [string, string[]] => [
        `person-${person}`,
        org.windowPlanIds
          .filter((id) => Number(id.split("-plan-")[1]) % 20 === person)
          .map((id) => `${id}-pp`)
          .toSorted(),
      ]).toSorted(([a], [b]) => a.localeCompare(b))
    );

    expect({
      fresh: historyRows(fresh),
      warm: historyRows(warm),
      loaded: fresh.reduce((sum, { batch }) => sum + batch.loadedPlanCount, 0),
      sentByWarm: server.sent.length - sentBeforeWarm,
      severalCalls: fresh.length > 1,
      everyCallWithinBudget: fresh.every(
        ({ requests }) => requests <= PROGRESSIVE_REQUEST_BUDGET
      ),
      // Each page after the first starts at the last plan listed, so a moved plan shows. The
      // third passes the window; the plans after it are never listed.
      sundayPages: new Set(
        pagesRead(server.sent, "/services/v2/service_types/st-sunday/plans")
      ),
    }).toStrictEqual({
      fresh: expected,
      warm: expected,
      loaded: 280,
      sentByWarm: 0,
      severalCalls: true,
      everyCallWithinBudget: true,
      sundayPages: new Set([0, 99, 198]),
    });
  });

  it("finds a deferred plan that moved to the page before after plans were deleted", async () => {
    // Two range pages: once the second is listed, the range is done and no listing can skip.
    const org = windowOrg(150);
    const server = fakePlanningCenter(org);
    const sundayPath = "/services/v2/service_types/st-sunday/plans";
    // Read until Sunday is listed and the next deferred plan is one its second page listed.
    const readUntilSecondPage = async (
      continuation?: PlanWindowHistoryInput["continuation"]
    ): Promise<PlanWindowHistoryBatch[]> => {
      const batch = await Effect.runPromise(
        getPlanWindowHistory(
          { date: PLAN_DATE, continuation },
          windowServices(server.fetch)
        )
      );
      const after = nextWindowContinuation(batch);
      return after === null ||
        (after.plans[0]?.rangeOffset === 99 &&
          after.ranges[0]?.serviceTypeId !== "st-sunday")
        ? [batch]
        : [batch, ...(await readUntilSecondPage(after))];
    };
    const firstCalls = await readUntilSecondPage();
    const calls = firstCalls.map((batch) => ({ batch }));
    const last = calls.at(-1)?.batch;
    const next = last === undefined ? null : nextWindowContinuation(last);
    const [moving] = next?.plans ?? [];
    const sunday = org.collections.get(sundayPath)?.data ?? [];
    const movingIndex = sunday.findIndex(({ id }) => id === moving?.planId);
    // Deleting plans already read moves the next deferred one onto the first page.
    org.collections.set(sundayPath, {
      data: sunday.slice(movingIndex - 99),
    });
    const rest =
      next === null
        ? []
        : await continueWindowHistory(() => windowServices(server.fetch), next);
    const rows = Object.values(historyRows([...calls, ...rest])).flat();

    expect({
      moved: movingIndex >= 100,
      everyPlanOnce: rows.length === new Set(rows).size,
      rows: rows.length,
    }).toStrictEqual({ moved: true, everyPlanOnce: true, rows: 180 });
  });
});

describe("plan window history whose first roster needs the retry headroom", () => {
  it("reads it past the planned budget, within the procedure cap, and says so", async () => {
    // Eleven empty service types, then one plan with 2,500 people: 25 roster pages.
    const serviceTypes = Array.from({ length: 12 }, (_, index): PCResource => ({
      type: "ServiceType",
      id: `st-${index}`,
      attributes: { archived_at: null, name: `Type ${index}` },
    }));
    const planPath = "/services/v2/service_types/st-11/plans";
    const org: FakeOrg = {
      collections: new Map([
        [
          planPath,
          {
            data: [
              {
                type: "Plan",
                id: "big",
                attributes: { sort_date: PLAN_DATE, plan_people_count: 2500 },
              },
            ],
          },
        ],
        [
          `${planPath}/big/team_members`,
          {
            data: Array.from({ length: 2500 }, (_, index): PCResource => ({
              type: "PlanPerson",
              id: `big-pp-${index}`,
              attributes: {
                status: "C",
                team_position_name: "Band - Vocals",
                created_at: "2026-01-01T00:00:00Z",
              },
              relationships: {
                person: { data: { type: "Person", id: `person-${index}` } },
                plan: { data: { type: "Plan", id: "big" } },
              },
            })),
          },
        ],
      ]),
      resources: new Map(),
    };
    const server = fakePlanningCenter(org);

    const calls = await continueWindowHistory(() => ({
      ...windowServices(server.fetch),
      catalog: { getServiceTypesCached: () => Effect.succeed(serviceTypes) },
    }));

    expect(
      calls.map(({ batch, requests }) => ({
        limit: batch.requestBudget.limit,
        planningCenterRequests: batch.requestBudget.planningCenterRequests,
        withinCap: requests <= PLANNING_CENTER_REQUEST_CAP,
        loadedPlanCount: batch.loadedPlanCount,
      }))
    ).toStrictEqual([
      {
        limit: PROGRESSIVE_REQUEST_BUDGET,
        planningCenterRequests: PROGRESSIVE_REQUEST_BUDGET + 1,
        withinCap: true,
        loadedPlanCount: 1,
      },
    ]);
  });
});

type WindowExit = Exit.Exit<PlanWindowHistoryBatch, unknown>;
/**
 * Follows the window call by call with fresh caches, editing the plans after the first call;
 * stops at the end or at the first failure.
 */
const readChangedWindow = async (
  fetch: typeof globalThis.fetch,
  afterFirstCall: () => void,
  continuation?: PlanWindowHistoryInput["continuation"],
  calls = 0
): Promise<WindowExit[]> => {
  if (calls === MAX_CALLS) {
    throw new Error("Plan window history did not finish");
  }
  const exit = await Effect.runPromiseExit(
    getPlanWindowHistory(
      { date: PLAN_DATE, continuation },
      windowServices(fetch)
    )
  );
  if (calls === 0) {
    afterFirstCall();
  }
  const next = Exit.isSuccess(exit) ? nextWindowContinuation(exit.value) : null;
  return next === null
    ? [exit]
    : [
        exit,
        ...(await readChangedWindow(fetch, afterFirstCall, next, calls + 1)),
      ];
};

/** What a read from the start finds once the plans stopped changing. */
const readAgain = async (fetch: typeof globalThis.fetch) => {
  const calls = await continueWindowHistory(() => windowServices(fetch));
  const rows = Object.values(historyRows(calls)).flat();
  return {
    rows: rows.length,
    everyPlanOnce: rows.length === new Set(rows).size,
    loaded: calls.reduce((sum, { batch }) => sum + batch.loadedPlanCount, 0),
  };
};

describe("plan window history when plans change between calls", () => {
  const sundayPath = "/services/v2/service_types/st-sunday/plans";
  /** A Sunday plan on the selected day with one person on its roster. */
  const sameDayPlan = (org: FakeOrg, id: string): PCResource => {
    org.collections.set(`${sundayPath}/${id}/team_members`, {
      data: [
        {
          type: "PlanPerson",
          id: `${id}-pp`,
          attributes: {
            status: "C",
            team_position_name: "Band - Vocals",
            created_at: "2026-01-01T00:00:00Z",
          },
          relationships: {
            person: { data: { type: "Person", id: "person-0" } },
            plan: { data: { type: "Plan", id } },
          },
        },
      ],
    });
    return {
      type: "Plan",
      id,
      attributes: { sort_date: PLAN_DATE, plan_people_count: 1 },
    };
  };
  const sameDayOrg = (count: number) => {
    const org: FakeOrg = { collections: new Map(), resources: new Map() };
    const plans = Array.from({ length: count }, (_, index) =>
      sameDayPlan(org, `plan-${index}`)
    );
    org.collections.set(sundayPath, { data: plans });
    const change = (edit: (current: PCResource[]) => PCResource[]) => {
      org.collections.set(sundayPath, {
        data: edit([...(org.collections.get(sundayPath)?.data ?? [])]),
      });
    };
    const inserted = (ids: readonly string[]) =>
      ids.map((id) => sameDayPlan(org, id));
    return { org, change, inserted };
  };
  const changed = (pages: number) =>
    new PlanningCenterPaginationError({
      reason: "changed",
      path: sundayPath,
      pages,
    });

  // The first call lists the first page and reads some rosters; a later one resumes the range
  // on the page starting at plan-99, after finding the rest of the first page's plans (deleted:
  // all on it still; added: plan-99 on the next page).
  it.each([
    ["deleted", 199, 2],
    ["added", 201, 3],
  ] as const)(
    "fails typed when a plan before an unlisted page is %s, and a fresh read finds every plan once",
    async (change, plans, pagesBeforeFailing) => {
      const window = sameDayOrg(200);
      const server = fakePlanningCenter(window.org);
      const [added] = window.inserted(["plan-new"]);

      const exits = await readChangedWindow(server.fetch, () => {
        window.change((current) =>
          change === "deleted" || added === undefined
            ? current.slice(1)
            : [added, ...current]
        );
      });

      expect({
        last: exits.at(-1),
        earlierSucceeded: exits.slice(0, -1).every(Exit.isSuccess),
        again: await readAgain(server.fetch),
      }).toStrictEqual({
        last: Exit.fail(changed(pagesBeforeFailing)),
        earlierSucceeded: true,
        again: { rows: plans, everyPlanOnce: true, loaded: plans },
      });
    }
  );

  it("rejects a tied-date swap across pages even when the boundary ID stays unchanged", async () => {
    const window = sameDayOrg(200);
    const server = fakePlanningCenter(window.org);
    const exits = await readChangedWindow(server.fetch, () => {
      window.change((current) => {
        const reordered = [...current];
        const [left] = reordered.slice(90, 91);
        const [right] = reordered.slice(110, 111);
        if (left !== undefined && right !== undefined) {
          reordered[90] = right;
          reordered[110] = left;
        }
        return reordered;
      });
    });
    expect(exits.at(-1)).toStrictEqual(Exit.fail(changed(3)));
    await expect(readAgain(server.fetch)).resolves.toStrictEqual({
      rows: 200,
      everyPlanOnce: true,
      loaded: 200,
    });
  });

  it("fails typed when a deferred plan moved past its neighboring pages, rather than drop it", async () => {
    // One range page, listed whole by the first call, which defers some rosters.
    const window = sameDayOrg(50);
    const server = fakePlanningCenter(window.org);
    // Enough plans ahead of the deferred ones to put them two pages on.
    const added = window.inserted(
      Array.from({ length: 170 }, (_, index) => `plan-new-${index}`)
    );

    const exits = await readChangedWindow(server.fetch, () => {
      window.change((current) => [...added, ...current]);
    });
    const [first] = exits;

    expect({
      firstDeferred:
        first !== undefined && Exit.isSuccess(first)
          ? first.value.deferredPlans.length > 0 &&
            first.value.deferredRanges.length === 0
          : false,
      last: exits.at(-1),
      again: await readAgain(server.fetch),
    }).toStrictEqual({
      firstDeferred: true,
      last: Exit.fail(changed(2)),
      again: { rows: 220, everyPlanOnce: true, loaded: 220 },
    });
  });
});

/** `count` active service types; the first holds 200 window plans, each needing a roster. */
const manyServiceTypesOrg = (count: number): FakeOrg => {
  const serviceTypes = Array.from(
    { length: count },
    (_, index): PCResource => ({
      type: "ServiceType",
      id: `st-${index}`,
      attributes: { archived_at: null, name: `Type ${index}` },
    })
  );
  const plans = Array.from({ length: 200 }, (_, index): PCResource => ({
    type: "Plan",
    id: `st-0-plan-${index}`,
    attributes: { sort_date: PLAN_DATE, plan_people_count: 1 },
  }));
  return {
    collections: new Map([
      ["/services/v2/service_types", { data: serviceTypes }],
      ["/services/v2/service_types/st-0/plans", { data: plans }],
    ]),
    resources: new Map(),
  };
};

const servicesWithCatalog = (fetch: typeof globalThis.fetch) => ({
  ...windowServices(fetch),
  catalog: new PlanningCenterCatalogService(
    createBasicPlanningCenterClient(
      { applicationId: "test-client", secret: "test-token" },
      httpClientFor(fetch)
    )
  ),
});

describe("plan window history across as many service types as the catalog holds", () => {
  it("hands back cursors the API accepts with every service type the catalog allows", async () => {
    const server = fakePlanningCenter(manyServiceTypesOrg(MAX_SERVICE_TYPES));
    // The first few calls: the whole window would take one per service type.
    const followCursors = async (
      calls: number,
      continuation?: PlanWindowHistoryInput["continuation"]
    ): Promise<(PlanWindowHistoryInput["continuation"] | null)[]> => {
      if (calls === 0) {
        return [];
      }
      const batch = await Effect.runPromise(
        getPlanWindowHistory(
          { date: PLAN_DATE, continuation },
          servicesWithCatalog(server.fetch)
        )
      );
      const next = nextWindowContinuation(batch);
      return [
        next,
        ...(next === null ? [] : await followCursors(calls - 1, next)),
      ];
    };
    const cursors = await followCursors(3);

    expect({
      largestRanges: Math.max(
        ...cursors.map((cursor) => cursor?.ranges.length ?? 0)
      ),
      everyCursorAccepted: cursors.every(
        (cursor) =>
          cursor !== null &&
          Option.isSome(
            decodeWindowHistoryInput({ date: PLAN_DATE, continuation: cursor })
          )
      ),
    }).toStrictEqual({
      largestRanges: MAX_SERVICE_TYPES,
      everyCursorAccepted: true,
    });
  });

  it("fails typed when the organization has more service types than that", async () => {
    const server = fakePlanningCenter(
      manyServiceTypesOrg(MAX_SERVICE_TYPES + 1)
    );

    const exit = await Effect.runPromiseExit(
      getPlanWindowHistory(
        { date: PLAN_DATE },
        servicesWithCatalog(server.fetch)
      )
    );

    expect(exit).toStrictEqual(
      Exit.fail(
        new PlanningCenterPaginationError({
          reason: "page-limit",
          path: "/services/v2/service_types",
          pages: MAX_SERVICE_TYPES / PLANNING_CENTER_PAGE_SIZE,
        })
      )
    );
  });
});

const rangeOrg = (count: number): FakeOrg => ({
  collections: new Map([
    [
      "/services/v2/service_types/st-1/plans",
      {
        data: Array.from({ length: count }, (_, index) => ({
          type: "Plan",
          id: `plan-${index}`,
          attributes: {
            sort_date: atDay("2026-04-01T17:00:00Z", index / 10),
          },
        })),
      },
    ],
  ]),
  resources: new Map(),
});

const plansService = (fetch: typeof globalThis.fetch) =>
  new PlanningCenterPlansService(
    createBasicPlanningCenterClient(
      { applicationId: "test-client", secret: "test-token" },
      httpClientFor(fetch)
    ),
    Effect.succeed(ORG_TIME_ZONE)
  );

describe("plan ranges read whole", () => {
  it("stops at the page that passes the range and says when the range went on past its cap", async () => {
    const server = fakePlanningCenter(rangeOrg(1000));
    const service = plansService(server.fetch);

    const short = await Effect.runPromise(
      service.getPlansWithIncludedInDateRange(
        "st-1",
        "2026-04-01",
        "2026-04-10",
        "",
        ORG_TIME_ZONE
      )
    );
    const long = await Effect.runPromise(
      service.getPlansWithIncludedInDateRange(
        "st-1",
        "2026-04-01",
        "2026-08-01",
        "",
        ORG_TIME_ZONE
      )
    );
    const listed = await Effect.runPromiseExit(
      service.getPlansInDateRange(
        "st-1",
        "2026-04-01",
        "2026-08-01",
        ORG_TIME_ZONE
      )
    );

    expect({
      short: [short.data.length, short.complete],
      long: [long.data.length, long.complete],
      listed,
      pages: pagesRead(server.sent, "/services/v2/service_types/st-1/plans"),
    }).toStrictEqual({
      // Ten plans a day from April 1, 10:00 in Los Angeles: 96 land on April 1 to 10.
      short: [96, true],
      long: [300, false],
      listed: Exit.fail(
        new PlanningCenterPaginationError({
          reason: "page-limit",
          path: "/services/v2/service_types/st-1/plans",
          pages: 3,
        })
      ),
      // One page covers April 1 to 10; the long range reads three, then cached pages.
      pages: [0, 100, 200],
    });
  });
});
