import {
  buildReadinessChecks,
  formatDuration,
  formatTimeOfDay,
  keyOptionLabelOf,
  keyOptionPartsOf,
  summarizeOrder,
  summarizeStaffing,
  summarizeTimes,
} from "@pcobooster/planning-center-models/plan-overview";
import type {
  PlanItem,
  PlanTime,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import { describe, expect, it } from "vitest";

const band: TeamPositionGroup = {
  teamId: "band",
  teamName: "Band",
  positions: [
    {
      id: "keys",
      name: "Keys",
      teamId: "band",
      source: "team_position",
      neededCount: 0,
      filledConfirmedCount: 1,
      filledPendingCount: 0,
    },
    {
      id: "drums",
      name: "Drums",
      teamId: "band",
      source: "needed_position",
      neededCount: 2,
      filledConfirmedCount: 0,
      filledPendingCount: 1,
      filledPeople: [
        {
          id: "person-1",
          planPersonId: "plan-person-1",
          personId: "person-1",
          name: "Ben Singer",
          status: "pending",
          rawStatus: "U",
          notification: { prepared: true, sentAt: null, senderName: null },
        },
      ],
    },
  ],
};

const unusedTeam: TeamPositionGroup = {
  teamId: "tech",
  teamName: "Tech",
  positions: [
    { id: "lights", name: "Lights", teamId: "tech", source: "custom" },
  ],
};

const planItem = (overrides: Partial<PlanItem>): PlanItem => ({
  id: "item",
  title: "Item",
  itemType: "item",
  sequence: 1,
  servicePosition: "during",
  length: null,
  description: "",
  htmlDetails: "",
  customArrangementSequence: [],
  song: null,
  arrangement: null,
  key: null,
  layout: null,
  ...overrides,
});

const songItem = (
  id: string,
  sequence: number,
  key: PlanItem["key"],
  length: number | null = null
) =>
  planItem({
    id,
    title: `Item ${id}`,
    itemType: "song",
    sequence,
    length,
    key,
    song: {
      id: `song-${id}`,
      title: `Song ${id}`,
      author: "",
      themes: "",
      lastScheduledAt: null,
    },
  });

const planTime = (
  id: string,
  timeType: PlanTime["timeType"],
  startsAt: string
): PlanTime => ({
  id,
  name: "",
  startsAt: new Date(startsAt),
  endsAt: null,
  timeType,
  teamReminders: null,
  assignedTeamIds: [],
  assignedPositionIds: [],
  splitTeamRehearsalAssignmentIds: [],
});

describe(summarizeStaffing, () => {
  it("counts filled and open slots per team and lists open positions", () => {
    expect(summarizeStaffing([band, unusedTeam])).toStrictEqual({
      confirmed: 1,
      pending: 1,
      open: 2,
      total: 4,
      unnotified: 1,
      teams: [
        {
          teamId: "band",
          teamName: "Band",
          confirmed: 1,
          pending: 1,
          open: 2,
        },
      ],
      openPositions: [
        {
          teamId: "band",
          teamName: "Band",
          positionId: "drums",
          positionName: "Drums",
          source: "needed_position",
          openCount: 2,
        },
      ],
    });
  });
});

describe(summarizeOrder, () => {
  it("lists songs in order with their keys and times the service", () => {
    const order = summarizeOrder([
      songItem("b", 3, {
        id: "k2",
        name: "Default",
        startingKey: "G",
        endingKey: "A",
      }),
      planItem({ id: "welcome", sequence: 1, length: 120 }),
      planItem({
        id: "header",
        itemType: "header",
        sequence: 0,
        length: 999,
      }),
      songItem("a", 2, null, 300),
      planItem({
        id: "preroll",
        sequence: 0,
        servicePosition: "pre",
        length: 600,
      }),
    ]);

    expect(order.songs).toStrictEqual([
      {
        id: "a",
        songId: "song-a",
        arrangementId: null,
        title: "Song a",
        keyLabel: null,
        length: 300,
      },
      {
        id: "b",
        songId: "song-b",
        arrangementId: null,
        title: "Song b",
        keyLabel: "G to A",
        length: null,
      },
    ]);
    expect(order.songsWithoutKey).toBe(1);
    expect(order.serviceLength).toBe(420);
    expect(order.itemCount).toBe(4);
  });

  it("shows one key when the song ends where it starts", () => {
    const order = summarizeOrder([
      songItem("a", 1, { id: "k", name: "", startingKey: "D", endingKey: "D" }),
    ]);
    expect(order.songs[0]?.keyLabel).toBe("D");
  });
});

describe(summarizeTimes, () => {
  it("orders times and counts services and rehearsals", () => {
    const schedule = summarizeTimes([
      planTime("late", "service", "2026-09-27T18:00:00Z"),
      planTime("rehearsal", "rehearsal", "2026-09-24T02:00:00Z"),
      planTime("early", "service", "2026-09-27T16:00:00Z"),
      planTime("other", "other", "2026-09-27T15:00:00Z"),
    ]);
    expect(schedule.times.map((time) => time.id)).toStrictEqual([
      "rehearsal",
      "other",
      "early",
      "late",
    ]);
    expect(schedule.serviceCount).toBe(2);
    expect(schedule.rehearsalCount).toBe(1);
  });
});

describe(buildReadinessChecks, () => {
  it("lists what is left to do across the plan", () => {
    const checks = buildReadinessChecks({
      staffing: summarizeStaffing([band]),
      order: summarizeOrder([songItem("a", 1, null)]),
      schedule: summarizeTimes([]),
    });
    expect(
      checks.map(({ id, state, label, view }) => ({ id, state, label, view }))
    ).toStrictEqual([
      {
        id: "positions",
        state: "todo",
        label: "2 positions need someone",
        view: "assign",
      },
      {
        id: "notifications",
        state: "todo",
        label: "1 person hasn't been notified",
        view: "lineup",
      },
      {
        id: "responses",
        state: "todo",
        label: "1 person hasn't responded",
        view: "lineup",
      },
      { id: "songs", state: "done", label: "1 song planned", view: "plan" },
      { id: "keys", state: "todo", label: "1 song has no key", view: "plan" },
      { id: "times", state: "todo", label: "No service times", view: "times" },
    ]);
  });

  it("marks a fully staffed, confirmed plan as done", () => {
    const checks = buildReadinessChecks({
      staffing: summarizeStaffing([
        { ...band, positions: [band.positions[0]] },
      ]),
      order: null,
      schedule: summarizeTimes([
        planTime("s", "service", "2026-09-27T16:00:00Z"),
        planTime("r", "rehearsal", "2026-09-24T02:00:00Z"),
      ]),
    });
    expect(checks.map((check) => [check.state, check.label])).toStrictEqual([
      ["done", "Every position is filled"],
      ["done", "Everyone scheduled has confirmed"],
      ["done", "1 service time and 1 rehearsal"],
    ]);
  });

  it("says when no one is scheduled", () => {
    const checks = buildReadinessChecks({
      staffing: summarizeStaffing([unusedTeam]),
      order: summarizeOrder([]),
      schedule: null,
    });
    expect(checks.map((check) => [check.id, check.label])).toStrictEqual([
      ["positions", "No one is scheduled yet"],
      ["songs", "No songs yet"],
    ]);
  });
});

describe(formatDuration, () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3905)).toBe("1:05:05");
  });
});

