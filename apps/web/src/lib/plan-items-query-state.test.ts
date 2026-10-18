import {
  applyPlanItemDraft,
  createOptimisticBasicPlanItem,
  createOptimisticSongPlanItem,
  insertPlanItem,
  nextPlanItemSequence,
  planItemDraftChangesItem,
  planItemsHaveSameOrder,
  removePlanItem,
  replacePlanItemById,
  reorderPlanItems,
  shiftPlanItem,
} from "@pcobooster/planning-center-models/plan-item-order";
import type {
  PlanItem,
  SongOptionSet,
} from "@pcobooster/planning-center-models/types";
import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readCachedPlanItems,
  writeCachedPlanItems,
} from "@/lib/plan-items-cache";
import {
  applyPlanItemsOptimisticUpdate,
  collectPlanSongOptionPrefetchIds,
  PLAN_ITEMS_MUTATION_RECONCILE_DELAY_MS,
  restorePlanItemsSnapshot,
  settlePlanItemsQuery,
} from "@/lib/plan-items-query-state";
import {
  readCachedSongOptions,
  writeCachedSongOptions,
} from "@/lib/song-options-cache";
import {
  readCachedSongSearch,
  writeCachedSongSearch,
} from "@/lib/song-search-cache";

const createItem = (id: string, sequence: number): PlanItem => ({
  id,
  title: `Item ${sequence}`,
  itemType: "item",
  sequence,
  servicePosition: "during",
  length: null,
  description: "",
  htmlDetails: "",
  customArrangementSequence: [],
  song: null,
  arrangement: null,
  key: null,
  layout: null,
});

const createSongItem = (
  id: string,
  sequence: number,
  songId: string
): PlanItem => ({
  ...createItem(id, sequence),
  itemType: "song",
  song: {
    id: songId,
    title: `Song ${songId}`,
    author: "",
    themes: "",
    lastScheduledAt: null,
  },
});

const songOptions = (): SongOptionSet => ({
  song: {
    id: "song-1",
    title: "Build My Life",
    author: "Pat Barrett",
    themes: "Worship",
    hidden: false,
    lastScheduledAt: new Date("2026-05-17T16:00:00.000Z"),
  },
  arrangements: [],
  layouts: [],
  currentLayout: null,
  suggestedArrangementId: null,
  suggestedKeyId: null,
  suggestedLayoutId: null,
  layoutMode: "unavailable",
});

const installLocalStorageMock = () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      get length() {
        return storage.size;
      },
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
};

