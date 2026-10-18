import { ensureRequestIsOpen } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import {
  PlanningCenterAccess,
  planningCenterFault,
  withPlanningCenterFaults,
} from "@pcobooster/api/application/planning-center-access";
import { PlanningCenterCatalog } from "@pcobooster/api/application/planning-center/catalog";
import { PlanningCenterPeople } from "@pcobooster/api/application/planning-center/people";
import {
  matchesScheduleTarget,
  resolveScheduleTarget,
} from "@pcobooster/api/modules/planning-center/schedule-person";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import type { PlanPersonLocation } from "@pcobooster/api/planning-center/services/people-service";
import { AlreadyScheduled } from "@pcobooster/contracts/faults/already-scheduled";
import { InvalidInput } from "@pcobooster/contracts/faults/invalid-input";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { PositionMismatch } from "@pcobooster/contracts/faults/position-mismatch";
import type {
  ScheduleAssignInput,
  ScheduleRemoveInput,
  ScheduleUpdateStatusInput,
} from "@pcobooster/contracts/http/schedule";
import { isString } from "@pcobooster/planning-center-models/json";
import { Effect } from "effect";

import type { RequestContext } from "./context";

export interface ScheduleAssignmentPreparation {
  readonly target: {
    readonly teamName: string;
    readonly positionName: string;
  };
}

/** Read-only validation remains in the request's interruptible phase. */
export const prepareScheduledPerson = (
  input: ScheduleAssignInput
): Effect.Effect<
  ScheduleAssignmentPreparation,
  ApplicationFault,
  PlanningCenterCatalog | PlanningCenterPeople
> =>
  Effect.gen(function* preparePerson() {
    const peopleService = yield* PlanningCenterPeople;
    const catalogService = yield* PlanningCenterCatalog;
    const normalizedInput = { ...input, oneOff: input.oneOff ?? false };
    const target = yield* resolveScheduleTarget(normalizedInput, {
      catalog: catalogService,
      people: peopleService,
    });
    return { target };
  }).pipe(withPlanningCenterFaults);

/**
 * This phase begins at the provider-write boundary. The transport executes it
 * without request-driven interruption so the audit observes its actual result.
 */
export const commitScheduledPerson = (
  input: ScheduleAssignInput,
  preparation: ScheduleAssignmentPreparation
): Effect.Effect<
  { readonly success: true; readonly data: { readonly id: string } },
  ApplicationFault,
  | PlanningCenterAccess
  | PlanningCenterCatalog
  | PlanningCenterPeople
  | RequestContext
> =>
  Effect.gen(function* commitPerson() {
    const access = yield* PlanningCenterAccess;
    const peopleService = yield* PlanningCenterPeople;
    const catalogService = yield* PlanningCenterCatalog;
    yield* ensureRequestIsOpen;
    // The scheduling transport does not interrupt this provider mutation,
    // so its outcome is audited accurately.
    const created = yield* peopleService
      .createPlanPerson(
        input.serviceTypeId,
        input.personId,
        input.planId,
        input.teamId,
        preparation.target.positionName
      )
      .pipe(
        Effect.catch((error) => {
          if (
            error.message.includes(
              "has already been scheduled for this position"
            )
          ) {
            peopleService.invalidateScheduleReadCaches(input);
            catalogService.invalidateNeededPositionsCache(
              input.serviceTypeId,
              input.planId
            );
            peopleService.invalidatePlanWindowRosters();
            return Effect.fail(
              new AlreadyScheduled({
                message:
                  "Person is already scheduled for this selected plan/team/position",
                details: access.presentation ? undefined : error.message,
              })
            );
          }
          return Effect.fail(planningCenterFault(error));
        })
      );

    peopleService.invalidateScheduleReadCaches(input);
    catalogService.invalidateNeededPositionsCache(
      input.serviceTypeId,
      input.planId
    );
    peopleService.invalidatePlanWindowRosters();
    const name = created.attributes.team_position_name;
    const createdPositionName = isString(name) ? name : "";

    if (!matchesScheduleTarget(preparation.target, createdPositionName)) {
      return yield* Effect.fail(
        new PositionMismatch({
          message:
            "PlanPerson was created but did not match selected team/position. Please check split-team/time settings in Planning Center.",
          details: {
            selected: {
              teamId: input.teamId,
              teamName: preparation.target.teamName,
              positionId: input.positionId,
              positionName: preparation.target.positionName,
            },
            created: {
              planPersonId: created.id,
              teamPositionName: createdPositionName,
            },
          },
        })
      );
    }

    return { success: true as const, data: { id: created.id } };
  });

