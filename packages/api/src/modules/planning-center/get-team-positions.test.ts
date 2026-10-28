import { getNeededTeamPositionsForPlan } from "@pcobooster/api/modules/planning-center/get-team-positions";
import type { TeamPositionDependencies } from "@pcobooster/api/modules/planning-center/get-team-positions";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import { planningCenterBudgetFailures } from "@pcobooster/api/testing/planning-center-failures";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect, Exit } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createFixture = () => {
  const mocks = {
    getServiceTypeTeamPositionsWithTeams:
      vi.fn<
        TeamPositionDependencies["catalogService"]["getServiceTypeTeamPositionsWithTeams"]
      >(),
    getPlanNeededPositionsWithTeams:
      vi.fn<
        TeamPositionDependencies["catalogService"]["getPlanNeededPositionsWithTeams"]
      >(),
    getServiceTypePlanNeededPositionsWithTeams:
      vi.fn<
        TeamPositionDependencies["catalogService"]["getServiceTypePlanNeededPositionsWithTeams"]
      >(),
    getPlanTeamMembers:
      vi.fn<TeamPositionDependencies["peopleService"]["getPlanTeamMembers"]>(),
    getPlanForServiceTypeWithSeries:
      vi.fn<
        TeamPositionDependencies["plansService"]["getPlanForServiceTypeWithSeries"]
      >(),
  };
  const dependencies = {
    catalogService: {
      getServiceTypeTeamPositionsWithTeams:
        mocks.getServiceTypeTeamPositionsWithTeams,
      getPlanNeededPositionsWithTeams: mocks.getPlanNeededPositionsWithTeams,
      getServiceTypePlanNeededPositionsWithTeams:
        mocks.getServiceTypePlanNeededPositionsWithTeams,
    },
    peopleService: { getPlanTeamMembers: mocks.getPlanTeamMembers },
    plansService: {
      getPlanForServiceTypeWithSeries: mocks.getPlanForServiceTypeWithSeries,
    },
  } satisfies TeamPositionDependencies;
  return { mocks, dependencies };
};

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
  teamId: string,
  name: string
): PCResource => ({
  type: "TeamPosition",
  id,
  attributes: { name },
  relationships: {
    team: {
      data: { type: "Team", id: teamId },
    },
  },
});

const neededPosition = (
  id: string,
  teamId: string,
  teamPositionName: string,
  quantity: number
): PCResource => ({
  type: "NeededPosition",
  id,
  attributes: { team_position_name: teamPositionName, quantity },
  relationships: {
    team: {
      data: { type: "Team", id: teamId },
    },
  },
});

const person = (
  id: string,
  firstName: string,
  lastName: string
): PCResource => ({
  type: "Person",
  id,
  attributes: {
    first_name: firstName,
    last_name: lastName,
    photo_url: null,
    photo_thumbnail_url: null,
    archived_at: null,
  },
});

const planTeamMember = (params: {
  id: string;
  teamId: string;
  teamPositionName: string;
  status: string;
  personId?: string;
  notification?: {
    prepare_notification: boolean;
    notification_sent_at: string | null;
    notification_sender_name: string | null;
  };
}): PCResource => ({
  type: "PlanPerson",
  id: params.id,
  attributes: {
    status: params.status,
    created_at: "2026-01-01T00:00:00Z",
    team_position_name: params.teamPositionName,
    ...params.notification,
  },
  relationships: {
    team: {
      data: { type: "Team", id: params.teamId },
    },
    ...(isNonEmptyString(params.personId)
      ? {
          person: {
            data: { type: "Person", id: params.personId },
          },
        }
      : undefined),
  },
});

