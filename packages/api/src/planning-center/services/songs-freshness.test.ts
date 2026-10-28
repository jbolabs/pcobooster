import { createBasicPlanningCenterClient } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPlanItemsService } from "@pcobooster/api/planning-center/services/plan-items-service";
import { PlanningCenterSongsService } from "@pcobooster/api/planning-center/services/songs-service";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

describe("song cache freshness", () => {
  it("reads arrangements and keys written through another Worker without waiting for expiry", async () => {
    let name = "Acoustic";
    let key = "C";
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      await Promise.resolve();
      if (init?.method === "PATCH") {
        name = "Full band";
        key = "D";
      }
      const arrangement = {
        id: "21",
        type: "Arrangement",
        attributes: { name },
      };
      return Response.json({
        data: init?.method === "PATCH" ? arrangement : [arrangement],
        included: [{ id: "22", type: "Key", attributes: { name: key } }],
      });
    };
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      httpClientFor(fetch)
    );
    const reader = new PlanningCenterSongsService(core);
    const writer = new PlanningCenterSongsService(core);
    await Effect.runPromise(reader.getSongArrangementsWithKeys("20"));
    await Effect.runPromise(
      writer.updateArrangement("20", "21", { name: "Full band" })
    );
    const refreshed = await Effect.runPromise(
      reader.getSongArrangementsWithKeys("20")
    );
    expect(refreshed.data[0].attributes.name).toBe("Full band");
    expect(refreshed.included[0].attributes.name).toBe("D");
  });

  it("reads song history changed by a plan edit through another Worker immediately", async () => {
    let keyName = "C";
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      await Promise.resolve();
      if (init?.method === "PATCH") {
        keyName = "D";
        return Response.json({
          data: { id: "31", type: "Item", attributes: {} },
        });
      }
      return Response.json({
        data: [
          { id: "32", type: "SongSchedule", attributes: { key_name: keyName } },
        ],
      });
    };
    const core = createBasicPlanningCenterClient(
      testPlanningCenterToken,
      httpClientFor(fetch)
    );
    const songs = new PlanningCenterSongsService(core);
    const plans = new PlanningCenterPlanItemsService(core);
    await Effect.runPromise(songs.getSongSchedules("20", "2025-10-18"));
    await Effect.runPromise(
      plans.updatePlanItem("30", "31", "32", { key_id: "22", length: 0 })
    );
    const refreshed = await Effect.runPromise(
      songs.getSongSchedules("20", "2025-10-18")
    );
    expect(refreshed.data[0]?.attributes.key_name).toBe("D");
  });
});
