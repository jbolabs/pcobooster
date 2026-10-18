import type { PlanItem } from "@pcobooster/planning-center-models/types";
import type { QueryClient } from "@tanstack/react-query";

import { clearCachedPlanItems } from "@/lib/plan-items-cache";
import type { queryKeys } from "@/lib/query-keys";
import { clearCachedSongOptions } from "@/lib/song-options-cache";
import { clearCachedSongSearch } from "@/lib/song-search-cache";

export type PlanItemsQueryKey = ReturnType<typeof queryKeys.planItems>;

export const PLAN_ITEMS_MUTATION_RECONCILE_DELAY_MS = 2500;
export const PLAN_SONG_OPTIONS_PREFETCH_LIMIT = 6;

const activeRefetchTimers = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof setTimeout>>
>();

export interface PlanItemsOptimisticSnapshot {
  previousItems: PlanItem[];
  nextItems: PlanItem[];
}

export const collectPlanSongOptionPrefetchIds = (
  items: PlanItem[],
  limit = PLAN_SONG_OPTIONS_PREFETCH_LIMIT
): string[] => {
  if (limit <= 0) {
    return [];
  }

  const songIds = new Set<string>();
  for (const item of items) {
    if (item.song?.id === undefined || item.song.id.length === 0) {
      continue;
    }
    songIds.add(item.song.id);
    if (songIds.size >= limit) {
      break;
    }
  }

  return [...songIds];
};

export const applyPlanItemsOptimisticUpdate = (
  queryClient: QueryClient,
  queryKey: PlanItemsQueryKey,
  update: (items: PlanItem[]) => PlanItem[]
): PlanItemsOptimisticSnapshot => {
  const previousItems = queryClient.getQueryData<PlanItem[]>(queryKey) ?? [];
  const nextItems = update(previousItems);

  queryClient.setQueryData(queryKey, nextItems);
  return {
    previousItems,
    nextItems,
  };
};

export const restorePlanItemsSnapshot = (
  queryClient: QueryClient,
  queryKey: PlanItemsQueryKey,
  snapshot: PlanItemsOptimisticSnapshot | undefined
) => {
  if (!snapshot) {
    return;
  }
  queryClient.setQueryData(queryKey, snapshot.previousItems);
};

export const settlePlanItemsQuery = (
  queryClient: QueryClient,
  queryKey: PlanItemsQueryKey
) => {
  clearCachedPlanItems();
  clearCachedSongOptions();
  clearCachedSongSearch();
  void queryClient.invalidateQueries({ queryKey, refetchType: "inactive" });

  let clientTimers = activeRefetchTimers.get(queryClient);
  if (!clientTimers) {
    clientTimers = new Map();
    activeRefetchTimers.set(queryClient, clientTimers);
  }

  const timerKey = JSON.stringify(queryKey);
  const currentTimer = clientTimers.get(timerKey);
  if (currentTimer) {
    clearTimeout(currentTimer);
  }

  const nextTimer = setTimeout(() => {
    clientTimers.delete(timerKey);
    // The last pending edit schedules its own reconciliation when it settles.
    if (queryClient.isMutating({ mutationKey: queryKey }) === 0) {
      void queryClient.refetchQueries({ queryKey, type: "active" });
    }
  }, PLAN_ITEMS_MUTATION_RECONCILE_DELAY_MS);
  clientTimers.set(timerKey, nextTimer);
};
