import { makeProductClient } from "@pcobooster/client/product-client";
import { procedureRoutes } from "@pcobooster/contracts/http/api";
import { matchRoute } from "@pcobooster/contracts/http/route";
import { createOptimisticBasicPlanItem } from "@pcobooster/planning-center-models/plan-item-order";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { makeFixtureFetch } from "../../harness/fixture-transport";
import { planFilesRead } from "./files/reads";
import { makeManualTimer } from "./manual-timer";
import { planReads } from "./reads";
import type { ReconcileTimer } from "./reconcile";
import { ItemDraft } from "./runsheet/item-draft";
import { RunSheetRemovals } from "./runsheet/removals";
import { PlanWriter } from "./writes";

const ids = { serviceTypeId: "1101", planId: "881261004" };
const setup = async (
  failTag?: string,
  timer?: ReconcileTimer,
  holdTag?: string
) => {
  const fixture = makeFixtureFetch({ latencyMs: 0 });
  const calls: string[] = [];
  const bodies: string[] = [];
  /** Held requests' outcomes, in send order: true lets one through, false refuses it. */
  const held: ((accepted: boolean) => void)[] = [];
  const client = makeProductClient({
    url: "https://fixture.invalid",
    client: "expo",
    credentials: "omit",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.text();
      const match = matchRoute(
        procedureRoutes,
        request.method,
        new URL(request.url).pathname
      );
      if (match.kind !== "found") {
        throw new Error("Unexpected endpoint");
      }
      const message = { tag: match.route.tag };
      calls.push(message.tag);
      bodies.push(body);
      if (message.tag === failTag) {
        throw new Error("Refused fixture write");
      }
      if (message.tag === holdTag) {
        const outcome = Promise.withResolvers<boolean>();
        held.push(outcome.resolve);
        if (!(await outcome.promise)) {
          throw new Error("Refused fixture write");
        }
      }
      return await fixture(input, init);
    },
  });
  const cache = new QueryClient();
  const context = { client, scope: "write-test" };
  const items = await cache.query(planReads.items(context, ids));
  const times = await cache.query(planReads.times(context, ids));
  const onError = vi.fn<(error: Error) => void>();
  const onSuccess = vi.fn<() => void>();
  const writer = new PlanWriter(
    client,
    cache,
    context.scope,
    ids,
    onError,
    onSuccess,
    timer
  ).content;
  return {
    client,
    cache,
    context,
    items,
    times,
    writer,
    onError,
    onSuccess,
    calls,
    bodies,
    /** Settles the nth held request once it has been sent. */
    settle: async (index: number, accepted: boolean) => {
      await vi.waitFor(() => {
        expect(held.length).toBeGreaterThan(index);
      });
      held[index]?.(accepted);
    },
  };
};

const PLACEHOLDER_IN_BODY = /"(?:optimistic|pending)-/u;

