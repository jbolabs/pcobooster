import { isSettledPlan } from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import { loadPositionCandidatesProgressively } from "@pcobooster/api/modules/planning-center/load-position-candidates.test-support";
import type {
  CandidateListDependencies,
  CandidateListInput,
} from "@pcobooster/api/modules/planning-center/load-position-candidates.test-support";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import type {
  PlanningCenterError,
  PlanningCenterPage,
} from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterCatalogService } from "@pcobooster/api/planning-center/services/catalog-service";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type {
  PCResource,
  RawPlanTime,
} from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

type CollectionRead = Effect.Effect<PCResource[], PlanningCenterError>;

const onlyPage = (data: PCResource[]): PlanningCenterPage => ({
  data,
  included: [],
  nextOffset: null,
});

const createFixture = () => {
  const mocks = {
    getServiceTypesCached:
      vi.fn<PlanningCenterCatalogService["getServiceTypesCached"]>(),
    getPeopleForTeamPosition:
      vi.fn<PlanningCenterPeopleService["getPeopleForTeamPosition"]>(),
    // Whole collections; `dependencies` serves each as its only page.
    getPersonBlockouts: vi.fn<(personId: string) => CollectionRead>(),
    getPersonBlockoutDates:
      vi.fn<(personId: string, blockoutId: string) => CollectionRead>(),
    // A person's schedules whole; `dependencies` serves them as their only page.
    getPersonSchedules:
      vi.fn<
        (
          personId: string,
          after: string
        ) => Effect.Effect<{ data: PCResource[]; included: PCResource[] }>
      >(),
    getPlanPlanTimes: vi.fn<(planId: string) => CollectionRead>(),
    getPlanTeamMembers:
      vi.fn<PlanningCenterPeopleService["getPlanTeamMembers"]>(),
    getPlanWindowRoster:
      vi.fn<PlanningCenterPeopleService["getPlanWindowRoster"]>(),
    // A service type's plans in the window whole; `dependencies` serves them as one page.
    getPlanRange:
      vi.fn<
        (
          serviceTypeId: string
        ) => Effect.Effect<{ data: PCResource[]; included: PCResource[] }>
      >(),
    resolveTimeZone: vi.fn<() => string>(),
  };
  const dependencies = {
    catalog: { getServiceTypesCached: mocks.getServiceTypesCached },
    people: {
      getPeopleForTeamPosition: mocks.getPeopleForTeamPosition,
      getPersonBlockoutsPage: (personId: string) =>
        Effect.map(mocks.getPersonBlockouts(personId), onlyPage),
      getPersonBlockoutDatesPage: (personId: string, blockoutId: string) =>
        Effect.map(
          mocks.getPersonBlockoutDates(personId, blockoutId),
          onlyPage
        ),
      getPersonSchedulesPage: (personId: string, after: string) =>
        Effect.map(mocks.getPersonSchedules(personId, after), (schedules) => ({
          ...schedules,
          nextOffset: null,
        })),
      getPlanPlanTimesPage: (planId: string) =>
        Effect.map(mocks.getPlanPlanTimes(planId), onlyPage),
      getPlanTeamMembers: mocks.getPlanTeamMembers,
      getPlanWindowRoster: mocks.getPlanWindowRoster,
    },
    plans: {
      getPlanRangePage: (serviceTypeId: string) =>
        Effect.map(mocks.getPlanRange(serviceTypeId), (range) => ({
          ...range,
          nextOffset: null,
        })),
    },
    resolveTimeZone: Effect.sync(() => mocks.resolveTimeZone()),
  } satisfies CandidateListDependencies;
  return { mocks, dependencies };
};

const person = (id: string, first: string, last: string): PCResource => ({
  type: "Person",
  id,
  attributes: {
    first_name: first,
    last_name: last,
    photo_url: null,
    photo_thumbnail_url: null,
    archived_at: null,
  },
});

const assignment = (id: string, personId: string): PCResource => ({
  type: "PersonTeamPositionAssignment",
  id,
  attributes: {},
  relationships: {
    person: {
      data: { type: "Person", id: personId },
    },
  },
});

const team = (id: string, name: string): PCResource => ({
  type: "Team",
  id,
  attributes: {
    name,
    sequence: 1,
    rehearsal_team: false,
    archived_at: null,
  },
});

const teamPosition = (
  id: string,
  name: string,
  teamId: string
): PCResource => ({
  type: "TeamPosition",
  id,
  attributes: { name },
  relationships: {
    team: { data: { type: "Team", id: teamId } },
  },
});

