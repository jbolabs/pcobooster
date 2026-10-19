import {
  getSongHistory,
  toSongHistory,
} from "@pcobooster/api/modules/planning-center/song-history";
import type { SongHistoryDependencies } from "@pcobooster/api/modules/planning-center/song-history";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const schedule = (
  planId: string,
  sortDate: string | null,
  keyName: string | null,
  serviceTypeName = "Agape Worship Services"
): PCResource => ({
  id: `schedule-${planId}`,
  type: "SongSchedule",
  attributes: {
    plan_sort_date: sortDate,
    key_name: keyName,
    service_type_name: serviceTypeName,
    arrangement_name: "Default",
  },
  relationships: {
    plan: { data: { type: "Plan", id: planId } },
    service_type: { data: { type: "ServiceType", id: "st-1" } },
  },
});

describe(toSongHistory, () => {
  it("reads each plan newest first, with the key it started in", () => {
    const history = toSongHistory([
      schedule("older", "2026-08-02T17:00:00Z", "Bb"),
      schedule("newer", "2026-09-27T17:00:00Z", "F: (highest note C)", "Youth"),
      schedule("undated", null, "G"),
    ]);

    expect(history).toStrictEqual([
      {
        planId: "newer",
        serviceTypeId: "st-1",
        serviceTypeName: "Youth",
        sortDate: new Date("2026-09-27T17:00:00Z"),
        keyName: "F: (highest note C)",
        startingKey: "F",
        arrangementName: "Default",
      },
      {
        planId: "older",
        serviceTypeId: "st-1",
        serviceTypeName: "Agape Worship Services",
        sortDate: new Date("2026-08-02T17:00:00Z"),
        keyName: "Bb",
        startingKey: "Bb",
        arrangementName: "Default",
      },
    ]);
  });

  it("reads minor keys and leaves labels that don't start with a key", () => {
    const [minor, custom, none] = toSongHistory([
      schedule("a", "2026-09-27T17:00:00Z", "C#m - E"),
      schedule("b", "2026-09-20T17:00:00Z", "Choir key"),
      schedule("c", "2026-09-13T17:00:00Z", null),
    ]);

    expect(minor?.startingKey).toBe("C#m");
    expect(custom?.startingKey).toBeNull();
    expect(none?.keyName).toBeNull();
  });
});

describe(getSongHistory, () => {
  it("asks for a year back from today in the org's calendar", async () => {
    const getSongSchedules = vi.fn<
      SongHistoryDependencies["songs"]["getSongSchedules"]
    >(() => Effect.succeed({ data: [], truncated: false }));

    // 7 PM in Los Angeles on Sep 28 is already Sep 29 in UTC.
    await Effect.runPromise(
      getSongHistory("song-1", new Date("2026-09-29T02:00:00Z"), {
        songs: { getSongSchedules },
        resolveTimeZone: Effect.succeed("America/Los_Angeles"),
      })
    );

    expect(getSongSchedules).toHaveBeenCalledExactlyOnceWith(
      "song-1",
      "2025-09-28"
    );
  });

  it("says when Planning Center had more plans than the page read", async () => {
    const history = await Effect.runPromise(
      getSongHistory("song-1", new Date("2026-09-29T02:00:00Z"), {
        songs: {
          getSongSchedules: () =>
            Effect.succeed({
              data: [schedule("p1", "2026-09-27T17:00:00Z", "G")],
              truncated: true,
            }),
        },
        resolveTimeZone: Effect.succeed("America/Los_Angeles"),
      })
    );

    expect({
      plans: history.entries.map((entry) => entry.planId),
      truncated: history.truncated,
    }).toStrictEqual({ plans: ["p1"], truncated: true });
  });
});
