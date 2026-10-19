import { useQueryClient } from "@tanstack/react-query";

import { usePlanningCenterAccess } from "@/hooks/use-planning-center-access";
import { chordChartEditAccess } from "@/lib/chord-chart-access";
import type { ChordChartEditAccess } from "@/lib/chord-chart-access";
import { queryKeys } from "@/lib/query-keys";

/** Whether this person can save chord charts, from their Planning Center permissions. */
export const useChordChartEditAccess = (): ChordChartEditAccess => {
  const { snapshot, demo, status } = usePlanningCenterAccess();
  return chordChartEditAccess(snapshot, demo, status === "error");
};

/** Reads the person's Planning Center permissions again, after a failed read. */
export const useRetryChordChartAccess = (): (() => void) => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: [queryKeys.planningCenterAccess(null)[0]],
    });
  };
};
