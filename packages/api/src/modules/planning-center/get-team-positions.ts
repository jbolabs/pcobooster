import { moduleLog } from "@pcobooster/api/logging";
import {
  buildPlanSchedulingContext,
  buildSlotKey,
  isDeclinedRosterStatus,
} from "@pcobooster/api/modules/planning-center/plan-scheduling-context";
import type { PlanRosterEntry } from "@pcobooster/api/modules/planning-center/plan-scheduling-context";
import type { PlanningCenterError } from "@pcobooster/api/planning-center/core-client";
import {
  describePlanningCenterCause,
  isRecoverablePlanningCenterCause,
} from "@pcobooster/api/planning-center/recover-failure";
import type { PlanningCenterCatalogService } from "@pcobooster/api/planning-center/services/catalog-service";
import type { PlanningCenterPeopleService } from "@pcobooster/api/planning-center/services/people-service";
import type { PlanningCenterPlansService } from "@pcobooster/api/planning-center/services/plans-service";
import {
  findAllIncluded,
  findIncluded,
} from "@pcobooster/api/planning-center/utils";
import {
  isNonEmptyString,
  isNumber,
  isString,
} from "@pcobooster/planning-center-models/json";
import type {
  FilledPositionPerson,
  PCResource,
  TeamPosition,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const log = moduleLog("module/get-team-positions");

interface NeededPositionsResolution {
  response: { data: PCResource[]; included: PCResource[] };
  resolvedSeriesId: string | null;
  neededPositionSource: "series-plan" | "service-type-plan";
  usedSeriesFallback: boolean;
}

export interface TeamPositionDependencies {
  catalogService: Pick<
    PlanningCenterCatalogService,
    | "getServiceTypeTeamPositionsWithTeams"
    | "getPlanNeededPositionsWithTeams"
    | "getServiceTypePlanNeededPositionsWithTeams"
  >;
  peopleService: Pick<PlanningCenterPeopleService, "getPlanTeamMembers">;
  plansService: Pick<
    PlanningCenterPlansService,
    "getPlanForServiceTypeWithSeries"
  >;
}

const addFilledPositionsToGroups = (
  teamMap: Map<string, TeamPositionGroup>,
  positionsByTeamAndName: Map<string, TeamPosition>
) => {
  for (const slot of positionsByTeamAndName.values()) {
    const filledCount =
      (slot.filledConfirmedCount ?? 0) + (slot.filledPendingCount ?? 0);
    if (filledCount === 0) {
      continue;
    }
    if (!slot.teamId || !isNonEmptyString(slot.teamName)) {
      continue;
    }

    if (!teamMap.has(slot.teamId)) {
      teamMap.set(slot.teamId, {
        teamId: slot.teamId,
        teamName: slot.teamName,
        positions: [],
      });
    }

    const group = teamMap.get(slot.teamId);
    if (!group) {
      continue;
    }
    const exists = group.positions.some((position) => position.id === slot.id);
    if (!exists) {
      group.positions.push(slot);
    }
  }
};

interface TeamInfo {
  teamId: string;
  teamName: string;
}

const getTeamInfo = (
  position: PCResource,
  included: PCResource[]
): TeamInfo => {
  let teamId = "";
  let teamName = "";

  if (position.relationships?.team?.data) {
    const teamData = position.relationships.team.data;
    teamId = Array.isArray(teamData)
      ? (teamData[0]?.id ?? "")
      : teamData?.id || "";
  }

  if (teamId) {
    const team = findIncluded(included, "Team", teamId);
    if (team) {
      teamName = isString(team.attributes.name) ? team.attributes.name : "";
    }
  }

  // Only a read of one team can say which team an unlinked position belongs to.
  if (!teamId || !teamName) {
    const teams = findAllIncluded(included, "Team");
    if (teams.length === 1) {
      const [team] = teams;
      teamId = team.id;
      teamName = isString(team.attributes.name) ? team.attributes.name : "";
    }
  }

  return { teamId, teamName };
};

const buildTeamPositionKey = (teamId: string, positionName: string): string =>
  buildSlotKey(teamId, positionName);

const buildPlanMemberOnlyPositionId = (
  teamId: string,
  positionName: string
): string =>
  `plan-member-position:${teamId}:${encodeURIComponent(positionName.trim().toLowerCase())}`;

const buildNeededPositionSlotId = (neededPositionId: string): string =>
  `needed-position:${neededPositionId}`;

const getRelationshipId = (
  data: { id?: string } | { id?: string }[] | null | undefined
): string | null => {
  if (!data || Array.isArray(data)) {
    return null;
  }
  return data.id ?? null;
};

const applyPlanTeamMemberSummary = (
  rosterEntries: PlanRosterEntry[],
  positionsByTeamAndName: Map<string, TeamPosition>
) => {
  for (const rosterEntry of rosterEntries) {
    if (
      !isNonEmptyString(rosterEntry.teamId) ||
      isDeclinedRosterStatus(rosterEntry.status)
    ) {
      continue;
    }

    const slot = positionsByTeamAndName.get(
      buildTeamPositionKey(rosterEntry.teamId, rosterEntry.positionName)
    );
    if (!slot) {
      continue;
    }

    const status = rosterEntry.status === "confirmed" ? "confirmed" : "pending";

    if (status === "confirmed") {
      slot.filledConfirmedCount = (slot.filledConfirmedCount ?? 0) + 1;
    } else {
      slot.filledPendingCount = (slot.filledPendingCount ?? 0) + 1;
    }

    const entry: FilledPositionPerson = {
      id: rosterEntry.personId ?? `unknown-${rosterEntry.planPersonId}`,
      planPersonId: rosterEntry.planPersonId,
      personId: rosterEntry.personId,
      name: rosterEntry.person?.name ?? "Unknown person",
      status,
      rawStatus: rosterEntry.rawStatus,
      photoThumbnailUrl: rosterEntry.person?.photoThumbnailUrl ?? null,
      assignedTimeIds: rosterEntry.assignedTimeIds,
      serviceTimeIds: rosterEntry.serviceTimeIds,
      notification: rosterEntry.notification,
    };

    if (slot.filledPeople) {
      slot.filledPeople.push(entry);
    } else {
      slot.filledPeople = [entry];
    }
  }

  for (const slot of positionsByTeamAndName.values()) {
    if (!slot.filledPeople || slot.filledPeople.length === 0) {
      continue;
    }
    slot.filledPeople.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "confirmed" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }
};

const addPlanMemberOnlyPositions = (
  rosterEntries: PlanRosterEntry[],
  teamMap: Map<string, TeamPositionGroup>,
  positionsByTeamAndName: Map<string, TeamPosition>
) => {
  for (const rosterEntry of rosterEntries) {
    if (
      !isNonEmptyString(rosterEntry.teamId) ||
      !isNonEmptyString(rosterEntry.teamName) ||
      isDeclinedRosterStatus(rosterEntry.status)
    ) {
      continue;
    }

    const key = buildTeamPositionKey(
      rosterEntry.teamId,
      rosterEntry.positionName
    );
    const existingSlot = positionsByTeamAndName.get(key);
    if (existingSlot?.source === "plan_member") {
      applyPlanTeamMemberSummary([rosterEntry], positionsByTeamAndName);
      continue;
    }
    if (existingSlot) {
      continue;
    }

    const slot: TeamPosition = {
      id: buildPlanMemberOnlyPositionId(
        rosterEntry.teamId,
        rosterEntry.positionName
      ),
      name: rosterEntry.positionName,
      teamId: rosterEntry.teamId,
      teamName: rosterEntry.teamName,
      source: "plan_member",
      neededCount: 0,
    };

    positionsByTeamAndName.set(key, slot);
    applyPlanTeamMemberSummary([rosterEntry], positionsByTeamAndName);

    if (!teamMap.has(rosterEntry.teamId)) {
      teamMap.set(rosterEntry.teamId, {
        teamId: rosterEntry.teamId,
        teamName: rosterEntry.teamName,
        positions: [],
      });
    }
  }
};

const extractSeriesIdFromIncluded = (included: PCResource[]): string | null => {
  const series = included.find((r) => r.type === "Series");
  return series?.id ?? null;
};

const hasSeriesRelationshipData = (plan: PCResource): boolean => {
  const seriesData = plan.relationships?.series?.data;
  return !!seriesData && !Array.isArray(seriesData);
};

const getSeriesRelationshipLink = (plan: PCResource): string | null => {
  const rel = plan.relationships?.series;
  if (!rel) {
    return null;
  }
  return rel.links?.related ?? null;
};

const extractSeriesIdFromPlanResource = (plan: PCResource): string | null => {
  const seriesData = plan.relationships?.series?.data;
  if (seriesData && !Array.isArray(seriesData)) {
    return seriesData.id || null;
  }

  const relatedLink = getSeriesRelationshipLink(plan);
  if (isNonEmptyString(relatedLink)) {
    const match = /\/series\/(?<seriesId>[^/?#]+)/u.exec(relatedLink);
    if (isNonEmptyString(match?.groups?.seriesId)) {
      return match.groups.seriesId;
    }
  }

  return null;
};

const getSeriesIdForPlan = (
  serviceTypeId: string,
  planId: string,
  dependencies: TeamPositionDependencies
): Effect.Effect<string | null, PlanningCenterError> =>
  Effect.flatMap(
    dependencies.plansService.getPlanForServiceTypeWithSeries(
      serviceTypeId,
      planId
    ),
    (scopedPlan) => {
      const resolvedSeriesId =
        extractSeriesIdFromPlanResource(scopedPlan.data) ??
        extractSeriesIdFromIncluded(scopedPlan.included);

      const line = isNonEmptyString(resolvedSeriesId)
        ? log.info("Resolved series ID for fallback", {
            planId,
            serviceTypeId,
            resolvedSeriesId,
          })
        : log.warn(
            "Unable to resolve series ID for needed positions fallback",
            {
              planId,
              serviceTypeId,
              hasSeriesRelationshipData: hasSeriesRelationshipData(
                scopedPlan.data
              ),
              seriesRelationshipLink: getSeriesRelationshipLink(
                scopedPlan.data
              ),
              includedTypes: scopedPlan.included.map((r) => r.type),
            }
          );
      return Effect.as(line, resolvedSeriesId);
    }
  );

/**
 * Prefers the service-type endpoint; when it fails with a provider error or an
 * unusable response, retries through the plan's series and reports the original
 * failure if the plan has no series. Rate-limit and subrequest-limit failures
 * and cancellation propagate at once, without spending more requests.
 */
const resolveNeededPositions = (
  serviceTypeId: string,
  planId: string,
  seriesId: string | null,
  dependencies: TeamPositionDependencies
): Effect.Effect<NeededPositionsResolution, PlanningCenterError> => {
  if (isNonEmptyString(seriesId)) {
    return Effect.map(
      dependencies.catalogService.getPlanNeededPositionsWithTeams(
        seriesId,
        planId
      ),
      (response): NeededPositionsResolution => ({
        response,
        resolvedSeriesId: seriesId,
        neededPositionSource: "series-plan",
        usedSeriesFallback: false,
      })
    );
  }

  return dependencies.catalogService
    .getServiceTypePlanNeededPositionsWithTeams(serviceTypeId, planId)
    .pipe(
      Effect.map((response): NeededPositionsResolution => ({
        response,
        resolvedSeriesId: null,
        neededPositionSource: "service-type-plan",
        usedSeriesFallback: false,
      })),
      Effect.catchCause((cause) => {
        if (
          !isRecoverablePlanningCenterCause(cause, [
            "not-found",
            "provider-failure",
            "unusable-response",
          ])
        ) {
          return Effect.failCause(cause);
        }
        const fallback = Effect.flatMap(
          getSeriesIdForPlan(serviceTypeId, planId, dependencies),
          (resolvedSeriesId) =>
            isNonEmptyString(resolvedSeriesId)
              ? Effect.map(
                  dependencies.catalogService.getPlanNeededPositionsWithTeams(
                    resolvedSeriesId,
                    planId
                  ),
                  (response): NeededPositionsResolution => ({
                    response,
                    resolvedSeriesId,
                    neededPositionSource: "series-plan",
                    usedSeriesFallback: true,
                  })
                )
              : Effect.failCause(cause)
        );
        return Effect.andThen(
          log.warn(
            "Service-type needed positions fetch failed, trying series lookup fallback",
            {
              serviceTypeId,
              planId,
              error: describePlanningCenterCause(cause),
            }
          ),
          fallback
        );
      })
    );
};

const indexTeamPositions = (
  teamPositions: PCResource[],
  included: PCResource[]
): Map<string, TeamPosition> => {
  const positionsByTeamAndName = new Map<string, TeamPosition>();
  for (const position of teamPositions) {
    const { teamId, teamName } = getTeamInfo(position, included);
    const positionName = isString(position.attributes.name)
      ? position.attributes.name.trim()
      : "";
    if (!teamId || !teamName || !isNonEmptyString(positionName)) {
      continue;
    }
    positionsByTeamAndName.set(buildTeamPositionKey(teamId, positionName), {
      id: position.id,
      name: positionName,
      teamId,
      teamName,
      source: "team_position",
      neededCount: 0,
    });
  }
  return positionsByTeamAndName;
};

const resolveNeededTeamName = (
  teamId: string,
  matchedPosition: TeamPosition | undefined,
  neededIncluded: PCResource[],
  teamPositionIncluded: PCResource[]
): string => {
  if (isNonEmptyString(matchedPosition?.teamName)) {
    return matchedPosition.teamName;
  }
  for (const included of [neededIncluded, teamPositionIncluded]) {
    const team = findIncluded(included, "Team", teamId);
    if (team && isNonEmptyString(team.attributes.name)) {
      return team.attributes.name;
    }
  }
  return "";
};

interface NeededPositionMaps {
  teamMap: Map<string, TeamPositionGroup>;
  positionsByTeamAndName: Map<string, TeamPosition>;
  neededIncluded: PCResource[];
  teamPositionIncluded: PCResource[];
}

const mergeMatchedNeededPosition = (
  group: TeamPositionGroup,
  matchedPosition: TeamPosition,
  needed: PCResource,
  teamName: string,
  incrementBy: number,
  timeId: string | null,
  timePreferenceOptionId: string | null
): void => {
  const existingPosition = group.positions.find(
    (position) => position.id === matchedPosition.id
  );
  if (existingPosition) {
    existingPosition.neededCount =
      (existingPosition.neededCount ?? 0) + incrementBy;
    existingPosition.neededPositionId ??= needed.id;
    existingPosition.timeId ??= timeId;
    existingPosition.timePreferenceOptionId ??= timePreferenceOptionId;
    return;
  }
  matchedPosition.teamName = teamName;
  matchedPosition.neededPositionId ??= needed.id;
  matchedPosition.timeId ??= timeId;
  matchedPosition.timePreferenceOptionId ??= timePreferenceOptionId;
  matchedPosition.neededCount = incrementBy;
  group.positions.push(matchedPosition);
};

const applyNeededPosition = (
  needed: PCResource,
  maps: NeededPositionMaps
): void => {
  const { quantity } = needed.attributes;
  if (isNumber(quantity) && quantity <= 0) {
    return;
  }
  const teamData = needed.relationships?.team?.data;
  const teamId = !Array.isArray(teamData) && teamData ? teamData.id : "";
  const neededName = isString(needed.attributes.team_position_name)
    ? needed.attributes.team_position_name.trim()
    : "";
  if (!teamId || !neededName) {
    return;
  }
  const positionKey = buildTeamPositionKey(teamId, neededName);
  const matchedPosition = maps.positionsByTeamAndName.get(positionKey);
  const teamName = resolveNeededTeamName(
    teamId,
    matchedPosition,
    maps.neededIncluded,
    maps.teamPositionIncluded
  );
  if (!teamName) {
    return;
  }
  if (!maps.teamMap.has(teamId)) {
    maps.teamMap.set(teamId, { teamId, teamName, positions: [] });
  }
  const group = maps.teamMap.get(teamId);
  if (!group) {
    return;
  }
  const incrementBy = isNumber(quantity) && quantity > 0 ? quantity : 1;
  const timeId = getRelationshipId(needed.relationships?.time?.data);
  const timePreferenceOptionId = getRelationshipId(
    needed.relationships?.time_preference_option?.data
  );

  if (!matchedPosition) {
    const slot: TeamPosition = {
      id: buildNeededPositionSlotId(needed.id),
      name: neededName,
      teamId,
      teamName,
      source: "needed_position",
      neededPositionId: needed.id,
      timeId,
      timePreferenceOptionId,
      neededCount: incrementBy,
    };
    group.positions.push(slot);
    maps.positionsByTeamAndName.set(positionKey, slot);
    return;
  }

  mergeMatchedNeededPosition(
    group,
    matchedPosition,
    needed,
    teamName,
    incrementBy,
    timeId,
    timePreferenceOptionId
  );
};

const groupNeededTeamPositions = (
  serviceTypeId: string,
  planId: string,
  {
    teamPositionResponse,
    neededPositionsResolution,
    planTeamMembersResponse,
  }: {
    teamPositionResponse: { data: PCResource[]; included: PCResource[] };
    neededPositionsResolution: NeededPositionsResolution;
    planTeamMembersResponse: { data: PCResource[]; included: PCResource[] };
  }
): Effect.Effect<TeamPositionGroup[]> => {
  const {
    response: neededPositionResponse,
    resolvedSeriesId,
    neededPositionSource,
    usedSeriesFallback,
  } = neededPositionsResolution;

  const teamPositions = teamPositionResponse.data;
  const teamPositionIncluded = teamPositionResponse.included ?? [];
  const neededPositions = neededPositionResponse.data;
  const neededIncluded = neededPositionResponse.included ?? [];
  const planTeamMembers = planTeamMembersResponse.data;
  const planSchedulingContext = buildPlanSchedulingContext({
    serviceTypeId,
    planId,
    planTeamMembers,
    included: planTeamMembersResponse.included ?? [],
  });
  const teamMap = new Map<string, TeamPositionGroup>();
  const positionsByTeamAndName = indexTeamPositions(
    teamPositions,
    teamPositionIncluded
  );
  const positionMaps = {
    teamMap,
    positionsByTeamAndName,
    neededIncluded,
    teamPositionIncluded,
  };
  for (const needed of neededPositions) {
    applyNeededPosition(needed, positionMaps);
  }

  applyPlanTeamMemberSummary(
    planSchedulingContext.rosterEntries,
    positionsByTeamAndName
  );
  addPlanMemberOnlyPositions(
    planSchedulingContext.rosterEntries,
    teamMap,
    positionsByTeamAndName
  );
  addFilledPositionsToGroups(teamMap, positionsByTeamAndName);

  const groupedPositions: TeamPositionGroup[] = [...teamMap.values()];
  groupedPositions.sort((a, b) => a.teamName.localeCompare(b.teamName));
  for (const group of groupedPositions) {
    group.positions.sort((a, b) => a.name.localeCompare(b.name));
  }

  const resolved = log.info("Resolved plan needed positions", {
    serviceTypeId,
    planId,
    seriesId: resolvedSeriesId ?? null,
    neededPositionSource,
    usedSeriesFallback,
    serviceTypeTeamPositionCount: teamPositions.length,
    neededPositionCount: neededPositions.length,
    planTeamMemberCount: planTeamMembers.length,
    matchedTeamCount: groupedPositions.length,
    matchedPositionCount: groupedPositions.reduce(
      (sum, g) => sum + g.positions.length,
      0
    ),
  });

  if (groupedPositions.length > 0 || neededPositions.length === 0) {
    return Effect.as(resolved, groupedPositions);
  }
  const neededSamples = neededPositions.slice(0, 10).map((np) => {
    const needed = np;
    const teamData = needed.relationships?.team?.data;
    const teamId = !Array.isArray(teamData) && teamData ? teamData.id : null;
    return {
      teamId,
      name: isString(needed.attributes.team_position_name)
        ? needed.attributes.team_position_name
        : null,
      quantity: isNumber(needed.attributes.quantity)
        ? needed.attributes.quantity
        : null,
    };
  });
  return Effect.as(
    Effect.andThen(
      resolved,
      log.warn(
        "No needed positions matched service type team positions (possible name mismatch)",
        { planId, neededSamples }
      )
    ),
    groupedPositions
  );
};

export const getNeededTeamPositionsForPlan = (
  serviceTypeId: string,
  planId: string,
  seriesId: string | null | undefined,
  dependencies: TeamPositionDependencies
): Effect.Effect<TeamPositionGroup[], PlanningCenterError> =>
  Effect.andThen(
    log.info("Fetching needed team positions for plan", {
      serviceTypeId,
      planId,
      providedSeriesId: seriesId ?? null,
    }),
    Effect.flatMap(
      Effect.all(
        [
          dependencies.catalogService.getServiceTypeTeamPositionsWithTeams(
            serviceTypeId
          ),
          resolveNeededPositions(
            serviceTypeId,
            planId,
            seriesId ?? null,
            dependencies
          ),
          dependencies.peopleService.getPlanTeamMembers(serviceTypeId, planId),
        ],
        { concurrency: "unbounded" }
      ),
      ([
        teamPositionResponse,
        neededPositionsResolution,
        planTeamMembersResponse,
      ]) =>
        groupNeededTeamPositions(serviceTypeId, planId, {
          teamPositionResponse,
          neededPositionsResolution,
          planTeamMembersResponse,
        })
    )
  );
