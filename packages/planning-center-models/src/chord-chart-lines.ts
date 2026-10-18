/**
 * Reads Planning Center's Lyrics & Chords text (`Arrangement.chord_chart`) into lines to draw:
 * section headings, chord lines over lyrics, inline `[G]` chords, and comments. Services renders
 * its own PDF of the same chart; these readings are for showing the chart as text, in any key.
 */
import {
  COLUMN_BREAK,
  PAGE_BREAK,
  isChordLine,
  isSectionHeading,
  transposeChordChartBy,
} from "@pcobooster/planning-center-models/chord-chart";
import {
  parseKey,
  semitonesBetween,
  transposeKey,
} from "@pcobooster/planning-center-models/chord-chart-chords";
import type { MusicalKey } from "@pcobooster/planning-center-models/chord-chart-chords";

export interface ChartSegment {
  readonly chord: string | null;
  readonly text: string;
}

export type ChartLine =
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "chords"; readonly text: string }
  | { readonly kind: "lyric"; readonly segments: readonly ChartSegment[] }
  | { readonly kind: "comment"; readonly text: string }
  | { readonly kind: "blank" }
  | { readonly kind: "break" };

const INLINE_CHORD = /\[(?<chord>[^\]]*)\]/gu;
const PLAIN_TEXT_TAG = /<\/?t>/giu;
const DIRECTIVE =
  /^\{\s*(?:c|comment|ci|comment_italic)\s*:\s*(?<text>.*)\}$/iu;
const OTHER_DIRECTIVE = /^\{[^}]*\}$/u;

/** A lyric line split at its inline chords: each chord sits over the text after it. */
const lyricSegments = (line: string): ChartSegment[] => {
  const segments: ChartSegment[] = [];
  let chord: string | null = null;
  let start = 0;
  for (const match of line.matchAll(INLINE_CHORD)) {
    const text = line.slice(start, match.index);
    if (chord !== null || text !== "") {
      segments.push({ chord, text });
    }
    chord = match.groups?.chord ?? "";
    start = match.index + match[0].length;
  }
  const rest = line.slice(start);
  if (chord !== null || rest !== "" || segments.length === 0) {
    segments.push({ chord, text: rest });
  }
  return segments;
};

/** Reads chart text into lines to draw. Windows line endings and trailing spaces don't matter. */
export const parseChartLines = (text: string): ChartLine[] =>
  text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((raw): ChartLine => {
      const line = raw.replaceAll(PLAIN_TEXT_TAG, "").trimEnd();
      const trimmed = line.trim();
      if (trimmed === "") {
        return { kind: "blank" };
      }
      if (trimmed === COLUMN_BREAK || trimmed === PAGE_BREAK) {
        return { kind: "break" };
      }
      const directive = DIRECTIVE.exec(trimmed)?.groups?.text;
      if (directive !== undefined) {
        return { kind: "comment", text: directive.trim() };
      }
      if (OTHER_DIRECTIVE.test(trimmed)) {
        return { kind: "blank" };
      }
      if (isSectionHeading(trimmed)) {
        return { kind: "heading", text: trimmed };
      }
      if (isChordLine(raw)) {
        return { kind: "chords", text: line };
      }
      return { kind: "lyric", segments: lyricSegments(line) };
    })
    // Runs of blank lines and breaks read as one gap.
    .filter(
      (line, index, lines) =>
        !(
          (line.kind === "blank" || line.kind === "break") &&
          (index === 0 ||
            lines[index - 1]?.kind === "blank" ||
            lines[index - 1]?.kind === "break")
        )
    );

/** Lyrics only: the chart without its chord lines and inline chords. */
export const lyricsOnly = (lines: readonly ChartLine[]): ChartLine[] =>
  lines.flatMap((line): ChartLine[] => {
    if (line.kind === "chords") {
      return [];
    }
    if (line.kind === "lyric") {
      const text = line.segments.map((segment) => segment.text).join("");
      return text.trim() === ""
        ? []
        : [{ kind: "lyric", segments: [{ chord: null, text }] }];
    }
    return [line];
  });

