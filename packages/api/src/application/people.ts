import { RequestContext } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import {
  explainMissingServicesPerson,
  PlanningCenterAccess,
  withPlanningCenterFaults,
} from "@pcobooster/api/application/planning-center-access";
import type { PlanningCenterRequestAccess } from "@pcobooster/api/application/planning-center-access";
import { PlanningCenterCatalog } from "@pcobooster/api/application/planning-center/catalog";
import { OrganizationTimeZone } from "@pcobooster/api/application/planning-center/organization-time-zone";
import { PlanningCenterPeople } from "@pcobooster/api/application/planning-center/people";
import { PlanningCenterPlans } from "@pcobooster/api/application/planning-center/plans";
import { requestPresentationDependencies } from "@pcobooster/api/application/presentation";
import { loadDevBypassIdentity } from "@pcobooster/api/auth/dev-bypass";
import { getPlanningCenterIdentityForAccount } from "@pcobooster/api/auth/planning-center-account-identity";
import { getCandidateDetails } from "@pcobooster/api/modules/planning-center/get-candidate-details";
import type {
  CandidateDetailsBatch,
  CandidateDetailsInput,
} from "@pcobooster/api/modules/planning-center/get-candidate-details";
import {
  getCurrentUserScheduledPlanIds,
  resolveCurrentUserPersonId,
} from "@pcobooster/api/modules/planning-center/get-current-user-scheduled-plans";
import type { CurrentUserIdentityDependencies } from "@pcobooster/api/modules/planning-center/get-current-user-scheduled-plans";
import { getMySchedulePage } from "@pcobooster/api/modules/planning-center/get-my-schedule";
import {
  getPeopleDashboardActivity as getPeopleDashboardActivityData,
  getPeopleDashboardRoster as getPeopleDashboardRosterData,
} from "@pcobooster/api/modules/planning-center/get-people-dashboard";
import { getPeopleDashboardPerson as getPeopleDashboardPersonDetail } from "@pcobooster/api/modules/planning-center/get-people-dashboard-person";
import { getFutureBlockoutsForPerson } from "@pcobooster/api/modules/planning-center/get-person-blockouts";
import { getPlanWindowHistory } from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import type {
  PlanWindowHistoryBatch,
  PlanWindowHistoryInput,
} from "@pcobooster/api/modules/planning-center/get-plan-window-history";
import { getPositionCandidates } from "@pcobooster/api/modules/planning-center/get-position-candidates";
import type { PositionCandidatesResult } from "@pcobooster/api/modules/planning-center/get-position-candidates";
import type {
  PeopleDashboardActivityBatch,
  PeopleDashboardPersonDetail,
  PeopleDashboardRoster,
} from "@pcobooster/api/modules/planning-center/people-dashboard-types";
import type { PlanTimesProgress } from "@pcobooster/api/modules/planning-center/people/plan-time-pages";
import {
  presentBlockouts,
  presentCandidateDetails,
  presentDashboardRoster,
  presentDashboardPerson,
  presentPlanWindowHistory,
  presentPositionCandidates,
  getPresentationIdentityMapper,
} from "@pcobooster/api/modules/planning-center/presentation";
import { searchPeople } from "@pcobooster/api/modules/planning-center/search-people";
import type { PeopleSearchResult } from "@pcobooster/api/modules/planning-center/search-people";
import { Server } from "@pcobooster/api/server";
import type { MySchedulePage } from "@pcobooster/contracts/http/people-schemas";
import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import type { Blockout } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const currentUserIdentityDependencies = Effect.gen(
  function* readCurrentUserIdentityDependencies() {
    const { auth, config } = yield* Server;
    const dependencies: CurrentUserIdentityDependencies = {
      isDevAuthBypassEnabled: () => config.devAuthBypass,
      loadDevBypassIdentity: async () =>
        await loadDevBypassIdentity(config.localPlanningCenterToken),
      getPlanningCenterIdentityForAccount: async (request, account) =>
        await getPlanningCenterIdentityForAccount(auth, request, account),
    };
    return dependencies;
  }
);

