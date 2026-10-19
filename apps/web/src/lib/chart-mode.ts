import type { ChordChartEditAccess } from "@/lib/chord-chart-access";

/** Whether a song's chart page reads Planning Center's PDF or edits the chart. */
export type ChartMode = "read" | "edit";

/** The mode one arrangement opened in, then whatever the person chose. */
export interface ChartModeState {
  readonly arrangementId: string;
  readonly mode: ChartMode;
  /** The person chose it (Edit, E, Done), so focus follows. */
  readonly chosen: boolean;
}

/**
 * Decides an arrangement's opening mode once, when it first shows with permissions known: an
 * editor opens an empty chart (or a new arrangement while already editing) to edit, anything
 * else to read. The decision then holds, so the first save, which fills the chart, doesn't
 * send the editor back to reading. Returns `current` itself when nothing changes.
 */
export const latchChartMode = (
  current: ChartModeState | null,
  arrangement: { readonly id: string; readonly chordChart: string } | null,
  access: ChordChartEditAccess
): ChartModeState | null => {
  if (
    arrangement === null ||
    access === "pending" ||
    current?.arrangementId === arrangement.id
  ) {
    return current;
  }
  const opensEditing =
    access === "editor" &&
    (current?.mode === "edit" || arrangement.chordChart.trim() === "");
  return {
    arrangementId: arrangement.id,
    mode: opensEditing ? "edit" : "read",
    chosen: false,
  };
};