export interface ChartSection {
  /** The section's heading as written, such as `VERSE 1`; null for lines before the first. */
  readonly heading: string | null;
  readonly lines: readonly ChartLine[];
}

const isGap = (line: ChartLine | undefined) =>
  line?.kind === "blank" || line?.kind === "break";

const trimGaps = (lines: readonly ChartLine[]): ChartLine[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && isGap(lines[start])) {
    start += 1;
  }
  while (end > start && isGap(lines[end - 1])) {
    end -= 1;
  }
  return lines.slice(start, end);
};

/** Splits lines at each heading, so a section can stay whole in one column. */
export const chartSections = (lines: readonly ChartLine[]): ChartSection[] => {
  const sections: { heading: string | null; lines: ChartLine[] }[] = [];
  for (const line of lines) {
    const current = sections.at(-1);
    if (line.kind === "heading") {
      sections.push({ heading: line.text, lines: [] });
    } else if (current === undefined) {
      sections.push({ heading: null, lines: [line] });
    } else {
      current.lines.push(line);
    }
  }
  // Gaps at a section's edges come from the text's spacing, not the music.
  return sections.flatMap((section) => {
    const trimmed = trimGaps(section.lines);
    return section.heading === null && trimmed.length === 0
      ? []
      : [{ heading: section.heading, lines: trimmed }];
  });
};

/** Section names and the short codes Services and musicians write for them. */
const SECTION_CODES: readonly (readonly [name: string, code: string])[] = [
  ["pre-chorus", "PC"],
  ["post-chorus", "PoC"],
  ["chorus", "C"],
  ["verse", "V"],
  ["bridge", "B"],
  ["intro", "I"],
  ["outro", "O"],
  ["ending", "E"],
  ["tag", "T"],
  ["interlude", "IL"],
  ["instrumental", "Inst"],
  ["turnaround", "TA"],
  ["refrain", "R"],
  ["vamp", "Vamp"],
  ["breakdown", "BD"],
  ["solo", "Solo"],
  ["misc", "M"],
];

const NAME_ALIASES = new Map<string, string>([
  ["prechorus", "pre-chorus"],
  ["pre chorus", "pre-chorus"],
  ["pre", "pre-chorus"],
  ["postchorus", "post-chorus"],
  ["post chorus", "post-chorus"],
  ["ch", "chorus"],
  ["br", "bridge"],
  ["in", "intro"],
  ["end", "ending"],
  ["out", "outro"],
  ["int", "interlude"],
  ["inst", "instrumental"],
]);
for (const [name, code] of SECTION_CODES) {
  NAME_ALIASES.set(code.toLowerCase(), name);
}

const SECTION_LABEL = /^(?<name>[a-z][a-z -]*?)(?:\s*(?<number>\d+)[a-z]?)?$/u;
/** Repeat marks and notes after a heading: `(x2)`, `2x`, `(softly)`, a trailing colon. */
const HEADING_SUFFIX =
  /(?:\s*[(]?\s*[x×]\s*\d+\s*[)]?|\s*\d+\s*[x×]|\s*[(][^)]*[)]|\s*:)+$/u;

export interface SectionName {
  /** The section's full name, lowercase, such as `pre-chorus`. */
  readonly name: string;
  readonly number: number | null;
}

/**
 * What a sequence entry or chart heading names: `V1`, `Verse 1`, and `VERSE 1 (x2)` are all
 * verse 1. Null for text that names no section Services knows.
 */
export const sectionName = (label: string): SectionName | null => {
  const cleaned = label.trim().replace(HEADING_SUFFIX, "").toLowerCase();
  const groups = SECTION_LABEL.exec(cleaned)?.groups;
  if (groups === undefined) {
    return null;
  }
  const raw = groups.name.trim();
  const name =
    NAME_ALIASES.get(raw) ??
    SECTION_CODES.find(([full]) => full === raw)?.[0] ??
    null;
  if (name === null) {
    return null;
  }
  return {
    name,
    number: groups.number === undefined ? null : Number(groups.number),
  };
};