describe("run sheet and time writes", () => {
  it("refreshes a warm song schedule and options after a run-sheet edit", async () => {
    const timer = makeManualTimer();
    const { writer, items, cache, context } = await setup(
      undefined,
      timer.timer
    );
    let saved = "C";
    const observers = ["songs.schedule", "songs.options"].map(
      (name) =>
        new QueryObserver(cache, {
          queryKey: [context.scope, name, "song-1"],
          queryFn: () => saved,
          staleTime: Infinity,
        })
    );
    const stops = observers.map((observer) => observer.subscribe(() => {}));
    await Promise.all(
      observers.map(async (observer) => await observer.refetch())
    );
    const draft = new ItemDraft(items[1]);
    draft.change({ title: "Greeting" });
    await draft.commit(writer);
    saved = "D";
    timer.fire();
    await Promise.all(
      observers.map(
        async (observer) => await observer.getCurrentQuery().promise
      )
    );
    expect(
      observers.map((observer) => observer.getCurrentResult().data)
    ).toStrictEqual(["D", "D"]);
    for (const stop of stops) {
      stop();
    }
    cache.clear();
  });

  it("autosaves a draft once and rejects invalid lengths before any write", async () => {
    const { writer, items, client, calls } = await setup();
    const [, item] = items;
    const draft = new ItemDraft(item);
    draft.change({
      title: "Greeting",
      description: "Host",
      lengthText: "invalid",
    });
    await expect(draft.commit(writer)).resolves.not.toBeNull();
    expect(calls.filter((tag) => tag === "planItems.update")).toHaveLength(0);
    draft.change({ lengthText: "4:30" });
    await draft.commit(writer);
    await draft.commit(writer);
    const targetClientNative1 = client;
    const inputNative1 = ids;
    const saved = await targetClientNative1.run((api) =>
      api.planItems.list({ params: inputNative1 })
    );
    expect(saved.find((value) => value.id === item.id)).toMatchObject({
      title: "Greeting",
      description: "Host",
      length: 270,
    });
    expect(calls.filter((tag) => tag === "planItems.update")).toHaveLength(1);
  });

  it("clears a song's arrangement and key and leaves a discarded draft unwritten", async () => {
    const { writer, items, client, calls, onError } = await setup();
    const song = items.find((item) => item.song !== null);
    if (song === undefined) {
      throw new Error("Song fixture is required");
    }
    const draft = new ItemDraft(song);
    draft.change({ arrangementId: "", keyId: "" });
    await draft.commit(writer);
    expect(onError.mock.calls).toStrictEqual([]);
    const targetClientNative2 = client;
    const inputNative2 = ids;
    const saved = await targetClientNative2.run((api) =>
      api.planItems.list({ params: inputNative2 })
    );
    expect(saved.find((item) => item.id === song.id)).toMatchObject({
      arrangement: null,
      key: null,
    });
    draft.change({ description: "Discarded" });
    draft.discard();
    await draft.commit(writer);
    expect(calls.filter((tag) => tag === "planItems.update")).toHaveLength(1);
  });

  it("paints a picked arrangement and key from cached options and sends them once", async () => {
    const { writer, items, client, cache, context, calls } = await setup();
    const song = items.find((item) => item.song !== null);
    if (song?.song === null || song?.song === undefined) {
      throw new Error("Song fixture is required");
    }
    const targetClientNative3 = client;
    const inputNative3 = {
      serviceTypeId: ids.serviceTypeId,
      songId: song.song.id,
    };
    const options = await targetClientNative3.run((api) =>
      api.songs.options({ params: inputNative3 })
    );
    const arrangement = options.arrangements.find(
      (option) => option.id !== song.arrangement?.id && option.keys.length > 0
    );
    const key = arrangement?.keys.at(-1);
    if (arrangement === undefined || key === undefined) {
      throw new Error("A second keyed arrangement is required");
    }
    const draft = new ItemDraft(song, () => options);
    draft.change({ arrangementId: arrangement.id, keyId: key.id });
    await draft.commit(writer);
    const painted = cache
      .getQueryData<PlanItem[]>(planReads.items(context, ids).queryKey)
      ?.find((item) => item.id === song.id);
    await draft.commit(writer);
    expect({
      arrangement: painted?.arrangement?.id,
      key: painted?.key?.id,
      updates: calls.filter((tag) => tag === "planItems.update").length,
    }).toStrictEqual({ arrangement: arrangement.id, key: key.id, updates: 1 });
  });

  it("sends a failed save once, not again when the editor unmounts", async () => {
    const { writer, items, calls, onError } = await setup("planItems.update");
    const [, item] = items;
    const draft = new ItemDraft(item);
    draft.change({ title: "Greeting" });
    await draft.commit(writer);
    await draft.commit(writer);
    expect(calls.filter((tag) => tag === "planItems.update")).toHaveLength(1);
    expect(onError).toHaveBeenCalledOnce();
    draft.change({ title: "Welcome back" });
    await draft.commit(writer);
    expect(calls.filter((tag) => tag === "planItems.update")).toHaveLength(2);
  });

  it("saves an item revert made while a save is pending, so the final value wins", async () => {
    const { writer, items, client, calls, settle } = await setup(
      undefined,
      undefined,
      "planItems.update"
    );
    const [, item] = items;
    const draft = new ItemDraft(item);
    const { title } = draft.draft;
    draft.change({ title: "Greeting" });
    const pending = draft.commit(writer);
    draft.change({ title });
    const closing = draft.commit(writer);
    await settle(0, true);
    await settle(1, true);
    await Promise.all([pending, closing]);
    const targetClientNative4 = client;
    const inputNative4 = ids;
    const saved = await targetClientNative4.run((api) =>
      api.planItems.list({ params: inputNative4 })
    );
    expect({
      title: saved.find((value) => value.id === item.id)?.title,
      updates: calls.filter((tag) => tag === "planItems.update").length,
    }).toStrictEqual({ title, updates: 2 });
  });

  it("keeps a closed item editor's final save ahead of a reopened editor", async () => {
    const { writer, items, cache, context, client, calls, settle } =
      await setup(undefined, undefined, "planItems.update");
    const [, item] = items;
    const old = new ItemDraft(item);
    old.change({ title: "A" });
    const blur = old.commit(writer);
    await vi.waitFor(() => {
      expect(calls.filter((tag) => tag === "planItems.update")).toHaveLength(1);
    });
    old.change({ title: "B" });
    const close = old.commit(writer);
    const painted = cache
      .getQueryData<PlanItem[]>(planReads.items(context, ids).queryKey)
      ?.find((value) => value.id === item.id);
    if (painted === undefined) {
      throw new Error("The reopened row is required");
    }
    const reopened = new ItemDraft(painted);
    reopened.change({ title: "C" });
    const newest = reopened.commit(writer);
    await settle(0, true);
    await settle(1, true);
    await vi.waitFor(() => {
      expect(calls.filter((tag) => tag === "planItems.update")).toHaveLength(3);
    });
    const targetClientNative5 = client;
    const inputNative5 = ids;
    const intermediate = await targetClientNative5.run((api) =>
      api.planItems.list({ params: inputNative5 })
    );
    const middle = intermediate.find((value) => value.id === item.id)?.title;
    await settle(2, true);
    await Promise.all([blur, close, newest]);
    const targetClientNative6 = client;
    const inputNative6 = ids;
    const saved = await targetClientNative6.run((api) =>
      api.planItems.list({ params: inputNative6 })
    );
    expect({
      middle,
      final: saved.find((value) => value.id === item.id)?.title,
    }).toStrictEqual({ middle: "B", final: "C" });
  });

  it("sends the first item value again after two overlapping saves both fail", async () => {
    const { writer, items, client, calls, settle } = await setup(
      undefined,
      undefined,
      "planItems.update"
    );
    const [, item] = items;
    const draft = new ItemDraft(item);
    draft.change({ title: "Greeting" });
    const first = draft.commit(writer);
    draft.change({ title: "Welcome" });
    const second = draft.commit(writer);
    await settle(0, false);
    const overlapping = calls.filter(
      (tag) => tag === "planItems.update"
    ).length;
    await settle(1, false);
    await Promise.all([first, second]);
    draft.change({ title: "Greeting" });
    const retry = draft.commit(writer);
    await settle(2, true);
    await retry;
    const targetClientNative7 = client;
    const inputNative7 = ids;
    const saved = await targetClientNative7.run((api) =>
      api.planItems.list({ params: inputNative7 })
    );
    expect({
      overlapping,
      title: saved.find((value) => value.id === item.id)?.title,
      updates: calls.filter((tag) => tag === "planItems.update").length,
    }).toStrictEqual({ overlapping: 1, title: "Greeting", updates: 3 });
  });

  it("sends an item edit still in flight once when the editor unmounts", async () => {
    const { writer, items, calls, settle } = await setup(
      undefined,
      undefined,
      "planItems.update"
    );
    const [, item] = items;
    const draft = new ItemDraft(item);
    draft.change({ title: "Greeting" });
    const blur = draft.commit(writer);
    const unmount = draft.commit(writer);
    await settle(0, true);
    await Promise.all([blur, unmount]);
    expect(calls.filter((tag) => tag === "planItems.update")).toHaveLength(1);
  });

  it("deletes a confirmed removal in Planning Center once its undo window is flushed", async () => {
    const { writer, items, client, calls } = await setup();
    const [, item] = items;
    const removals = new RunSheetRemovals(
      async (id) => await writer.deleteItem(id),
      () => {
        // The run sheet hides pending removals; this test reads Planning Center instead.
      }
    );
    removals.request(item);
    expect(calls).not.toContain("planItems.delete");
    removals.flush();
    await vi.waitFor(() => {
      expect(calls).toContain("planItems.delete");
    });
    const targetClientNative8 = client;
    const inputNative8 = ids;
    const saved = await targetClientNative8.run((api) =>
      api.planItems.list({ params: inputNative8 })
    );
    expect(saved.map((value) => value.id)).not.toContain(item.id);
  });

  it("persists and clears plan-person and needed-slot assignments in fixture rosters", async () => {
    const { client, writer, times } = await setup();
    const targetClientNative9 = client;
    const inputNative9 = ids;
    const groups = await targetClientNative9.run((api) =>
      api.catalog.teamPositions({
        params: inputNative9,
        query: {},
      })
    );
    const people = groups.flatMap((group) =>
      group.positions.flatMap((position) => position.filledPeople ?? [])
    );
    const slots = groups.flatMap((group) =>
      group.positions.flatMap((position) =>
        position.neededPositionId === undefined
          ? []
          : [position.neededPositionId]
      )
    );
    const [person] = people;
    const [slot] = slots;
    const [target] = times;
    await writer.updateTime(
      {
        planTimeId: target.id,
        assignedPlanPersonIds: [person.planPersonId],
        assignedNeededPositionIds: [slot],
      },
      target
    );
    const targetClientNative10 = client;
    const inputNative10 = ids;
    const assigned = await targetClientNative10.run((api) =>
      api.catalog.teamPositions({
        params: inputNative10,
        query: {},
      })
    );
    expect(
      assigned
        .flatMap((group) => group.positions)
        .find((position) => position.neededPositionId === slot)?.timeId
    ).toBe(target.id);
    expect(
      assigned
        .flatMap((group) =>
          group.positions.flatMap((position) => position.filledPeople ?? [])
        )
        .find((candidate) => candidate.planPersonId === person.planPersonId)
        ?.assignedTimeIds
    ).toContain(target.id);
    await writer.updateTime(
      {
        planTimeId: target.id,
        clearedPlanPersonIds: [person.planPersonId],
        clearedNeededPositionIds: [slot],
      },
      target
    );
    const targetClientNative11 = client;
    const inputNative11 = ids;
    const cleared = await targetClientNative11.run((api) =>
      api.catalog.teamPositions({
        params: inputNative11,
        query: {},
      })
    );
    expect(
      cleared
        .flatMap((group) => group.positions)
        .find((position) => position.neededPositionId === slot)?.timeId
    ).toBeNull();
    expect(
      cleared
        .flatMap((group) =>
          group.positions.flatMap((position) => position.filledPeople ?? [])
        )
        .find((candidate) => candidate.planPersonId === person.planPersonId)
        ?.assignedTimeIds
    ).not.toContain(target.id);
  });

  it("creates a header within a section and keeps its order after refetch", async () => {
    const { writer, items, client } = await setup();
    const created = await writer.createItem(
      { itemType: "header", title: "Our section" },
      undefined,
      { afterItemId: items[0].id }
    );
    const targetClientNative12 = client;
    const inputNative12 = ids;
    const saved = await targetClientNative12.run((api) =>
      api.planItems.list({ params: inputNative12 })
    );
    expect(saved[1].id).toBe(created?.id);
    expect(saved[1].title).toBe("Our section");
  });

  it("persists item title, length, notes, and service position", async () => {
    const { writer, items, client } = await setup();
    const item = items.find((value) => value.itemType === "item");
    if (item === undefined) {
      throw new Error("Missing fixture item");
    }
    await writer.updateItem(
      {
        itemId: item.id,
        title: "Welcome home",
        length: 125,
        description: "Host",
        servicePosition: "post",
      },
      {
        ...item,
        title: "Welcome home",
        length: 125,
        description: "Host",
        servicePosition: "post",
      }
    );
    const targetClientNative13 = client;
    const inputNative13 = ids;
    const snapshot1 = await targetClientNative13.run((api) =>
      api.planItems.list({ params: inputNative13 })
    );
    expect(snapshot1.find((value) => value.id === item.id)).toMatchObject({
      title: "Welcome home",
      length: 125,
      description: "Host",
      servicePosition: "post",
    });
  });

  it("persists song arrangement and key changes", async () => {
    const { writer, items, client } = await setup();
    const song = items.find((item) => item.song !== null);
    if (song?.song === null || song?.song === undefined) {
      throw new Error("Missing song");
    }
    const targetClientNative14 = client;
    const inputNative14 = {
      serviceTypeId: ids.serviceTypeId,
      songId: song.song.id,
    };
    const options = await targetClientNative14.run((api) =>
      api.songs.options({ params: inputNative14 })
    );
    const [arrangement] = options.arrangements;
    const key = arrangement.keys.at(-1);
    if (key === undefined) {
      throw new Error("Missing key");
    }
    await writer.updateItem(
      { itemId: song.id, arrangementId: arrangement.id, keyId: key.id },
      { ...song, key, arrangement: { ...arrangement, archivedAt: null } }
    );
    const targetClientNative15 = client;
    const inputNative15 = ids;
    const snapshot2 = await targetClientNative15.run((api) =>
      api.planItems.list({ params: inputNative15 })
    );
    expect(snapshot2.find((item) => item.id === song.id)?.key?.id).toBe(key.id);
  });

  it("serializes movement and deletion", async () => {
    const { writer, items, client } = await setup();
    await Promise.all([
      writer.moveItem(items[1].id, 1),
      writer.deleteItem(items[0].id),
    ]);
    const targetClientNative16 = client;
    const inputNative16 = ids;
    const saved = await targetClientNative16.run((api) =>
      api.planItems.list({ params: inputNative16 })
    );
    expect(saved[0].id).toBe(items[2].id);
    expect(saved.some((item) => item.id === items[0].id)).toBeFalsy();
  });

  it("uses a dragged target to reorder", async () => {
    const { writer, items, client } = await setup();
    await writer.dropItem(items[0].id, items[2].id);
    const targetClientNative17 = client;
    const inputNative17 = ids;
    const snapshot3 = await targetClientNative17.run((api) =>
      api.planItems.list({ params: inputNative17 })
    );
    expect(snapshot3[2].id).toBe(items[0].id);
  });

  it("creates, edits, and deletes a time with an explicit cleared end", async () => {
    const { writer, client } = await setup();
    await writer.createTime({
      name: "Soundcheck",
      timeType: "rehearsal",
      startsAt: "2026-10-04T15:00:00Z",
      endsAt: "2026-10-04T15:30:00Z",
      assignedTeamIds: ["2201"],
    });
    const targetClientNative18 = client;
    const inputNative18 = ids;
    const snapshot4 = await targetClientNative18.run((api) =>
      api.planTimes.list({ params: inputNative18 })
    );
    const time = snapshot4.find((value) => value.name === "Soundcheck");
    if (time === undefined) {
      throw new Error("Missing created time");
    }
    await writer.updateTime(
      {
        planTimeId: time.id,
        name: "Band call",
        endsAt: null,
        assignedTeamIds: [],
      },
      { ...time, name: "Band call", endsAt: null, assignedTeamIds: [] }
    );
    const targetClientNative19 = client;
    const inputNative19 = ids;
    const snapshot5 = await targetClientNative19.run((api) =>
      api.planTimes.list({ params: inputNative19 })
    );
    expect(snapshot5.find((value) => value.id === time.id)).toMatchObject({
      name: "Band call",
      endsAt: null,
      assignedTeamIds: [],
    });
    await writer.deleteTime(time.id);
    const targetClientNative20 = client;
    const inputNative20 = ids;
    const snapshot6 = await targetClientNative20.run((api) =>
      api.planTimes.list({ params: inputNative20 })
    );
    expect(snapshot6.some((value) => value.id === time.id)).toBeFalsy();
  });

  it("rolls back a refused edit without erasing a later movement", async () => {
    const { writer, items, cache, context, onError } =
      await setup("planItems.update");
    const [, item] = items;
    const edit = writer.updateItem(
      { itemId: item.id, title: "Refused" },
      { ...item, title: "Refused" }
    );
    const move = writer.moveItem(item.id, 1);
    expect(
      cache.getQueryData<PlanItem[]>(
        planReads.items(context, ids).queryKey
      )?.[2].title
    ).toBe("Refused");
    await Promise.all([edit, move]);
    const saved = cache.getQueryData<PlanItem[]>(
      planReads.items(context, ids).queryKey
    );
    expect(saved?.[2].title).toBe(item.title);
    expect(onError).toHaveBeenCalledOnce();
  });

  it.each([
    "planItems.create",
    "planItems.delete",
    "planItems.reorder",
    "planTimes.create",
    "planTimes.update",
    "planTimes.delete",
  ])("restores the cache after %s fails", async (tag) => {
    const { writer, cache, context, items, times, onError } = await setup(tag);
    if (tag === "planItems.create") {
      await writer.createItem(
        { title: "New Header", itemType: "header" },
        createOptimisticBasicPlanItem("pending", "header", 0)
      );
    }
    if (tag === "planItems.delete") {
      await writer.deleteItem(items[0].id);
    }
    if (tag === "planItems.reorder") {
      await writer.moveItem(items[0].id, 1);
    }
    if (tag === "planTimes.create") {
      await writer.createTime({
        name: "New service",
        timeType: "service",
        startsAt: "2026-10-04T16:00:00Z",
      });
    }
    if (tag === "planTimes.update") {
      await writer.updateTime(
        { planTimeId: times[0].id, name: "Changed" },
        { ...times[0], name: "Changed" }
      );
    }
    if (tag === "planTimes.delete") {
      await writer.deleteTime(times[0].id);
    }
    expect(
      cache.getQueryData(planReads.items(context, ids).queryKey)
    ).toStrictEqual(items);
    expect(
      cache.getQueryData(planReads.times(context, ids).queryKey)
    ).toStrictEqual(times);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("never sends an id Planning Center hasn't created", async () => {
    const { writer, items, times, cache, context, bodies, onError } =
      await setup();
    const placeholder = "optimistic-item-404";
    const results = await Promise.all([
      writer.deleteItem(placeholder),
      writer.moveItem(placeholder, 1),
      writer.dropItem(items[0].id, placeholder),
      writer.dropItem(placeholder, items[0].id),
      writer.updateItem(
        { itemId: placeholder, title: "Ghost" },
        { ...items[0], id: placeholder, title: "Ghost" }
      ),
      writer.createItem(
        { itemType: "item", title: "Below a ghost" },
        undefined,
        {
          afterItemId: placeholder,
        }
      ),
      writer.deleteTime("pending-time-404"),
      writer.updateTime(
        { planTimeId: "pending-time-404", name: "Ghost" },
        { ...times[0], id: "pending-time-404", name: "Ghost" }
      ),
    ]);
    expect(results).toStrictEqual([
      false,
      false,
      false,
      false,
      false,
      null,
      false,
      false,
    ]);
    expect(
      bodies.filter((body) => PLACEHOLDER_IN_BODY.test(body))
    ).toStrictEqual([]);
    expect(
      cache.getQueryData(planReads.items(context, ids).queryKey)
    ).toStrictEqual(items);
    expect(onError.mock.calls).toStrictEqual([]);
  });

  it("sends the created id for edits queued behind a create", async () => {
    const { writer, cache, context, client, bodies } = await setup();
    const key = planReads.items(context, ids).queryKey;
    const created = writer.createItem({ itemType: "item", title: "Fresh" });
    const placeholder = cache
      .getQueryData<PlanItem[]>(key)
      ?.find((item) => item.id.startsWith("optimistic-"))?.id;
    if (placeholder === undefined) {
      throw new Error("The create shows a placeholder row");
    }
    const [item, renamed, moved] = await Promise.all([
      created,
      writer.updateItem(
        { itemId: placeholder, title: "Renamed" },
        {
          ...createOptimisticBasicPlanItem(placeholder, "item", 0),
          title: "Renamed",
        }
      ),
      writer.moveItem(placeholder, -1),
    ]);
    expect([renamed, moved]).toStrictEqual([true, true]);
    const targetClientNative21 = client;
    const inputNative21 = ids;
    const saved = await targetClientNative21.run((api) =>
      api.planItems.list({ params: inputNative21 })
    );
    expect(saved.at(-2)).toMatchObject({ id: item?.id, title: "Renamed" });
    const time = writer.createTime({
      name: "Soundcheck",
      timeType: "rehearsal",
      startsAt: "2026-10-04T15:00:00Z",
    });
    const pending = cache
      .getQueryData<{ id: string }[]>(planReads.times(context, ids).queryKey)
      ?.find((value) => value.id.startsWith("pending-"))?.id;
    if (pending === undefined) {
      throw new Error("The create shows a pending time");
    }
    await Promise.all([time, writer.deleteTime(pending)]);
    const targetClientNative22 = client;
    const inputNative22 = ids;
    const remaining = await targetClientNative22.run((api) =>
      api.planTimes.list({ params: inputNative22 })
    );
    expect(remaining.map((value) => value.name)).not.toContain("Soundcheck");
    expect(
      bodies.filter((body) => PLACEHOLDER_IN_BODY.test(body))
    ).toStrictEqual([]);
  });

  it("keeps a created item when only its placement fails, so a retry can't duplicate it", async () => {
    const { writer, items, cache, context, onError, calls } =
      await setup("planItems.reorder");
    const created = await writer.createItem(
      { itemType: "header", title: "Placed" },
      undefined,
      { afterItemId: items[0].id }
    );
    expect(created?.title).toBe("Placed");
    expect(
      cache
        .getQueryData<PlanItem[]>(planReads.items(context, ids).queryKey)
        ?.map((item) => item.id)
    ).toContain(created?.id);
    expect(calls.filter((tag) => tag === "planItems.create")).toHaveLength(1);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("refetches a list once, 2.5 s after the last of spaced writes, and never inside the write queue", async () => {
    const reconcile = makeManualTimer();
    const { writer, items, times, cache, context, calls } = await setup(
      undefined,
      reconcile.timer
    );
    const watching = [
      new QueryObserver(cache, planReads.items(context, ids)),
      new QueryObserver(cache, planReads.groups(context, ids)),
      new InfiniteQueryObserver(cache, planFilesRead(context, ids)),
    ].map((observer) =>
      observer.subscribe(() => {
        // Mounted screens keep these lists active, so invalidation refetches them.
      })
    );
    const reads = (tag: string) =>
      calls.filter((value) => value === tag).length;
    await vi.waitFor(() => {
      expect(reads("planFiles.list")).toBe(1);
    });
    const before = reads("planItems.list");
    const [, item] = items;
    await writer.updateItem(
      { itemId: item.id, description: "One" },
      { ...item, description: "One" }
    );
    await writer.updateItem(
      { itemId: item.id, description: "Two" },
      { ...item, description: "Two" }
    );
    expect(reads("planItems.list")).toBe(before);
    expect(reconcile.pending()).toStrictEqual([2500, 2500, 2500, 2500]);
    reconcile.fire();
    await vi.waitFor(() => {
      expect(reads("planItems.list")).toBe(before + 1);
      expect(reads("planFiles.list")).toBe(2);
    });
    calls.length = 0;
    const [time] = times;
    await Promise.all([
      writer.updateTime(
        { planTimeId: time.id, name: "Band call" },
        { ...time, name: "Band call" }
      ),
      writer.deleteItem(item.id),
    ]);
    expect(calls).toStrictEqual(["planTimes.update", "planItems.delete"]);
    for (const unsubscribe of watching) {
      unsubscribe();
    }
  });
});

describe("length validation regression", () => {
  it("bounds a mobile duration draft before transport", async () => {
    const { writer, items, bodies, calls } = await setup();
    const item = items.find((value) => value.itemType === "item");
    if (!item) {
      throw new Error("Fixture needs a regular item");
    }
    const draft = new ItemDraft(item);
    draft.change({ lengthText: "25:00:00" });
    await expect(draft.commit(writer)).resolves.toBeNull();
    expect(
      JSON.parse(bodies[calls.indexOf("planItems.update")] ?? "{}")
    ).toMatchObject({ length: 86_400 });
  });
});
