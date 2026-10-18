import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import type {
  PlanItem,
  PlanItemType,
} from "@pcobooster/planning-center-models/types";
import { describe, expect, it } from "vitest";

import {
  adjacentStep,
  formatPlaybackTime,
  nextLoop,
  playedSequence,
  practiceFiles,
  practiceSetlist,
  resolvePracticeItem,
  stepPosition,
  stepTextSize,
  withSongPractice,
} from "@/lib/practice";

const item = (
  id: string,
  itemType: PlanItemType,
  overrides: Partial<PlanItem> = {}
): PlanItem => ({
  id,
  title: `Item ${id}`,
  itemType,
  sequence: Number(id),
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

/** Pre-service: a welcome. Worship: two songs around a prayer. Response: a video. */
const plan = [
  item("1", "header"),
  item("2", "item"),
  item("3", "header"),
  item("4", "song"),
  item("5", "item"),
  item("6", "song"),
  item("7", "header"),
  item("8", "header"),
  item("9", "media"),
];

const ids = (entries: readonly { readonly id: string }[]) =>
  entries.map(({ id }) => id);

describe(practiceSetlist, () => {
  it("groups items under their headers and drops empty headers", () => {
    expect(
      practiceSetlist([item("0", "item"), ...plan]).map((group) => [
        group.header?.id ?? null,
        ids(group.items),
      ])
    ).toStrictEqual([
      [null, ["0"]],
      ["1", ["2"]],
      ["3", ["4", "5", "6"]],
      ["8", ["9"]],
    ]);
  });
});

describe(resolvePracticeItem, () => {
  it("opens the item asked for, else the first song", () => {
    expect(resolvePracticeItem(plan, "5")?.id).toBe("5");
    expect(resolvePracticeItem(plan, "gone")?.id).toBe("4");
    expect(resolvePracticeItem(plan, "3")?.id).toBe("4");
    expect(resolvePracticeItem(plan)?.id).toBe("4");
  });

  it("falls back to any item, and to nothing for an empty plan", () => {
    expect(
      resolvePracticeItem([item("1", "header"), item("2", "item")])?.id
    ).toBe("2");
    expect(resolvePracticeItem([])).toBeNull();
  });
});

describe(adjacentStep, () => {
  it("steps over headers and plain items to songs and media", () => {
    const at = (id: string) => plan.find((entry) => entry.id === id) ?? plan[0];
    expect(adjacentStep(plan, at("4"), "next")?.id).toBe("6");
    expect(adjacentStep(plan, at("6"), "next")?.id).toBe("9");
    expect(adjacentStep(plan, at("6"), "previous")?.id).toBe("4");
    expect(adjacentStep(plan, at("5"), "previous")?.id).toBe("4");
    expect(adjacentStep(plan, at("2"), "next")?.id).toBe("4");
  });

  it("stops at either end", () => {
    const at = (id: string) => plan.find((entry) => entry.id === id) ?? plan[0];
    expect(adjacentStep(plan, at("9"), "next")).toBeNull();
    expect(adjacentStep(plan, at("4"), "previous")).toBeNull();
  });
});

describe(stepPosition, () => {
  it("counts songs and media only", () => {
    expect(stepPosition(plan, plan[5])).toStrictEqual({
      position: 2,
      total: 3,
    });
    expect(stepPosition(plan, plan[1])).toBeNull();
  });
});

describe(playedSequence, () => {
  const arrangement = {
    id: "a",
    name: "Default",
    sequence: ["Verse 1", "Chorus"],
    length: null,
    archivedAt: null,
  };

  it("prefers the plan's own sequence to the arrangement's", () => {
    expect(
      playedSequence(
        item("1", "song", {
          arrangement,
          customArrangementSequence: ["Chorus"],
        })
      )
    ).toStrictEqual(["Chorus"]);
    expect(playedSequence(item("1", "song", { arrangement }))).toStrictEqual([
      "Verse 1",
      "Chorus",
    ]);
    expect(playedSequence(item("1", "item"))).toStrictEqual([]);
  });
});

const file = (
  id: string,
  providerType: string,
  filename: string,
  owner: [string, string]
): PlanFile => ({
  id,
  name: filename,
  filename,
  contentType: "",
  fileType: "",
  providerType,
  size: 0,
  hasPreview: false,
  downloadable: true,
  streamable: true,
  ownerType: owner[0],
  ownerId: owner[1],
});

describe(practiceFiles, () => {
  const song = item("4", "song", {
    song: {
      id: "s1",
      title: "Be Enthroned",
      author: "",
      themes: "",
      lastScheduledAt: null,
    },
    arrangement: {
      id: "a1",
      name: "Default",
      sequence: [],
      length: null,
      archivedAt: null,
    },
    key: { id: "k1", name: "G", startingKey: "G", endingKey: null },
  });

  it("sorts the song's files into charts, tracks, videos, and other", () => {
    const files = practiceFiles(
      [
        file("1", "AttachmentRehearsalMixV2", "Keys: Organ", [
          "Arrangement",
          "a1",
        ]),
        file("2", "AttachmentS3", "Be Enthroned.mp3", ["Song", "s1"]),
        file("3", "AttachmentChart::Lyric", "Lyrics", ["Arrangement", "a1"]),
        file("4", "AttachmentChart::Chord", "Chord Chart in G", ["Key", "k1"]),
        file("5", "AttachmentRehearsalMixV2", "Original Mix", [
          "Arrangement",
          "a1",
        ]),
        file("6", "AttachmentYoutube", "Live video", ["Song", "s1"]),
        file("7", "AttachmentS3", "Notes.doc", ["Song", "s1"]),
        file("8", "AttachmentS3", "Other song.mp3", ["Song", "s2"]),
      ],
      song
    );
    expect({
      charts: ids(files.charts),
      tracks: ids(files.tracks),
      videos: ids(files.videos),
      other: ids(files.other),
    }).toStrictEqual({
      charts: ["4", "3"],
      tracks: ["2", "5", "1"],
      videos: ["6"],
      other: ["7"],
    });
  });
});

describe(stepTextSize, () => {
  it("steps one size and stops at the ends", () => {
    expect(stepTextSize("base", 1)).toBe("lg");
    expect(stepTextSize("2xl", 1)).toBe("2xl");
    expect(stepTextSize("sm", -1)).toBe("sm");
  });
});

describe(withSongPractice, () => {
  const prefs = {
    textSize: "base",
    mode: "chords",
    songs: { a1: { capo: 3 } },
  } as const;

  it("saves a song's capo and key, and forgets one set back to the defaults", () => {
    expect(
      withSongPractice(prefs, "a2", { capo: 2, key: "A" }).songs
    ).toStrictEqual({
      a1: { capo: 3 },
      a2: { capo: 2, key: "A" },
    });
    expect(withSongPractice(prefs, "a1", { capo: 0 }).songs).toStrictEqual({});
  });
});

describe(formatPlaybackTime, () => {
  it("reads minutes and seconds", () => {
    expect(formatPlaybackTime(187.6)).toBe("3:07");
    expect(formatPlaybackTime(0)).toBe("0:00");
    expect(formatPlaybackTime(Number.NaN)).toBe("0:00");
  });
});

describe(nextLoop, () => {
  it("marks a start, then an end, then clears", () => {
    const started = nextLoop(null, 30);
    expect(started).toStrictEqual({ start: 30, end: null });
    expect(nextLoop(started, 45)).toStrictEqual({ start: 30, end: 45 });
    expect(nextLoop(started, 10)).toStrictEqual({ start: 10, end: 30 });
    expect(nextLoop(started, 30)).toStrictEqual({ start: 30, end: null });
    expect(nextLoop({ start: 30, end: 45 }, 50)).toBeNull();
  });
});