const scheduleEntry = (params: {
  id: string;
  planId: string;
  teamId: string;
  status: string;
  teamName?: string;
  teamPositionName: string;
  sortDate?: string;
  timesIds?: string[];
}): PCResource => {
  const relationships: PCResource["relationships"] = {
    plan: { data: { type: "Plan", id: params.planId } },
    team: { data: { type: "Team", id: params.teamId } },
    plan_person: { data: { type: "PlanPerson", id: params.id } },
  };
  if (params.timesIds) {
    relationships.plan_times = {
      data: params.timesIds.map((id) => ({ type: "PlanTime", id })),
    };
  }

  return {
    type: "Schedule",
    id: params.id,
    attributes: {
      status: params.status,
      sort_date: `${params.sortDate ?? "2026-02-22"}T00:00:00Z`,
      ...(isNonEmptyString(params.teamName) ||
      params.teamPositionName.includes(" - ")
        ? {
            team_name:
              params.teamName ?? params.teamPositionName.split(" - ")[0],
          }
        : undefined),
      team_position_name: params.teamPositionName,
    },
    relationships,
  };
};

const planMemberEntry = (params: {
  id: string;
  personId: string;
  planId: string;
  teamId: string;
  status: string;
  teamPositionName: string;
}): PCResource => ({
  type: "PlanPerson",
  id: params.id,
  attributes: {
    status: params.status,
    created_at: "2026-02-22T00:00:00Z",
    team_position_name: params.teamPositionName,
    decline_reason: null,
  },
  relationships: {
    person: { data: { type: "Person", id: params.personId } },
    plan: { data: { type: "Plan", id: params.planId } },
    team: { data: { type: "Team", id: params.teamId } },
  },
});

const planEntry = (id: string, sortDate: string): PCResource => ({
  type: "Plan",
  id,
  attributes: {
    title: id,
    sort_date: `${sortDate}T00:00:00Z`,
    created_at: `${sortDate}T00:00:00Z`,
  },
});

const blockout = (
  id: string,
  startsAt: string,
  endsAt: string
): PCResource => ({
  type: "Blockout",
  id,
  attributes: {
    reason: "Away",
    starts_at: startsAt,
    ends_at: endsAt,
    description: "",
    share: true,
  },
});

/** Parent row from Services API for a recurring block: wide starts_at/ends_at; real days are on blockout_dates. */
const recurringWeeklyBlockout = (
  id: string,
  startsAt: string,
  endsAt: string
): PCResource => ({
  type: "Blockout",
  id,
  attributes: {
    reason: "Recurring",
    starts_at: startsAt,
    ends_at: endsAt,
    description: "",
    share: true,
    repeat_frequency: "every_1",
    repeat_period: "weekly",
  },
});

/** A blockout entered in Los Angeles; Planning Center reports its instants in UTC. */
const laBlockout = (
  id: string,
  startsAt: string,
  endsAt: string,
  extra: Record<string, string> = {}
): PCResource => ({
  type: "Blockout",
  id,
  attributes: {
    reason: "Away",
    starts_at: startsAt,
    ends_at: endsAt,
    description: "",
    share: true,
    time_zone: "America/Los_Angeles",
    repeat_frequency: "no_repeat",
    ...extra,
  },
});

const servicePlanTime = (startsAt: string): RawPlanTime => ({
  type: "PlanTime",
  id: startsAt,
  attributes: { starts_at: startsAt, time_type: "service" },
});

const planSortedAt = (sortDate: string | null): PCResource => ({
  type: "Plan",
  id: "plan-1",
  attributes: { sort_date: sortDate },
});

