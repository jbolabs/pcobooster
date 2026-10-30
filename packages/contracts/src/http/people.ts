/** Candidates, availability, schedule history, and the People dashboard. */
import { read } from "@pcobooster/contracts/http/endpoint";
import { planningCenterGroup } from "@pcobooster/contracts/http/group";
import {
  blockoutSchema,
  candidateDetailsBatchSchema,
  myScheduledPlansDataSchema,
  mySchedulePageSchema,
  peopleDashboardActivityBatchSchema,
  peopleDashboardPersonDetailSchema,
  peopleDashboardRosterSchema,
  peopleSearchResultSchema,
  planWindowHistoryBatchSchema,
  positionCandidatesSchema,
  candidateDetailsContinuationSchema,
  MAX_SERVICE_TYPES,
  MAX_WINDOW_CONTINUATION_PLANS,
  planTimesProgressSchema,
  windowPlanRefSchema,
  windowRangeRefSchema,
} from "@pcobooster/contracts/http/people-schemas";
import {
  mutableArray,
  isoDateTimeWithOffset,
  requiredId,
  nonNegativeInteger,
} from "@pcobooster/contracts/http/schema";
import {
  PEOPLE_CANDIDATE_DETAILS_BATCH_SIZE,
  PEOPLE_DASHBOARD_ACTIVITY_BATCH_SIZE,
} from "@pcobooster/contracts/people";
import { Struct, Schema } from "effect";

const PEOPLE_SEARCH_MIN_LENGTH = 2;
const PEOPLE_SEARCH_MAX_LENGTH = 80;
const MONTH_KEY = /^\d{4}-\d{2}$/u;

export const peoplePositionCandidatesInputSchema = Schema.Struct({
  serviceTypeId: requiredId,
  positionId: requiredId,
  teamId: Schema.optional(requiredId),
  planId: requiredId,
});

/** The selected plan's sort instant, as an ISO date-time with its offset. */
const planDateSchema = isoDateTimeWithOffset;

export const peoplePlanWindowHistoryInputSchema = Schema.Struct({
  date: planDateSchema,
  /**
   * Reads only this service type's plans. Clients read the window one service type per call,
   * in parallel; omit it to read every active service type in one call.
   */
  serviceTypeId: Schema.optional(requiredId),
  /** Where the previous call stopped; omit on the first call. */
  continuation: Schema.optional(
    Schema.Struct({
      plans: mutableArray(windowPlanRefSchema).check(
        Schema.isMaxLength(MAX_WINDOW_CONTINUATION_PLANS)
      ),
      ranges: mutableArray(windowRangeRefSchema).check(
        Schema.isMaxLength(MAX_SERVICE_TYPES)
      ),
    })
  ),
});

const personBatchSchema = (maximum: number) =>
  mutableArray(requiredId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maximum)
  );

export const peopleCandidateDetailsInputSchema = Schema.Struct({
  personIds: personBatchSchema(PEOPLE_CANDIDATE_DETAILS_BATCH_SIZE),
  planId: requiredId,
  date: planDateSchema,
  /** Also read each person's own schedules; only when the plan window is empty. */
  scheduleHistory: Schema.Boolean,
  /** From the previous call's `continuation`; omit on the first call. */
  continuation: Schema.optional(
    Schema.Struct({
      ...candidateDetailsContinuationSchema.fields,
      people: candidateDetailsContinuationSchema.fields.people.check(
        Schema.isMaxLength(PEOPLE_CANDIDATE_DETAILS_BATCH_SIZE)
      ),
    })
  ),
});

export const peopleSearchInputSchema = Schema.Struct({
  query: Schema.Trim.check(
    Schema.isMinLength(PEOPLE_SEARCH_MIN_LENGTH),
    Schema.isMaxLength(PEOPLE_SEARCH_MAX_LENGTH)
  ),
});

export const peopleBlockoutsInputSchema = Schema.Struct({
  personId: requiredId,
});

export const peopleDashboardActivityInputSchema = Schema.Struct({
  personIds: personBatchSchema(PEOPLE_DASHBOARD_ACTIVITY_BATCH_SIZE),
});

