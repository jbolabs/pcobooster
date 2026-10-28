import { speculativeQuery } from "@pcobooster/client/query";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import { clampPlanItemLength } from "@pcobooster/planning-center-models/plan-item-draft";
import type { DraftState } from "@pcobooster/planning-center-models/plan-item-draft";
import {
  applyPlanItemDraft,
  createOptimisticBasicPlanItem,
  createOptimisticSongPlanItem,
  insertPlanItem,
  nextPlanItemSequence,
  planItemDraftChangesItem,
  planItemsHaveSameOrder,
  replacePlanItem,
  shiftPlanItem,
} from "@pcobooster/planning-center-models/plan-item-order";
import type { PlanInsertion } from "@pcobooster/planning-center-models/plan-item-order";
import type {
  PlanItem,
  PlanItemArrangement,
  PlanItemKey,
  SongCatalogEntry,
  SongOptionSet,
} from "@pcobooster/planning-center-models/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { usePrefetchPlanFiles } from "@/hooks/use-plan-files";
import { usePlanItems } from "@/hooks/use-plan-items";
import { createSongOptionsQueryOptions } from "@/hooks/use-song-options";
import { isQueryFresh } from "@/lib/intent-prefetch";
import { confirmPlanItemCreation } from "@/lib/plan-item-creation";
import type { ConfirmedPlanItemCreation } from "@/lib/plan-item-creation";
import {
  applyPlanItemsOptimisticUpdate,
  collectPlanSongOptionPrefetchIds,
  discardPlanItemsSnapshot,
  restorePlanItemsSnapshot,
  settlePlanItemsQuery,
} from "@/lib/plan-items-query-state";
import type { PlanItemsOptimisticSnapshot } from "@/lib/plan-items-query-state";
import { queryKeys } from "@/lib/query-keys";
import { requestScheduler } from "@/lib/request-priority";
import { productClient } from "@/product-client";

export type AddedPlanItemKind = "song" | "header" | "item";

interface UsePlanTabControllerArgs {
  serviceTypeId: string | null;
  planId: string | null;
  /**
   * Called with a new row's id so the builder can select it: first the optimistic id,
   * then Planning Center's once the item exists.
   */
  onItemAdded?: (itemId: string, kind: AddedPlanItemKind) => void;
}

const EMPTY_PLAN_ITEMS: PlanItem[] = [];
/** How long a removed item can be restored before the delete reaches Planning Center. */
export const DELETE_UNDO_WINDOW_MS = 5000;

interface PendingDelete {
  item: PlanItem;
  timer: ReturnType<typeof setTimeout>;
  toastId: string | number;
}

export const isOptimisticItemId = (itemId: string) =>
  itemId.startsWith("optimistic-");

const toPlanItemServicePosition = (
  value: string
): "pre" | "during" | "post" | undefined => {
  if (value === "pre" || value === "during" || value === "post") {
    return value;
  }
  return undefined;
};

const savedLengthOf = (length: number | null) =>
  length === null ? null : clampPlanItemLength(length) || null;