describe("plan item query state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("restores the previous cache snapshot after an optimistic reorder rollback", () => {
    const queryClient = new QueryClient();
    const queryKey = ["plan-items", "service-1", "plan-1"] as const;
    const items = [createItem("item-1", 1), createItem("item-2", 2)];

    queryClient.setQueryData(queryKey, items);

    const snapshot = applyPlanItemsOptimisticUpdate(
      queryClient,
      queryKey,
      (current) => reorderPlanItems(current, "item-2", "item-1")
    );

    expect(
      queryClient.getQueryData<PlanItem[]>(queryKey)?.map((item) => item.id)
    ).toStrictEqual(["item-2", "item-1"]);

    restorePlanItemsSnapshot(queryClient, queryKey, snapshot);

    expect(
      queryClient.getQueryData<PlanItem[]>(queryKey)?.map((item) => item.id)
    ).toStrictEqual(["item-1", "item-2"]);
  });

  it("does not replace a confirmed earlier addition with its temporary row when a later add fails", () => {
    const queryClient = new QueryClient();
    const queryKey = ["plan-items", "service-1", "plan-1"] as const;
    queryClient.setQueryData(queryKey, [
      createItem("opening", 1),
      createItem("temp-a", 2),
    ]);
    const failedAdd = applyPlanItemsOptimisticUpdate(
      queryClient,
      queryKey,
      (current) => insertPlanItem(current, createItem("temp-b", 3))
    );
    queryClient.setQueryData<PlanItem[]>(queryKey, (current = []) =>
      replacePlanItemById(current, "temp-a", createItem("saved-a", 2))
    );
    restorePlanItemsSnapshot(queryClient, queryKey, failedAdd);
    expect(
      queryClient.getQueryData<PlanItem[]>(queryKey)?.map((item) => item.id)
    ).toStrictEqual(["opening", "saved-a"]);
    queryClient.clear();
  });

  it("rolls back only the failed edit while preserving a newer edit on the same song", () => {
    const queryClient = new QueryClient();
    const queryKey = ["plan-items", "service-1", "plan-1"] as const;
    queryClient.setQueryData(queryKey, [createItem("song", 1)]);
    const failedEdit = applyPlanItemsOptimisticUpdate(
      queryClient,
      queryKey,
      (current) =>
        current.map((item) => ({ ...item, description: "Failed notes" }))
    );
    queryClient.setQueryData<PlanItem[]>(queryKey, (current = []) =>
      current.map((item) => ({ ...item, length: 180 }))
    );
    restorePlanItemsSnapshot(queryClient, queryKey, failedEdit);
    expect(queryClient.getQueryData<PlanItem[]>(queryKey)?.[0]).toMatchObject({
      id: "song",
      description: "",
      length: 180,
    });
    queryClient.clear();
  });

  it("removes a failed addition without discarding a later addition", () => {
    const queryClient = new QueryClient();
    const queryKey = ["plan-items", "service-1", "plan-1"] as const;
    queryClient.setQueryData(queryKey, [createItem("opening", 1)]);
    const failedAdd = applyPlanItemsOptimisticUpdate(
      queryClient,
      queryKey,
      (current) => insertPlanItem(current, createItem("failed", 2))
    );
    applyPlanItemsOptimisticUpdate(queryClient, queryKey, (current) =>
      insertPlanItem(current, createItem("later", 3))
    );
    restorePlanItemsSnapshot(queryClient, queryKey, failedAdd);
    expect(
      queryClient
        .getQueryData<PlanItem[]>(queryKey)
        ?.map((item) => ({ id: item.id, sequence: item.sequence }))
    ).toStrictEqual([
      { id: "opening", sequence: 1 },
      { id: "later", sequence: 2 },
    ]);
    queryClient.clear();
  });

  it("does not undo a newer reorder when an older reorder fails", () => {
    const queryClient = new QueryClient();
    const queryKey = ["plan-items", "service-1", "plan-1"] as const;
    queryClient.setQueryData(queryKey, [
      createItem("a", 1),
      createItem("b", 2),
      createItem("c", 3),
    ]);
    const failedReorder = applyPlanItemsOptimisticUpdate(
      queryClient,
      queryKey,
      (current) => reorderPlanItems(current, "c", "a")
    );
    applyPlanItemsOptimisticUpdate(queryClient, queryKey, (current) =>
      reorderPlanItems(current, "b", "c")
    );
    restorePlanItemsSnapshot(queryClient, queryKey, failedReorder);
    expect(
      queryClient.getQueryData<PlanItem[]>(queryKey)?.map((item) => item.id)
    ).toStrictEqual(["b", "c", "a"]);
    queryClient.clear();
  });

  it("renumbers remaining items after an optimistic delete", () => {
    expect(
      removePlanItem(
        [
          createItem("item-1", 1),
          createItem("item-2", 2),
          createItem("item-3", 3),
        ],
        "item-2"
      )
    ).toMatchObject([
      { id: "item-1", sequence: 1 },
      { id: "item-3", sequence: 2 },
    ]);
  });

  it("detects when a proposed reorder keeps the same item order", () => {
    const current = [createItem("item-1", 1), createItem("item-2", 2)];

    expect(
      planItemsHaveSameOrder(current, [
        { ...createItem("item-1", 1), sequence: 10 },
        { ...createItem("item-2", 2), sequence: 11 },
      ])
    ).toBeTruthy();

    expect(
      planItemsHaveSameOrder(current, [
        createItem("item-2", 1),
        createItem("item-1", 2),
      ])
    ).toBeFalsy();
    expect(
      planItemsHaveSameOrder(current, [createItem("item-1", 1)])
    ).toBeFalsy();
  });

  it("collects a bounded unique list of song option prefetch ids", () => {
    expect(
      collectPlanSongOptionPrefetchIds(
        [
          createItem("item-1", 1),
          createSongItem("song-item-1", 2, "song-1"),
          createSongItem("song-item-2", 3, "song-1"),
          createSongItem("song-item-3", 4, "song-2"),
          createSongItem("song-item-4", 5, "song-3"),
        ],
        2
      )
    ).toStrictEqual(["song-1", "song-2"]);

    expect(
      collectPlanSongOptionPrefetchIds(
        [createSongItem("song-item-1", 1, "song-1")],
        0
      )
    ).toStrictEqual([]);
  });

  it("builds optimistic basic and song items at the next sequence", () => {
    const current = [createItem("item-1", 1), createItem("item-2", 2)];
    const nextSequence = nextPlanItemSequence(current);

    expect(
      createOptimisticBasicPlanItem("temp-header", "header", nextSequence)
    ).toMatchObject({
      id: "temp-header",
      title: "New Header",
      itemType: "header",
      sequence: 3,
    });

    expect(
      createOptimisticSongPlanItem(
        "temp-song",
        {
          id: "song-1",
          title: "Grace Alone",
          author: "The Modern Post",
          themes: "Grace",
          hidden: false,
          lastScheduledAt: null,
        },
        nextSequence
      )
    ).toMatchObject({
      id: "temp-song",
      title: "Grace Alone",
      itemType: "song",
      sequence: 3,
      song: {
        id: "song-1",
        title: "Grace Alone",
      },
    });
  });

  it("replaces temporary items with the server item", () => {
    const current = [
      createItem("item-1", 1),
      createOptimisticBasicPlanItem("temp-item", "item", 2),
    ];
    const serverItem = createItem("server-item", 2);

    expect(
      replacePlanItemById(current, "temp-item", serverItem).map(
        (item) => item.id
      )
    ).toStrictEqual(["item-1", "server-item"]);
  });

  it("applies draft fields for immediate edit feedback", () => {
    expect(
      applyPlanItemDraft(
        createItem("item-1", 1),
        {
          title: "Welcome",
          servicePosition: "pre",
          description: "Before service",
        },
        0,
        null,
        null
      )
    ).toMatchObject({
      title: "Welcome",
      servicePosition: "pre",
      length: null,
      description: "Before service",
    });
  });

  it("detects unchanged plan item drafts so saves can skip no-op PATCH requests", () => {
    const item = {
      ...createItem("song-item-1", 1),
      itemType: "song" as const,
      title: "Build My Life",
      song: {
        id: "song-1",
        title: "Build My Life",
        author: "Pat Barrett",
        themes: "",
        lastScheduledAt: null,
      },
      arrangement: {
        id: "arr-1",
        name: "Default",
        sequence: [],
        length: null,
        archivedAt: null,
      },
      key: {
        id: "key-1",
        name: "A",
        startingKey: null,
        endingKey: null,
      },
      servicePosition: "during" as const,
      length: 300,
      description: "Intro",
    };

    expect(
      planItemDraftChangesItem(
        item,
        {
          title: "Ignored for songs",
          servicePosition: "during",
          description: "Intro",
          arrangementId: "arr-1",
          keyId: "key-1",
        },
        300
      )
    ).toBeFalsy();

    expect(
      planItemDraftChangesItem(
        item,
        {
          title: "Ignored for songs",
          servicePosition: "during",
          description: "Intro",
          arrangementId: "arr-1",
          keyId: "key-2",
        },
        300
      )
    ).toBeTruthy();
  });

  it("settles optimistic plan item mutations without immediately refetching the active list", () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const queryKey = ["plan-items", "service-1", "plan-1"] as const;
    const invalidateQueries = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();
    const refetchQueries = vi
      .spyOn(queryClient, "refetchQueries")
      .mockResolvedValue();

    settlePlanItemsQuery(queryClient, queryKey);
    settlePlanItemsQuery(queryClient, queryKey);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey,
      refetchType: "inactive",
    });
    expect(refetchQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PLAN_ITEMS_MUTATION_RECONCILE_DELAY_MS);

    expect(refetchQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey,
      type: "active",
    });
  });

  it("keeps an added song visible while a key edit outlasts an earlier refresh timer", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const queryKey = ["plan-items", "service-1", "plan-1"] as const;
    let serverItems = [createItem("opening", 1)];
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: () => serverItems,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await observer.refetch();
    queryClient.setQueryData(queryKey, [
      createItem("opening", 1),
      createSongItem("new-song", 2, "song-1"),
    ]);
    // The add has settled, and its refresh will fire during the following key edit.
    settlePlanItemsQuery(queryClient, queryKey);
    const finishEdit = Promise.withResolvers<undefined>();
    const mutation = new MutationObserver(queryClient, {
      mutationKey: queryKey,
      mutationFn: async () => {
        await finishEdit.promise;
      },
      onSettled: () => {
        settlePlanItemsQuery(queryClient, queryKey);
      },
    });
    const edit = mutation.mutate();
    await vi.advanceTimersByTimeAsync(PLAN_ITEMS_MUTATION_RECONCILE_DELAY_MS);
    expect(
      queryClient.getQueryData<PlanItem[]>(queryKey)?.map((item) => item.id)
    ).toStrictEqual(["opening", "new-song"]);
    serverItems = [
      createItem("opening", 1),
      {
        ...createSongItem("new-song", 2, "song-1"),
        key: { id: "key-d", name: "D", startingKey: "D", endingKey: "D" },
      },
    ];
    finishEdit.resolve();
    await edit;
    // Once editing finishes, the next refresh is allowed to reconcile again.
    await vi.advanceTimersByTimeAsync(PLAN_ITEMS_MUTATION_RECONCILE_DELAY_MS);
    expect(
      queryClient.getQueryData<PlanItem[]>(queryKey)?.map((item) => item.id)
    ).toStrictEqual(["opening", "new-song"]);
    expect(queryClient.getQueryData<PlanItem[]>(queryKey)?.[1].key?.name).toBe(
      "D"
    );
    unsubscribe();
    queryClient.clear();
  });

  it("clears persisted plan-item and song metadata snapshots when optimistic mutations settle", () => {
    installLocalStorageMock();
    const queryClient = new QueryClient();
    const queryKey = ["plan-items", "service-1", "plan-1"] as const;
    writeCachedPlanItems("service-1", "plan-1", [createItem("item-1", 1)]);
    writeCachedSongSearch("build", [
      {
        id: "song-1",
        title: "Build My Life",
        author: "Pat Barrett",
        themes: "Worship",
        hidden: false,
        lastScheduledAt: new Date("2026-05-17T16:00:00.000Z"),
      },
    ]);
    writeCachedSongOptions("song-1", "service-1", songOptions());
    expect([
      readCachedPlanItems("service-1", "plan-1")?.data[0]?.id,
      readCachedSongSearch("build")?.data[0]?.id,
      readCachedSongOptions("song-1", "service-1")?.data.song.id,
    ]).toStrictEqual(["item-1", "song-1", "song-1"]);

    settlePlanItemsQuery(queryClient, queryKey);

    expect(readCachedPlanItems("service-1", "plan-1")).toBeUndefined();
    expect(readCachedSongSearch("build")).toBeUndefined();
    expect(readCachedSongOptions("song-1", "service-1")).toBeUndefined();
  });
});

