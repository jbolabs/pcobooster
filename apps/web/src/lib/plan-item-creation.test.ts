import { createOptimisticBasicPlanItem } from "@pcobooster/planning-center-models/plan-item-order";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { confirmPlanItemCreation } from "@/lib/plan-item-creation";

const queryKey = ["plan-items", "service-1", "plan-1"] as const;
const opening = createOptimisticBasicPlanItem("opening", "item", 1);
const closing = createOptimisticBasicPlanItem("closing", "item", 2);
const optimistic = createOptimisticBasicPlanItem("optimistic-song", "item", 2);
const saved = { ...optimistic, id: "saved-song", title: "New song" };
const succeeds = () => vi.fn<() => Promise<void>>().mockResolvedValue();
const rowIds = (client: QueryClient) =>
  client.getQueryData<PlanItem[]>(queryKey)?.map((row) => row.id);

describe("confirming a created plan item", () => {
  it("keeps the saved song when the follow-up reorder fails", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, [opening, optimistic, closing]);
    const result = await confirmPlanItemCreation({
      queryClient,
      queryKey,
      item: saved,
      optimisticItemId: optimistic.id,
      insertion: { afterItemId: "opening" },
      place: vi
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("Reorder failed")),
    });
    expect(result.placementFailed).toBeTruthy();
    expect(rowIds(queryClient)).toStrictEqual([
      "opening",
      "saved-song",
      "closing",
    ]);
    queryClient.clear();
  });

  it("restores the saved song at its intended position after a refresh dropped the temporary row", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, [opening, closing]);
    const result = await confirmPlanItemCreation({
      queryClient,
      queryKey,
      item: saved,
      optimisticItemId: optimistic.id,
      insertion: { afterItemId: "opening" },
      place: succeeds(),
    });
    expect(result.placementFailed).toBeFalsy();
    expect(rowIds(queryClient)).toStrictEqual([
      "opening",
      "saved-song",
      "closing",
    ]);
    queryClient.clear();
  });

  it("does not duplicate a saved row that a refresh already discovered", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, [opening, saved, closing]);
    await confirmPlanItemCreation({
      queryClient,
      queryKey,
      item: { ...saved, title: "Saved title" },
      optimisticItemId: optimistic.id,
      place: succeeds(),
    });
    expect(rowIds(queryClient)).toStrictEqual([
      "opening",
      "saved-song",
      "closing",
    ]);
    expect(queryClient.getQueryData<PlanItem[]>(queryKey)?.[1].title).toBe(
      "Saved title"
    );
    queryClient.clear();
  });

  it("cancels a read that began during creation before confirming the saved row", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, [opening, optimistic]);
    const staleRead = Promise.withResolvers<PlanItem[]>();
    const observer = new QueryObserver(queryClient, {
      queryKey,
      staleTime: Infinity,
      queryFn: async () => await staleRead.promise,
    });
    const unsubscribe = observer.subscribe(() => {});
    const read = observer.refetch();
    await confirmPlanItemCreation({
      queryClient,
      queryKey,
      item: saved,
      optimisticItemId: optimistic.id,
      place: succeeds(),
    });
    staleRead.resolve([opening]);
    await read;
    expect(rowIds(queryClient)).toStrictEqual(["opening", "saved-song"]);
    unsubscribe();
    queryClient.clear();
  });
});
