import { usePlanningCenterAccess } from "@/hooks/use-planning-center-access";
import { chordChartEditAccess } from "@/lib/chord-chart-access";
import type { ChordChartEditAccess } from "@/lib/chord-chart-access";

/** Whether this person can save chord charts, from their Planning Center permissions. */
export const useChordChartEditAccess = (): ChordChartEditAccess => {
  const { snapshot, demo, status } = usePlanningCenterAccess();
  return chordChartEditAccess(snapshot, demo, status === "error");
};
