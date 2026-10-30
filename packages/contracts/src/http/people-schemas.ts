/** People answers. */
import {
  finiteNumber,
  integer,
  mutableArray,
  nonNegativeInteger,
  requiredId,
} from "@pcobooster/contracts/http/schema";
import { Schema } from "effect";

const MAX_ROSTER_REQUESTS = 100;
/**
 * Service types an organization may have: the catalog reads them whole and fails typed past
 * this, so a window cursor's ranges (one per active service type) never outgrow it.
 */
export const MAX_SERVICE_TYPES = 1000;
/** Listed plans a window cursor carries; a call lists no more than it can hand back. */
export const MAX_WINDOW_CONTINUATION_PLANS = 1000;
/** Repeating blockouts one person's candidate-details cursor holds, at most. */
export const MAX_PENDING_BLOCKOUTS = 1000;
/** Plans whose times one person's history or detail page reads across calls. */
export const MAX_PROGRESS_PLANS = 1000;
/** Times found on those plans that the cursor carries until the person's history is complete. */
export const MAX_PROGRESS_TIMES = 5000;

export const blockoutSchema = Schema.Struct({
  id: Schema.String,
  reason: Schema.String,
  startsAt: Schema.Date,
  endsAt: Schema.Date,
  description: Schema.String,
  share: Schema.Boolean,
  timeZone: Schema.optional(Schema.NullOr(Schema.String)),
});

/** A person's Planning Center scheduling preferences for the position. */
export const schedulingPreferencesSchema = Schema.Struct({
  schedulePreference: Schema.NullOr(Schema.String),
  preferredWeeks: mutableArray(integer),
  timePreferenceOptionIds: mutableArray(Schema.String),
  maxPlansPerDay: Schema.NullOr(integer),
  maxPlansPerMonth: Schema.NullOr(integer),
});

/** The selected plan and slot candidates are matched against. */
export const selectedPlanMatchSchema = Schema.Struct({
  planId: Schema.optional(Schema.String),
  teamId: Schema.optional(Schema.String),
  selectedPositionName: Schema.optional(Schema.String),
  selectedTeamName: Schema.optional(Schema.String),
});

export const selectedPlanSlotSchema = Schema.Struct({
  planPersonId: Schema.String,
  status: Schema.Literals(["confirmed", "pending", "declined"]),
  declineReason: Schema.NullOr(Schema.String),
});

/** A candidate with the selected plan's fresh roster applied; no history or availability. */
export const positionCandidateSchema = Schema.Struct({
  id: Schema.String,
  firstName: Schema.String,
  lastName: Schema.String,
  fullName: Schema.String,
  photoUrl: Schema.NullOr(Schema.String),
  photoThumbnailUrl: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  selectedPlanRosterLabels: mutableArray(Schema.String),
  selectedPlanSlot: Schema.NullOr(selectedPlanSlotSchema),
  /** Null for people on the selected slot who are not assigned to the position. */
  schedulingPreferences: Schema.NullOr(schedulingPreferencesSchema),
});

export const positionCandidatesSchema = Schema.Struct({
  generatedAt: Schema.String,
  timeZone: Schema.String,
  match: selectedPlanMatchSchema,
  candidates: mutableArray(positionCandidateSchema),
});

export const serviceHistoryItemSchema = Schema.Struct({
  id: Schema.String,
  sourceScheduleId: Schema.String,
  planId: Schema.optional(Schema.String),
  date: Schema.Date,
  teamPositionName: Schema.String,
  teamName: Schema.optional(Schema.String),
  serviceTypeName: Schema.optional(Schema.String),
  planTitle: Schema.optional(Schema.String),
  status: Schema.String,
  timeType: Schema.optional(Schema.Literals(["service", "rehearsal", "other"])),
});

/** One of a person's selected-plan assignments as history saw it. */
export const selectedPlanAssignmentSchema = Schema.Struct({
  source: Schema.Literals(["planPerson", "schedule"]),
  id: Schema.String,
  planId: Schema.NullOr(Schema.String),
  teamId: Schema.NullOr(Schema.String),
  teamName: Schema.NullOr(Schema.String),
  teamPositionName: Schema.String,
  status: Schema.String,
  planPersonId: Schema.NullOr(Schema.String),
  declineReason: Schema.NullOr(Schema.String),
});

export const candidateHistorySchema = Schema.Struct({
  /** Unsorted; the browser sorts, summarizes, and trims them. */
  serviceHistory: mutableArray(serviceHistoryItemSchema),
  selectedPlanAssignments: mutableArray(selectedPlanAssignmentSchema),
});

