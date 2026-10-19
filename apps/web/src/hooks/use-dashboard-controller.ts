import { speculativeQuery } from "@pcobooster/client/query";
import { buildPlanMemberPositionId } from "@pcobooster/planning-center-models/custom-position";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { SlotRef } from "@pcobooster/planning-center-models/scheduling-notifications";
import type {
  Plan,
  ServiceType,
  TeamPosition,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ReadQueryState } from "@/components/query-data-boundary";
import { useCollapsedTeams } from "@/hooks/use-collapsed-teams";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { createPlanItemsQueryOptions } from "@/hooks/use-plan-items";
import { usePlanTimes } from "@/hooks/use-plan-times";
import {
  ADJACENT_PLANS_LIMIT,
  usePlanDetails,
  usePlans,
} from "@/hooks/use-plans";
import {
  createPlanWindowHistoryQueryOptions,
  isPositionCandidatesFresh,
  prefetchPositionCandidates,
  toPlanDateKey,
  usePositionCandidates,
} from "@/hooks/use-position-candidates";
import type { CandidateSlot } from "@/hooks/use-position-candidates";
import { useServiceTypes } from "@/hooks/use-service-types";
import { useTeamPositions } from "@/hooks/use-team-positions";
import { queryKeys } from "@/lib/query-keys";
import { requestScheduler } from "@/lib/request-priority";
import type {
  DashboardView,
  PlanSlotSelection,
} from "@/lib/schedule-navigation";
import { planSlotLink } from "@/lib/schedule-navigation";
import {
  findFirstPosition,
  findNextOpenPosition,
} from "@/lib/schedule/open-positions";

interface RouteSelectionIds {
  teamId: string | null;
  positionId: string | null;
  view: DashboardView;
}

const withFirstPositionDefault = (
  teamPositionGroups: readonly TeamPositionGroup[],
  routeIds: RouteSelectionIds
): Pick<RouteSelectionIds, "teamId" | "positionId"> => {
  if (isNonEmptyString(routeIds.positionId)) {
    return routeIds;
  }
  const first =
    findNextOpenPosition(teamPositionGroups, null) ??
    findFirstPosition(teamPositionGroups);
  return first ?? routeIds;
};

/**
 * The slot the URL names. With `openFirstPosition`, a URL without one opens the first
 * position that still needs someone (or the first position), so wide layouts never show
 * an empty pane beside the position list.
 */
const resolveSelectedSlot = (
  teamPositionGroups: TeamPositionGroup[] | undefined,
  routeIds: RouteSelectionIds,
  openFirstPosition: boolean
) => {
  const { teamId, positionId } = openFirstPosition
    ? withFirstPositionDefault(teamPositionGroups ?? [], routeIds)
    : routeIds;
  const selectedTeamGroup =
    teamPositionGroups?.find((group) => group.teamId === teamId) ?? null;
  const selectedPositionObj =
    selectedTeamGroup?.positions.find(
      (position) => position.id === positionId
    ) ?? null;

  const selectedTeam = selectedTeamGroup?.teamId ?? null;
  const selectedPosition = selectedPositionObj?.id ?? null;
  const selectedTimePreferenceOptionId =
    selectedPositionObj?.timePreferenceOptionId ?? null;
  const selectedPositionUsesRoster =
    selectedPositionObj?.source === undefined ||
    selectedPositionObj.source === "team_position";
  return {
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    selectedTimePreferenceOptionId,
  };
};

/**
 * Plans come sorted by date, so the listed neighbors are the plans just before and after,
 * nearest first. Fewer than `ADJACENT_PLANS_LIMIT` on a side means the list ends there and
 * the rest are looked up when someone asks for them.
 */
interface ListedNeighbors {
  previousPlans: readonly Plan[];
  nextPlans: readonly Plan[];
}

