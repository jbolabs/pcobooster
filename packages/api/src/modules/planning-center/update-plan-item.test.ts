import { createBasicPlanningCenterClient } from "@pcobooster/api/planning-center/core-client";
import { PlanningCenterPlanItemsService } from "@pcobooster/api/planning-center/services/plan-items-service";
import { PlanningCenterSongsService } from "@pcobooster/api/planning-center/services/songs-service";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import { recordLogs } from "@pcobooster/api/testing/logs";
import { testPlanningCenterToken } from "@pcobooster/api/testing/server";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  commitUpdatePlanItem,
  prepareUpdatePlanItem,
} from "./update-plan-item";

describe("rejected plan item diagnostics", () => {
  it.each([
    {
      diagnosticFails: false,
      storedSeconds: 0,
      selectedSeconds: 0,
      length: undefined,
      requested: { state: "omitted" },
      sent: { state: "number", seconds: 0 },
    },
    {
      diagnosticFails: false,
      length: undefined,
      requested: { state: "omitted" },
      sent: { state: "number", seconds: 300 },
    },
    {
      diagnosticFails: true,
      length: undefined,
      requested: { state: "omitted" },
      sent: { state: "number", seconds: 300 },
    },
    {
      diagnosticFails: false,
      length: null,
      requested: { state: "null" },
      sent: { state: "number", seconds: 0 },
    },
    {
      diagnosticFails: false,
      length: 999_999,
      requested: { state: "number", seconds: 999_999 },
      sent: { state: "number", seconds: 86_400 },
    },
  ])(
    "records private-safe durations and preserves rejection: %j",
    async ({
      diagnosticFails,
      length,
      requested,
      sent,
      storedSeconds = 300,
      selectedSeconds = 240_000,
    }) => {
      const requests: string[] = [];
      const fetch: typeof globalThis.fetch = async (url, init) => {
        const request = new Request(url, init);
        await request.text();
        requests.push(`${request.method} ${new URL(request.url).pathname}`);
        if (request.method === "PATCH") {
          return Response.json(
            {
              errors: [
                {
                  detail: "can not be longer than 24 hours",
                  source: { parameter: "length" },
                  meta: { resource: "PlanSong" },
                },
              ],
            },
            { status: 422 }
          );
        }
        if (request.url.includes("/arrangements/")) {
          return diagnosticFails
            ? Response.json({ errors: [] }, { status: 403 })
            : Response.json({
                data: {
                  id: "new-arr",
                  type: "Arrangement",
                  attributes: {
                    length: selectedSeconds,
                    name: "PRIVATE ARRANGEMENT",
                  },
                },
              });
        }
        return Response.json({
          data: {
            id: "item",
            type: "Item",
            attributes: {
              item_type: "song",
              length: storedSeconds,
              title: "PRIVATE SONG",
            },
            relationships: {
              song: { data: { type: "Song", id: "song" } },
              arrangement: { data: { type: "Arrangement", id: "old-arr" } },
            },
          },
          included: [
            {
              id: "old-arr",
              type: "Arrangement",
              attributes: { length: storedSeconds },
            },
          ],
        });
      };
      const core = createBasicPlanningCenterClient(
        testPlanningCenterToken,
        httpClientFor(fetch)
      );
      const items = new PlanningCenterPlanItemsService(core);
      const songs = new PlanningCenterSongsService(core);
      const logs = recordLogs();
      const error = await Effect.runPromise(
        logs.capture(
          Effect.gen(function* rejectedUpdate() {
            const prepared = yield* prepareUpdatePlanItem(
              {
                serviceTypeId: "s",
                planId: "p",
                itemId: "item",
                arrangementId: "new-arr",
                keyId: "new-key",
                title: "PRIVATE TITLE",
                length,
              },
              () => Effect.die(new Error("Should not load song options")),
              items
            );
            return yield* Effect.flip(
              commitUpdatePlanItem(prepared, items, songs)
            );
          }).pipe(
            Effect.annotateLogs({
              requestId: "request",
              procedure: "planItems.update",
            })
          )
        )
      );
      expect(error).toMatchObject({
        _tag: "PlanningCenterApiError",
        status: 422,
      });
      expect(requests).toStrictEqual([
        "GET /services/v2/service_types/s/plans/p/items/item",
        "PATCH /services/v2/service_types/s/plans/p/items/item",
        "GET /services/v2/songs/song/arrangements/new-arr",
      ]);
      const diagnosticLogs = logs.lines.filter(
        (line) =>
          line.message.startsWith("Plan item update rejected") ||
          line.message.startsWith("Rejected plan item")
      );
      expect(diagnosticLogs[0]).toMatchObject({
        level: "warn",
        fields: {
          requestId: "request",
          procedure: "planItems.update",
          serviceTypeId: "s",
          planId: "p",
          itemId: "item",
          songId: "song",
          arrangementId: "new-arr",
          currentArrangementId: "old-arr",
          itemType: "song",
          storedLength: { state: "number", seconds: storedSeconds },
          currentArrangementLength: { state: "number", seconds: storedSeconds },
          requestedLength: requested,
          sentLength: sent,
          selectedKeyId: "new-key",
          providerStatus: 422,
        },
      });
      expect(diagnosticLogs[1]).toMatchObject({
        fields: diagnosticFails
          ? { diagnosticFailure: "PlanningCenterApiError" }
          : {
              selectedArrangementLength: {
                state: "number",
                seconds: selectedSeconds,
              },
            },
      });
      expect(JSON.stringify(diagnosticLogs)).not.toContain("PRIVATE");
    }
  );
});