describe("position candidate list", () => {
  let mocks: ReturnType<typeof createFixture>["mocks"];
  let dependencies: ReturnType<typeof createFixture>["dependencies"];
  const loadCandidates = async (input: CandidateListInput) => {
    const { people, complete } = await loadPositionCandidatesProgressively(
      input,
      dependencies
    );
    expect(complete).toBeTruthy();
    return people;
  };

  beforeEach(() => {
    ({ mocks, dependencies } = createFixture());
    // Most tests give one roster per plan: the window reads what the fresh read sees.
    mocks.getPlanWindowRoster.mockImplementation((serviceTypeId, planId) =>
      mocks.getPlanTeamMembers(serviceTypeId, planId)
    );
    mocks.getServiceTypesCached.mockReturnValue(
      Effect.succeed([
        {
          type: "ServiceType",
          id: "st-1",
          attributes: { archived_at: null, sequence: 1, name: "Primary" },
        },
      ])
    );
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({ data: [], included: [] })
    );
    mocks.getPlanPlanTimes.mockReturnValue(Effect.succeed([]));
    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({ data: [], included: [] })
    );
    mocks.getPlanRange.mockReturnValue(
      Effect.succeed({
        data: [],
        included: [],
      })
    );
    mocks.resolveTimeZone.mockReturnValue("UTC");
  });

  it("marks selected plan scheduled/confirmed flags and sorts confirmed/scheduled before available/blocked", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-1";
    const planId = "plan-target";
    const date = "2026-02-22";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [
          assignment("a1", "p-confirmed"),
          assignment("a2", "p-scheduled"),
          assignment("a3", "p-available"),
          assignment("a4", "p-blocked"),
        ],
        included: [
          person("p-confirmed", "Alice", "Confirmed"),
          person("p-scheduled", "Bob", "Scheduled"),
          person("p-available", "Cara", "Available"),
          person("p-blocked", "Dan", "Blocked"),
          teamPosition(positionId, "Vocals", teamId),
          team(teamId, "Band"),
        ],
      })
    );

    const scheduleResponseForPerson = (personId: string) => {
      if (personId === "p-confirmed") {
        return {
          data: [
            scheduleEntry({
              id: "pp-confirmed",
              planId,
              teamId,
              status: "C",
              teamPositionName: "Band - Vocals",
            }),
          ],
          included: [],
        };
      }

      if (personId === "p-scheduled") {
        return {
          data: [
            scheduleEntry({
              id: "pp-scheduled",
              planId,
              teamId,
              status: "U",
              teamPositionName: "Band - Vocals",
            }),
          ],
          included: [],
        };
      }

      return {
        data: [],
        included: [],
      };
    };
    mocks.getPersonSchedules.mockImplementation((personId: string) =>
      Effect.succeed(scheduleResponseForPerson(personId))
    );

    mocks.getPersonBlockouts.mockImplementation((personId: string) => {
      if (personId === "p-blocked") {
        return Effect.succeed([
          blockout("b1", "2026-02-22T00:00:00Z", "2026-02-22T23:59:59Z"),
        ]);
      }
      return Effect.succeed([]);
    });

    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planMemberEntry({
            id: "pp-confirmed",
            personId: "p-confirmed",
            planId,
            teamId,
            status: "C",
            teamPositionName: "Vocals",
          }),
          planMemberEntry({
            id: "pp-scheduled",
            personId: "p-scheduled",
            planId,
            teamId,
            status: "U",
            teamPositionName: "Vocals",
          }),
        ],
        included: [
          person("p-confirmed", "Alice", "Confirmed"),
          person("p-scheduled", "Bob", "Scheduled"),
          team(teamId, "Band"),
        ],
      })
    );

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date,
    });

    expect(result).toMatchObject([
      {
        id: "p-confirmed",
        isConfirmedForSelectedPlanPosition: true,
        isScheduledForSelectedPlanPosition: true,
        selectedPlanAssignmentLabels: ["Band - Vocals"],
        scheduledPlanPersonId: "pp-confirmed",
      },
      {
        id: "p-scheduled",
        isConfirmedForSelectedPlanPosition: false,
        isScheduledForSelectedPlanPosition: true,
        selectedPlanAssignmentLabels: ["Band - Vocals"],
        scheduledPlanPersonId: "pp-scheduled",
      },
      {
        id: "p-available",
        isScheduledForSelectedPlanPosition: false,
        selectedPlanAssignmentLabels: [],
      },
      { id: "p-blocked", isBlockedForDate: true },
    ]);
  });

  it("includes same-plan assignments from other positions as labels without marking the selected slot scheduled", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-guitar";
    const planId = "plan-target";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a1", "p1")],
        included: [
          person("p1", "Casey", "Elsewhere"),
          teamPosition(positionId, "Guitar", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({
        data: [
          scheduleEntry({
            id: "pp1",
            planId,
            teamId,
            status: "U",
            teamName: "Band",
            teamPositionName: "Keys",
          }),
        ],
        included: [],
      })
    );

    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planMemberEntry({
            id: "pp1",
            personId: "p1",
            planId,
            teamId,
            status: "U",
            teamPositionName: "Keys",
          }),
        ],
        included: [person("p1", "Casey", "Elsewhere"), team(teamId, "Band")],
      })
    );

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date: "2026-02-22",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      isScheduledForSelectedPlanPosition: false,
      selectedPlanAssignmentLabels: ["Band - Keys"],
    });
    expect(result[0]?.scheduledPlanPersonId).toBeUndefined();
  });

  it("matches the same person's current roster against each position", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const planId = "plan-target";
    const personId = "p-shared";

    mocks.getPeopleForTeamPosition.mockImplementation(
      (_serviceTypeId: string, positionId: string) =>
        Effect.succeed({
          data: [assignment(`a-${positionId}`, personId)],
          included: [
            person(personId, "Shared", "Candidate"),
            teamPosition(
              positionId,
              positionId === "pos-vocals" ? "Vocals" : "Keys",
              teamId
            ),
            team(teamId, "Band"),
          ],
        })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({
        data: [
          scheduleEntry({
            id: "pp-keys",
            planId,
            teamId,
            status: "U",
            teamName: "Band",
            teamPositionName: "Keys",
          }),
        ],
        included: [],
      })
    );

    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planMemberEntry({
            id: "pp-keys",
            personId,
            planId,
            teamId,
            status: "U",
            teamPositionName: "Keys",
          }),
        ],
        included: [
          person(personId, "Shared", "Candidate"),
          team(teamId, "Band"),
        ],
      })
    );

    const vocalsResult = await loadCandidates({
      serviceTypeId,
      positionId: "pos-vocals",
      teamId,
      planId,
      date: "2026-02-22",
    });
    const keysResult = await loadCandidates({
      serviceTypeId,
      positionId: "pos-keys",
      teamId,
      planId,
      date: "2026-02-22",
    });

    expect(vocalsResult[0]).toMatchObject({
      selectedPlanAssignmentLabels: ["Band - Keys"],
      isScheduledForSelectedPlanPosition: false,
    });
    expect(keysResult[0]).toMatchObject({
      selectedPlanAssignmentLabels: ["Band - Keys"],
      isScheduledForSelectedPlanPosition: true,
    });
  });

  it("takes history from the plan window instead of per-person schedule reads", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-vocals";
    const planId = "plan-target";
    const previousPlanId = "plan-prev";
    const personId = "p-shared-window";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a1", personId)],
        included: [
          person(personId, "Window", "Candidate"),
          teamPosition(positionId, "Vocals", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPlanRange.mockReturnValue(
      Effect.succeed({
        data: [
          planEntry(previousPlanId, "2026-02-15"),
          planEntry(planId, "2026-02-22"),
        ],
        included: [],
      })
    );
    const planMembersForPlan = (requestedPlanId: string) => {
      if (requestedPlanId === previousPlanId) {
        return {
          data: [
            planMemberEntry({
              id: "pp-prev",
              personId,
              planId: previousPlanId,
              teamId,
              status: "C",
              teamPositionName: "Band - Vocals",
            }),
          ],
          included: [
            person(personId, "Window", "Candidate"),
            team(teamId, "Band"),
            planEntry(previousPlanId, "2026-02-15"),
          ],
        };
      }

      return {
        data: [
          planMemberEntry({
            id: "pp-target",
            personId,
            planId,
            teamId,
            status: "U",
            teamPositionName: "Band - Vocals",
          }),
        ],
        included: [
          person(personId, "Window", "Candidate"),
          team(teamId, "Band"),
          planEntry(planId, "2026-02-22"),
        ],
      };
    };
    mocks.getPlanTeamMembers.mockImplementation(
      (_serviceTypeId: string, requestedPlanId: string) =>
        Effect.succeed(planMembersForPlan(requestedPlanId))
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date: "2026-02-22",
    });

    expect(mocks.getPersonSchedules).not.toHaveBeenCalled();
    // The selected plan is read fresh; window reads mark plans that already happened.
    expect({
      window: mocks.getPlanWindowRoster.mock.calls.toSorted((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b))
      ),
      fresh:
        mocks.getPlanTeamMembers.mock.calls.length -
        mocks.getPlanWindowRoster.mock.calls.length,
    }).toStrictEqual({
      window: [
        [serviceTypeId, previousPlanId, { settled: true }],
        [serviceTypeId, planId, { settled: true }],
      ],
      fresh: 1,
    });
    expect({
      result,
      servedRecently: (result[0]?.frequency?.recentServedDays ?? 0) >= 1,
      hasPreviousPlanHistory: result[0]?.serviceHistory?.some(
        (entry) => entry.sourceScheduleId === "pp-prev"
      ),
    }).toMatchObject({
      result: [
        {
          isScheduledForSelectedPlanPosition: true,
          selectedPlanAssignmentLabels: ["Band - Vocals"],
        },
      ],
      servedRecently: true,
      hasPreviousPlanHistory: true,
    });
  });

  it("does not collapse every candidate to 50% when shared-window PlanPeople include null decline_reason", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-bass";
    const planId = "plan-target";
    const previousPlanId = "plan-prev";
    const recentPersonId = "p-recent";
    const unusedPersonId = "p-unused";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [
          assignment("a-recent", recentPersonId),
          assignment("a-unused", unusedPersonId),
        ],
        included: [
          person(recentPersonId, "Recent", "Player"),
          person(unusedPersonId, "Unused", "Player"),
          teamPosition(positionId, "Bass Guitar", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPlanRange.mockReturnValue(
      Effect.succeed({
        data: [
          planEntry(previousPlanId, "2026-02-15"),
          planEntry(planId, "2026-02-22"),
        ],
        included: [],
      })
    );
    mocks.getPlanTeamMembers.mockImplementation(
      (_serviceTypeId: string, requestedPlanId: string) => {
        if (requestedPlanId === previousPlanId) {
          return Effect.succeed({
            data: [
              planMemberEntry({
                id: "pp-prev",
                personId: recentPersonId,
                planId: previousPlanId,
                teamId,
                status: "C",
                teamPositionName: "Band - Bass Guitar",
              }),
            ],
            included: [
              person(recentPersonId, "Recent", "Player"),
              team(teamId, "Band"),
              planEntry(previousPlanId, "2026-02-15"),
            ],
          });
        }

        return Effect.succeed({ data: [], included: [] });
      }
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date: "2026-02-22",
    });

    const recent = result.find((row) => row.id === recentPersonId);
    const unused = result.find((row) => row.id === unusedPersonId);
    expect(recent?.frequency?.recentServedDays).toBe(1);
    expect(unused?.frequency?.recentServedDays ?? 0).toBe(0);
    // Served last week ranks lowest, never served ranks highest: neither collapses to 50.
    expect([
      recent?.recommendationScore,
      unused?.recommendationScore,
    ]).toStrictEqual([0, 100]);
  });

  it("includes adjacent history from other service types in the shared plan window", async () => {
    const serviceTypeId = "st-youth";
    const otherServiceTypeId = "st-sunday";
    const teamId = "team-1";
    const positionId = "pos-electric";
    const selectedPlanId = "plan-may-4";
    const adjacentPlanId = "plan-may-3";
    const personId = "p-michael";

    mocks.getServiceTypesCached.mockReturnValue(
      Effect.succeed([
        {
          type: "ServiceType",
          id: serviceTypeId,
          attributes: { archived_at: null, sequence: 1, name: "Youth" },
        },
        {
          type: "ServiceType",
          id: otherServiceTypeId,
          attributes: { archived_at: null, sequence: 2, name: "Sunday" },
        },
      ])
    );
    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a1", personId)],
        included: [
          person(personId, "Michael", "Bortis"),
          teamPosition(positionId, "Lead Electric Guitar", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    const plansForServiceType = (requestedServiceTypeId: string) => {
      if (requestedServiceTypeId === serviceTypeId) {
        return {
          data: [planEntry(selectedPlanId, "2026-05-04")],
          included: [],
        };
      }

      if (requestedServiceTypeId === otherServiceTypeId) {
        return {
          data: [planEntry(adjacentPlanId, "2026-05-03")],
          included: [],
        };
      }

      return { data: [], included: [] };
    };
    mocks.getPlanRange.mockImplementation((requestedServiceTypeId: string) =>
      Effect.succeed(plansForServiceType(requestedServiceTypeId))
    );
    const planMembersForServiceType = (
      requestedServiceTypeId: string,
      requestedPlanId: string
    ) => {
      if (
        requestedServiceTypeId === serviceTypeId &&
        requestedPlanId === selectedPlanId
      ) {
        return {
          data: [],
          included: [
            person(personId, "Michael", "Bortis"),
            team(teamId, "Band"),
            planEntry(selectedPlanId, "2026-05-04"),
          ],
        };
      }

      if (
        requestedServiceTypeId === otherServiceTypeId &&
        requestedPlanId === adjacentPlanId
      ) {
        return {
          data: [
            planMemberEntry({
              id: "pp-may-3",
              personId,
              planId: adjacentPlanId,
              teamId,
              status: "C",
              teamPositionName: "Band - Electric Guitar - Rhythm",
            }),
          ],
          included: [
            person(personId, "Michael", "Bortis"),
            team(teamId, "Band"),
            planEntry(adjacentPlanId, "2026-05-03"),
          ],
        };
      }

      return { data: [], included: [] };
    };
    mocks.getPlanTeamMembers.mockImplementation(
      (requestedServiceTypeId: string, requestedPlanId: string) =>
        Effect.succeed(
          planMembersForServiceType(requestedServiceTypeId, requestedPlanId)
        )
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId: selectedPlanId,
      date: "2026-05-04",
    });

    expect(mocks.getPersonSchedules).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]?.serviceHistory).toContainEqual(
      expect.objectContaining({ sourceScheduleId: "pp-may-3" })
    );
  });

  it("includes and marks a selected slot plan member even when they are not assigned to the position", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-vocals";
    const planId = "plan-target";
    const personId = "p-pending";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [],
        included: [
          teamPosition(positionId, "Vocals", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planMemberEntry({
            id: "pp-pending",
            personId,
            planId,
            teamId,
            status: "U",
            teamPositionName: "Vocals",
          }),
        ],
        included: [person(personId, "Pending", "Singer"), team(teamId, "Band")],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({ data: [], included: [] })
    );

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date: "2026-02-22",
    });

    expect(result.map((row) => row.id)).toStrictEqual([personId]);
    expect(result[0]).toMatchObject({
      isScheduledForSelectedPlanPosition: true,
      isConfirmedForSelectedPlanPosition: false,
      scheduledPlanPersonId: "pp-pending",
      selectedPlanAssignmentLabels: ["Band - Vocals"],
      schedulingPreferences: null,
    });
  });

  it("reads scheduling preferences from the position's assignments and ranks by them", async () => {
    const teamId = "team-1";
    const positionId = "pos-1";
    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [
          {
            ...assignment("a-weeks", "p-weeks"),
            attributes: {
              schedule_preference: "Choose Weeks",
              preferred_weeks: ["1", "3", "nine"],
            },
            relationships: {
              person: { data: { type: "Person", id: "p-weeks" } },
              time_preference_options: {
                data: [{ type: "TimePreferenceOption", id: "tpo-9am" }],
              },
            },
          },
          {
            ...assignment("a-any", "p-any"),
            attributes: {
              schedule_preference: "As often as needed",
              preferred_weeks: ["1", "2", "3", "4", "5"],
            },
          },
        ],
        included: [
          {
            ...person("p-weeks", "Wren", "Weeks"),
            attributes: {
              ...person("p-weeks", "Wren", "Weeks").attributes,
              preferred_max_plans_per_day: 1,
              preferred_max_plans_per_month: 2,
            },
          },
          person("p-any", "Avery", "Anytime"),
          teamPosition(positionId, "Guitar", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));

    // Sunday February 8, 2026: week 2 of the month.
    const result = await loadCandidates({
      serviceTypeId: "st-1",
      positionId,
      teamId,
      planId: "plan-target",
      date: "2026-02-08T17:00:00Z",
    });

    expect(mocks.getPeopleForTeamPosition).toHaveBeenCalledOnce();
    expect(result.map((row) => row.id)).toStrictEqual(["p-any", "p-weeks"]);
    expect(result[1]).toMatchObject({
      schedulingPreferences: {
        schedulePreference: "Choose Weeks",
        preferredWeeks: [1, 3],
        timePreferenceOptionIds: ["tpo-9am"],
        maxPlansPerDay: 1,
        maxPlansPerMonth: 2,
      },
      recommendationReasoning: [
        "No past services scheduled",
        "Prefers weeks 1 and 3 of the month",
        "Ranked lower: this plan is in week 2",
        "At most 2 plans a month; this plan fits",
      ],
    });
    expect(result[0]?.schedulingPreferences).toStrictEqual({
      schedulePreference: "As often as needed",
      preferredWeeks: [],
      timePreferenceOptionIds: [],
      maxPlansPerDay: null,
      maxPlansPerMonth: null,
    });
  });

  it("does not add unassigned people who are scheduled elsewhere on the selected plan", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-lead-guitar";
    const planId = "plan-target";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a-lead", "p-lead")],
        included: [
          person("p-lead", "Lead", "Candidate"),
          teamPosition(positionId, "Lead Guitar", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planMemberEntry({
            id: "pp-vocals",
            personId: "p-vocals",
            planId,
            teamId,
            status: "U",
            teamPositionName: "Vocals",
          }),
        ],
        included: [person("p-vocals", "Vocal", "Only"), team(teamId, "Band")],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({ data: [], included: [] })
    );

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date: "2026-02-22",
    });

    expect(result.map((row) => row.id)).toStrictEqual(["p-lead"]);
  });

  it("matches selected plan when plan_person team_position_name is unprefixed (position only)", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-1";
    const planId = "plan-target";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a1", "p1")],
        included: [
          person("p1", "Una", "Prefixed"),
          teamPosition(positionId, "Vocals", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({
        data: [
          scheduleEntry({
            id: "pp1",
            planId,
            teamId,
            status: "U",
            teamPositionName: "Vocals",
          }),
        ],
        included: [],
      })
    );

    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planMemberEntry({
            id: "pp1",
            personId: "p1",
            planId,
            teamId,
            status: "U",
            teamPositionName: "Vocals",
          }),
        ],
        included: [person("p1", "Una", "Prefixed"), team(teamId, "Band")],
      })
    );

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date: "2026-02-22",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      isScheduledForSelectedPlanPosition: true,
      isConfirmedForSelectedPlanPosition: false,
    });
  });

  it("does not mark selected plan scheduled when schedule team_name does not match selected team", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const otherTeamId = "team-2";
    const positionId = "pos-1";
    const planId = "plan-target";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a1", "p1")],
        included: [
          person("p1", "Team", "Mismatch"),
          teamPosition(positionId, "Vocals", teamId),
          team(teamId, "Band"),
          team(otherTeamId, "Choir"),
        ],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({
        data: [
          scheduleEntry({
            id: "pp1",
            planId,
            teamId,
            status: "U",
            teamName: "Choir",
            teamPositionName: "Vocals",
          }),
        ],
        included: [],
      })
    );

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date: "2026-02-22",
    });

    expect(result[0]).toMatchObject({
      isScheduledForSelectedPlanPosition: false,
    });
    expect(result[0]?.scheduledPlanPersonId).toBeUndefined();
  });

  it("reads empty-window history from the person's schedules starting 28 days before the plan", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-bass";
    const planEasterId = "plan-easter-am";
    const personId = "p-michael";
    const easterSortDay = "2026-04-05";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a-michael", personId)],
        included: [
          person(personId, "Michael", "Bortis"),
          teamPosition(positionId, "Bass Guitar", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({
        data: [
          scheduleEntry({
            id: "pp-from-schedules",
            planId: planEasterId,
            teamId,
            status: "C",
            teamPositionName: "Band - Bass Guitar",
            sortDate: easterSortDay,
          }),
        ],
        included: [],
      })
    );

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId: planEasterId,
      date: easterSortDay,
    });

    // Without a filter Planning Center returns only upcoming schedules, so past services
    // never counted; `after` from the window start makes them visible.
    expect(mocks.getPersonSchedules.mock.calls).toStrictEqual([
      [personId, "2026-03-08"],
    ]);
    const [personRow] = result;
    if (!personRow?.serviceHistory || !personRow.frequency) {
      throw new Error("Expected service history and frequency");
    }
    const historyRow = personRow.serviceHistory.find(
      (h) => h.teamPositionName === "Band - Bass Guitar"
    );
    expect({
      resultLength: result.length,
      hasHistoryRow: historyRow !== undefined,
      hasServed: personRow.frequency.totalServed >= 1,
      servedRecently: personRow.frequency.recentServedDays >= 1,
    }).toStrictEqual({
      resultLength: 1,
      hasHistoryRow: true,
      hasServed: true,
      servedRecently: true,
    });
  });

  it("does not mark blocked from recurring blockout parent range alone (needs blockout_dates)", async () => {
    const serviceTypeId = "st-1";
    const teamId = "team-1";
    const positionId = "pos-1";
    const planId = "plan-target";
    const planSortDay = "2026-04-13";

    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a1", "p1")],
        included: [
          person("p1", "Pat", "Person"),
          teamPosition(positionId, "Vocals", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(
      Effect.succeed([
        recurringWeeklyBlockout(
          "b-weekly",
          "2026-01-01T00:00:00.000Z",
          "2026-12-31T23:59:59.000Z"
        ),
      ])
    );
    mocks.getPersonBlockoutDates.mockReturnValue(Effect.succeed([]));
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({
        data: [],
        included: [],
      })
    );

    const result = await loadCandidates({
      serviceTypeId,
      positionId,
      teamId,
      planId,
      date: planSortDay,
    });

    expect(result).toHaveLength(1);
    expect(mocks.getPersonBlockoutDates).toHaveBeenCalledWith("p1", "b-weekly");
    expect(result[0]).toMatchObject({ isBlockedForDate: false });
  });

  it("marks a recurring blockout only on its generated date", async () => {
    const teamId = "team-1";
    const positionId = "pos-1";
    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a1", "p1")],
        included: [
          person("p1", "Pat", "Person"),
          teamPosition(positionId, "Vocals", teamId),
          team(teamId, "Band"),
        ],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(
      Effect.succeed([
        recurringWeeklyBlockout(
          "b-weekly",
          "2026-01-01T00:00:00.000Z",
          "2026-12-31T23:59:59.000Z"
        ),
      ])
    );
    mocks.getPersonBlockoutDates.mockReturnValue(
      Effect.succeed([
        blockout(
          "d-apr-13",
          "2026-04-13T00:00:00.000Z",
          "2026-04-13T23:59:59.000Z"
        ),
      ])
    );
    mocks.getPersonSchedules.mockReturnValue(
      Effect.succeed({ data: [], included: [] })
    );

    const result = await loadCandidates({
      serviceTypeId: "st-1",
      positionId,
      teamId,
      planId: "plan-target",
      date: "2026-04-13",
    });

    expect(result[0]).toMatchObject({ isBlockedForDate: true });
  });

  const singleCandidate = (personId = "p1") => {
    mocks.getPeopleForTeamPosition.mockReturnValue(
      Effect.succeed({
        data: [assignment("a1", personId)],
        included: [
          person(personId, "Pat", "Person"),
          teamPosition("pos-1", "Vocals", "team-1"),
          team("team-1", "Band"),
        ],
      })
    );
  };

  const readCandidates = async (date: string, planId = "plan-target") =>
    await loadCandidates({
      serviceTypeId: "st-1",
      positionId: "pos-1",
      teamId: "team-1",
      planId,
      date,
    });

  it("compares blockouts by calendar day in the blockout's own time zone", async () => {
    singleCandidate();
    mocks.resolveTimeZone.mockReturnValue("America/Los_Angeles");
    // Saturday Sept 26 all day in Los Angeles; it ends at 06:59 UTC on the 27th.
    mocks.getPersonBlockouts.mockReturnValue(
      Effect.succeed([
        laBlockout(
          "b-saturday",
          "2026-09-26T07:00:00Z",
          "2026-09-27T06:59:59Z"
        ),
      ])
    );

    const saturdayEvening = await readCandidates("2026-09-27T01:00:00Z");
    const sundayMorning = await readCandidates("2026-09-27T17:00:00Z");

    expect(saturdayEvening[0]).toMatchObject({
      isBlockedForDate: true,
      availability: "blocked",
    });
    expect(sundayMorning[0]).toMatchObject({
      isBlockedForDate: false,
      availability: "available",
    });
  });

  it("skips dates of repeating blockouts that ended before the plan and keeps the rest", async () => {
    singleCandidate();
    mocks.resolveTimeZone.mockReturnValue("America/Los_Angeles");
    const weekly = { repeat_frequency: "every_1", repeat_period: "weekly" };
    mocks.getPersonBlockouts.mockReturnValue(
      Effect.succeed([
        laBlockout("b-ended", "2021-02-04T08:00:00Z", "2021-02-05T07:59:59Z", {
          ...weekly,
          repeat_until: "2021-05-20",
        }),
        laBlockout(
          "b-last-day",
          "2026-09-05T07:00:00Z",
          "2026-09-06T06:59:59Z",
          {
            ...weekly,
            repeat_until: "2026-09-26",
          }
        ),
        laBlockout("b-open", "2026-01-03T08:00:00Z", "2026-01-04T07:59:59Z", {
          ...weekly,
        }),
      ])
    );
    mocks.getPersonBlockoutDates.mockImplementation(
      (_personId: string, blockoutId: string) =>
        Effect.succeed(
          blockoutId === "b-last-day"
            ? [
                laBlockout(
                  "d-sep-26",
                  "2026-09-26T07:00:00Z",
                  "2026-09-27T06:59:59Z"
                ),
              ]
            : []
        )
    );

    const result = await readCandidates("2026-09-27T01:00:00Z");

    expect(
      mocks.getPersonBlockoutDates.mock.calls.map(([, id]) => id).toSorted()
    ).toStrictEqual(["b-last-day", "b-open"]);
    expect(result[0]).toMatchObject({ isBlockedForDate: true });
  });

  it("reads the selected plan's roster fresh while reusing the window's cached roster", async () => {
    singleCandidate();
    mocks.getPlanRange.mockReturnValue(
      Effect.succeed({
        data: [planEntry("plan-target", "2026-02-22")],
        included: [],
      })
    );
    const rosterWith = (status: string) => ({
      data: [
        planMemberEntry({
          id: "pp-target",
          personId: "p1",
          planId: "plan-target",
          teamId: "team-1",
          status,
          teamPositionName: "Band - Vocals",
        }),
      ],
      included: [person("p1", "Pat", "Person"), team("team-1", "Band")],
    });
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    mocks.getPlanTeamMembers.mockReturnValue(Effect.succeed(rosterWith("U")));

    const before = await readCandidates("2026-02-22");
    mocks.getPlanTeamMembers.mockReturnValue(Effect.succeed(rosterWith("C")));
    const after = await readCandidates("2026-02-22");

    // Each load reads the window's roster through the people service's cache; the fake has
    // none, so both loads read it. What matters is that the fresh read is separate.
    expect(
      mocks.getPlanTeamMembers.mock.calls.length -
        mocks.getPlanWindowRoster.mock.calls.length
    ).toBe(2);
    expect(before[0]).toMatchObject({
      isScheduledForSelectedPlanPosition: true,
      isConfirmedForSelectedPlanPosition: false,
    });
    expect(after[0]).toMatchObject({
      isScheduledForSelectedPlanPosition: true,
      isConfirmedForSelectedPlanPosition: true,
    });
  });

  it("fails instead of falling back when the fresh selected-plan read fails", async () => {
    singleCandidate();
    mocks.getPlanRange.mockReturnValue(
      Effect.succeed({
        data: [planEntry("plan-target", "2026-02-22")],
        included: [],
      })
    );
    mocks.getPersonBlockouts.mockReturnValue(Effect.succeed([]));
    const unavailable = new PlanningCenterApiError({
      message: "Unavailable",
      status: 503,
      code: "UPSTREAM",
    });
    mocks.getPlanTeamMembers.mockReturnValue(Effect.fail(unavailable));
    mocks.getPlanWindowRoster.mockReturnValue(
      Effect.succeed({ data: [], included: [] })
    );

    // The browser retries the call; a stale roster must not pass for the fresh one.
    await expect(readCandidates("2026-02-22")).rejects.toBe(unavailable);
  });
});

describe(isSettledPlan, () => {
  const la = "America/Los_Angeles";
  const plan = planSortedAt;
  const planTime = servicePlanTime;

  it("settles a plan only after its last time's org calendar day", () => {
    // 2026-09-24T02:00Z is still Sept 23 in Los Angeles.
    expect(
      isSettledPlan(plan("2026-09-24T02:00:00Z"), [], "2026-09-24", la)
    ).toBeTruthy();
    expect(
      isSettledPlan(plan("2026-09-24T08:00:00Z"), [], "2026-09-24", la)
    ).toBeFalsy();
    expect(
      isSettledPlan(
        plan("2026-09-20T17:00:00Z"),
        [planTime("2026-09-24T17:00:00Z")],
        "2026-09-24",
        la
      )
    ).toBeFalsy();
    expect(isSettledPlan(plan(null), [], "2026-09-24", la)).toBeFalsy();
  });
});
