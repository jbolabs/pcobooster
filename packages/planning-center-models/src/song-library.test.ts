import { describe, expect, it } from "vitest";

import {
  songHistoryCountLabel,
  describeKeyChange,
  formatCompactAgo,
  previousSongBefore,
  songHistoryNote,
  songPreviewFacts,
  summarizeSongHistory,
} from "./song-library";
import type { SongHistoryFact } from "./song-library";
import type { PlanItem } from "./types";

const item = (
  id: string,
  itemType: PlanItem["itemType"],
  keys: { start?: string; end?: string } = {}
): PlanItem => ({
  id,
  title: id,
  itemType,
  sequence: 0,
  servicePosition: "during",
  length: null,
  description: "",
  htmlDetails: "",
  customArrangementSequence: [],
  song: null,
  arrangement: null,
  key:
    keys.start === undefined
      ? null
      : {
          id: `key-${id}`,
          name: keys.start,
          startingKey: keys.start,
          endingKey: keys.end ?? null,
        },
  layout: null,
});

describe(previousSongBefore, () => {
  const items = [
    item("set", "header"),
    item("egypt", "song", { start: "Eb", end: "F" }),
    item("prayer", "item"),
    item("sermon", "header"),
    item("response", "item"),
  ];

  it("finds the song before the insertion point, past plain items", () => {
    expect(previousSongBefore(items, "prayer")).toStrictEqual({
      title: "egypt",
      endKey: "F",
    });
  });

  it("stops at a header, since a new section starts fresh", () => {
    expect(previousSongBefore(items, "response")).toBeNull();
    expect(previousSongBefore(items, null)).toBeNull();
    expect(previousSongBefore(items, "set")).toBeNull();
  });
});

describe(describeKeyChange, () => {
  it("names the change without judging it", () => {
    expect(describeKeyChange("Eb", "Eb")).toBe("same key");
    expect(describeKeyChange("Eb", "F")).toBe("up a whole step");
    expect(describeKeyChange("Eb", "Bb")).toBe("down a 4th");
    expect(describeKeyChange("C", "F#")).toBe("a tritone away");
  });

  it("names changes of mode", () => {
    expect(describeKeyChange("G", "Em")).toBe("relative minor");
    expect(describeKeyChange("Em", "G")).toBe("relative major");
    expect(describeKeyChange("D", "Dm")).toBe("parallel minor");
    expect(describeKeyChange("C", "Dm")).toBe("up a whole step, to minor");
  });

  it("returns null when a key can't be read", () => {
    expect(describeKeyChange("Eb", "Worship")).toBeNull();
  });
});

describe(formatCompactAgo, () => {
  const reference = new Date("2026-10-05T17:00:00Z");

  it("steps from days to weeks, months, and years", () => {
    expect(formatCompactAgo(new Date("2026-10-02T17:00:00Z"), reference)).toBe(
      "3d"
    );
    expect(formatCompactAgo(new Date("2026-09-07T17:00:00Z"), reference)).toBe(
      "4w"
    );
    expect(formatCompactAgo(new Date("2026-05-05T17:00:00Z"), reference)).toBe(
      "5mo"
    );
    expect(formatCompactAgo(new Date("2024-09-01T17:00:00Z"), reference)).toBe(
      "2y"
    );
  });
});

const entry = (
  day: string,
  serviceTypeId: string,
  startingKey: string | null
): SongHistoryFact => ({
  planId: `plan-${day}`,
  serviceTypeId,
  sortDate: new Date(`${day}T17:00:00Z`),
  startingKey,
});

