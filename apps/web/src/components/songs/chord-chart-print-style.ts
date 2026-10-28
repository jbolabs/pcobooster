import {
  CHORD_CHART_CHORD_COLORS,
  CHORD_CHART_FONTS,
} from "@pcobooster/contracts/chord-charts";
import type { ChordChartLayout } from "@pcobooster/contracts/http/chord-charts";

type ChordChartFont = (typeof CHORD_CHART_FONTS)[number]["value"];
type ChordChartChordColor = (typeof CHORD_CHART_CHORD_COLORS)[number];

/** What Services prints when nothing picks a font, and what the API reports then. */
const DEFAULT_FONT: ChordChartFont = "Times-Roman";

/** Font stacks in `globals.css` with the widths Services prints each font at. */
const FONT_CLASSES: Record<ChordChartFont, string> = {
  Helvetica: "font-chart-helvetica",
  Courier: "font-chart-courier",
  Monaco: "font-chart-monaco",
  "Times-Roman": "font-chart-times",
  "Noto Sans": "font-chart-noto-sans",
};

const CHORD_COLOR_CLASSES: Record<ChordChartChordColor, string> = {
  Black: "text-foreground",
  Blue: "text-chord-blue",
  Green: "text-chord-green",
  Orange: "text-chord-orange",
  Purple: "text-chord-purple",
  Red: "text-chord-red",
};

const isChordChartFont = (font: string | null): font is ChordChartFont =>
  CHORD_CHART_FONTS.some((option) => option.value === font);

export interface ChordChartPrintStyle {
  /** The chart's font, so chords written above lyrics land where Services prints them. */
  readonly fontClassName: string;
  /** The chart's chord color. */
  readonly chordClassName: string;
}

/**
 * How Services will print the chart, for the editor to match. A setting reset to the
 * organization default falls back to the one Planning Center last reported.
 */
export const chordChartPrintStyle = (
  draft: ChordChartLayout,
  reported: ChordChartLayout
): ChordChartPrintStyle => {
  const font = draft.font ?? reported.font;
  const color =
    CHORD_CHART_CHORD_COLORS[draft.chordColor ?? reported.chordColor ?? 0] ??
    "Black";
  return {
    fontClassName: FONT_CLASSES[isChordChartFont(font) ? font : DEFAULT_FONT],
    chordClassName: CHORD_COLOR_CLASSES[color],
  };
};