const PLANNING_CENTER_NOT_FOUND_STATUS = 404;

/**
 * Someone else may have removed the plan person in Planning Center since the lineup loaded.
 * That is a stale lineup, not a provider outage.
 */
const reportMissingPlanPerson = <Value, Requirements>(
  effect: Effect.Effect<Value, PlanningCenterError, Requirements>
): Effect.Effect<Value, PlanningCenterError | NotFound, Requirements> =>
  Effect.mapError(effect, (failure) =>
    failure instanceof PlanningCenterApiError &&
    failure.status === PLANNING_CENTER_NOT_FOUND_STATUS
      ? new NotFound({
          message:
            "This person is no longer on the plan in Planning Center. Refresh to see the current lineup.",
          resource: "plan-person",
        })
      : failure
  );

/** The plan (preferred) or person a removal or status change addresses the plan person through. */
const planPersonLocation = (
  input: ScheduleRemoveInput
): Effect.Effect<PlanPersonLocation, InvalidInput> => {
  const { serviceTypeId, planId, personId } = input;
  if (serviceTypeId !== undefined && planId !== undefined) {
    return Effect.succeed({ serviceTypeId, planId, personId });
  }
  if (personId !== undefined) {
    return Effect.succeed({ personId });
  }
  return Effect.fail(
    new InvalidInput({
      message:
        "A plan person can only be changed with its plan or person. Refresh and try again.",
    })
  );
};

export const removeScheduledPerson = (
  input: ScheduleRemoveInput
): Effect.Effect<
  { readonly success: true },
  ApplicationFault,
  PlanningCenterCatalog | PlanningCenterPeople | RequestContext
> =>
  Effect.gen(function* removePerson() {
    const peopleService = yield* PlanningCenterPeople;
    const catalogService = yield* PlanningCenterCatalog;
    const location = yield* planPersonLocation(input);
    yield* ensureRequestIsOpen;
    yield* reportMissingPlanPerson(
      peopleService.deletePlanPerson(input.planPersonId, location)
    );
    if (input.serviceTypeId !== undefined && input.planId !== undefined) {
      catalogService.invalidateNeededPositionsCache(
        input.serviceTypeId,
        input.planId
      );
    }
    peopleService.invalidatePlanWindowRosters();
    return { success: true as const };
  }).pipe(withPlanningCenterFaults);

export const updateScheduledPersonStatus = (
  input: ScheduleUpdateStatusInput
): Effect.Effect<
  { readonly success: true },
  ApplicationFault,
  PlanningCenterCatalog | PlanningCenterPeople | RequestContext
> =>
  Effect.gen(function* updateStatus() {
    const peopleService = yield* PlanningCenterPeople;
    const catalogService = yield* PlanningCenterCatalog;
    const location = yield* planPersonLocation(input);
    yield* ensureRequestIsOpen;
    yield* reportMissingPlanPerson(
      peopleService.updatePlanPersonStatus(
        input.planPersonId,
        input.status,
        location
      )
    );
    if (input.serviceTypeId !== undefined && input.planId !== undefined) {
      catalogService.invalidateNeededPositionsCache(
        input.serviceTypeId,
        input.planId
      );
    }
    peopleService.invalidatePlanWindowRosters();
    return { success: true as const };
  }).pipe(withPlanningCenterFaults);