describe(summarizeSongHistory, () => {
  it("counts from the plan's date, leaving the plan itself out", () => {
    const summary = summarizeSongHistory(
      [
        entry("2026-10-18", "agape", "G"),
        entry("2026-10-11", "agape", "G"),
        entry("2026-10-04", "youth", "E"),
        entry("2026-09-27", "youth", "F"),
        entry("2026-08-02", "agape", "G"),
        entry("2026-07-05", "youth", null),
      ],
      new Date("2026-10-04T17:00:00Z"),
      "youth"
    );

    expect(summary).toStrictEqual({
      last: entry("2026-09-27", "youth", "F"),
      next: entry("2026-10-11", "agape", "G"),
      timesThisYear: 3,
      timesHere: 2,
      keys: ["G", "E", "F"],
    });
  });
});

describe(songHistoryNote, () => {
  it("marks the plan being built and plans after its date", () => {
    const planDate = new Date("2026-10-11T17:00:00Z");
    expect([
      songHistoryNote(
        entry("2026-10-11", "agape", "G"),
        "plan-2026-10-11",
        planDate
      ),
      songHistoryNote(
        entry("2026-10-18", "agape", "G"),
        "plan-2026-10-11",
        planDate
      ),
      songHistoryNote(
        entry("2026-10-04", "agape", "G"),
        "plan-2026-10-11",
        planDate
      ),
      songHistoryNote(
        { ...entry("2026-10-11", "agape", "G"), planId: null },
        null,
        planDate
      ),
    ]).toStrictEqual(["this plan", "later", null, null]);
  });
});

describe(songHistoryCountLabel, () => {
  it("counts the past year, then the plan's service type by name", () => {
    expect(
      songHistoryCountLabel({ timesThisYear: 4, timesHere: 2 }, "Youth", false)
    ).toBe("Sung 4 times in the past year · 2 at Youth");
    expect(
      songHistoryCountLabel({ timesThisYear: 1, timesHere: 0 }, "Youth", false)
    ).toBe("Sung once in the past year · 0 at Youth");
  });

  it("leaves out the service type when its name is unknown", () => {
    expect(
      songHistoryCountLabel({ timesThisYear: 3, timesHere: 1 }, null, false)
    ).toBe("Sung 3 times in the past year");
  });

  it("counts a history cut off at its page as a floor", () => {
    expect(
      songHistoryCountLabel({ timesThisYear: 97, timesHere: 40 }, "Youth", true)
    ).toBe("Sung 97+ times in the past year · 40 at Youth");
  });

  it("says when the song wasn't sung in the past year", () => {
    expect(
      songHistoryCountLabel({ timesThisYear: 0, timesHere: 0 }, "Youth", false)
    ).toBe("Not sung in the past year");
  });
});

describe(songPreviewFacts, () => {
  const arrangement = {
    id: "arr-1",
    name: "Default",
    sequence: [],
    length: 333,
    bpm: 72,
    meter: "4/4",
    archived: false,
    keys: [
      { id: "k-1", name: "G", startingKey: "G", endingKey: null },
      { id: "k-2", name: "A", startingKey: "A", endingKey: null },
    ],
  };

  it("falls back to arrangement keys when the song has no history", () => {
    const facts = songPreviewFacts({
      history: [],
      arrangements: [arrangement],
      serviceTypeId: "youth",
      previousSong: { title: "Egypt", endKey: "Eb" },
      planDate: new Date("2026-10-05T17:00:00Z"),
    });

    expect(facts).toMatchObject({
      keys: ["G", "A"],
      tempos: ["72 bpm · 4/4"],
      keyChange: { key: "G", change: "up a major 3rd" },
    });
  });

  it("prefers the keys it was sung in and skips archived arrangements", () => {
    const facts = songPreviewFacts({
      history: [entry("2026-09-27", "youth", "F")],
      arrangements: [{ ...arrangement, archived: true }],
      serviceTypeId: "youth",
      previousSong: null,
      planDate: new Date("2026-10-05T17:00:00Z"),
    });

    expect(facts.keys).toStrictEqual(["F"]);
    expect(facts.tempos).toStrictEqual([]);
    expect(facts.keyChange).toBeNull();
  });
});
