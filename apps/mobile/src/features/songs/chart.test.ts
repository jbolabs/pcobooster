import { describe, expect, it } from "vitest";

import songFixture from "../../harness/fixtures/chordCharts.song.json";
import {
  chartTargetId,
  chartTargetLabel,
  chartTargets,
  hasChart,
  readChart,
  resolveChartTarget,
} from "./chart";
import type { ChordChartArrangement } from "./detail";

const layout = {
  font: null,
  fontSize: null,
  columns: null,
  chordColor: null,
  pageSize: null,
  orientation: null,
  margin: null,
};

const arrangement = (
  overrides: Partial<ChordChartArrangement>
): ChordChartArrangement => ({
  id: "a1",
  name: "Default Arrangement",
  archived: false,
  chordChart: "",
  chordChartKey: "G",
  lyrics: "",
  keys: [
    { id: "k1", name: "Original", startingKey: "G", endingKey: null },
    { id: "k2", name: "Jordan's key", startingKey: "Bb", endingKey: null },
  ],
  layout,
  updatedAt: null,
  ...overrides,
});

describe("chart readings", () => {
  const chart = arrangement({
    chordChart: "CHORUS\n[G]Rise, my [D/F#]soul\nG     C\nAnd sing",
  });

  it("offers each key then the lyrics, and resolves an unknown target to the first", () => {
    const targets = chartTargets(chart);
    expect(targets.map(chartTargetId)).toStrictEqual([
      "key-k1",
      "key-k2",
      "lyrics",
    ]);
    expect(targets.map(chartTargetLabel)).toStrictEqual([
      "Original (G)",
      "Jordan's key (B♭)",
      "Lyrics",
    ]);
    expect(chartTargetId(resolveChartTarget(chart, "gone"))).toBe("key-k1");
    expect(
      chartTargetId(resolveChartTarget(arrangement({ keys: [] }), null))
    ).toBe("lyrics");
  });

  it("moves the chords from the written key to the chosen key, spelled for it", () => {
    const reading = readChart(chart, resolveChartTarget(chart, "key-k2"));
    expect(reading.key).toBe("Bb");
    expect(reading.note).toBeNull();
    expect(reading.lines).toStrictEqual([
      { kind: "heading", text: "CHORUS" },
      {
        kind: "lyric",
        segments: [
          { chord: "Bb", text: "Rise, my " },
          { chord: "F/A", text: "soul" },
        ],
      },
      { kind: "chords", text: "Bb    Eb" },
      { kind: "lyric", segments: [{ chord: null, text: "And sing" }] },
    ]);
  });

  it("shows the lyrics without chord lines or inline chords", () => {
    expect(readChart(chart, { kind: "lyrics" }).lines).toStrictEqual([
      { kind: "heading", text: "CHORUS" },
      { kind: "lyric", segments: [{ chord: null, text: "Rise, my soul" }] },
      { kind: "lyric", segments: [{ chord: null, text: "And sing" }] },
    ]);
  });

  it("shows chords as written, and says so, when the chart has no written key", () => {
    const unkeyed = arrangement({ chordChart: "[G]Rise", chordChartKey: null });
    const reading = readChart(unkeyed, resolveChartTarget(unkeyed, "key-k2"));
    expect(reading.key).toBeNull();
    expect(reading.note).toBe(
      "Planning Center has no key for this chart, so its chords show as written."
    );
    expect(reading.lines).toStrictEqual([
      { kind: "lyric", segments: [{ chord: "G", text: "Rise" }] },
    ]);
  });

  it("reads the fixture's charts and knows an empty chart", () => {
    const [main, archived] = songFixture.default.arrangements;
    if (main === undefined || archived === undefined) {
      throw new Error("The fixture needs two arrangements");
    }
    const fixtureChart = arrangement({
      ...main,
      keys: main.keys,
      layout,
    });
    expect(hasChart(fixtureChart)).toBeTruthy();
    expect(hasChart(arrangement({ chordChart: "  \n" }))).toBeFalsy();
    const reading = readChart(
      fixtureChart,
      resolveChartTarget(fixtureChart, "key-550112")
    );
    expect(reading.key).toBe("A");
    expect(reading.lines[1]).toStrictEqual({
      kind: "lyric",
      segments: [
        { chord: "A", text: "Morning light is " },
        { chord: "D", text: "breaking through" },
      ],
    });
  });
});
