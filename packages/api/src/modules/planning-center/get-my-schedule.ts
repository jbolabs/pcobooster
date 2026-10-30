import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import type { MySchedulePage } from "@pcobooster/contracts/http/people-schemas";
import {
  isNonEmptyString,
  isString,
} from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const relatedId = (resource: PCResource, name: string): string | null => {
  const data = resource.relationships?.[name]?.data;
  return data && !Array.isArray(data) ? data.id : null;
};

export const getMySchedulePage = (
  personId: string,
  offset: number,
  after: string,
  people: Pick<PlanningCenterPeopleService, "getPersonUpcomingSchedulesPage">
): Effect.Effect<MySchedulePage, PlanningCenterError> =>
  Effect.gen(function* readSchedulePage() {
    const page = yield* people.getPersonUpcomingSchedulesPage(
      personId,
      after,
      offset
    );
    const entries: MySchedulePage["entries"] = [];
    for (const schedule of page.data) {
      const planId = relatedId(schedule, "plan");
      const serviceTypeId = relatedId(schedule, "service_type");
      const attrs = schedule.attributes;
      if (
        !isNonEmptyString(planId) ||
        !isNonEmptyString(serviceTypeId) ||
        attrs.plan_visible_to_me === false ||
        !isNonEmptyString(attrs.sort_date)
      ) {
        continue;
      }
      const sortDate = new Date(attrs.sort_date);
      if (Number.isNaN(sortDate.getTime())) {
        continue;
      }
      entries.push({
        planId,
        serviceTypeId,
        sortDate,
        serviceTypeName: isString(attrs.service_type_name)
          ? attrs.service_type_name
          : "",
        assignment: [attrs.team_name, attrs.team_position_name]
          .filter(isNonEmptyString)
          .join(" · "),
      });
    }
    return { entries, nextOffset: page.nextOffset };
  });
