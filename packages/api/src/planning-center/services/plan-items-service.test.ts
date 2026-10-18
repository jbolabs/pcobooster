import { createBasicPlanningCenterClient } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPlanItemsService } from "@pcobooster/api/planning-center/services/plan-items-service";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const itemResource = (id: string): PCResource => ({
  id,
  type: "Item",
  attributes: {
    title: "Opening Song",
  },
});

describe("PlanningCenterPlanItemsService reads after writes", () => {
  it("reads a song added through another Worker instance immediately", async () => {
    let added = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method === "POST") {
        added = true;
        return await Promise.resolve(
          Response.json({ data: itemResource("new-song") })
        );
      }
      return await Promise.resolve(
        Response.json({
          data: added
            ? [itemResource("opening"), itemResource("new-song")]
            : [itemResource("opening")],
          included: [],
        })
      );
    });
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      httpClientFor(fetch)
    );
    const reader = new PlanningCenterPlanItemsService(core);
    const writer = new PlanningCenterPlanItemsService(core);
    await Effect.runPromise(reader.getPlanItems("st-1", "plan-1"));
    await Effect.runPromise(
      writer.createPlanItem("st-1", "plan-1", { title: "New song" })
    );

    const refreshed = await Effect.runPromise(
      reader.getPlanItems("st-1", "plan-1")
    );
    expect(refreshed.data.map((item) => item.id)).toStrictEqual([
      "opening",
      "new-song",
    ]);
  });

  it("reads the changed key through another Worker instance immediately", async () => {
    let keyId = "key-c";
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method === "PATCH") {
        keyId = "key-d";
      }
      const song = {
        ...itemResource("new-song"),
        relationships: { key: { data: { type: "Key", id: keyId } } },
      };
      return await Promise.resolve(
        Response.json({
          data: init?.method === "PATCH" ? song : [song],
          included: [],
        })
      );
    });
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      httpClientFor(fetch)
    );
    const reader = new PlanningCenterPlanItemsService(core);
    const writer = new PlanningCenterPlanItemsService(core);
    const before = await Effect.runPromise(
      reader.getPlanItems("st-1", "plan-1")
    );
    expect(before.data[0].relationships?.key?.data).toStrictEqual({
      type: "Key",
      id: "key-c",
    });
    await Effect.runPromise(
      writer.updatePlanItem("st-1", "plan-1", "new-song", { key_id: "key-d" })
    );

    const refreshed = await Effect.runPromise(
      reader.getPlanItems("st-1", "plan-1")
    );
    expect(
      refreshed.data.map((item) => ({
        id: item.id,
        key: item.relationships?.key?.data,
      }))
    ).toStrictEqual([{ id: "new-song", key: { type: "Key", id: "key-d" } }]);
  });
});