describe(getNeededTeamPositionsForPlan, () => {
  let mocks: ReturnType<typeof createFixture>["mocks"];
  let dependencies: ReturnType<typeof createFixture>["dependencies"];

  beforeEach(() => {
    ({ mocks, dependencies } = createFixture());
    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({ data: [], included: [] })
    );
  });

  it("requests the plan's positions, needed positions, and roster", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [teamPosition("tp-1", "team-1", "Drums")],
        included: [team("team-1", "Band")],
      })
    );
    mocks.getPlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [neededPosition("np-1", "team-1", "Drums", 2)],
        included: [team("team-1", "Band")],
      })
    );
    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan("st-1", "plan-1", "series-1", dependencies)
    );

    expect(result).toMatchObject([
      {
        teamId: "team-1",
        teamName: "Band",
        positions: [{ id: "tp-1", name: "Drums", neededCount: 2 }],
      },
    ]);

    expect(mocks.getServiceTypeTeamPositionsWithTeams).toHaveBeenCalledWith(
      "st-1"
    );
    expect(mocks.getPlanNeededPositionsWithTeams).toHaveBeenCalledWith(
      "series-1",
      "plan-1"
    );
    expect(mocks.getPlanTeamMembers).toHaveBeenCalledWith("st-1", "plan-1");
  });

  it("falls back to service-type plan needed_positions for no-series plans and matches/dedupes", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [
          teamPosition("tp-band-vocals", "team-band", "Vocals"),
          teamPosition("tp-band-guitar", "team-band", "Guitar"),
          teamPosition("tp-media-slides", "team-media", "Slides"),
        ],
        included: [team("team-band", "Band"), team("team-media", "Media")],
      })
    );

    mocks.getServiceTypePlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [
          neededPosition("np-1", "team-band", "Vocals", 1),
          // Duplicate after normalization.
          neededPosition("np-2", "team-band", " vocals ", 2),
          // Ignored because quantity is zero.
          neededPosition("np-3", "team-band", "Guitar", 0),
          // No matching team position.
          neededPosition("np-4", "team-band", "Keys", 1),
          neededPosition("np-5", "team-media", "Slides", 1),
        ],
        included: [team("team-band", "Band"), team("team-media", "Media")],
      })
    );
    mocks.getPlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [],
        included: [],
      })
    );

    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan("st-1", "plan-1", undefined, dependencies)
    );

    expect(
      mocks.getServiceTypePlanNeededPositionsWithTeams
    ).toHaveBeenCalledWith("st-1", "plan-1");
    expect(mocks.getPlanForServiceTypeWithSeries).not.toHaveBeenCalled();
    expect(mocks.getPlanNeededPositionsWithTeams).not.toHaveBeenCalled();
    expect(result).toStrictEqual([
      {
        teamId: "team-band",
        teamName: "Band",
        positions: [
          {
            id: "needed-position:np-4",
            name: "Keys",
            teamId: "team-band",
            teamName: "Band",
            source: "needed_position",
            neededPositionId: "np-4",
            timeId: null,
            timePreferenceOptionId: null,
            neededCount: 1,
          },
          {
            id: "tp-band-vocals",
            name: "Vocals",
            teamId: "team-band",
            teamName: "Band",
            source: "team_position",
            neededPositionId: "np-1",
            timeId: null,
            timePreferenceOptionId: null,
            neededCount: 3,
          },
        ],
      },
      {
        teamId: "team-media",
        teamName: "Media",
        positions: [
          {
            id: "tp-media-slides",
            name: "Slides",
            teamId: "team-media",
            teamName: "Media",
            source: "team_position",
            neededPositionId: "np-5",
            timeId: null,
            timePreferenceOptionId: null,
            neededCount: 1,
          },
        ],
      },
    ]);
  });

  it("leaves a position Planning Center sent without a team out of every team", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [
          teamPosition("tp-band-vocals", "team-band", "Vocals"),
          {
            type: "TeamPosition",
            id: "tp-unlinked",
            attributes: { name: "Slides" },
            relationships: { team: { data: null } },
          },
        ],
        included: [team("team-band", "Band"), team("team-media", "Media")],
      })
    );
    mocks.getPlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [
          neededPosition("np-1", "team-band", "Vocals", 1),
          neededPosition("np-2", "team-band", "Slides", 1),
        ],
        included: [team("team-band", "Band")],
      })
    );

    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan("st-1", "plan-1", "series-1", dependencies)
    );

    expect(
      result.map(({ teamName, positions }) => [
        teamName,
        positions.map(({ id }) => id),
      ])
    ).toStrictEqual([["Band", ["needed-position:np-2", "tp-band-vocals"]]]);
  });

  it("uses provided seriesId and skips plan series resolution", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [teamPosition("tp-1", "team-1", "Drums")],
        included: [team("team-1", "Band")],
      })
    );
    mocks.getPlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [neededPosition("np-1", "team-1", "Drums", 1)],
        included: [team("team-1", "Band")],
      })
    );

    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan(
        "st-1",
        "plan-1",
        "series-123",
        dependencies
      )
    );

    expect(mocks.getPlanForServiceTypeWithSeries).not.toHaveBeenCalled();
    expect(mocks.getPlanNeededPositionsWithTeams).toHaveBeenCalledWith(
      "series-123",
      "plan-1"
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.positions[0]?.name).toBe("Drums");
  });

  it("falls back to series endpoint when service-type needed positions fails", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [teamPosition("tp-1", "team-1", "Drums")],
        included: [team("team-1", "Band")],
      })
    );
    mocks.getServiceTypePlanNeededPositionsWithTeams.mockReturnValue(
      Effect.fail(
        new PlanningCenterApiError({
          message: "Planning Center API error: 404",
          status: 404,
        })
      )
    );
    mocks.getPlanForServiceTypeWithSeries.mockReturnValue(
      Effect.succeed({
        data: {
          type: "Plan",
          id: "plan-1",
          attributes: { title: "Test", created_at: "2026-01-01T00:00:00Z" },
          relationships: {
            series: {
              data: { type: "Series", id: "series-1" },
            },
          },
        },
        included: [],
      })
    );
    mocks.getPlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [neededPosition("np-1", "team-1", "Drums", 1)],
        included: [team("team-1", "Band")],
      })
    );

    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan("st-1", "plan-1", undefined, dependencies)
    );

    expect(
      mocks.getServiceTypePlanNeededPositionsWithTeams
    ).toHaveBeenCalledWith("st-1", "plan-1");
    expect(mocks.getPlanForServiceTypeWithSeries).toHaveBeenCalledWith(
      "st-1",
      "plan-1"
    );
    expect(mocks.getPlanNeededPositionsWithTeams).toHaveBeenCalledWith(
      "series-1",
      "plan-1"
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.positions[0]?.name).toBe("Drums");
  });

  it.each(planningCenterBudgetFailures())(
    "fails with %s without trying the series fallback",
    async (failure) => {
      mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
        Effect.succeed({ data: [], included: [] })
      );
      mocks.getServiceTypePlanNeededPositionsWithTeams.mockReturnValue(
        Effect.fail(failure)
      );

      await expect(
        Effect.runPromiseExit(
          getNeededTeamPositionsForPlan(
            "st-1",
            "plan-1",
            undefined,
            dependencies
          )
        )
      ).resolves.toStrictEqual(Exit.fail(failure));
      expect(mocks.getPlanForServiceTypeWithSeries).not.toHaveBeenCalled();
    }
  );

  it("adds confirmed and pending fill summaries with people names", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [
          teamPosition("tp-vocals", "team-band", "Vocals"),
          teamPosition("tp-guitar", "team-band", "Guitar"),
        ],
        included: [team("team-band", "Band")],
      })
    );
    mocks.getServiceTypePlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [
          neededPosition("np-vocals", "team-band", "Vocals", 1),
          neededPosition("np-guitar", "team-band", "Guitar", 1),
        ],
        included: [team("team-band", "Band")],
      })
    );
    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planTeamMember({
            id: "pp-confirmed",
            teamId: "team-band",
            teamPositionName: "Vocals",
            status: "C",
            personId: "person-1",
            notification: {
              prepare_notification: false,
              notification_sent_at: "2026-01-02T15:00:00Z",
              notification_sender_name: "Sam Scheduler",
            },
          }),
          planTeamMember({
            id: "pp-pending",
            teamId: "team-band",
            teamPositionName: "Vocals",
            status: "U",
            personId: "person-2",
            notification: {
              prepare_notification: true,
              notification_sent_at: null,
              notification_sender_name: null,
            },
          }),
          planTeamMember({
            id: "pp-declined",
            teamId: "team-band",
            teamPositionName: "Vocals",
            status: "declined",
            personId: "person-3",
          }),
        ],
        included: [
          team("team-band", "Band"),
          person("person-1", "Amy", "Leader"),
          person("person-2", "Ben", "Singer"),
          person("person-3", "Cara", "Nope"),
        ],
      })
    );

    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan("st-1", "plan-1", undefined, dependencies)
    );
    const vocals = result[0]?.positions.find((p) => p.name === "Vocals");

    expect(vocals?.filledConfirmedCount).toBe(1);
    expect(vocals?.filledPendingCount).toBe(1);
    expect(vocals?.filledPeople).toStrictEqual([
      {
        id: "person-1",
        planPersonId: "pp-confirmed",
        personId: "person-1",
        name: "Amy Leader",
        status: "confirmed",
        rawStatus: "C",
        photoThumbnailUrl: null,
        assignedTimeIds: [],
        serviceTimeIds: [],
        notification: {
          prepared: false,
          sentAt: "2026-01-02T15:00:00Z",
          senderName: "Sam Scheduler",
        },
      },
      {
        id: "person-2",
        planPersonId: "pp-pending",
        personId: "person-2",
        name: "Ben Singer",
        status: "pending",
        rawStatus: "U",
        photoThumbnailUrl: null,
        assignedTimeIds: [],
        serviceTimeIds: [],
        notification: { prepared: true, sentAt: null, senderName: null },
      },
    ]);
  });

  it("keeps needed count independent and falls back to unknown person when include is missing", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [teamPosition("tp-1", "team-1", "Drums")],
        included: [team("team-1", "Band")],
      })
    );
    mocks.getServiceTypePlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [neededPosition("np-1", "team-1", "Drums", 1)],
        included: [team("team-1", "Band")],
      })
    );
    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planTeamMember({
            id: "pp-1",
            teamId: "team-1",
            teamPositionName: "Drums",
            status: "confirmed",
          }),
          planTeamMember({
            id: "pp-2",
            teamId: "team-1",
            teamPositionName: "Drums",
            status: "U",
          }),
        ],
        included: [team("team-1", "Band")],
      })
    );

    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan("st-1", "plan-1", undefined, dependencies)
    );
    const drums = result[0]?.positions[0];

    expect(drums?.neededCount).toBe(1);
    expect(drums?.filledConfirmedCount).toBe(1);
    expect(drums?.filledPendingCount).toBe(1);
    expect(drums?.filledPeople?.[0]?.name).toBe("Unknown person");
  });

  it("adds filled plan-member-only positions that are not in service type team positions", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [teamPosition("tp-leader-am", "team-leaders", "Leader-Am")],
        included: [team("team-leaders", "Leaders and Pastor")],
      })
    );
    mocks.getServiceTypePlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [],
        included: [],
      })
    );
    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planTeamMember({
            id: "pp-youth",
            teamId: "team-leaders",
            teamPositionName: "Youth Leader-Am",
            status: "C",
            personId: "person-1",
          }),
        ],
        included: [
          team("team-leaders", "Leaders and Pastor"),
          person("person-1", "Jake", "Bodea"),
        ],
      })
    );

    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan("st-1", "plan-1", undefined, dependencies)
    );

    expect(result).toStrictEqual([
      {
        teamId: "team-leaders",
        teamName: "Leaders and Pastor",
        positions: [
          {
            id: "plan-member-position:team-leaders:youth%20leader-am",
            name: "Youth Leader-Am",
            teamId: "team-leaders",
            teamName: "Leaders and Pastor",
            source: "plan_member",
            neededCount: 0,
            filledConfirmedCount: 1,
            filledPeople: [
              {
                id: "person-1",
                planPersonId: "pp-youth",
                personId: "person-1",
                name: "Jake Bodea",
                status: "confirmed",
                rawStatus: "C",
                photoThumbnailUrl: null,
                assignedTimeIds: [],
                serviceTimeIds: [],
                notification: null,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("keeps multiple people in the same plan-member-only position", async () => {
    mocks.getServiceTypeTeamPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [teamPosition("tp-leader-am", "team-leaders", "Leader-Am")],
        included: [team("team-leaders", "Leaders and Pastor")],
      })
    );
    mocks.getServiceTypePlanNeededPositionsWithTeams.mockReturnValue(
      Effect.succeed({
        data: [],
        included: [],
      })
    );
    mocks.getPlanTeamMembers.mockReturnValue(
      Effect.succeed({
        data: [
          planTeamMember({
            id: "pp-jake",
            teamId: "team-leaders",
            teamPositionName: "Youth Leader-Am",
            status: "C",
            personId: "person-1",
          }),
          planTeamMember({
            id: "pp-casey",
            teamId: "team-leaders",
            teamPositionName: "Youth Leader-Am",
            status: "U",
            personId: "person-2",
          }),
        ],
        included: [
          team("team-leaders", "Leaders and Pastor"),
          person("person-1", "Jake", "Bodea"),
          person("person-2", "Casey", "Smith"),
        ],
      })
    );

    const result = await Effect.runPromise(
      getNeededTeamPositionsForPlan("st-1", "plan-1", undefined, dependencies)
    );
    const youthLeader = result[0]?.positions[0];

    expect(youthLeader?.filledConfirmedCount).toBe(1);
    expect(youthLeader?.filledPendingCount).toBe(1);
    expect(youthLeader?.filledPeople?.map((entry) => entry.name)).toStrictEqual(
      ["Jake Bodea", "Casey Smith"]
    );
  });
});
