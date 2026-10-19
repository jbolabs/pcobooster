import { createBasicPlanningCenterClient } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPlanItemsService } from "@pcobooster/api/planning-center/services/plan-items-service";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import type { SongOptionSet } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { prepareCreatePlanItem } from "./create-plan-item";
import {
  resolvePlanItemSongDefaults,
  buildPlanItemAttributes,
} from "./plan-item-payload";
import {
  commitUpdatePlanItem,
  prepareUpdatePlanItem,
} from "./update-plan-item";

describe("plan item length limits", () => {
  it.each([
    [-1, 0],
    [86_401, 86_400],
    [240_000, 86_400],
    [1.9, 1],
    [Infinity, 0],
    [Number.NaN, 0],
  ])("bounds payload length %s to %s", (length, expected) => {
    expect(
      buildPlanItemAttributes({ serviceTypeId: "s", length })
    ).toHaveLength(expected);
  });

  it("creates headers with zero length even if a length was supplied", () => {
    expect(
      buildPlanItemAttributes({
        serviceTypeId: "s",
        itemType: "header",
        length: 999_999,
      })
    ).toHaveLength(0);
  });

  it("repairs a stored oversized header before a title or sequence update", async () => {
    let storedLength = 999_999;
    const service = {
      getPlanItem: () =>
        Effect.succeed({
          data: {
            id: "h",
            type: "Item",
            attributes: { item_type: "header", length: storedLength },
          },
          included: [],
        }),
      updatePlanItem: (
        _service: string,
        _plan: string,
        _id: string,
        attributes: JsonObject
      ) => {
        if (Number.isFinite(Number(attributes.length))) {
          storedLength = Number(attributes.length);
        }
        return storedLength > 86_400
          ? Effect.die(new Error("can not be longer than 24 hours"))
          : Effect.succeed({
              data: {
                id: "h",
                type: "Item",
                attributes: {
                  ...attributes,
                  item_type: "header",
                  length: storedLength,
                },
              },
              included: [],
            });
      },
    };
    const prepared = await Effect.runPromise(
      prepareUpdatePlanItem(
        { serviceTypeId: "s", planId: "p", itemId: "h", title: "Updated" },
        () => Effect.die(new Error("Not a song")),
        service
      )
    );
    const result = await Effect.runPromise(
      commitUpdatePlanItem(prepared, service)
    );
    expect(result).toMatchObject({ id: "h", title: "Updated", length: 0 });
  });

  it("bounds an oversized arrangement default on song creation", async () => {
    const options: SongOptionSet = {
      song: {
        id: "song",
        title: "Song",
        author: "",
        themes: "",
        hidden: false,
        lastScheduledAt: null,
      },
      arrangements: [
        {
          id: "arr",
          name: "Default",
          sequence: [],
          length: 999_999,
          bpm: null,
          meter: null,
          archived: false,
          keys: [],
        },
      ],
      layouts: [],
      currentLayout: null,
      suggestedArrangementId: "arr",
      suggestedKeyId: null,
      suggestedLayoutId: null,
      layoutMode: "unavailable",
    };
    const load = () => Effect.succeed(options);
    const input = { serviceTypeId: "s", planId: "p", songId: "song" };
    const defaults = await Effect.runPromise(
      resolvePlanItemSongDefaults(input, load)
    );
    expect(defaults).toHaveLength(86_400);
    const created = await Effect.runPromise(prepareCreatePlanItem(input, load));
    expect(created.attributes).toHaveLength(86_400);
  });

  it("bounds raw create and update writes and reorders only IDs", async () => {
    const bodies: unknown[] = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      bodies.push(await new Request(url, init).json());
      return Response.json({ data: { id: "i", type: "Item", attributes: {} } });
    };
    const service = new PlanningCenterPlanItemsService(
      createBasicPlanningCenterClient(
        testPlanningCenterToken,
        httpClientFor(fetch)
      )
    );
    await Effect.runPromise(
      service.createPlanItem("s", "p", { length: 999_999 })
    );
    await Effect.runPromise(
      service.updatePlanItem("s", "p", "i", { length: -2 })
    );
    await Effect.runPromise(service.reorderPlanItems("s", "p", ["h", "i"]));
    expect(bodies).toStrictEqual([
      { data: { type: "Item", attributes: { length: 86_400 } } },
      { data: { type: "Item", id: "i", attributes: { length: 0 } } },
      {
        data: { type: "PlanItemReorder", attributes: { sequence: ["h", "i"] } },
      },
    ]);
  });
});
