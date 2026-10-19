import { describe, expect, it } from "vitest";

import {
  activeFirst,
  arrangementFacts,
  arrangementFactsLine,
  arrangementPickerDetail,
  arrangementRows,
  chartActionLabel,
  formatLength,
  historyCountLine,
  historyDateLabel,
  historyNamesArrangements,
  historyRowDetail,
  historyServiceTypeId,
  keyEndingLabel,
  keyLabel,
  missingChartLabel,
  planningCenterArrangementUrl,
  serviceTypeCounts,
  songCreditsLine,
  songFacts,
  songFileGroups,
  songNotes,
  songPageSelection,
  splitSongHistory,
} from "./song-detail";
import type { ChartArrangementSummary, SongHistoryEntry } from "./song-detail";
import type { ArrangementOption, KeyOption } from "./types";

const now = new Date("2026-10-07T18:00:00.000Z");
const zone = "America/Los_Angeles";

const entry = (
  sortDate: string,
  serviceTypeName: string,
  overrides: Partial<SongHistoryEntry> = {}
): SongHistoryEntry => ({
  planId: `plan-${sortDate}`,
  serviceTypeId: serviceTypeName === "" ? null : `st-${serviceTypeName}`,
  serviceTypeName,
  sortDate: new Date(sortDate),
  keyName: "Original",
  startingKey: "G",
  arrangementName: "Default Arrangement",
  ...overrides,
});

// Newest first, as `songs.history` answers.
const history = [
  entry("2026-11-07T03:00:00.000Z", "Special Events"),
  entry("2026-11-01T17:00:00.000Z", "Sunday Gathering"),
  // Saturday evening in Los Angeles, Sunday in UTC.
  entry("2026-10-04T03:30:00.000Z", "Sunday Gathering", {
    startingKey: "A",
    keyName: "Jordan's key",
  }),
  entry("2026-08-16T16:00:00.000Z", "Youth Night", {
    arrangementName: "Acoustic",
  }),
  entry("2025-12-21T17:00:00.000Z", "Sunday Gathering"),
];

describe("song history facts", () => {
  it("splits upcoming plans soonest first from past plans newest first", () => {
    const { upcoming, past } = splitSongHistory(history, now);
    expect(upcoming.map((row) => row.serviceTypeName)).toStrictEqual([
      "Sunday Gathering",
      "Special Events",
    ]);
    expect(past.map((row) => row.sortDate.toISOString())).toStrictEqual([
      "2026-10-04T03:30:00.000Z",
      "2026-08-16T16:00:00.000Z",
      "2025-12-21T17:00:00.000Z",
    ]);
  });

  it("counts the past year by service type, most first, naming unknown services", () => {
    const { past } = splitSongHistory(
      [...history, entry("2026-01-04T17:00:00.000Z", "")],
      now
    );
    expect(serviceTypeCounts(past)).toStrictEqual([
      { name: "Sunday Gathering", count: 2 },
      { name: "Unknown service", count: 1 },
      { name: "Youth Night", count: 1 },
    ]);
  });

  it("labels facts on the org's calendar, with the next plan and the keys it was sung in", () => {
    expect(songFacts(history, now, zone, false)).toStrictEqual([
      {
        label: "Last sung",
        value: "Oct 3",
        caption: "3d ago",
        accessibilityValue: "Sat, Oct 3, 2026",
      },
      {
        label: "Next",
        value: "Nov 1",
        caption: "Sunday Gathering",
        accessibilityValue: "Sun, Nov 1, 2026",
      },
      {
        label: "Past year",
        value: "3 times",
        caption: "Sung in A, G",
        accessibilityValue: "3 times",
      },
    ]);
  });

  it("counts a history Planning Center cut off at its page as a floor", () => {
    expect(songFacts(history, now, zone, true).at(2)?.value).toBe("3+ times");
    expect(songFacts(history.slice(3, 4), now, zone, false).at(2)?.value).toBe(
      "Once"
    );
  });

  it("names only the keys it was sung in, not a key planned ahead", () => {
    const planned = [
      entry("2026-12-06T17:00:00.000Z", "Sunday Gathering", {
        startingKey: "B",
      }),
      ...history,
    ];
    expect(songFacts(planned, now, zone, false).at(2)?.caption).toBe(
      "Sung in A, G"
    );
  });

  it("says plainly when the song was never sung or planned", () => {
    expect(songFacts([], now, zone, false)).toStrictEqual([
      {
        label: "Last sung",
        value: "Not in the past year",
        caption: null,
        accessibilityValue: "Not in the past year",
      },
      {
        label: "Next",
        value: "Not planned",
        caption: null,
        accessibilityValue: "Not planned",
      },
      {
        label: "Past year",
        value: "0 times",
        caption: null,
        accessibilityValue: "0 times",
      },
    ]);
    expect(historyCountLine([], now, false)).toBe("Not sung in the past year");
  });

  it("summarizes the count line with each service type", () => {
    expect(historyCountLine(history, now, false)).toBe(
      "Sung 3 times in the past year · 2 at Sunday Gathering, 1 at Youth Night"
    );
    expect(historyCountLine(history, now, true)).toBe(
      "Sung 3+ times in the past year · 2 at Sunday Gathering, 1 at Youth Night"
    );
  });

  it("names arrangements only when the history spans several, and named keys", () => {
    expect(historyNamesArrangements(history)).toBeTruthy();
    expect(historyNamesArrangements(history.slice(0, 2))).toBeFalsy();
    expect(historyRowDetail(history[2], true)).toBe(
      "Default Arrangement · Jordan's key"
    );
    expect(historyRowDetail(history[0], false)).toBeNull();
  });

  it("dates history rows with the weekday this year and the year otherwise", () => {
    expect(
      historyDateLabel(new Date("2026-10-04T03:30:00.000Z"), now, zone)
    ).toBe("Sat, Oct 3");
    expect(
      historyDateLabel(new Date("2025-12-21T17:00:00.000Z"), now, zone)
    ).toBe("Dec 21, 2025");
  });
});

