import type { ApplicationFault } from "@pcobooster/api/application/errors";
import {
  explainPlanningCenterDenial,
  withPlanningCenterFaults,
} from "@pcobooster/api/application/planning-center-access";
import { PlanningCenterPlans } from "@pcobooster/api/application/planning-center/plans";
import {
  listPlanFiles,
  openPlanFile,
} from "@pcobooster/api/modules/planning-center/plan-files";
import type {
  PlanFileLink,
  PlanFileOpenInput,
  PlanFiles,
  PlanFilesInput,
} from "@pcobooster/contracts/http/plan-files";
import { Effect } from "effect";

const viewDenied = explainPlanningCenterDenial(
  "Your Planning Center account can't view this plan's files. Ask a Services administrator for access."
);

/** One page of the plan's files, read only. */
export const readPlanFiles = (
  input: PlanFilesInput
): Effect.Effect<PlanFiles, ApplicationFault, PlanningCenterPlans> =>
  Effect.gen(function* readFiles() {
    const plans = yield* PlanningCenterPlans;
    return yield* listPlanFiles(input, plans);
  }).pipe(viewDenied, withPlanningCenterFaults);

/**
 * A short-lived link to one file, or the PDF itself. Calls the Worker's `fetch` through a
 * wrapper: invoked as a method it loses its binding.
 */
export const readPlanFileLink = (
  input: PlanFileOpenInput
): Effect.Effect<PlanFileLink, ApplicationFault, PlanningCenterPlans> =>
  Effect.gen(function* openFile() {
    const plans = yield* PlanningCenterPlans;
    return yield* openPlanFile(input, {
      plans,
      fetch: async (request, init) => await globalThis.fetch(request, init),
    });
  }).pipe(viewDenied, withPlanningCenterFaults);