export const peopleDashboardPersonInputSchema = Schema.Struct({
  ...peopleBlockoutsInputSchema.fields,
  month: Schema.optional(Schema.String.check(Schema.isPattern(MONTH_KEY))),
  /** From the previous call's `continuation`; omit on the first call. */
  continuation: Schema.optional(planTimesProgressSchema),
});

const CANDIDATE_POSITION = ["serviceTypeId", "planId", "positionId"] as const;

export const people = planningCenterGroup(
  "people",
  read(
    "positionCandidates",
    "/service-types/:serviceTypeId/plans/:planId/positions/:positionId/candidates",
    {
      params: Struct.pick(
        peoplePositionCandidatesInputSchema.fields,
        CANDIDATE_POSITION
      ),
      query: Struct.omit(
        peoplePositionCandidatesInputSchema.fields,
        CANDIDATE_POSITION
      ),
      success: positionCandidatesSchema,
    }
  ),
  /**
   * Partial with a continuation cursor: pass `deferredPlans` and `deferredRanges` back as
   * `continuation`.
   * A POST read: the cursor can outgrow a URL.
   */
  read.post("planWindowHistory", "/people/plan-window-history", {
    payload: peoplePlanWindowHistoryInputSchema.fields,
    success: planWindowHistoryBatchSchema,
  }),
  /**
   * Partial with a continuation cursor: `deferredPersonIds` and `continuation`. A POST read:
   * the people and their page progress can outgrow a URL.
   */
  read.post("candidateDetails", "/plans/:planId/candidate-details", {
    params: Struct.pick(peopleCandidateDetailsInputSchema.fields, ["planId"]),
    payload: Struct.omit(peopleCandidateDetailsInputSchema.fields, ["planId"]),
    success: candidateDetailsBatchSchema,
  }),
  read("search", "/people", {
    query: peopleSearchInputSchema.fields,
    success: mutableArray(peopleSearchResultSchema),
  }),
  read("blockouts", "/people/:personId/blockouts", {
    params: peopleBlockoutsInputSchema.fields,
    success: mutableArray(blockoutSchema),
  }),
  read("dashboardRoster", "/people/roster", {
    success: peopleDashboardRosterSchema,
    feature: "people",
  }),
  /** Partial with a continuation cursor: `deferredPersonIds`. */
  read("dashboardActivity", "/people/activity", {
    query: peopleDashboardActivityInputSchema.fields,
    success: peopleDashboardActivityBatchSchema,
    feature: "people",
  }),
  /**
   * Partial with a continuation cursor: pass `continuation` back until it is `null`. A POST
   * read: the rehearsal times found so far can outgrow a URL.
   */
  read.post("dashboardPerson", "/people/:personId/dashboard", {
    params: Struct.pick(peopleDashboardPersonInputSchema.fields, ["personId"]),
    payload: Struct.omit(peopleDashboardPersonInputSchema.fields, ["personId"]),
    success: peopleDashboardPersonDetailSchema,
    feature: "people",
  }),
  read("mySchedule", "/me/schedule", {
    query: { offset: Schema.optional(nonNegativeInteger) },
    success: mySchedulePageSchema,
  }),
  read("myScheduledPlans", "/me/scheduled-plans", {
    success: myScheduledPlansDataSchema,
  })
);

export type PeoplePositionCandidatesInput =
  typeof peoplePositionCandidatesInputSchema.Type;
export type PeoplePlanWindowHistoryInput =
  typeof peoplePlanWindowHistoryInputSchema.Type;
export type PeopleCandidateDetailsInput =
  typeof peopleCandidateDetailsInputSchema.Type;
export type PeopleSearchInput = typeof peopleSearchInputSchema.Type;
export type PeopleBlockoutsInput = typeof peopleBlockoutsInputSchema.Type;
export type PeopleDashboardActivityInput =
  typeof peopleDashboardActivityInputSchema.Type;
export type PeopleDashboardPersonInput =
  typeof peopleDashboardPersonInputSchema.Type;