/** A sequence entry's short code, such as `V1` for `Verse 1`; the entry itself if unknown. */
export const sectionCode = (label: string): string => {
  const section = sectionName(label);
  const code = SECTION_CODES.find(([name]) => name === section?.name)?.[1];
  if (section === null || code === undefined) {
    return label.trim();
  }
  return section.number === null ? code : `${code}${String(section.number)}`;
};

/**
 * The chart section each sequence entry plays, or -1 when the chart has no such section. A
 * numbered entry (`Verse 2`) finds its own heading. An unnumbered one finds the next heading of
 * its name in turn (`V`, `V` reach `VERSE 1`, then `VERSE 2`), staying on the last when the
 * chart writes fewer (one `CHORUS` for every chorus).
 */
export const sequenceSections = (
  sections: readonly ChartSection[],
  sequence: readonly string[]
): number[] => {
  const named = sections.map((section) =>
    section.heading === null ? null : sectionName(section.heading)
  );
  const headingsNamed = (name: string) =>
    named.flatMap((section, index) => (section?.name === name ? [index] : []));
  const turns = new Map<string, number>();
  return sequence.map((label) => {
    const wanted = sectionName(label);
    if (wanted === null) {
      return -1;
    }
    const candidates = headingsNamed(wanted.name);
    if (wanted.number !== null) {
      const exact = candidates.find(
        (index) => (named[index]?.number ?? 1) === wanted.number
      );
      return exact ?? candidates[0] ?? -1;
    }
    const turn = turns.get(wanted.name) ?? 0;
    turns.set(wanted.name, turn + 1);
    return candidates[Math.min(turn, candidates.length - 1)] ?? -1;
  });
};

/** Frets a capo can sit on for a song's chords to stay sensible. */
export const MAX_CAPO = 9;

export interface ChartKeys {
  /** The key the band hears; null when neither the plan nor the chart knows it. */
  readonly sounding: MusicalKey | null;
  /** The key the chords are fingered in: the sounding key, down a semitone per capo fret. */
  readonly fingered: MusicalKey | null;
}

/** The sounding key, and the key a capo on `capo` fingers it in. */
export const capoKeys = (
  sounding: MusicalKey | null,
  capo: number
): ChartKeys => ({
  sounding,
  fingered: sounding === null ? null : transposeKey(sounding, -capo),
});

export interface ChartReadingInput {
  readonly chordChart: string;
  /** The key the chart's chords are written in (`chord_chart_key`). */
  readonly writtenKey: string | null;
  /** The key the song is played in: the plan's key, a key chosen to practice in, or null. */
  readonly soundingKey: string | null;
  readonly capo: number;
}

export interface ChartReading {
  readonly lines: readonly ChartLine[];
  readonly keys: ChartKeys;
  /** Why the chords show as written instead of in the chosen key, if they do. */
  readonly note: string | null;
}

/**
 * The chart in the key to play it in, fingered for the capo. Without a written key
 * the chords can still move for a capo, but not to a named key, and the reading says so.
 */
export const readChart = ({
  chordChart,
  writtenKey,
  soundingKey,
  capo,
}: ChartReadingInput): ChartReading => {
  const written = parseKey(writtenKey);
  if (written === null) {
    return {
      lines: parseChartLines(transposeChordChartBy(chordChart, -capo, null)),
      keys: { sounding: null, fingered: null },
      note:
        capo === 0
          ? "Planning Center has no key for this chart, so its chords show as written."
          : "Planning Center has no key for this chart, so its chords move only for the capo.",
    };
  }
  const keys = capoKeys(parseKey(soundingKey) ?? written, capo);
  const fingered = keys.fingered ?? written;
  return {
    lines: parseChartLines(
      transposeChordChartBy(
        chordChart,
        semitonesBetween(written, fingered),
        fingered
      )
    ),
    keys,
    note: null,
  };
};
