import type { MySchedulePage } from "@pcobooster/contracts/http/people-schemas";
import type { ServicePlanRow } from "@pcobooster/planning-center-models/service-plans";

/** Keep one plan across pages, while keeping every assigned team searchable. */
export const personalServiceRows = (
  entries: MySchedulePage["entries"]
): ServicePlanRow[] => {
  const plans = new Map<
    string,
    { row: ServicePlanRow; assignments: Set<string> }
  >();
  for (const entry of entries) {
    const existing = plans.get(entry.planId);
    if (existing !== undefined) {
      existing.assignments.add(entry.assignment);
      continue;
    }
    plans.set(entry.planId, {
      row: {
        ...entry,
        planTitle: "",
        seriesId: null,
        seriesTitle: null,
        serviceTypeSequence: 0,
      },
      assignments: new Set([entry.assignment]),
    });
  }
  return [...plans.values()]
    .map(({ row, assignments }) => ({
      ...row,
      planTitle: [...assignments].filter((value) => value !== "").join("; "),
    }))
    .toSorted(
      (left, right) => left.sortDate.getTime() - right.sortDate.getTime()
    );
};