const ids = (list: PlanItem[]) => list.map((item) => item.id);

describe("positional plan edits", () => {
  const items = [createItem("a", 1), createItem("b", 2), createItem("c", 3)];

  it("inserts after an item, at the top, or at the end", () => {
    const added = createItem("new", 0);

    expect(
      ids(insertPlanItem(items, added, { afterItemId: "a" }))
    ).toStrictEqual(["a", "new", "b", "c"]);
    expect(
      ids(insertPlanItem(items, added, { afterItemId: null }))
    ).toStrictEqual(["new", "a", "b", "c"]);
    expect(ids(insertPlanItem(items, added))).toStrictEqual([
      "a",
      "b",
      "c",
      "new",
    ]);
    expect(
      ids(insertPlanItem(items, added, { afterItemId: "missing" }))
    ).toStrictEqual(["a", "b", "c", "new"]);
    expect(
      insertPlanItem(items, added, { afterItemId: "a" }).map(
        (item) => item.sequence
      )
    ).toStrictEqual([1, 2, 3, 4]);
  });

  it("shifts an item by one and keeps the ends in place", () => {
    expect(ids(shiftPlanItem(items, "b", -1))).toStrictEqual(["b", "a", "c"]);
    expect(ids(shiftPlanItem(items, "b", 1))).toStrictEqual(["a", "c", "b"]);
    expect(shiftPlanItem(items, "a", -1)).toBe(items);
    expect(shiftPlanItem(items, "c", 1)).toBe(items);
  });
});
