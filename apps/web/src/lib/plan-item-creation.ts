import {
  insertPlanItem,
  replacePlanItemById,
} from "@pcobooster/planning-center-models/plan-item-order";
import type { PlanInsertion } from "@pcobooster/planning-center-models/plan-item-order";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import type { QueryClient } from "@tanstack/react-query";

import type { PlanItemsQueryKey } from "@/lib/plan-items-query-state";

export interface ConfirmedPlanItemCreation {
  item: PlanItem;
  placementFailed: boolean;
}

/** Creation has committed; a failed follow-up reorder cannot undo the saved item. */
export const confirmPlanItemCreation = async ({
  queryClient,
  queryKey,
  item,
  optimisticItemId,
  insertion,
  place,
}: {
  queryClient: QueryClient;
  queryKey: PlanItemsQueryKey;
  item: PlanItem;
  optimisticItemId: string;
  insertion?: PlanInsertion;
  place: () => Promise<void>;
}): Promise<ConfirmedPlanItemCreation> => {
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<PlanItem[]>(queryKey, (current = []) => {
    if (current.some((row) => row.id === optimisticItemId)) {
      return replacePlanItemById(current, optimisticItemId, item);
    }
    if (current.some((row) => row.id === item.id)) {
      return replacePlanItemById(current, item.id, item);
    }
    // A background read may already have replaced the optimistic list.
    return insertPlanItem(current, item, insertion);
  });
  try {
    await place();
    return { item, placementFailed: false };
  } catch {
    return { item, placementFailed: true };
  }
};
