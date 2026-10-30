import type { MySchedulePage } from "@pcobooster/contracts/http/people-schemas";
import type { ServicePlanRow } from "@pcobooster/planning-center-models/service-plans";

/** Keep one plan across pages, while keeping every assigned team searchable. */
export const personalServiceRows = (
  entries: MySchedulePage["entries"],
  selectedTypes: readonly string[] | null
): ServicePlanRow[] => {
  const selected = selectedTypes === null ? null : new Set(selectedTypes);
  const plans = new Map<
    string,
    { row: ServicePlanRow; assignments: Set<string> }
  >();
  for (const entry of entries) {
    if (selected !== null && !selected.has(entry.serviceTypeId)) {
      continue;
    }
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
  return [...plans.values()].map(({ row, assignments }) => ({
    ...row,
    planTitle: [...assignments].filter((value) => value !== "").join("; "),
  }));
};