/** The page a follow-up call reads next: an offset into a Planning Center collection. */
const pageOffset = nonNegativeInteger;

/** A plan a `people.planWindowHistory` call left for the next one: part of its cursor. */
export const windowPlanRefSchema = Schema.Struct({
  serviceTypeId: requiredId,
  planId: requiredId,
  /** Roster pages the plan needs; a follow-up call reserves them before locating plans. */
  rosterRequests: integer.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(MAX_ROSTER_REQUESTS)
  ),
  /** The range page that listed the plan, where the next call finds it again. */
  rangeOffset: pageOffset,
});

/**
 * A service type whose window plans are listed up to `offset`: part of the cursor. Once plans
 * are listed, `offset` is the position of the last one, `boundaryPlanId`, which the next page
 * must start with.
 */
export const windowRangeRefSchema = Schema.Struct({
  serviceTypeId: requiredId,
  offset: pageOffset,
  boundaryPlanId: Schema.NullOr(requiredId),
  previousPage: Schema.optional(
    Schema.Struct({
      offset: pageOffset,
      planIds: mutableArray(requiredId).check(Schema.isMaxLength(100)),
    })
  ),
});

export const windowPlanSummarySchema = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  sortDate: Schema.NullOr(Schema.String),
  serviceTypeName: Schema.NullOr(Schema.String),
});

export const windowPlanTimeSchema = Schema.Struct({
  id: Schema.String,
  startsAt: Schema.NullOr(Schema.String),
  timeType: Schema.NullOr(Schema.String),
});

export const windowRosterRowSchema = Schema.Struct({
  id: Schema.String,
  planId: Schema.NullOr(Schema.String),
  teamId: Schema.NullOr(Schema.String),
  teamPositionName: Schema.String,
  status: Schema.String,
  createdAt: Schema.String,
  timeIds: mutableArray(Schema.String),
  serviceTimeIds: mutableArray(Schema.String),
  declineReason: Schema.NullOr(Schema.String),
});

export const planWindowHistoryBatchSchema = Schema.Struct({
  generatedAt: Schema.String,
  /** Rosters read by this call, including plans with no one scheduled. */
  loadedPlanCount: finiteNumber,
  /** Plans and times the rows point at; the browser expands rows into history items. */
  plans: mutableArray(windowPlanSummarySchema),
  planTimes: mutableArray(windowPlanTimeSchema),
  people: mutableArray(
    Schema.Struct({
      personId: Schema.String,
      rows: mutableArray(windowRosterRowSchema),
    })
  ),
  /** Listed plans left for a follow-up call, in window order. */
  deferredPlans: mutableArray(windowPlanRefSchema).check(
    Schema.isMaxLength(MAX_WINDOW_CONTINUATION_PLANS)
  ),
  /** Ranges not listed to their end yet, and their next page; after `deferredPlans`. */
  deferredRanges: mutableArray(windowRangeRefSchema).check(
    Schema.isMaxLength(MAX_SERVICE_TYPES)
  ),
  requestBudget: Schema.Struct({
    /**
     * What the call planned against. To finish or advance its first unit it may go past this
     * into the retry headroom, never past the procedure's hard cap.
     */
    limit: finiteNumber,
    /** Planning Center requests the call sent; cached reads cost none. */
    planningCenterRequests: finiteNumber,
    planRangeRequests: finiteNumber,
    rosterRequests: finiteNumber,
  }),
});

export const candidateDetailSchema = Schema.Struct({
  personId: Schema.String,
  isBlockedForDate: Schema.Boolean,
  /** The person's own schedule history, only when it was asked for. */
  history: Schema.optional(candidateHistorySchema),
});

/**
 * Plans whose times earlier calls read page by page for one person (`nextOffset` is `null` once
 * read to the end), and the times found that the person's schedules list.
 */
export const planTimesProgressSchema = Schema.Struct({
  plans: mutableArray(
    Schema.Struct({ planId: requiredId, nextOffset: Schema.NullOr(pageOffset) })
  ).check(Schema.isMaxLength(MAX_PROGRESS_PLANS)),
  times: mutableArray(
    Schema.Struct({
      id: requiredId,
      timeType: Schema.NullOr(Schema.String),
      startsAt: Schema.NullOr(Schema.String),
    })
  ).check(Schema.isMaxLength(MAX_PROGRESS_TIMES)),
});

