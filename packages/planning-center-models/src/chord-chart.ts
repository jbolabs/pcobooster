/**
 * Reads Planning Center's Lyrics & Chords text (`Arrangement.chord_chart`): ChordPro inline
 * chords (`[G]Amazing grace`), chords written on their own line above the lyrics, and
 * Services' section headings and codes. Services renders the chart itself; these helpers
 * color it for editing and transpose it.
 */
import {
  isChord,
  semitonesBetween,
  transposeChordText,
} from "@pcobooster/planning-center-models/chord-chart-chords";
import type { MusicalKey } from "@pcobooster/planning-center-models/chord-chart-chords";

/** Section names Planning Center formats as headings, optionally numbered (`VERSE 2`). */
const SECTION_NAMES = [
  "intro",
  "verse",
  "pre-chorus",
  "prechorus",
  "pre chorus",
  "chorus",
  "post-chorus",
  "postchorus",
  "post chorus",
  "refrain",
  "bridge",
  "tag",
  "interlude",
  "instrumental",
  "turnaround",
  "vamp",
  "breakdown",
  "ending",
  "outro",
  "coda",
  "misc",
  "spoken",
  "solo",
  "rap",
  "hook",
  "channel",
] as const;

const SECTION_PATTERN = new RegExp(
  `^(?:${SECTION_NAMES.join("|")})(?:\\s*\\d+[a-z]?)?\\s*:?(?:\\s*[(]?\\s*(?:[x×]\\s*\\d+|\\d+\\s*[x×])\\s*[)]?)?(?:\\s*[(][^)]*[)])?\\s*:?$`,
  "iu"
);
const BRACKETED_CHORD_PATTERN = /\[(?<chord>[^\]]*)\]/gu;
const PLAIN_TEXT_TAG_PATTERN = /<t>/iu;
/**
 * Chord-line tokens that are not chords: bar lines, repeats (`x2`, `(2x)`, `-II-`, `-//-`),
 * rests and pushes (`*`), and beat counts (`4,3`).
 */
const CHORD_LINE_SYMBOL_PATTERN =
  /^(?:\||\|\||\/|-|\u2013|%|\.|:|\*|\(|\)|[x×]\d+|\(?[x×]\d+\)?|\(?\d+[x×]\)?|\d+(?:,\d+)*|-+[Il|/]+-+|N\.?C\.?|\(\S*\))$/iu;
/** A bass note alone after a chord (`/D`), or a chord in parentheses (`(Em)`). */
const SLASH_BASS_PATTERN = /^\/[A-G][#b♯♭]?$/u;
const ENCLOSING_PARENTHESES_PATTERN = /^\(|\)$/gu;
const WHITESPACE_TOKEN_PATTERN = /\S+/gu;
const TRAILING_WHITESPACE_PATTERN = /\s*$/u;

export const COLUMN_BREAK = "COLUMN_BREAK";
export const PAGE_BREAK = "PAGE_BREAK";

export const isSectionHeading = (line: string): boolean =>
  !line.includes("[") && SECTION_PATTERN.test(line.trim());

/** One space-separated token of a chord line that Services prints as a chord. */
export const isChordToken = (token: string): boolean =>
  SLASH_BASS_PATTERN.test(token) ||
  isChord(token.replaceAll(ENCLOSING_PARENTHESES_PATTERN, ""));

/** A line of chords written above lyrics, such as `G    D/F#   Em`. */
export const isChordLine = (line: string): boolean => {
  if (line.includes("[") || PLAIN_TEXT_TAG_PATTERN.test(line)) {
    return false;
  }
  const tokens = line.match(WHITESPACE_TOKEN_PATTERN) ?? [];
  let chords = 0;
  for (const token of tokens) {
    if (isChordToken(token)) {
      chords += 1;
    } else if (!CHORD_LINE_SYMBOL_PATTERN.test(token)) {
      return false;
    }
  }
  return chords > 0;
};

/**
 * Transposes a chord line, keeping each chord over the lyric column it started on. Trailing
 * spaces and a Windows `\r` stay as they were, so only the chords change.
 */
const transposeChordLine = (
  line: string,
  semitones: number,
  to: MusicalKey | null
): string => {
  let result = "";
  for (const match of line.matchAll(WHITESPACE_TOKEN_PATTERN)) {
    const column = Math.max(match.index, result.length + (result ? 1 : 0));
    result = `${result.padEnd(column)}${transposeChordText(match[0], semitones, to)}`;
  }
  const trailing = TRAILING_WHITESPACE_PATTERN.exec(line)?.[0] ?? "";
  return `${result}${trailing}`;
};

/**
 * Moves every chord in the chart by `semitones`, spelled for `spellingKey` (or Planning
 * Center's neutral names when the key is unknown). Chord lines keep their columns.
 */
export const transposeChordChartBy = (
  text: string,
  semitones: number,
  spellingKey: MusicalKey | null
): string => {
  if (semitones === 0) {
    return text;
  }
  return text
    .split("\n")
    .map((line) => {
      if (isChordLine(line)) {
        return transposeChordLine(line, semitones, spellingKey);
      }
      return line.replaceAll(
        BRACKETED_CHORD_PATTERN,
        (_match, chord: string) =>
          `[${transposeChordText(chord, semitones, spellingKey)}]`
      );
    })
    .join("\n");
};

/** The chart's written key moved to another key: rewrites the chords in the text itself. */
export const transposeChordChartText = (
  text: string,
  from: MusicalKey,
  to: MusicalKey
): string => transposeChordChartBy(text, semitonesBetween(from, to), to);
