import type { PlanIds } from "../plan/reads";

/** Preparation stays in the plan's native stack so Back returns to the same order. */
export const songPathInPlan = (path: string, plan?: PlanIds): string =>
  plan === undefined
    ? path
    : `/services/${encodeURIComponent(plan.serviceTypeId)}/plans/${encodeURIComponent(plan.planId)}${path}`;
