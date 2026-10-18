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
  const nextItems =
    queryClient.setQueryData<PlanItem[]>(queryKey, update(previousItems)) ?? [];
  return {
    previousItems,
    nextItems,
  };
};

const restorePlanItemFields = (
  before: PlanItem,
  applied: PlanItem,
  current: PlanItem
): PlanItem => {
  const field = <Key extends keyof PlanItem>(key: Key): PlanItem[Key] =>
    Object.is(current[key], applied[key]) ? before[key] : current[key];
  return {
    ...current,
    title: field("title"),
    itemType: field("itemType"),
    servicePosition: field("servicePosition"),
    length: field("length"),
    description: field("description"),
    htmlDetails: field("htmlDetails"),
    customArrangementSequence: field("customArrangementSequence"),
    song: field("song"),
    arrangement: field("arrangement"),
    key: field("key"),
    layout: field("layout"),
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
  const before = new Map(snapshot.previousItems.map((item) => [item.id, item]));
  const applied = new Map(snapshot.nextItems.map((item) => [item.id, item]));
  queryClient.setQueryData<PlanItem[]>(queryKey, (current = []) => {
    const restored = current.flatMap((item) => {
      const previous = before.get(item.id);
      const next = applied.get(item.id);
      if (next === undefined) {
        return [item];
      }
      if (previous === undefined) {
        return [];
      }
      return [restorePlanItemFields(previous, next, item)];
    });
    // Undo a reorder only if a later edit hasn't changed that relative order.
    const existingIds = new Set(restored.map((item) => item.id));
    const originalOrder = snapshot.previousItems.filter((item) =>
      existingIds.has(item.id)
    );
    const appliedOrder = snapshot.nextItems.filter(
      (item) => before.has(item.id) && existingIds.has(item.id)
    );
    const currentOrder = restored.filter((item) => before.has(item.id));
    const canRestoreOrder =
      before.size === applied.size &&
      current.length === snapshot.nextItems.length &&
      currentOrder.length === appliedOrder.length &&
      currentOrder.every((item, index) => item.id === appliedOrder[index]?.id);
    const restoredById = new Map(restored.map((item) => [item.id, item]));
    const original = originalOrder.values();
    return restored.map((item, index) => {
      const originalId =
        canRestoreOrder && before.has(item.id)
          ? original.next().value?.id
          : undefined;
      return {
        ...(originalId === undefined
          ? item
          : (restoredById.get(originalId) ?? item)),
        sequence: index + 1,
      };
    });
  });
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