const toErrorMessage = (error: Error, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const usePlanTabController = ({
  serviceTypeId,
  planId,
  onItemAdded,
}: UsePlanTabControllerArgs) => {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.planItems(serviceTypeId, planId);
  const planItemsQuery = usePlanItems(serviceTypeId, planId);
  // Ahead of the songs' options: one or two requests serve every item's files.
  usePrefetchPlanFiles(serviceTypeId, planId);
  const { data: itemsData, isLoading } = planItemsQuery;
  const planScope = JSON.stringify([serviceTypeId, planId]);
  // Writes to one plan run one after another, so quick keyboard edits land in order.
  const mutationScope = { id: `plan-items:${planScope}` };
  const pendingDeletes = useRef(new Map<string, PendingDelete>());
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  // A reorder shows in the render that ends the drag, not a tick later when the cache
  // notifies, so dropped rows never flash back to their old places. It holds only until
  // the cache changes from the list it was chosen on.
  const [chosenOrder, setChosenOrder] = useState<{
    from: PlanItem[] | undefined;
    items: PlanItem[];
  } | null>(null);
  if (chosenOrder !== null && chosenOrder.from !== itemsData) {
    setChosenOrder(null);
  }
  const shownData =
    chosenOrder !== null && chosenOrder.from === itemsData
      ? chosenOrder.items
      : (itemsData ?? EMPTY_PLAN_ITEMS);
  // A refetch can bring back an item whose delete is still waiting out its undo window.
  const items =
    pendingDeleteIds.size === 0
      ? shownData
      : shownData.filter((item) => !pendingDeleteIds.has(item.id));
  // The phone song picker belongs to one plan, so stepping to another plan closes it.
  const [pickerScope, setPickerScope] = useState<string | null>(null);
  const songPickerOpen = pickerScope === planScope;
  const setSongPickerOpen = (open: boolean) => {
    setPickerScope(open ? planScope : null);
  };
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pendingSongId, setPendingSongId] = useState<string | null>(null);

  const prefetchSongOptions = useCallback(
    async (songId: string) => {
      if (!isNonEmptyString(serviceTypeId)) {
        return;
      }
      try {
        await queryClient.query(
          speculativeQuery(createSongOptionsQueryOptions(songId, serviceTypeId))
        );
      } catch {
        // Interactive song queries surface failures; prefetching is best effort.
      }
    },
    [queryClient, serviceTypeId]
  );

  // The plan's songs' keys and arrangements (about 3 Planning Center requests each) load
  // one song at a time in the speculative lane, after the run sheet itself.
  useEffect(() => {
    const songIds = isNonEmptyString(serviceTypeId)
      ? collectPlanSongOptionPrefetchIds(items)
      : [];
    const leave = new AbortController();
    for (const songId of songIds) {
      void requestScheduler.runSpeculative(async () => {
        await prefetchSongOptions(songId);
      }, leave.signal);
    }
    return () => {
      leave.abort();
    };
  }, [items, prefetchSongOptions, serviceTypeId]);

  const settlePlanItems = () => {
    settlePlanItemsQuery(queryClient, queryKey);
  };

  const itemSongId = useCallback(
    (itemId: string) =>
      items.find((candidate) => candidate.id === itemId)?.song?.id ?? null,
    [items]
  );
  const { getIntentProps: getItemIntentProps } = useIntentPrefetch<string>({
    keyOf: (itemId) => itemId,
    isFresh: (itemId) => {
      const songId = itemSongId(itemId);
      if (songId === null || !isNonEmptyString(serviceTypeId)) {
        return true;
      }
      const options = createSongOptionsQueryOptions(songId, serviceTypeId);
      return isQueryFresh(queryClient, options.queryKey, options.staleTime);
    },
    prefetch: async (itemId) => {
      const songId = itemSongId(itemId);
      if (songId !== null) {
        await prefetchSongOptions(songId);
      }
    },
  });

  /**
   * Planning Center appends new items, so an item inserted mid-plan is moved into place
   * with a reorder that uses the cache's order, where the optimistic row already sits.
   */
  const placeCreatedItem = async (
    created: PlanItem,
    optimisticItemId: string,
    insertion: PlanInsertion | undefined
  ) => {
    if (
      insertion === undefined ||
      !isNonEmptyString(serviceTypeId) ||
      !isNonEmptyString(planId)
    ) {
      return;
    }
    const sequence: string[] = [];
    for (const item of queryClient.getQueryData<PlanItem[]>(queryKey) ?? []) {
      const itemId = item.id === optimisticItemId ? created.id : item.id;
      if (!isOptimisticItemId(itemId)) {
        sequence.push(itemId);
      }
    }
    if (sequence.at(-1) === created.id) {
      return;
    }
    await productClient.run((api) =>
      api.planItems.reorder({
        params: { serviceTypeId, planId },
        payload: { sequence },
      })
    );
  };

  const createItemMutation = useMutation<
    ConfirmedPlanItemCreation,
    Error,
    {
      kind: "header" | "item";
      insertion?: PlanInsertion;
      optimisticItemId: string;
    },
    { snapshot: PlanItemsOptimisticSnapshot | undefined }
  >({
    mutationKey: queryKey,
    scope: mutationScope,
    mutationFn: async ({ kind, insertion, optimisticItemId }) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      const created = await productClient.run((api) =>
        api.planItems.create({
          params: { serviceTypeId, planId },
          payload: {
            itemType: kind,
            title: kind === "header" ? "New Header" : "New Item",
          },
        })
      );
      return await confirmPlanItemCreation({
        queryClient,
        queryKey,
        item: created,
        optimisticItemId,
        insertion,
        place: async () => {
          await placeCreatedItem(created, optimisticItemId, insertion);
        },
      });
    },
    onMutate: async ({ kind, insertion, optimisticItemId }) => {
      await queryClient.cancelQueries({ queryKey });
      setPendingItemId(optimisticItemId);
      onItemAdded?.(optimisticItemId, kind);

      return {
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          (current) =>
            insertPlanItem(
              current,
              createOptimisticBasicPlanItem(
                optimisticItemId,
                kind,
                nextPlanItemSequence(current)
              ),
              insertion
            )
        ),
      };
    },
    onSuccess: ({ item, placementFailed }, { kind }) => {
      onItemAdded?.(item.id, kind);
      if (placementFailed) {
        toast.error(
          "Item was added, but could not be moved. Try moving it again."
        );
      }
    },
    onError: (error, _kind, context) => {
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSettled: (_result, _error, _input, context) => {
      discardPlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  const addSongMutation = useMutation<
    ConfirmedPlanItemCreation,
    Error,
    {
      song: SongCatalogEntry;
      insertion?: PlanInsertion;
      optimisticItemId: string;
    },
    { snapshot: PlanItemsOptimisticSnapshot | undefined }
  >({
    mutationKey: queryKey,
    scope: mutationScope,
    mutationFn: async ({ song, insertion, optimisticItemId }) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      const songOptionsQuery = createSongOptionsQueryOptions(
        song.id,
        serviceTypeId
      );
      const songOptions =
        queryClient.getQueryData<SongOptionSet | null>(
          songOptionsQuery.queryKey
        ) ?? null;

      const suggestedArrangement =
        songOptions?.arrangements.find(
          (arrangement) => arrangement.id === songOptions.suggestedArrangementId
        ) ?? null;

      const created = await productClient.run((api) =>
        api.planItems.create({
          params: { serviceTypeId, planId },
          payload: {
            title: songOptions?.song.title ?? song.title,
            songId: song.id,
            arrangementId: songOptions?.suggestedArrangementId ?? undefined,
            keyId: songOptions?.suggestedKeyId ?? undefined,
            selectedLayoutId: songOptions?.suggestedLayoutId ?? undefined,
            length:
              suggestedArrangement?.length === undefined ||
              suggestedArrangement.length === null
                ? undefined
                : clampPlanItemLength(suggestedArrangement.length),
          },
        })
      );
      return await confirmPlanItemCreation({
        queryClient,
        queryKey,
        item: created,
        optimisticItemId,
        insertion,
        place: async () => {
          await placeCreatedItem(created, optimisticItemId, insertion);
        },
      });
    },
    onMutate: async ({ song, insertion, optimisticItemId }) => {
      await queryClient.cancelQueries({ queryKey });

      setPendingSongId(song.id);
      setPendingItemId(optimisticItemId);
      setSongPickerOpen(false);
      onItemAdded?.(optimisticItemId, "song");

      return {
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          (current) =>
            insertPlanItem(
              current,
              createOptimisticSongPlanItem(
                optimisticItemId,
                song,
                nextPlanItemSequence(current)
              ),
              insertion
            )
        ),
      };
    },
    onSuccess: ({ item, placementFailed }) => {
      onItemAdded?.(item.id, "song");
      if (placementFailed) {
        toast.error(
          "Song was added, but could not be moved. Try moving it again."
        );
      }
    },
    onError: (error, _song, context) => {
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSettled: (_result, _error, _input, context) => {
      discardPlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      setPendingSongId(null);
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  const deleteItemMutation = useMutation<undefined, Error, PlanItem>({
    mutationKey: queryKey,
    scope: mutationScope,
    mutationFn: async (item) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      await productClient.run((api) =>
        api.planItems.delete({
          params: { itemId: item.id, serviceTypeId, planId },
        })
      );
    },
    onSuccess: async (_result, item) => {
      // Drop it from the cache before it stops being hidden, or it shows again until
      // the delayed refetch lands; a read already in flight could still hold it.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<PlanItem[]>(queryKey, (current) =>
        current?.filter((candidate) => candidate.id !== item.id)
      );
    },
    onError: (error) => {
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSettled: (_result, _error, item) => {
      setPendingDeleteIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      settlePlanItems();
    },
  });

  const commitDelete = async (itemId: string) => {
    const pending = pendingDeletes.current.get(itemId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timer);
    pendingDeletes.current.delete(itemId);
    toast.dismiss(pending.toastId);
    await deleteItemMutation.mutateAsync(pending.item);
  };

  /** Sends every delete still in its undo window, so later writes see the plan as shown. */
  const commitPendingDeletes = async () => {
    await Promise.all(
      [...pendingDeletes.current.keys()].map(async (itemId) => {
        await commitDelete(itemId);
      })
    );
  };

  /** Hides the item now and deletes it once the undo window passes. */
  const removeItem = (itemId: string) => {
    const item = items.find((candidate) => candidate.id === itemId);
    if (item === undefined || isOptimisticItemId(itemId)) {
      return;
    }
    setPendingDeleteIds((current) => new Set(current).add(itemId));
    const toastId = toast(`Removed “${item.title || "Untitled item"}”`, {
      duration: DELETE_UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const pending = pendingDeletes.current.get(itemId);
          if (pending === undefined) {
            return;
          }
          clearTimeout(pending.timer);
          pendingDeletes.current.delete(itemId);
          setPendingDeleteIds((current) => {
            const next = new Set(current);
            next.delete(itemId);
            return next;
          });
        },
      },
    });
    pendingDeletes.current.set(itemId, {
      item,
      toastId,
      timer: setTimeout(() => {
        void commitDelete(itemId);
      }, DELETE_UNDO_WINDOW_MS),
    });
  };

  // Leaving the plan sends the deletes the user already chose; undo ends with the page.
  useEffect(() => {
    const deletes = pendingDeletes.current;
    return () => {
      for (const { item, timer } of deletes.values()) {
        clearTimeout(timer);
        if (isNonEmptyString(serviceTypeId) && isNonEmptyString(planId)) {
          void (async () => {
            try {
              await productClient.run((api) =>
                api.planItems.delete({
                  params: { itemId: item.id, serviceTypeId, planId },
                })
              );
            } catch {
              toast.error(`Could not remove “${item.title}”.`);
            }
          })();
        }
      }
      deletes.clear();
    };
  }, [planId, serviceTypeId]);

  const reorderItemsMutation = useMutation<
    undefined,
    Error,
    PlanItem[],
    { snapshot: PlanItemsOptimisticSnapshot | undefined }
  >({
    mutationKey: queryKey,
    scope: mutationScope,
    mutationFn: async (nextItems) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      await productClient.run((api) =>
        api.planItems.reorder({
          params: { serviceTypeId, planId },
          payload: { sequence: nextItems.map((item) => item.id) },
        })
      );
    },
    onMutate: async (nextItems) => {
      setPendingItemId("reorder");
      await queryClient.cancelQueries({ queryKey });

      return {
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          () => nextItems
        ),
      };
    },
    onError: (error, _nextItems, context) => {
      setChosenOrder(null);
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSettled: (_result, _error, _input, context) => {
      discardPlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  /** Shows the new order now, then saves it. */
  const reorderTo = async (nextItems: PlanItem[]) => {
    setChosenOrder({ from: itemsData, items: nextItems });
    await commitPendingDeletes();
    await reorderItemsMutation.mutateAsync(nextItems);
  };

  const updateItemMutation = useMutation<
    PlanItem,
    Error,
    {
      item: PlanItem;
      draft: DraftState;
      length: number | null;
      optimisticArrangement: PlanItemArrangement | null;
      optimisticKey: PlanItemKey | null;
    },
    { snapshot: PlanItemsOptimisticSnapshot | undefined }
  >({
    mutationKey: queryKey,
    scope: mutationScope,
    mutationFn: async ({
      item,
      draft,
      length,
      optimisticArrangement: _optimisticArrangement,
      optimisticKey: _optimisticKey,
    }: {
      item: PlanItem;
      draft: DraftState;
      length: number | null;
      optimisticArrangement: PlanItemArrangement | null;
      optimisticKey: PlanItemKey | null;
    }) => {
      if (!isNonEmptyString(serviceTypeId) || !isNonEmptyString(planId)) {
        throw new Error("A service type and plan must be selected.");
      }

      return await productClient.run((api) =>
        api.planItems.update({
          params: { itemId: item.id, serviceTypeId, planId },
          payload: {
            title: item.song ? item.title : draft.title,
            servicePosition: toPlanItemServicePosition(draft.servicePosition),
            length:
              item.itemType === "header" ? undefined : savedLengthOf(length),
            description: draft.description,
            songId: undefined,
            arrangementId: draft.arrangementId || undefined,
            keyId: draft.keyId || undefined,
          },
        })
      );
    },
    onMutate: async ({
      item,
      draft,
      length,
      optimisticArrangement,
      optimisticKey,
    }) => {
      setPendingItemId(item.id);
      await queryClient.cancelQueries({ queryKey });

      return {
        snapshot: applyPlanItemsOptimisticUpdate(
          queryClient,
          queryKey,
          (current) =>
            replacePlanItem(
              current,
              applyPlanItemDraft(
                item,
                draft,
                length,
                optimisticArrangement,
                optimisticKey
              )
            )
        ),
      };
    },
    onError: (error, _input, context) => {
      restorePlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      toast.error(toErrorMessage(error, "Something went wrong."));
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData<PlanItem[]>(
        queryKey,
        (current = EMPTY_PLAN_ITEMS) => replacePlanItem(current, updatedItem)
      );
    },
    onSettled: (_result, _error, _input, context) => {
      discardPlanItemsSnapshot(queryClient, queryKey, context?.snapshot);
      setPendingItemId(null);
      settlePlanItems();
    },
  });

  return {
    items,
    isLoading,
    planItemsQuery,
    songPickerOpen,
    pendingItemId,
    pendingSongId,
    isCreatingBasicItem: createItemMutation.isPending,
    isSavingItem: updateItemMutation.isPending,
    setSongPickerOpen,
    createBasicItem: async (
      kind: "header" | "item",
      insertion?: PlanInsertion
    ) => {
      await commitPendingDeletes();
      return await createItemMutation.mutateAsync({
        kind,
        insertion,
        optimisticItemId: `optimistic-${kind}-${crypto.randomUUID()}`,
      });
    },
    addSongToPlan: async (
      song: SongCatalogEntry,
      insertion?: PlanInsertion
    ) => {
      await commitPendingDeletes();
      return await addSongMutation.mutateAsync({
        song,
        insertion,
        optimisticItemId: `optimistic-song-${song.id}-${crypto.randomUUID()}`,
      });
    },
    removeItem,
    reorderItems: async (nextItems: PlanItem[]) => {
      if (planItemsHaveSameOrder(items, nextItems)) {
        return;
      }
      await reorderTo(nextItems);
    },
    moveItem: async (itemId: string, offset: -1 | 1) => {
      const nextItems = shiftPlanItem(items, itemId, offset);
      if (nextItems === items) {
        return;
      }
      await reorderTo(nextItems);
    },
    getItemIntentProps,
    saveItem: async (input: {
      item: PlanItem;
      draft: DraftState;
      length: number | null;
      optimisticArrangement: PlanItemArrangement | null;
      optimisticKey: PlanItemKey | null;
    }) => {
      if (!planItemDraftChangesItem(input.item, input.draft, input.length)) {
        return;
      }
      await commitPendingDeletes();
      await updateItemMutation.mutateAsync(input);
    },
  };
};
