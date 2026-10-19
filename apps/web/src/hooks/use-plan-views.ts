import type { PlanView } from "@pcobooster/planning-center-models/plan-overview";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { planViewEnabled } from "@/lib/app-routes";
import { featuresQueryOptions } from "@/lib/features";

/** The views this visitor can open, in the given order: flagged-off views drop out. */
export const useEnabledPlanViews = (
  views: readonly PlanView[]
): readonly PlanView[] => {
  const { data } = useQuery(featuresQueryOptions);
  return useMemo(
    () => views.filter((view) => planViewEnabled(view, data)),
    [views, data]
  );
};