const option = (overrides: Partial<ArrangementOption>): ArrangementOption => ({
  id: "a",
  name: "Default",
  sequence: [],
  length: null,
  bpm: null,
  meter: null,
  archived: false,
  keys: [],
  ...overrides,
});

const key = (
  id: string,
  startingKey: string | null,
  overrides: Partial<KeyOption> = {}
): KeyOption => ({
  id,
  name: "Original",
  startingKey,
  endingKey: null,
  ...overrides,
});

const chartArrangement = (
  overrides: Partial<ChartArrangementSummary>
): ChartArrangementSummary => ({
  id: "a",
  name: "Default",
  archived: false,
  keys: [],
  sequence: [],
  length: null,
  bpm: null,
  meter: null,
  ...overrides,
});

describe("arrangements", () => {
  it("lists active arrangements before archived ones with length, tempo, and meter", () => {
    const rows = arrangementRows([
      option({ id: "old", archived: true, name: "" }),
      option({ id: "main", bpm: 74, meter: "4/4", length: 300 }),
    ]);
    expect(rows.map((row) => [row.id, row.name, row.facts])).toStrictEqual([
      ["main", "Default", "5:00 · 74 bpm · 4/4"],
      ["old", "Untitled arrangement", null],
    ]);
  });

  it("reads facts and sequence from the chart's arrangements until options load", () => {
    const rows = arrangementRows(undefined, [
      chartArrangement({
        id: "c",
        bpm: 70,
        length: 253,
        sequence: ["V1", "C"],
      }),
    ]);
    expect(rows.map((row) => [row.id, row.facts, row.sequence])).toStrictEqual([
      ["c", "4:13 · 70 bpm", ["V1", "C"]],
    ]);
    expect(activeFirst([])).toStrictEqual([]);
  });

  it("splits the facts line into values and units, leaving unset facts out", () => {
    expect(
      arrangementFacts({ length: 253, bpm: 70, meter: " 6/8 " })
    ).toStrictEqual([
      { label: "Length", value: "4:13", unit: null },
      { label: "Tempo", value: "70", unit: "bpm" },
      { label: "Meter", value: "6/8", unit: null },
    ]);
    expect(arrangementFactsLine({ length: 0, bpm: 0, meter: "" })).toBeNull();
  });

  it("formats lengths", () => {
    expect(formatLength(3723)).toBe("1:02:03");
    expect(formatLength(0)).toBeNull();
  });

  it("reads options under the latest service type the song was sung at", () => {
    expect(historyServiceTypeId(history)).toBe("st-Special Events");
    expect(
      historyServiceTypeId([entry("2026-01-04T17:00:00.000Z", "")])
    ).toBeNull();
    expect(historyServiceTypeId([])).toBeNull();
  });

  it("encodes Planning Center links", () => {
    expect(planningCenterArrangementUrl("5 01", "a/1")).toBe(
      "https://services.planningcenteronline.com/songs/5%2001/arrangements/a%2F1"
    );
  });
});

describe("keys", () => {
  it("labels a key by where it starts, adding its own name", () => {
    expect(
      [
        key("1", "G"),
        key("2", "A", { name: "Jordan's key" }),
        key("3", null, { name: "Choir" }),
        key("4", null, { name: "" }),
      ].map(keyLabel)
    ).toStrictEqual(["G", "A · Jordan's key", "Choir", "No key"]);
  });

  it("notes a key that ends somewhere else", () => {
    expect(keyEndingLabel(key("1", "G", { endingKey: "A" }))).toBe("Ends in A");
    expect(keyEndingLabel(key("1", "G", { endingKey: "G" }))).toBeNull();
  });

  it("names the chart action and a missing chart by the key", () => {
    expect(chartActionLabel(key("1", "G"))).toBe("Chart in G");
    expect(chartActionLabel(key("2", null, { name: "Choir" }))).toBe(
      "Chart in Choir"
    );
    expect(chartActionLabel(null)).toBe("Chart");
    expect(missingChartLabel(key("1", "Bb"))).toBe("No chart in Bb yet");
    expect(missingChartLabel(null)).toBe("No lyrics sheet yet");
  });

  it("tells arrangements apart by tempo and distinct starting keys", () => {
    expect(
      arrangementPickerDetail({
        bpm: 70,
        keys: [key("1", "G"), key("2", "A"), key("3", "G", { name: "Low" })],
      })
    ).toBe("70 bpm · G, A");
    expect(arrangementPickerDetail({ bpm: null, keys: [] })).toBe("");
  });
});

