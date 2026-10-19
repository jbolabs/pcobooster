import { transposeChordChartText } from "@pcobooster/planning-center-models/chord-chart";
import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import {
  lyricsOnly,
  parseChartLines,
} from "@pcobooster/planning-center-models/chord-chart-lines";
import type { ChartLine } from "@pcobooster/planning-center-models/chord-chart-lines";

import { displayKey } from "../../lib/song-keys";
import { keyOptionLabel } from "./detail";
import type { ChordChartArrangement, KeyOption } from "./detail";

/**
 * A read-only reading of an arrangement's Lyrics & Chords text (Services' ChordPro-based
 * format): section headings, chord lines over lyrics, and inline `[G]` chords, in one of the
 * arrangement's keys or as a lyrics sheet. Planning Center's own PDF of the same chart opens in
 * `chart-pdf-screen.tsx`.
 */

/** What the chart shows: one of the arrangement's keys, or its lyrics. */
export type ChartTarget =
  | { readonly kind: "key"; readonly key: KeyOption }
  | { readonly kind: "lyrics" };

export const chartTargetId = (target: ChartTarget): string =>
  target.kind === "lyrics" ? "lyrics" : `key-${target.key.id}`;

/** "Chords in G", "Jordan's key (A)", or "Lyrics" (the web's `keyLabel`). */
export const chartTargetLabel = (target: ChartTarget): string => {
  if (target.kind === "lyrics") {
    return "Lyrics";
  }
  const name = target.key.name.trim();
  const start = target.key.startingKey ?? "";
  if (name === "" || name === start) {
    return start === "" ? "Chord chart" : `Chords in ${displayKey(start)}`;
  }
  return keyOptionLabel(target.key);
};

/** Every target an arrangement offers: its keys, then the lyrics sheet. */
export const chartTargets = (
  arrangement: ChordChartArrangement
): ChartTarget[] => [
  ...arrangement.keys.map((key): ChartTarget => ({ kind: "key", key })),
  { kind: "lyrics" },
];

/** The target with `id`, else the arrangement's first. */
export const resolveChartTarget = (
  arrangement: ChordChartArrangement,
  id: string | null | undefined
): ChartTarget => {
  const targets = chartTargets(arrangement);
  return (
    targets.find((target) => chartTargetId(target) === id) ??
    targets[0] ?? { kind: "lyrics" }
  );
};

export const hasChart = (arrangement: ChordChartArrangement): boolean =>
  arrangement.chordChart.trim() !== "";

export interface ChartReading {
  readonly lines: readonly ChartLine[];
  /** The key the chords show in, when they show; null for lyrics or an unknown key. */
  readonly key: string | null;
  /** Why the chords show as written instead of in the chosen key, if they do. */
  readonly note: string | null;
}

/**
 * The arrangement's chart for `target`: chords moved from the key they are written in
 * (`chordChartKey`) to the chosen key's starting key, or the lyrics with chords removed. When
 * Planning Center has no written key, the chords show as written, and the reading says so.
 */
export const readChart = (
  arrangement: ChordChartArrangement,
  target: ChartTarget
): ChartReading => {
  if (target.kind === "lyrics") {
    return {
      lines: lyricsOnly(parseChartLines(arrangement.chordChart)),
      key: null,
      note: null,
    };
  }
  const written = parseKey(arrangement.chordChartKey);
  const wanted = parseKey(target.key.startingKey);
  if (written === null) {
    return {
      lines: parseChartLines(arrangement.chordChart),
      key: null,
      note: "Planning Center has no key for this chart, so its chords show as written.",
    };
  }
  if (wanted === null) {
    return {
      lines: parseChartLines(arrangement.chordChart),
      key: written.name,
      note: `This key has no starting key in Planning Center, so the chords show in ${displayKey(written.name)} as written.`,
    };
  }
  return {
    lines: parseChartLines(
      transposeChordChartText(arrangement.chordChart, written, wanted)
    ),
    key: wanted.name,
    note: null,
  };
};