/** What earlier calls learned about a person they left unfinished. */
export const candidatePersonProgressSchema = Schema.Struct({
  personId: requiredId,
  /** A blockout covers the plan day. */
  blocked: Schema.Boolean,
  /** The next page of the person's blockout list, or `null` once it is all read. */
  blockoutsOffset: Schema.NullOr(pageOffset),
  /** Repeating blockouts whose dates may still cover the plan day, and their next date page. */
  pendingBlockouts: mutableArray(
    Schema.Struct({
      blockoutId: requiredId,
      timeZone: Schema.NullOr(Schema.String),
      datesOffset: pageOffset,
    })
  ).check(Schema.isMaxLength(MAX_PENDING_BLOCKOUTS)),
  /** For schedule history: the rehearsal plans whose times were read, and the times found. */
  rehearsalTimes: planTimesProgressSchema,
});

/** Where a candidate details call stopped; a follow-up call resumes from it alone. */
export const candidateDetailsContinuationSchema = Schema.Struct({
  people: mutableArray(candidatePersonProgressSchema),
});

export const candidateDetailsBatchSchema = Schema.Struct({
  generatedAt: Schema.String,
  /** People whose details are complete. */
  people: mutableArray(candidateDetailSchema),
  /** Requested people left for a follow-up call to stay within the budget. */
  deferredPersonIds: mutableArray(Schema.String),
  /** Pass back with `deferredPersonIds`; empty once nobody is deferred. */
  continuation: candidateDetailsContinuationSchema,
  requestBudget: Schema.Struct({
    /**
     * What the call planned against. To finish or advance its first unit it may go past this
     * into the retry headroom, never past the procedure's hard cap.
     */
    limit: finiteNumber,
    /** Planning Center requests the call sent; cached reads cost none. */
    planningCenterRequests: finiteNumber,
  }),
});

export const peopleDashboardDayKindSchema = Schema.Literals([
  "service",
  "rehearsal",
]);

export const peopleDashboardMonthSchema = Schema.Struct({
  year: finiteNumber,
  monthIndex: finiteNumber,
  label: Schema.String,
  daysInMonth: finiteNumber,
  startsOnWeekday: finiteNumber,
});

/** Who is on the roster: identity and teams, with no schedule reads behind it. */
export const peopleDashboardRosterPersonSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  initials: Schema.String,
  photoThumbnailUrl: Schema.NullOr(Schema.String),
  teams: mutableArray(Schema.String),
});

const CALENDAR_DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u;
const calendarDayKeySchema = Schema.String.check(
  Schema.isPattern(CALENDAR_DAY_KEY)
);

/** How a person has been serving and responding; days are org `YYYY-MM-DD`. */
export const servingRhythmSchema = Schema.Struct({
  lastServedOn: Schema.NullOr(calendarDayKeySchema),
  nextServingOn: Schema.NullOr(calendarDayKeySchema),
  servedDays30: finiteNumber,
  servedDays90: finiteNumber,
  servedDays180: finiteNumber,
  upcomingDays30: finiteNumber,
  /** Median days between served days in the last 180; null with too few. */
  typicalGapDays: Schema.NullOr(finiteNumber),
  /** Schedules dated in the last 180 days through today, declined included. */
  requests180: finiteNumber,
  declined180: finiteNumber,
  /** Upcoming schedules still unconfirmed. */
  pendingUpcoming: finiteNumber,
  nextPendingOn: Schema.NullOr(calendarDayKeySchema),
});

/** A service or rehearsal day in a person's month, one per position, service type, and status. */
export const peopleDashboardMonthDaySchema = Schema.Struct({
  day: finiteNumber,
  kind: peopleDashboardDayKindSchema,
  positionName: Schema.optional(Schema.String),
  serviceTypeName: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  planUrl: Schema.optional(Schema.String),
});

/** How one roster person is serving, derived from their own schedules. */
export const peopleDashboardActivitySchema = Schema.Struct({
  id: Schema.String,
  rhythm: servingRhythmSchema,
  /** Their most common positions, most common first; empty without schedules. */
  roles: mutableArray(Schema.String),
  /** The month's services and rehearsals, by day. */
  monthDays: mutableArray(peopleDashboardMonthDaySchema),
});

const { id: _activityId, ...activityFields } =
  peopleDashboardActivitySchema.fields;

/** A roster person with their serving activity. */
export const peopleDashboardPersonSchema = Schema.Struct({
  ...peopleDashboardRosterPersonSchema.fields,
  ...activityFields,
});

export const peopleDashboardTeamSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The team's service type, to tell same-named teams apart. */
  serviceTypeName: Schema.NullOr(Schema.String),
  personIds: mutableArray(Schema.String),
});