/** The signed-in person's Planning Center id; null for demo visitors or when unreadable. */
const currentUserPersonId = (access: PlanningCenterRequestAccess) =>
  Effect.gen(function* readCurrentUserPersonId() {
    // A demo visitor is not a person in the demo organization.
    if (access.authentication.kind === "demo") {
      return null;
    }
    const { request } = yield* RequestContext;
    return yield* resolveCurrentUserPersonId(
      request,
      access.authentication.account,
      yield* currentUserIdentityDependencies
    );
  });

export const getPeoplePositionCandidates = (input: {
  readonly serviceTypeId: string;
  readonly positionId: string;
  readonly teamId?: string;
  readonly planId: string;
}): Effect.Effect<
  PositionCandidatesResult,
  ApplicationFault,
  | OrganizationTimeZone
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | Server
> =>
  Effect.gen(function* listPositionCandidates() {
    const peopleService = yield* PlanningCenterPeople;
    const organizationTimeZone = yield* OrganizationTimeZone;
    const result = yield* getPositionCandidates(input, {
      people: peopleService,
      resolveTimeZone: organizationTimeZone,
    });
    return yield* presentPositionCandidates(
      result,
      yield* requestPresentationDependencies
    );
  }).pipe(withPlanningCenterFaults);

export const getPeoplePlanWindowHistory = (
  input: PlanWindowHistoryInput
): Effect.Effect<
  PlanWindowHistoryBatch,
  ApplicationFault,
  | OrganizationTimeZone
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | PlanningCenterPlans
> =>
  Effect.gen(function* readPlanWindowHistory() {
    const access = yield* PlanningCenterAccess;
    const peopleService = yield* PlanningCenterPeople;
    const catalogService = yield* PlanningCenterCatalog;
    const plansService = yield* PlanningCenterPlans;
    const organizationTimeZone = yield* OrganizationTimeZone;
    const batch = yield* getPlanWindowHistory(input, {
      catalog: catalogService,
      people: peopleService,
      plans: plansService,
      resolveTimeZone: organizationTimeZone,
    });
    return presentPlanWindowHistory(batch, access.presentation);
  }).pipe(withPlanningCenterFaults);

export const getPeopleCandidateDetails = (
  input: CandidateDetailsInput
): Effect.Effect<
  CandidateDetailsBatch,
  ApplicationFault,
  OrganizationTimeZone | PlanningCenterAccess | PlanningCenterPeople
> =>
  Effect.gen(function* readCandidateDetails() {
    const access = yield* PlanningCenterAccess;
    const peopleService = yield* PlanningCenterPeople;
    const organizationTimeZone = yield* OrganizationTimeZone;
    const batch = yield* getCandidateDetails(input, {
      people: peopleService,
      resolveTimeZone: organizationTimeZone,
    });
    return presentCandidateDetails(batch, access.presentation);
  }).pipe(withPlanningCenterFaults);

export const getPeopleSearch = (input: {
  readonly query: string;
}): Effect.Effect<
  PeopleSearchResult[],
  ApplicationFault,
  PlanningCenterAccess | PlanningCenterCatalog | PlanningCenterPeople | Server
> =>
  Effect.gen(function* searchDirectory() {
    const peopleService = yield* PlanningCenterPeople;
    return yield* searchPeople(input.query, 15, {
      people: peopleService,
      getIdentityMapper: getPresentationIdentityMapper(
        yield* requestPresentationDependencies
      ),
    });
  }).pipe(withPlanningCenterFaults);

export const getPeopleBlockouts = (input: {
  readonly personId: string;
}): Effect.Effect<
  Blockout[],
  ApplicationFault,
  PlanningCenterAccess | PlanningCenterPeople
> =>
  Effect.gen(function* listPeopleBlockouts() {
    const access = yield* PlanningCenterAccess;
    const peopleService = yield* PlanningCenterPeople;
    const blockouts = yield* getFutureBlockoutsForPerson(input.personId, {
      peopleService,
    });
    return presentBlockouts(blockouts, access.presentation);
  }).pipe(explainMissingServicesPerson, withPlanningCenterFaults);

export const getPeopleDashboardRoster = (): Effect.Effect<
  PeopleDashboardRoster,
  ApplicationFault,
  | OrganizationTimeZone
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | RequestContext
  | Server