describe(formatTimeOfDay, () => {
  it("formats in the organization's zone, not the host's", () => {
    // 02:00 UTC on Sept 24 is 7 PM on Sept 23 in Los Angeles.
    expect(
      formatTimeOfDay(new Date("2026-09-24T02:00:00Z"), "America/Los_Angeles")
    ).toBe("7:00 PM");
  });
});

const keyOption = (
  name: string,
  startingKey: string | null,
  endingKey = startingKey
) => ({
  id: "key-1",
  name,
  startingKey,
  endingKey,
});

describe(keyOptionPartsOf, () => {
  it("separates the key from whose key it is", () => {
    expect(
      keyOptionPartsOf(
        keyOption("Female lead (highest note is C# at bridge)", "D")
      )
    ).toStrictEqual({
      label: "D",
      description: "Female lead (highest note is C# at bridge)",
    });
    expect(keyOptionLabelOf(keyOption("Emily", "D"))).toBe("D: Emily");
  });

  it("drops a description that only repeats the key", () => {
    expect(keyOptionPartsOf(keyOption("Bb", "Bb"))).toStrictEqual({
      label: "Bb",
      description: null,
    });
    expect(keyOptionPartsOf(keyOption("G -> A", "G", "A"))).toStrictEqual({
      label: "G to A",
      description: null,
    });
    expect(keyOptionPartsOf(keyOption("Original", null))).toStrictEqual({
      label: "Original",
      description: null,
    });
  });
});