const decodeItemWrite = Schema.decodeUnknownSync(
  Schema.Struct({
    data: Schema.Struct({
      type: Schema.Literal("Item"),
      id: Schema.String,
      attributes: Schema.Record(Schema.String, Schema.Json),
    }),
  })
);

describe("plan item duration on updates", () => {
  it.each([
    { stored: 0, input: undefined, expected: 0 },
    { stored: 240, input: undefined, expected: 240 },
    { stored: 240, input: null, expected: 0 },
    { stored: 240, input: 90, expected: 90 },
  ])(
    "preserves or explicitly clears duration: %j",
    async ({ stored, input, expected }) => {
      const writes: ReturnType<typeof decodeItemWrite>[] = [];
      const fetch: typeof globalThis.fetch = async (url, init) => {
        const request = new Request(url, init);
        if (request.method === "PATCH") {
          const body = decodeItemWrite(await request.json());
          writes.push(body);
          return Response.json({
            data: {
              id: "item",
              type: "Item",
              attributes: { ...body.data.attributes, item_type: "song" },
            },
            included: [],
          });
        }
        return Response.json({
          data: {
            id: "item",
            type: "Item",
            attributes: { title: "Song", item_type: "song", length: stored },
          },
          included: [],
        });
      };
      const core = createBasicPlanningCenterClient(
        testPlanningCenterToken,
        httpClientFor(fetch)
      );
      const service = new PlanningCenterPlanItemsService(core);
      const prepared = await Effect.runPromise(
        prepareUpdatePlanItem(
          {
            serviceTypeId: "s",
            planId: "p",
            itemId: "item",
            arrangementId: "selected",
            keyId: "a",
            length: input,
          },
          () => Effect.die(new Error("No song-options read needed")),
          service
        )
      );
      const result = await Effect.runPromise(
        commitUpdatePlanItem(prepared, service, {
          getArrangement: () =>
            Effect.die(
              new Error("Successful edits must not fetch diagnostics")
            ),
        })
      );
      expect(writes).toStrictEqual([
        {
          data: {
            type: "Item",
            id: "item",
            attributes: {
              arrangement_id: "selected",
              key_id: "a",
              length: expected,
            },
          },
        },
      ]);
      expect(result).toMatchObject({
        id: "item",
        itemType: "song",
        length: expected,
      });
    }
  );
});
