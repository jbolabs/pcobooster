import { NotFound } from "@pcobooster/contracts/faults/not-found";
import type {
  PlanWindowHistoryBatch,
  PositionCandidates,
} from "@pcobooster/contracts/http/people-schemas";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type {
  PositionCandidate,
  SelectedPlanSlot,
} from "@pcobooster/planning-center-models/position-candidates";
import type {
  FilledPositionPerson,
  TeamPosition,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import type {
  InvalidateQueryFilters,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";

import { clearCachedMyScheduledPlans } from "@/lib/my-scheduled-plans-cache";
import { clearCachedPeopleDashboards } from "@/lib/people-dashboard-cache";
import { clearCachedCandidateSchedules } from "@/lib/position-candidates-cache";
import { queryKeys, scheduleMutationKey } from "@/lib/query-keys";
import { clearCachedTeamPositions } from "@/lib/team-positions-cache";

export type OptimisticPlanPersonStatusCode = "C" | "U" | "D";

export interface OptimisticSchedulePerson {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName: string;
  photoUrl?: string | null;
  photoThumbnailUrl?: string | null;
}

export interface OptimisticScheduleSlot {
  serviceTypeId: string;
  planId: string;
  teamId: string;
  positionId: string;
}

const OPTIMISTIC_PLAN_PERSON_ID_PREFIX = "optimistic:";

/** Planning Center no longer has the plan person, so the lineup on screen is stale. */
export const isMissingPlanPersonError = (error: Error): boolean =>
  error instanceof NotFound;

/** Stands in for the plan person an assign creates until Planning Center returns its ID. */
export const createOptimisticPlanPersonId = (
  slot: Omit<OptimisticScheduleSlot, "serviceTypeId">,
  personId: string
): string =>
  `${OPTIMISTIC_PLAN_PERSON_ID_PREFIX}${slot.planId}:${slot.teamId}:${slot.positionId}:${personId}`;

/**
 * A plan person Planning Center has saved. A stand-in can't change status or come off the
 * plan until its assign lands; Planning Center would answer 404.
 */
export const isSavedPlanPersonId = (
  planPersonId: string | null | undefined
): planPersonId is string =>
  isNonEmptyString(planPersonId) &&
  !planPersonId.startsWith(OPTIMISTIC_PLAN_PERSON_ID_PREFIX);

export interface ScheduleMutationInvalidateContext {
  serviceTypeId?: string | null;
  personId?: string | null;
  planId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
}

export const SCHEDULE_MUTATION_RECONCILE_DELAY_MS = 2500;

const activeRefetchTimers = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof setTimeout>>
>();

const CANDIDATES_QUERY_KEY = ["people"] as const;
const WINDOW_HISTORY_QUERY_KEY = ["people-plan-window-history"] as const;
const CANDIDATE_DETAILS_QUERY_KEY = ["people-candidate-details"] as const;

interface ScheduleMutationSnapshot {
  applied?: ScheduleMutationSnapshot;
  candidates: [QueryKey, PositionCandidates | undefined][];
  windowHistory: [QueryKey, PlanWindowHistoryBatch[] | undefined][];
  teamPositions: [QueryKey, TeamPositionGroup[] | undefined][];
}

const snapshotScheduleCaches = (
  queryClient: QueryClient
): ScheduleMutationSnapshot => ({
  candidates: queryClient.getQueriesData<PositionCandidates>({
    queryKey: CANDIDATES_QUERY_KEY,
  }),
  windowHistory: queryClient.getQueriesData<PlanWindowHistoryBatch[]>({
    queryKey: WINDOW_HISTORY_QUERY_KEY,
  }),
  teamPositions: queryClient.getQueriesData<TeamPositionGroup[]>({
    queryKey: ["team-positions"],
  }),
});

const recalculateFilledCounts = (position: TeamPosition): TeamPosition => {
  const people = (position.filledPeople ?? []).toSorted((a, b) => {
    if (a.status !== b.status) {
      return a.status === "confirmed" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return {
    ...position,
    filledConfirmedCount: people.filter(
      (person) => person.status === "confirmed"
    ).length,
    filledPendingCount: people.filter((person) => person.status === "pending")
      .length,
    filledPeople: people.length > 0 ? people : undefined,
  };
};

const sameSelectedSlot = (
  first: SelectedPlanSlot | null,
  second: SelectedPlanSlot | null
): boolean =>
  first?.planPersonId === second?.planPersonId &&
  first?.status === second?.status &&
  first?.declineReason === second?.declineReason;

/** Roll back only rows this mutation changed, preserving independent edits made since. */
const restoreChangedRows = <Row>(
  before: readonly Row[],
  applied: readonly Row[],
  current: readonly Row[],
  keyOf: (row: Row) => string,
  restoreUpdated: (before: Row, applied: Row, current: Row) => Row = (
    previous,
    next,
    latest
  ) => (latest === next ? previous : latest),
  matchesApplied: (current: Row, applied: Row) => boolean = Object.is
): Row[] => {
  const previousById = new Map(before.map((row) => [keyOf(row), row]));
  const appliedById = new Map(applied.map((row) => [keyOf(row), row]));
  const restored = current.flatMap((row) => {
    const id = keyOf(row);
    const previous = previousById.get(id);
    const next = appliedById.get(id);
    if (previous === next || next === undefined) {
      return [row];
    }
    if (previous === undefined) {
      return matchesApplied(row, next) ? [] : [row];
    }
    return [restoreUpdated(previous, next, row)];
  });
  const currentIds = new Set(current.map(keyOf));
  for (const row of before) {
    const id = keyOf(row);
    if (!appliedById.has(id) && !currentIds.has(id)) {
      restored.push(row);
    }
  }
  return restored;
};

/** Every position's candidates show the same current "Also on" assignments as the sidebar. */
const updateCandidateRosterLabels = (
  queryClient: QueryClient,
  previous: ScheduleMutationSnapshot
) => {
  for (const [key, groups] of queryClient.getQueriesData<TeamPositionGroup[]>({
    queryKey: ["team-positions"],
  })) {
    const before = previous.teamPositions.find(
      ([queryKey]) => queryKey[1] === key[1] && queryKey[2] === key[2]
    )?.[1];
    if (!groups || groups === before) {
      continue;
    }
    const labels = new Map<string, string[]>();
    for (const group of groups) {
      for (const position of group.positions) {
        for (const person of position.filledPeople ?? []) {
          const id = person.personId ?? person.id;
          const personLabels = labels.get(id) ?? [];
          personLabels.push(`${group.teamName} - ${position.name}`);
          labels.set(id, personLabels);
        }
      }
    }
    queryClient.setQueriesData<PositionCandidates>(
      {
        queryKey: ["people", key[1]],
        predicate: ({ queryKey }) => queryKey[4] === key[2],
      },
      (data) =>
        data === undefined
          ? data
          : {
              ...data,
              candidates: data.candidates.map((candidate) => ({
                ...candidate,
                selectedPlanRosterLabels: labels.get(candidate.id) ?? [],
              })),
            }
    );
  }
};

export const restoreScheduleCaches = (
  queryClient: QueryClient,
  snapshot: ScheduleMutationSnapshot | undefined
) => {
  const applied = snapshot?.applied;
  if (!snapshot || !applied) {
    return;
  }
  for (const [index, [key, before]] of snapshot.candidates.entries()) {
    const after = applied.candidates[index]?.[1];
    if (!before || !after) {
      continue;
    }
    queryClient.setQueryData<PositionCandidates>(key, (current) =>
      current === undefined
        ? current
        : {
            ...current,
            candidates: restoreChangedRows(
              before.candidates,
              after.candidates,
              current.candidates,
              (row) => row.id,
              (previous, next, latest) => ({
                ...latest,
                selectedPlanSlot: sameSelectedSlot(
                  latest.selectedPlanSlot,
                  next.selectedPlanSlot
                )
                  ? previous.selectedPlanSlot
                  : latest.selectedPlanSlot,
              }),
              (latest, next) =>
                sameSelectedSlot(latest.selectedPlanSlot, next.selectedPlanSlot)
            ),
          }
    );
  }
  for (const [index, [key, before]] of snapshot.windowHistory.entries()) {
    const after = applied.windowHistory[index]?.[1];
    if (!before || !after) {
      continue;
    }
    queryClient.setQueryData<PlanWindowHistoryBatch[]>(key, (current) =>
      current?.map((call, callIndex) => {
        const previousCall = before[callIndex];
        const nextCall = after[callIndex];
        if (previousCall === undefined || nextCall === undefined) {
          return call;
        }
        return {
          ...call,
          people: call.people.map((person) => ({
            ...person,
            rows: restoreChangedRows(
              previousCall.people.find(
                (row) => row.personId === person.personId
              )?.rows ?? [],
              nextCall.people.find((row) => row.personId === person.personId)
                ?.rows ?? [],
              person.rows,
              (row) => row.id
            ),
          })),
        };
      })
    );
  }
  for (const [index, [key, before]] of snapshot.teamPositions.entries()) {
    const after = applied.teamPositions[index]?.[1];
    if (!before || !after) {
      continue;
    }
    queryClient.setQueryData<TeamPositionGroup[]>(key, (current) =>
      current?.map((group) => ({
        ...group,
        positions: group.positions.map((position) => {
          const previous = before
            .find((row) => row.teamId === group.teamId)
            ?.positions.find((row) => row.id === position.id);
          const next = after
            .find((row) => row.teamId === group.teamId)
            ?.positions.find((row) => row.id === position.id);
          if (!previous || !next || previous === next) {
            return position;
          }
          return recalculateFilledCounts({
            ...position,
            filledPeople: restoreChangedRows(
              previous.filledPeople ?? [],
              next.filledPeople ?? [],
              position.filledPeople ?? [],
              (row) => row.planPersonId
            ),
          });
        }),
      }))
    );
  }
  updateCandidateRosterLabels(queryClient, applied);
};

interface ScheduleMutationQueryFilters extends InvalidateQueryFilters {
  queryKey: QueryKey;
  /**
   * Refetch cached copies nobody is viewing right away. Off for plan-window histories: each
   * costs up to 40 Planning Center requests, so only the one on screen is refetched.
   */
  refetchInactive: boolean;
}

/** Candidate details that carry schedule history; blockouts do not change on schedule writes. */
const hasScheduleHistory = ({ queryKey }: { queryKey: QueryKey }) =>
  queryKey[2] !== null;

const getScheduleMutationQueryFilters = (
  context: ScheduleMutationInvalidateContext
): ScheduleMutationQueryFilters[] => {
  const serviceTypeId = context.serviceTypeId ?? null;
  const planId = context.planId ?? null;

  return [
    {
      queryKey: ["my-scheduled-plans"],
      refetchInactive: true,
    },
    {
      queryKey:
        isNonEmptyString(serviceTypeId) && planId !== null && planId !== ""
          ? ["team-positions", serviceTypeId, planId]
          : ["team-positions"],
      refetchInactive: true,
    },
    {
      queryKey:
        isNonEmptyString(serviceTypeId) && isNonEmptyString(planId)
          ? ["people", serviceTypeId]
          : CANDIDATES_QUERY_KEY,
      predicate: ({ queryKey }) =>
        !isNonEmptyString(planId) || queryKey[4] === planId,
      refetchInactive: true,
    },
    { queryKey: WINDOW_HISTORY_QUERY_KEY, refetchInactive: false },
    {
      queryKey: CANDIDATE_DETAILS_QUERY_KEY,
      predicate: hasScheduleHistory,
      refetchInactive: false,
    },
  ];
};

const toQueryFilters = ({
  refetchInactive: _refetchInactive,
  ...filters
}: ScheduleMutationQueryFilters): InvalidateQueryFilters & {
  queryKey: QueryKey;
} => filters;

export const invalidateScheduleMutationQueries = (
  queryClient: QueryClient,
  context: ScheduleMutationInvalidateContext
) => {
  for (const filters of getScheduleMutationQueryFilters(context)) {
    void queryClient.invalidateQueries(toQueryFilters(filters));
  }
};

/**
 * Plan person time and plan time writes change the rosters and plan times that candidate history
 * is built from: plan-window histories and schedule-history candidate details go stale, and only
 * the ones on screen refetch now. Blockout-only details are untouched.
 */
export const invalidateCandidateHistoryQueries = async (
  queryClient: QueryClient
): Promise<void> => {
  clearCachedCandidateSchedules();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: WINDOW_HISTORY_QUERY_KEY }),
    queryClient.invalidateQueries({
      queryKey: CANDIDATE_DETAILS_QUERY_KEY,
      predicate: hasScheduleHistory,
    }),
  ]);
};

export const cancelScheduleMutationQueries = async (
  queryClient: QueryClient,
  context: ScheduleMutationInvalidateContext
) =>
  await Promise.all(
    getScheduleMutationQueryFilters(context).map(async (filters) => {
      await queryClient.cancelQueries(toQueryFilters(filters));
    })
  );

const scheduleActiveRefetch = (
  queryClient: QueryClient,
  filters: InvalidateQueryFilters & { queryKey: QueryKey }
) => {
  let clientTimers = activeRefetchTimers.get(queryClient);
  if (!clientTimers) {
    clientTimers = new Map();
    activeRefetchTimers.set(queryClient, clientTimers);
  }

  const timerKey = JSON.stringify(filters.queryKey);
  const currentTimer = clientTimers.get(timerKey);
  if (currentTimer) {
    clearTimeout(currentTimer);
  }

  const nextTimer = setTimeout(() => {
    clientTimers.delete(timerKey);
    if (queryClient.isMutating({ mutationKey: scheduleMutationKey }) > 0) {
      scheduleActiveRefetch(queryClient, filters);
      return;
    }
    void queryClient.refetchQueries({ ...filters, type: "active" });
  }, SCHEDULE_MUTATION_RECONCILE_DELAY_MS);
  clientTimers.set(timerKey, nextTimer);
};

export const settleScheduleMutationQueries = (
  queryClient: QueryClient,
  context: ScheduleMutationInvalidateContext
) => {
  clearCachedMyScheduledPlans();
  clearCachedCandidateSchedules();
  clearCachedPeopleDashboards();
  clearCachedTeamPositions();
  const filtersList = getScheduleMutationQueryFilters(context);

  for (const filters of filtersList) {
    void queryClient.invalidateQueries({
      ...toQueryFilters(filters),
      refetchType: filters.refetchInactive ? "inactive" : "none",
    });
  }

  for (const filters of filtersList) {
    scheduleActiveRefetch(queryClient, toQueryFilters(filters));
  }
};

const statusToFilledStatus = (
  status: OptimisticPlanPersonStatusCode
): FilledPositionPerson["status"] | null => {
  if (status === "D") {
    return null;
  }
  return status === "C" ? "confirmed" : "pending";
};

const upsertFilledPerson = (
  position: TeamPosition,
  person: OptimisticSchedulePerson,
  planPersonId: string,
  statusCode: OptimisticPlanPersonStatusCode
): TeamPosition => {
  const status = statusToFilledStatus(statusCode);
  const currentPeople = position.filledPeople ?? [];
  const previous = currentPeople.find(
    (filledPerson) => filledPerson.planPersonId === planPersonId
  );
  const filteredPeople = currentPeople.filter(
    (filledPerson) =>
      filledPerson.planPersonId !== planPersonId &&
      filledPerson.id !== person.id
  );

  if (!status) {
    return recalculateFilledCounts({
      ...position,
      filledPeople: filteredPeople,
    });
  }

  const nextPerson: FilledPositionPerson = {
    ...previous,
    id: person.id,
    personId: person.id,
    planPersonId,
    name: person.fullName,
    status,
    rawStatus: statusCode,
    photoThumbnailUrl: person.photoThumbnailUrl ?? null,
    // A new assignment's email state depends on team settings; the refetch fills it in.
    notification: previous?.notification ?? null,
  };

  const filledPeople = [...filteredPeople, nextPerson];

  return recalculateFilledCounts({ ...position, filledPeople });
};

const removeFilledPerson = (
  position: TeamPosition,
  planPersonId: string
): TeamPosition => {
  const people = position.filledPeople ?? [];
  const filledPeople = people.filter(
    (person) => person.planPersonId !== planPersonId
  );
  if (filledPeople.length === people.length) {
    return position;
  }
  return recalculateFilledCounts({ ...position, filledPeople });
};

const updateFilledPersonStatus = (
  position: TeamPosition,
  planPersonId: string,
  statusCode: OptimisticPlanPersonStatusCode
): TeamPosition => {
  const status = statusToFilledStatus(statusCode);
  const currentPeople = position.filledPeople ?? [];
  const existingPerson = currentPeople.find(
    (person) => person.planPersonId === planPersonId
  );
  if (!existingPerson) {
    return position;
  }

  if (!status) {
    return removeFilledPerson(position, planPersonId);
  }

  const filledPeople = currentPeople
    .map((person) =>
      person.planPersonId === planPersonId
        ? { ...person, status, rawStatus: statusCode }
        : person
    )
    .toSorted((a, b) => {
      if (a.status !== b.status) {
        return a.status === "confirmed" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  return recalculateFilledCounts({ ...position, filledPeople });
};

const SLOT_STATUS_BY_CODE: Record<
  OptimisticPlanPersonStatusCode,
  SelectedPlanSlot["status"]
> = {
  C: "confirmed",
  U: "pending",
  D: "declined",
};

const slotWithStatus = (
  statusCode: OptimisticPlanPersonStatusCode,
  planPersonId: string
): SelectedPlanSlot => ({
  planPersonId,
  status: SLOT_STATUS_BY_CODE[statusCode],
  declineReason: null,
});

const createOptimisticCandidate = (
  person: OptimisticSchedulePerson,
  planPersonId: string
): PositionCandidate => {
  const [firstFallback = "", ...lastParts] = person.fullName
    .trim()
    .split(/\s+/u);
  return {
    id: person.id,
    firstName: person.firstName ?? firstFallback,
    lastName: person.lastName ?? lastParts.join(" "),
    fullName: person.fullName,
    photoUrl: person.photoUrl ?? null,
    photoThumbnailUrl: person.photoThumbnailUrl ?? null,
    archived: false,
    selectedPlanRosterLabels: [],
    selectedPlanSlot: slotWithStatus("U", planPersonId),
    // Unknown until the next candidates read; ranking treats it as no preferences.
    schedulingPreferences: null,
  };
};

const updateCandidates = (
  queryClient: QueryClient,
  queryKey: QueryKey,
  update: (candidate: PositionCandidate) => PositionCandidate
) => {
  queryClient.setQueriesData<PositionCandidates>({ queryKey }, (data) =>
    data === undefined
      ? data
      : { ...data, candidates: data.candidates.map(update) }
  );
};

type WindowRosterRow = PlanWindowHistoryBatch["people"][number]["rows"][number];

/**
 * History's copy of the selected plan can still name a plan person the scheduler just changed;
 * without a roster entry for the slot, the list would fall back to that copy.
 */
const updateWindowRosterRows = (
  queryClient: QueryClient,
  planPersonId: string,
  update: (row: WindowRosterRow) => WindowRosterRow | null
) => {
  queryClient.setQueriesData<PlanWindowHistoryBatch[]>(
    { queryKey: WINDOW_HISTORY_QUERY_KEY },
    (calls) =>
      calls?.map((call) => ({
        ...call,
        people: call.people.map((person) => ({
          ...person,
          rows: person.rows.flatMap((row) => {
            if (row.id !== planPersonId) {
              return [row];
            }
            const next = update(row);
            return next === null ? [] : [next];
          }),
        })),
      }))
  );
};

export const optimisticallySchedulePerson = (
  queryClient: QueryClient,
  slot: OptimisticScheduleSlot,
  person: OptimisticSchedulePerson,
  planPersonId: string
): ScheduleMutationSnapshot => {
  const snapshot = snapshotScheduleCaches(queryClient);

  queryClient.setQueriesData<PositionCandidates>(
    {
      queryKey: queryKeys.positionCandidates(
        slot.serviceTypeId,
        slot.teamId,
        slot.positionId,
        slot.planId
      ),
    },
    (data) => {
      if (!data) {
        return data;
      }
      const found = data.candidates.some(({ id }) => id === person.id);
      // A new person joins at the end so earlier detail batches keep their keys.
      return {
        ...data,
        candidates: found
          ? data.candidates.map((candidate) =>
              candidate.id === person.id
                ? {
                    ...candidate,
                    selectedPlanSlot: slotWithStatus("U", planPersonId),
                  }
                : candidate
            )
          : [
              ...data.candidates,
              createOptimisticCandidate(person, planPersonId),
            ],
      };
    }
  );

  queryClient.setQueriesData<TeamPositionGroup[]>(
    { queryKey: ["team-positions", slot.serviceTypeId, slot.planId] },
    (groups) =>
      groups?.map((group) =>
        group.teamId === slot.teamId
          ? {
              ...group,
              positions: group.positions.map((position) =>
                position.id === slot.positionId
                  ? upsertFilledPerson(position, person, planPersonId, "U")
                  : position
              ),
            }
          : group
      )
  );

  updateCandidateRosterLabels(queryClient, snapshot);
  snapshot.applied = snapshotScheduleCaches(queryClient);
  return snapshot;
};

export const reconcileOptimisticPlanPersonId = (
  queryClient: QueryClient,
  optimisticPlanPersonId: string,
  planPersonId: string
) => {
  if (optimisticPlanPersonId === planPersonId) {
    return;
  }

  updateCandidates(queryClient, CANDIDATES_QUERY_KEY, (candidate) =>
    candidate.selectedPlanSlot?.planPersonId === optimisticPlanPersonId
      ? {
          ...candidate,
          selectedPlanSlot: { ...candidate.selectedPlanSlot, planPersonId },
        }
      : candidate
  );

  queryClient.setQueriesData<TeamPositionGroup[]>(
    { queryKey: ["team-positions"] },
    (groups) =>
      groups?.map((group) => ({
        ...group,
        positions: group.positions.map((position) => ({
          ...position,
          filledPeople: position.filledPeople?.map((person) =>
            person.planPersonId === optimisticPlanPersonId
              ? { ...person, planPersonId }
              : person
          ),
        })),
      }))
  );
};

/** Rebuild sidebar entries when a previously declined person accepts again. */
const restoreDeclinedFilledPerson = (
  queryClient: QueryClient,
  snapshot: ScheduleMutationSnapshot,
  planPersonId: string,
  statusCode: OptimisticPlanPersonStatusCode
) => {
  if (statusCode === "D") {
    return;
  }
  for (const [key, data] of snapshot.candidates) {
    const candidate = data?.candidates.find(
      (person) => person.selectedPlanSlot?.planPersonId === planPersonId
    );
    if (!candidate) {
      continue;
    }
    queryClient.setQueryData<TeamPositionGroup[]>(
      ["team-positions", key[1], key[4]],
      (groups) =>
        groups?.map((group) =>
          group.teamId === key[2]
            ? {
                ...group,
                positions: group.positions.map((position) =>
                  position.id === key[3] &&
                  position.filledPeople?.some(
                    (person) => person.planPersonId === planPersonId
                  ) !== true
                    ? upsertFilledPerson(
                        position,
                        candidate,
                        planPersonId,
                        statusCode
                      )
                    : position
                ),
              }
            : group
        )
    );
  }
};

export const optimisticallyUpdatePlanPersonStatus = (
  queryClient: QueryClient,
  planPersonId: string,
  statusCode: OptimisticPlanPersonStatusCode
): ScheduleMutationSnapshot => {
  const snapshot = snapshotScheduleCaches(queryClient);

  updateCandidates(queryClient, CANDIDATES_QUERY_KEY, (candidate) =>
    candidate.selectedPlanSlot?.planPersonId === planPersonId
      ? {
          ...candidate,
          selectedPlanSlot: slotWithStatus(statusCode, planPersonId),
        }
      : candidate
  );
  updateWindowRosterRows(queryClient, planPersonId, (row) => ({
    ...row,
    status: statusCode,
    declineReason: null,
  }));

  queryClient.setQueriesData<TeamPositionGroup[]>(
    { queryKey: ["team-positions"] },
    (groups) =>
      groups?.map((group) => ({
        ...group,
        positions: group.positions.map((position) =>
          updateFilledPersonStatus(position, planPersonId, statusCode)
        ),
      }))
  );

  restoreDeclinedFilledPerson(queryClient, snapshot, planPersonId, statusCode);
  updateCandidateRosterLabels(queryClient, snapshot);
  snapshot.applied = snapshotScheduleCaches(queryClient);
  return snapshot;
};

export const optimisticallyUnschedulePlanPerson = (
  queryClient: QueryClient,
  planPersonId: string
): ScheduleMutationSnapshot => {
  const snapshot = snapshotScheduleCaches(queryClient);

  updateCandidates(queryClient, CANDIDATES_QUERY_KEY, (candidate) =>
    candidate.selectedPlanSlot?.planPersonId === planPersonId
      ? { ...candidate, selectedPlanSlot: null }
      : candidate
  );
  updateWindowRosterRows(queryClient, planPersonId, () => null);

  queryClient.setQueriesData<TeamPositionGroup[]>(
    { queryKey: ["team-positions"] },
    (groups) =>
      groups?.map((group) => ({
        ...group,
        positions: group.positions.map((position) =>
          removeFilledPerson(position, planPersonId)
        ),
      }))
  );

  updateCandidateRosterLabels(queryClient, snapshot);
  snapshot.applied = snapshotScheduleCaches(queryClient);
  return snapshot;
};
