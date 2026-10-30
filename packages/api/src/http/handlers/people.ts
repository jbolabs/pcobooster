import {
  getMyScheduledPlans,
  getMySchedule,
  getPeopleBlockouts,
  getPeopleCandidateDetails,
  getPeopleDashboardActivity,
  getPeopleDashboardPerson,
  getPeopleDashboardRoster,
  getPeoplePlanWindowHistory,
  getPeoplePositionCandidates,
  getPeopleSearch,
} from "@pcobooster/api/application/people";
import { ProductApi } from "@pcobooster/contracts/http/api";
import { HttpApiBuilder } from "effect/http-api";

export const PeopleHandlers = HttpApiBuilder.group(
  ProductApi,
  "people",
  (handlers) =>
    handlers
      .handle("positionCandidates", ({ params, query }) =>
        getPeoplePositionCandidates({ ...params, ...query })
      )
      .handle("planWindowHistory", ({ payload }) =>
        getPeoplePlanWindowHistory(payload)
      )
      .handle("candidateDetails", ({ params, payload }) =>
        getPeopleCandidateDetails({ ...params, ...payload })
      )
      .handle("search", ({ query }) => getPeopleSearch(query))
      .handle("blockouts", ({ params }) => getPeopleBlockouts(params))
      .handle("dashboardRoster", () => getPeopleDashboardRoster())
      .handle("dashboardActivity", ({ query }) =>
        getPeopleDashboardActivity(query)
      )
      .handle("dashboardPerson", ({ params, payload }) =>
        getPeopleDashboardPerson({ ...params, ...payload })
      )
      .handle("mySchedule", ({ query }) => getMySchedule(query.offset ?? 0))
      .handle("myScheduledPlans", () => getMyScheduledPlans())
);