> =>
  Effect.gen(function* readPeopleDashboardRoster() {
    const access = yield* PlanningCenterAccess;
    const peopleService = yield* PlanningCenterPeople;
    const organizationTimeZone = yield* OrganizationTimeZone;
    const roster = yield* getPeopleDashboardRosterData({
      peopleService,
      resolveTimeZone: organizationTimeZone,
      viewerPersonId: yield* currentUserPersonId(access),
    });
    return yield* presentDashboardRoster(
      roster,
      yield* requestPresentationDependencies
    );
  }).pipe(withPlanningCenterFaults);

export const getPeopleDashboardActivity = (input: {
  readonly personIds: readonly string[];
}): Effect.Effect<
  PeopleDashboardActivityBatch,
  ApplicationFault,
  OrganizationTimeZone | PlanningCenterPeople | PlanningCenterPlans
> =>
  Effect.gen(function* readPeopleDashboardActivity() {
    const peopleService = yield* PlanningCenterPeople;
    const plansService = yield* PlanningCenterPlans;
    const organizationTimeZone = yield* OrganizationTimeZone;
    return yield* getPeopleDashboardActivityData({
      personIds: input.personIds,
      dependencies: {
        peopleService,
        plansService,
        resolveTimeZone: organizationTimeZone,
      },
    });
  }).pipe(withPlanningCenterFaults);

export const getPeopleDashboardPerson = (input: {
  readonly personId: string;
  readonly month?: string;
  readonly continuation?: PlanTimesProgress;
}): Effect.Effect<
  PeopleDashboardPersonDetail,
  ApplicationFault,
  | OrganizationTimeZone
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | PlanningCenterPlans
  | Server
> =>
  Effect.gen(function* readPeopleDashboardPerson() {
    const peopleService = yield* PlanningCenterPeople;
    const catalogService = yield* PlanningCenterCatalog;
    const plansService = yield* PlanningCenterPlans;
    const organizationTimeZone = yield* OrganizationTimeZone;
    const detail = yield* getPeopleDashboardPersonDetail({
      personId: input.personId,
      month: input.month,
      continuation: input.continuation,
      dependencies: {
        peopleService,
        catalogService,
        plansService,
        resolveTimeZone: organizationTimeZone,
        detailCache: (yield* Server).moduleReadCaches.peopleDashboardPerson,
      },
    });
    return yield* presentDashboardPerson(
      detail,
      yield* requestPresentationDependencies
    );
  }).pipe(explainMissingServicesPerson, withPlanningCenterFaults);

export const getMyScheduledPlans = (): Effect.Effect<
  { readonly planIds: string[] },
  ApplicationFault,
  | OrganizationTimeZone
  | PlanningCenterAccess
  | PlanningCenterPeople
  | RequestContext
  | Server
> =>
  Effect.gen(function* readMyScheduledPlans() {
    const access = yield* PlanningCenterAccess;
    const peopleService = yield* PlanningCenterPeople;
    const organizationTimeZone = yield* OrganizationTimeZone;
    const { request } = yield* RequestContext;
    // A demo visitor is not a person in the demo organization.
    if (access.authentication.kind === "demo") {
      return { planIds: [] };
    }
    const { account } = access.authentication;
    const planIds = yield* getCurrentUserScheduledPlanIds(request, account, {
      ...(yield* currentUserIdentityDependencies),
      peopleService,
      resolveTimeZone: organizationTimeZone,
    });
    return { planIds };
  }).pipe(withPlanningCenterFaults);

export const getMySchedule = (
  offset: number
): Effect.Effect<
  MySchedulePage,
  ApplicationFault,
  | OrganizationTimeZone
  | PlanningCenterAccess
  | PlanningCenterPeople
  | RequestContext
  | Server
> =>
  Effect.gen(function* readMySchedule() {
    const access = yield* PlanningCenterAccess;
    if (access.authentication.kind === "demo") {
      return { entries: [], nextOffset: null };
    }
    const { request } = yield* RequestContext;
    const personId = yield* resolveCurrentUserPersonId(
      request,
      access.authentication.account,
      yield* currentUserIdentityDependencies
    );
    if (personId === null) {
      return { entries: [], nextOffset: null };
    }
    const organizationTimeZone = yield* OrganizationTimeZone;
    const orgTimeZone = yield* organizationTimeZone;
    return yield* getMySchedulePage(
      personId,
      offset,
      formatCalendarDayInTimeZone(new Date(), orgTimeZone),
      yield* PlanningCenterPeople
    );
  }).pipe(withPlanningCenterFaults);