const listedNeighbors = (
  plans: readonly Plan[] | undefined,
  index: number
): ListedNeighbors => {
  if (plans === undefined || index === -1) {
    return { previousPlans: [], nextPlans: [] };
  }
  return {
    previousPlans: plans
      .slice(Math.max(0, index - ADJACENT_PLANS_LIMIT), index)
      .toReversed(),
    nextPlans: plans.slice(index + 1, index + 1 + ADJACENT_PLANS_LIMIT),
  };
};

/** Assign on wide layouts keeps its position list in a sidebar (Tailwind `lg`). */
const useOpensFirstPosition = (view: DashboardView): boolean => {
  const isWideLayout = useMediaQuery("(min-width: 1024px)");
  return view === "assign" && isWideLayout;
};

const findFailedWorkspaceQuery = (
  selectedServiceType: ServiceType | null,
  selectedPlan: Plan | null,
  serviceTypesQuery: ReadQueryState<unknown>,
  plansQuery: ReadQueryState<unknown>,
  planDetails: ReadQueryState<unknown>
): ReadQueryState<unknown> | undefined => {
  const requiredQueries = [
    ...(selectedServiceType === null ? [serviceTypesQuery] : []),
    ...(selectedPlan === null ? [plansQuery, planDetails] : []),
  ];
  return requiredQueries.find(
    (query) => query.error !== null && query.data === undefined
  );
};

const usePlanWorkspaceData = (
  serviceTypeId: string,
  planId: string,
  routeIds: RouteSelectionIds
) => {
  const opensFirstPosition = useOpensFirstPosition(routeIds.view);
  const serviceTypesQuery = useServiceTypes();
  const { data: serviceTypes, isLoading: serviceTypesLoading } =
    serviceTypesQuery;
  const routeServiceTypeId = serviceTypeId;
  const routePlanId = planId;
  const selectedServiceType =
    serviceTypes?.find(
      (serviceType) => serviceType.id === routeServiceTypeId
    ) ?? null;

  const plansQuery = usePlans(routeServiceTypeId);
  const { data: plans, isLoading: plansLoading } = plansQuery;
  const selectedPlanIndex =
    plans?.findIndex((plan) => plan.id === routePlanId) ?? -1;
  const listedPlan = plans?.[selectedPlanIndex] ?? null;
  // Past plans (and ones past the list's window) load on their own.
  const planDetails = usePlanDetails(
    routeServiceTypeId,
    routePlanId,
    plans !== undefined && listedPlan === null
  );
  const selectedPlan = listedPlan ?? planDetails.data ?? null;
  const { previousPlans, nextPlans } = listedNeighbors(
    plans,
    selectedPlanIndex
  );

  const teamPositionsQuery = useTeamPositions(
    routeServiceTypeId,
    routePlanId,
    selectedPlan?.seriesId ?? null
  );
  const { data: teamPositionGroups, isLoading: teamPositionsLoading } =
    teamPositionsQuery;
  const planTimesQuery = usePlanTimes(routeServiceTypeId, routePlanId);
  const { data: planTimes } = planTimesQuery;

  const {
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    selectedTimePreferenceOptionId,
  } = resolveSelectedSlot(teamPositionGroups, routeIds, opensFirstPosition);
  const planDateKey = toPlanDateKey(selectedPlan?.sortDate ?? null);
  const candidateSlot = useMemo<CandidateSlot | null>(
    () =>
      routeIds.view === "assign" &&
      planDateKey !== null &&
      isNonEmptyString(selectedPosition) &&
      selectedPositionUsesRoster
        ? {
            serviceTypeId: routeServiceTypeId,
            teamId: selectedTeam,
            positionId: selectedPosition,
            planId: routePlanId,
            dateKey: planDateKey,
            timePreferenceOptionId: selectedTimePreferenceOptionId,
          }
        : null,
    [
      planDateKey,
      routeIds.view,
      routePlanId,
      routeServiceTypeId,
      selectedPosition,
      selectedPositionUsesRoster,
      selectedTeam,
      selectedTimePreferenceOptionId,
    ]
  );
  const candidateList = usePositionCandidates(candidateSlot);

  const planDetailsSettled =
    planDetails.isFetched || planDetails.isError || listedPlan !== null;
  const workspaceFailedQuery = findFailedWorkspaceQuery(
    selectedServiceType,
    selectedPlan,
    serviceTypesQuery,
    plansQuery,
    planDetails
  );
  const workspaceUnavailable =
    !serviceTypesLoading &&
    !plansLoading &&
    (!selectedServiceType || (!selectedPlan && planDetailsSettled));
  return {
    selectedServiceType,
    selectedPlan,
    previousPlans,
    nextPlans,
    teamPositionGroups,
    teamPositionsLoading,
    teamPositionsQuery,
    planTimesQuery,
    planTimes,
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    candidateList,
    workspaceUnavailable,
    workspaceFailedQuery,
  };
};