export const peopleDashboardRosterSchema = Schema.Struct({
  generatedAt: Schema.String,
  month: peopleDashboardMonthSchema,
  /** Sorted by last name, then first name. */
  people: mutableArray(peopleDashboardRosterPersonSchema),
  teams: mutableArray(peopleDashboardTeamSchema),
  /** Teams the signed-in person leads; empty when they lead none or are unknown. */
  ledTeamIds: mutableArray(Schema.String),
});

export const peopleDashboardActivityBatchSchema = Schema.Struct({
  generatedAt: Schema.String,
  people: mutableArray(peopleDashboardActivitySchema),
  /**
   * Requested people this call left for a follow-up call to stay within its
   * Planning Center request budget. Empty when the batch is complete.
   */
  deferredPersonIds: mutableArray(Schema.String),
  requestBudget: Schema.Struct({
    /**
     * What the call planned against. To finish or advance its first unit it may go past this
     * into the retry headroom, never past the procedure's hard cap.
     */
    limit: finiteNumber,
    /** Planning Center requests the call sent; cached reads cost none. */
    planningCenterRequests: finiteNumber,
    scheduleRequests: finiteNumber,
    planTimeRequests: finiteNumber,
  }),
});

export const peopleDashboardPersonDetailSchema = Schema.Struct({
  generatedAt: Schema.String,
  month: peopleDashboardMonthSchema,
  previousMonth: Schema.String,
  nextMonth: Schema.String,
  /**
   * The rhythm reads the same schedules the dashboard does; `teams` are the teams the person
   * served on lately, and `monthDays` cover the requested month.
   */
  person: peopleDashboardPersonSchema,
  requestBudget: Schema.Struct({
    /**
     * What the call planned against. To finish or advance its first unit it may go past this
     * into the retry headroom, never past the procedure's hard cap.
     */
    limit: finiteNumber,
    /** Planning Center requests the call sent; cached reads cost none. */
    planningCenterRequests: finiteNumber,
    /**
     * Rehearsal (and other) times their plans do not list, or not read yet while
     * `continuation` is set; their assignments show on their plan's date.
     */
    unresolvedRehearsalTimes: finiteNumber,
  }),
  /** Plan pages left for a follow-up call; `null` once the detail is complete. */
  continuation: Schema.NullOr(planTimesProgressSchema),
});

export const peopleSearchResultSchema = Schema.Struct({
  id: Schema.String,
  firstName: Schema.String,
  lastName: Schema.String,
  fullName: Schema.String,
  photoThumbnailUrl: Schema.NullOr(Schema.String),
});

export const myScheduledPlansDataSchema = Schema.Struct({
  planIds: mutableArray(Schema.String),
});

export type Blockout = typeof blockoutSchema.Type;
export type PositionCandidates = typeof positionCandidatesSchema.Type;
export type PlanWindowHistoryBatch = typeof planWindowHistoryBatchSchema.Type;
export type CandidateDetailsBatch = typeof candidateDetailsBatchSchema.Type;
export type PeopleDashboardDayKind = typeof peopleDashboardDayKindSchema.Type;
export type PeopleDashboardMonth = typeof peopleDashboardMonthSchema.Type;
export type PeopleDashboardMonthDay = typeof peopleDashboardMonthDaySchema.Type;
export type PeopleDashboardRosterPerson =
  typeof peopleDashboardRosterPersonSchema.Type;
export type ServingRhythm = typeof servingRhythmSchema.Type;
export type PeopleDashboardTeam = typeof peopleDashboardTeamSchema.Type;
export type PeopleDashboardActivity = typeof peopleDashboardActivitySchema.Type;
export type PeopleDashboardPerson = typeof peopleDashboardPersonSchema.Type;
export type PeopleDashboardRoster = typeof peopleDashboardRosterSchema.Type;
export type PeopleDashboardActivityBatch =
  typeof peopleDashboardActivityBatchSchema.Type;
export type PeopleDashboardPersonDetail =
  typeof peopleDashboardPersonDetailSchema.Type;
export type PeopleSearchResult = typeof peopleSearchResultSchema.Type;
export type MyScheduledPlansData = typeof myScheduledPlansDataSchema.Type;

/** One provider page of the signed-in person's assignments, across all dates. */
export const mySchedulePageSchema = Schema.Struct({
  entries: mutableArray(
    Schema.Struct({
      planId: requiredId,
      serviceTypeId: requiredId,
      serviceTypeName: Schema.String,
      sortDate: Schema.Date,
      assignment: Schema.String,
    })
  ),
  nextOffset: Schema.NullOr(nonNegativeInteger),
});
export type MySchedulePage = typeof mySchedulePageSchema.Type;