describe("song page selection", () => {
  const acoustic = chartArrangement({
    id: "acoustic",
    keys: [key("k-g", "G"), key("k-a", "A")],
  });
  const archived = chartArrangement({
    id: "old",
    archived: true,
    keys: [key("k-c", "C")],
  });
  const arrangements = [archived, acoustic];

  it("keeps an arrangement and key the URL names", () => {
    const selection = songPageSelection(arrangements, {
      arrangement: "old",
      key: "k-c",
    });
    expect({
      order: selection.arrangements.map(({ id }) => id),
      arrangement: selection.arrangement?.id,
      key: selection.key?.id,
      search: selection.search,
      stale: selection.stale,
    }).toStrictEqual({
      order: ["acoustic", "old"],
      arrangement: "old",
      key: "k-c",
      search: { arrangement: "old", key: "k-c" },
      stale: false,
    });
  });

  it("falls back to the first active arrangement and key, asking to replace the URL", () => {
    expect(
      songPageSelection(arrangements, { arrangement: "gone", key: "k-c" })
    ).toMatchObject({
      search: { arrangement: "acoustic", key: "k-g" },
      stale: true,
    });
    expect(songPageSelection(arrangements, {})).toMatchObject({
      search: { arrangement: "acoustic", key: "k-g" },
      stale: true,
    });
  });

  it("shows the lyrics sheet for an arrangement without keys, dropping a key from the URL", () => {
    const selection = songPageSelection([chartArrangement({ id: "bare" })], {
      arrangement: "bare",
      key: "k-g",
    });
    expect([selection.key, selection.search, selection.stale]).toStrictEqual([
      null,
      { arrangement: "bare", key: undefined },
      true,
    ]);
  });

  it("has nothing to show for a song without arrangements", () => {
    const selection = songPageSelection([], { arrangement: "a" });
    expect([selection.arrangement, selection.stale]).toStrictEqual([
      null,
      true,
    ]);
  });
});

const files = [
  { id: "lyrics", keyId: null },
  { id: "bass-g", keyId: "k-g" },
  { id: "keys-g", keyId: "k-g" },
  { id: "bass-a", keyId: "k-a" },
  { id: "stray", keyId: "k-gone" },
];
const groupIds = (
  groups: ReturnType<typeof songFileGroups<(typeof files)[number]>>
) => groups.map((group) => [group.label, group.files.map(({ id }) => id)]);

describe("credits, files, and notes", () => {
  it("joins writers, CCLI number, and copyright year, skipping missing parts", () => {
    expect(
      songCreditsLine({
        author: "Joel Davies and Aodhan King",
        ccliNumber: 6_605_236,
        copyright: "2013 Hillsong Music Publishing",
      })
    ).toBe("Joel Davies and Aodhan King · CCLI 6605236 · © 2013");
    expect(
      songCreditsLine({
        author: "",
        ccliNumber: null,
        copyright: "Public Domain",
      })
    ).toBe("Public Domain");
    expect(
      songCreditsLine({ author: " ", ccliNumber: null, copyright: null })
    ).toBeNull();
  });

  it("scopes key files to the chosen key when there are two or more keys", () => {
    expect(
      groupIds(
        songFileGroups(
          files,
          [key("k-g", "G"), key("k-a", "A", { name: "Jordan" })],
          "k-a"
        )
      )
    ).toStrictEqual([
      ["Arrangement", ["lyrics"]],
      ["A · Jordan", ["bass-a"]],
      ["Other keys", ["stray"]],
    ]);
  });

  it("groups every key's files under their key with one key", () => {
    expect(
      groupIds(songFileGroups(files.slice(0, 3), [key("k-g", "G")], null))
    ).toStrictEqual([
      ["Arrangement", ["lyrics"]],
      ["G", ["bass-g", "keys-g"]],
    ]);
  });

  it("puts the arrangement's notes before the song's, leaving blank ones out", () => {
    expect(
      songNotes({ notes: " Capo 2 " }, { notes: "Written for Easter" })
    ).toStrictEqual([
      { source: "Arrangement", text: "Capo 2" },
      { source: "Song", text: "Written for Easter" },
    ]);
    expect(songNotes(null, { notes: "  " })).toStrictEqual([]);
  });
});