export const useDashboardController = ({
  serviceTypeId,
  planId,
  view,
}: {
  serviceTypeId: string;
  planId: string;
  view: DashboardView;
}) => {
  const router = useRouter();
  const navigate = useNavigate();
  const search = useSearch({
    from: "/_app/services/$serviceTypeId/plans/$planId/$view",
  });
  const queryClient = useQueryClient();
  const isPhone = useIsMobile();
  /** True once a slot was opened from the phone position list, so Back can pop history. */
  const openedSlotFromListRef = useRef(false);

  const [collapsedTeamsByPlan, setCollapsedTeamsByPlan] = useCollapsedTeams();

  const routeIds = useMemo<RouteSelectionIds>(
    () => ({
      teamId: search.teamId ?? null,
      positionId: search.positionId ?? null,
      view,
    }),
    [search.teamId, search.positionId, view]
  );

  const navigateTo = useCallback(
    (next: PlanSlotSelection, method: "push" | "replace" = "push") => {
      if (
        next.serviceTypeId === serviceTypeId &&
        next.planId === planId &&
        next.view === routeIds.view &&
        (next.teamId ?? "") === (routeIds.teamId ?? "") &&
        (next.positionId ?? "") === (routeIds.positionId ?? "")
      ) {
        return;
      }
      void navigate({ ...planSlotLink(next), replace: method === "replace" });
    },
    [navigate, planId, routeIds, serviceTypeId]
  );

  const {
    selectedServiceType,
    selectedPlan,
    previousPlans,
    nextPlans,
    teamPositionGroups,
    teamPositionsLoading,
    teamPositionsQuery,
    planTimesQuery,
    planTimes,
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    candidateList,
    workspaceUnavailable,
    workspaceFailedQuery,
  } = usePlanWorkspaceData(serviceTypeId, planId, routeIds);
  const routeServiceTypeId = serviceTypeId;
  const routePlanId = planId;
  const selectedPlanId = planId;
  const collapsedTeams = collapsedTeamsByPlan[planId] ?? {};
  const hasPlanUrlSelection = true;
  const hasSelectedPlanMetadata = Boolean(selectedServiceType && selectedPlan);
  const activeView = view;

  useEffect(() => {
    if (!teamPositionGroups || teamPositionsLoading) {
      return;
    }
    if (
      routeIds.teamId === selectedTeam &&
      routeIds.positionId === selectedPosition
    ) {
      return;
    }
    // The URL named a slot this plan doesn't have; show the resolved selection instead.
    void navigate({
      ...planSlotLink({
        serviceTypeId,
        planId,
        view,
        teamId: selectedTeam,
        positionId: selectedPosition,
      }),
      replace: true,
    });
  }, [
    navigate,
    planId,
    routeIds,
    selectedPosition,
    selectedTeam,
    serviceTypeId,
    teamPositionGroups,
    teamPositionsLoading,
    view,
  ]);

  // Phones have no Assign tab: without a position, Assign is Lineup's position list.
  const phoneAssignWithoutPosition =
    isPhone && view === "assign" && !isNonEmptyString(routeIds.positionId);
  useEffect(() => {
    if (phoneAssignWithoutPosition) {
      void navigate({
        ...planSlotLink({
          serviceTypeId,
          planId,
          view: "lineup",
          teamId: null,
          positionId: null,
        }),
        replace: true,
      });
    }
  }, [navigate, phoneAssignWithoutPosition, planId, serviceTypeId]);

  // What the other tabs need waits in the speculative lane, behind the view on screen: the
  // Plan tab's items (the Overview, Plan, and Practice views load them directly), and on the Assign view
  // the plan-window history every position's candidates are scored with (up to about 40
  // Planning Center requests cold).
  useEffect(() => {
    const leave = new AbortController();
    const viewLoadsItems =
      activeView === "plan" ||
      activeView === "overview" ||
      activeView === "practice";
    if (hasPlanUrlSelection && !viewLoadsItems) {
      void requestScheduler.runSpeculative(async () => {
        await queryClient.query(
          speculativeQuery(
            createPlanItemsQueryOptions(routeServiceTypeId, routePlanId)
          )
        );
      }, leave.signal);
    }
    return () => {
      leave.abort();
    };
  }, [
    activeView,
    hasPlanUrlSelection,
    queryClient,
    routePlanId,
    routeServiceTypeId,
  ]);

  const planDateKey = toPlanDateKey(selectedPlan?.sortDate ?? null);
  useEffect(() => {
    const leave = new AbortController();
    if (activeView === "assign" && planDateKey !== null) {
      void requestScheduler.runSpeculative(async () => {
        await queryClient.query(
          speculativeQuery(createPlanWindowHistoryQueryOptions(planDateKey))
        );
      }, leave.signal);
    }
    return () => {
      leave.abort();
    };
  }, [activeView, planDateKey, queryClient]);

  const getCandidateSlot = useCallback(
    (slot: SlotRef): CandidateSlot | null => {
      const dateKey = toPlanDateKey(selectedPlan?.sortDate ?? null);
      if (!routeServiceTypeId || !selectedPlan || dateKey === null) {
        return null;
      }
      const slotPosition = teamPositionGroups
        ?.find((group) => group.teamId === slot.teamId)
        ?.positions.find((position) => position.id === slot.positionId);
      if (slotPosition?.source && slotPosition.source !== "team_position") {
        return null;
      }
      return {
        serviceTypeId: routeServiceTypeId,
        teamId: slot.teamId,
        positionId: slot.positionId,
        planId: selectedPlan.id,
        dateKey,
      };
    },
    [routeServiceTypeId, selectedPlan, teamPositionGroups]
  );

  const prefetchSlotPeople = useCallback(
    async (slot: SlotRef) => {
      const candidateSlot = getCandidateSlot(slot);
      if (candidateSlot === null) {
        return;
      }
      try {
        await prefetchPositionCandidates(queryClient, candidateSlot);
      } catch {
        // The selected-slot queries own any visible loading error.
      }
    },
    [getCandidateSlot, queryClient]
  );

  // Candidates are cheap, but their availability costs a request or more per person, so only
  // a slot the pointer or focus rests on is loaded ahead of the click.
  const { getIntentProps: getSlotIntentProps, cancelIntent: cancelSlotIntent } =
    useIntentPrefetch<SlotRef>({
      keyOf: (slot) => `${slot.teamId}:${slot.positionId}`,
      isFresh: (slot) => {
        const candidateSlot = getCandidateSlot(slot);
        return (
          candidateSlot === null ||
          isPositionCandidatesFresh(queryClient, candidateSlot)
        );
      },
      prefetch: prefetchSlotPeople,
    });

  const handleSlotSelect = (
    slot: SlotRef,
    { replace = false }: { replace?: boolean } = {}
  ) => {
    if (!isNonEmptyString(routeIds.positionId)) {
      openedSlotFromListRef.current = true;
    }
    // The selected slot's queries load its list as interactive work.
    cancelSlotIntent();

    if (selectedPlanId) {
      setCollapsedTeamsByPlan((prev) => {
        const currentForPlan = prev[selectedPlanId] ?? {};
        if (!currentForPlan[slot.teamId]) {
          return prev;
        }

        return {
          ...prev,
          [selectedPlanId]: {
            ...currentForPlan,
            [slot.teamId]: false,
          },
        };
      });
    }

    navigateTo(
      {
        serviceTypeId: routeServiceTypeId,
        planId: routePlanId,
        teamId: slot.teamId,
        positionId: slot.positionId,
        view: "assign",
      },
      replace ? "replace" : "push"
    );
  };

  /** Returns a phone from a position's candidates to Lineup, or Assign to its position list. */
  const handleSlotClear = () => {
    if (openedSlotFromListRef.current) {
      openedSlotFromListRef.current = false;
      router.history.back();
      return;
    }
    navigateTo(
      {
        serviceTypeId: routeServiceTypeId,
        planId: routePlanId,
        teamId: null,
        positionId: null,
        view: isPhone ? "lineup" : "assign",
      },
      "replace"
    );
  };

  const handleAddCustomPosition = (
    team: { teamId: string; teamName: string },
    positionName: string
  ): SlotRef | null => {
    if (!routeServiceTypeId || !routePlanId) {
      return null;
    }
    const trimmedName = positionName.trim();
    if (!trimmedName) {
      return null;
    }

    const existingPosition = teamPositionGroups
      ?.find((group) => group.teamId === team.teamId)
      ?.positions.find(
        (position) =>
          position.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
    if (existingPosition) {
      return {
        teamId: team.teamId,
        teamName: team.teamName,
        positionId: existingPosition.id,
        positionName: existingPosition.name,
        source: existingPosition.source,
      };
    }

    const positionId = buildPlanMemberPositionId(team.teamId, trimmedName);
    const slot: SlotRef = {
      teamId: team.teamId,
      teamName: team.teamName,
      positionId,
      positionName: trimmedName,
      source: "custom",
    };

    queryClient.setQueryData<TeamPositionGroup[]>(
      queryKeys.teamPositions(routeServiceTypeId, routePlanId, null),
      (groups) => {
        if (!groups) {
          return groups;
        }
        return groups.map((group) => {
          if (group.teamId !== team.teamId) {
            return group;
          }
          const duplicate = group.positions.some(
            (position) =>
              position.name.trim().toLowerCase() === trimmedName.toLowerCase()
          );
          if (duplicate) {
            return group;
          }

          const position: TeamPosition = {
            id: positionId,
            name: trimmedName,
            teamId: team.teamId,
            teamName: team.teamName,
            source: "custom",
            neededCount: 0,
          };

          return {
            ...group,
            positions: [...group.positions, position].toSorted((a, b) =>
              a.name.localeCompare(b.name)
            ),
          };
        });
      }
    );

    return slot;
  };

  const toggleTeamCollapsed = (teamId: string) => {
    if (!selectedPlanId) {
      return;
    }
    setCollapsedTeamsByPlan((prev) => {
      const currentForPlan = prev[selectedPlanId] ?? {};
      return {
        ...prev,
        [selectedPlanId]: {
          ...currentForPlan,
          [teamId]: !currentForPlan[teamId],
        },
      };
    });
  };

  return {
    workspaceUnavailable,
    workspaceFailedQuery,
    hasPlanUrlSelection,
    hasSelectedPlanMetadata,
    selectedServiceType,
    selectedPlan,
    previousPlans,
    nextPlans,
    activeView,
    teamPositionsQuery,
    planTimesQuery,
    teamPositionsLoading,
    teamPositionGroups,
    collapsedTeams,
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    candidateList,
    routeServiceTypeId,
    routePlanId,
    toggleTeamCollapsed,
    handleSlotSelect,
    handleSlotClear,
    getSlotIntentProps,
    handleAddCustomPosition,
    planTimes,
  };
};
