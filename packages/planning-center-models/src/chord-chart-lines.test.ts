import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import {
  capoKeys,
  chartSections,
  lyricsOnly,
  parseChartLines,
  readChart,
  sectionCode,
  sectionName,
  sequenceSections,
} from "@pcobooster/planning-center-models/chord-chart-lines";
import { describe, expect, it } from "vitest";

describe(parseChartLines, () => {
  it("reads headings, chord lines, inline chords, comments, and breaks", () => {
    expect(
      parseChartLines(
        "VERSE 1\r\nG    D/F#   Em\nAmazing grace\n[G]Morning [C]light\n\n\nCOLUMN_BREAK\n{c: Softly}\n<t>CHORUS</t> notes"
      )
    ).toStrictEqual([
      { kind: "heading", text: "VERSE 1" },
      { kind: "chords", text: "G    D/F#   Em" },
      { kind: "lyric", segments: [{ chord: null, text: "Amazing grace" }] },
      {
        kind: "lyric",
        segments: [
          { chord: "G", text: "Morning " },
          { chord: "C", text: "light" },
        ],
      },
      { kind: "blank" },
      { kind: "comment", text: "Softly" },
      {
        kind: "lyric",
        segments: [{ chord: null, text: "CHORUS notes" }],
      },
    ]);
  });

  it("keeps text before the first chord and a chord with no lyric after it", () => {
    expect(parseChartLines("Oh [Em]come [D]")).toStrictEqual([
      {
        kind: "lyric",
        segments: [
          { chord: null, text: "Oh " },
          { chord: "Em", text: "come " },
          { chord: "D", text: "" },
        ],
      },
    ]);
  });
});

describe(lyricsOnly, () => {
  it("drops chord lines and inline chords, and lines left empty", () => {
    expect(
      lyricsOnly(
        parseChartLines("CHORUS\n[G]Rise, my [D/F#]soul\nG     C\n[Em]")
      )
    ).toStrictEqual([
      { kind: "heading", text: "CHORUS" },
      { kind: "lyric", segments: [{ chord: null, text: "Rise, my soul" }] },
    ]);
  });
});

describe(chartSections, () => {
  it("splits at headings and trims the gaps at each section's edges", () => {
    expect(
      chartSections(
        parseChartLines(
          "Intro riff\n\nVERSE 1\n\nLine one\n\nCHORUS\nLine two\n\n"
        )
      )
    ).toStrictEqual([
      {
        heading: null,
        lines: [
          { kind: "lyric", segments: [{ chord: null, text: "Intro riff" }] },
        ],
      },
      {
        heading: "VERSE 1",
        lines: [
          { kind: "lyric", segments: [{ chord: null, text: "Line one" }] },
        ],
      },
      {
        heading: "CHORUS",
        lines: [
          { kind: "lyric", segments: [{ chord: null, text: "Line two" }] },
        ],
      },
    ]);
  });
});

describe(sectionName, () => {
  it.each([
    ["V1", { name: "verse", number: 1 }],
    ["Verse 2", { name: "verse", number: 2 }],
    ["VERSE 3 (x2)", { name: "verse", number: 3 }],
    ["C", { name: "chorus", number: null }],
    ["Chorus 2x", { name: "chorus", number: null }],
    ["PC", { name: "pre-chorus", number: null }],
    ["Pre-Chorus 2", { name: "pre-chorus", number: 2 }],
    ["Bridge:", { name: "bridge", number: null }],
    ["Tag", { name: "tag", number: null }],
  ])("reads %s", (label, expected) => {
    expect(sectionName(label)).toStrictEqual(expected);
  });

  it("names nothing for lyrics or unknown labels", () => {
    expect(sectionName("Amazing grace")).toBeNull();
    expect(sectionName("Welcome")).toBeNull();
  });
});

describe(sectionCode, () => {
  it("shortens sequence entries and keeps unknown ones", () => {
    expect(
      ["Verse 1", "Chorus", "Pre-Chorus", "Bridge 2", "Welcome"].map(
        sectionCode
      )
    ).toStrictEqual(["V1", "C", "PC", "B2", "Welcome"]);
  });
});

describe(sequenceSections, () => {
  const sections = chartSections(
    parseChartLines("VERSE 1\na\nCHORUS\nb\nVERSE 2\nc\nBRIDGE\nd")
  );

  it("finds numbered sections, and unnumbered ones in turn", () => {
    expect(
      sequenceSections(sections, ["V", "C", "V", "C", "B", "C", "C"])
    ).toStrictEqual([0, 1, 2, 1, 3, 1, 1]);
    expect(
      sequenceSections(sections, ["Verse 2", "Verse 1", "Verse 3", "Chorus 2"])
    ).toStrictEqual([2, 0, 0, 1]);
  });

  it("finds nothing the chart lacks", () => {
    expect(sequenceSections(sections, ["Tag", "Welcome"])).toStrictEqual([
      -1, -1,
    ]);
  });
});

describe(capoKeys, () => {
  it("plays A with G shapes on capo 2, and F#m with Em shapes", () => {
    expect(capoKeys(parseKey("A"), 2).fingered?.name).toBe("G");
    expect(capoKeys(parseKey("F#m"), 2).fingered?.name).toBe("Em");
    expect(capoKeys(parseKey("Bb"), 0).fingered?.name).toBe("Bb");
  });
});

describe(readChart, () => {
  const chordChart = "CHORUS\n[G]Rise, my [D/F#]soul\nG     C\nAnd sing";

  it("moves the chords from the written key to the key played in", () => {
    const reading = readChart({
      chordChart,
      writtenKey: "G",
      soundingKey: "Bb",
      capo: 0,
    });
    expect(reading.keys.sounding?.name).toBe("Bb");
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

  it("shows capo shapes: A with capo 2 reads in G", () => {
    const reading = readChart({
      chordChart: "[D]Holy [A/C#]is the [Bm]Lord",
      writtenKey: "D",
      soundingKey: "A",
      capo: 2,
    });
    expect(reading.keys.fingered?.name).toBe("G");
    expect(reading.lines).toStrictEqual([
      {
        kind: "lyric",
        segments: [
          { chord: "G", text: "Holy " },
          { chord: "D/F#", text: "is the " },
          { chord: "Em", text: "Lord" },
        ],
      },
    ]);
  });

  it("plays in the written key when the plan has none", () => {
    expect(
      readChart({ chordChart, writtenKey: "G", soundingKey: null, capo: 0 })
        .keys.sounding?.name
    ).toBe("G");
  });

  it("moves an unkeyed chart only for the capo, and says so", () => {
    const reading = readChart({
      chordChart: "[A]Rise",
      writtenKey: null,
      soundingKey: "A",
      capo: 2,
    });
    expect(reading.keys).toStrictEqual({ sounding: null, fingered: null });
    expect(reading.note).toBe(
      "Planning Center has no key for this chart, so its chords move only for the capo."
    );
    expect(reading.lines).toStrictEqual([
      { kind: "lyric", segments: [{ chord: "G", text: "Rise" }] },
    ]);
  });
});
