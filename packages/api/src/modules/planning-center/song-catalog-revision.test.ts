import { addChordChartSong } from "@pcobooster/api/application/chord-charts";
import { PlanningCenterAccess } from "@pcobooster/api/application/planning-center-access";
import type { PlanningCenterServices } from "@pcobooster/api/application/planning-center/services";
import { planningCenterServicesContext } from "@pcobooster/api/application/planning-center/services";
import { searchRunSheetSongs } from "@pcobooster/api/application/run-sheet";
import { readSongLibrary } from "@pcobooster/api/application/song-library";
import { createDatabase } from "@pcobooster/api/db/client";
import {
  advanceSongCatalogRevision,
  readSongCatalogCacheScope,
} from "@pcobooster/api/modules/planning-center/song-catalog-revision";
import {
  createBasicPlanningCenterServices,
  createPlanningCenterReadCaches,
} from "@pcobooster/api/planning-center/services/factory";
import { Server } from "@pcobooster/api/server";
import { httpClientFor } from "@pcobooster/api/testing/http-client";
import {
  testPlanningCenterToken,
  testServer,
} from "@pcobooster/api/testing/server";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { createLocalD1 } from "../../../../../scripts/database/local-d1";

const { runtime, binding } = await createLocalD1("song-catalog-revision");
const database = createDatabase(binding);

describe("song cache freshness", () => {
  afterAll(async () => {
    await runtime.dispose();
  });

  it("advances revisions atomically and keeps credential scopes independent", async () => {
    await Promise.all([
      advanceSongCatalogRevision(database, "concurrent"),
      advanceSongCatalogRevision(database, "concurrent"),
      advanceSongCatalogRevision(database, "concurrent"),
    ]);
    await expect(
      readSongCatalogCacheScope(database, "concurrent")
    ).resolves.toBe("concurrent:catalog-revision:3");
    await expect(readSongCatalogCacheScope(database, "other")).resolves.toBe(
      "other:catalog-revision:0"
    );
  });

  it.each([false, true])(
    "refreshes warm library and search in another Worker after song creation (follow-up failure: %s)",
    async (failArrangement) => {
      let added = false;
      const scope = `account-${String(failArrangement)}`;
      const original = {
        id: "20",
        type: "Song",
        attributes: { title: "Morning", author: "Sandbox" },
      };
      const created = {
        id: "21",
        type: "Song",
        attributes: { title: "Evening", author: "Sandbox" },
      };
      const store = new Map<string, string>();
      const fetch: typeof globalThis.fetch = async (input, init) => {
        await Promise.resolve();
        const url = new URL(new Request(input, init).url);
        if (init?.method === "POST") {
          added = true;
          return Response.json({ data: created });
        }
        if (url.pathname.endsWith("/arrangements")) {
          return failArrangement
            ? Response.json(
                { errors: [{ detail: "No access to arrangements" }] },
                { status: 403 }
              )
            : Response.json({
                data: [
                  {
                    id: "22",
                    type: "Arrangement",
                    attributes: { name: "Default" },
                  },
                ],
                included: [],
              });
        }
        return Response.json({
          data: added ? [created, original] : [original],
        });
      };
      const worker = () => {
        const caches = createPlanningCenterReadCaches({
          store: {
            get: async (key) => await Promise.resolve(store.get(key) ?? null),
            put: async (key, value) => {
              await Promise.resolve();
              store.set(key, value);
            },
          },
          reportError: (_message, error) => {
            throw error;
          },
        });
        const services = createBasicPlanningCenterServices(
          testPlanningCenterToken,
          "America/Los_Angeles",
          httpClientFor(fetch),
          caches
        );
        const access = {
          authentication: {
            kind: "demo" as const,
            planningCenter: testPlanningCenterToken,
          },
          cacheScope: scope,
          services,
          presentation: false,
          presentationSeed: "test",
        };
        const server = testServer({ database });
        const provide = <A, E>(
          program: Effect.Effect<
            A,
            E,
            PlanningCenterAccess | Server | PlanningCenterServices
          >
        ) =>
          program.pipe(
            Effect.provideContext(planningCenterServicesContext(services)),
            Effect.provideService(PlanningCenterAccess, access),
            Effect.provideService(Server, server)
          );
        return { provide, services };
      };
      const reader = worker();
      await Effect.runPromise(reader.provide(readSongLibrary()));
      await Effect.runPromise(
        reader.provide(searchRunSheetSongs({ query: "Evening" }))
      );
      await Effect.runPromise(reader.services.settleReadCaches);
      const writer = worker();
      await Effect.runPromiseExit(
        writer.provide(addChordChartSong({ title: "Evening" }))
      );
      // The reader keeps its old in-memory catalog and ranked search; the new D1 revision must bypass both.
      const library = await Effect.runPromise(
        reader.provide(readSongLibrary())
      );
      const search = await Effect.runPromise(
        reader.provide(searchRunSheetSongs({ query: "Evening" }))
      );
      expect(library.songs.map((song) => song.title)).toStrictEqual([
        "Evening",
        "Morning",
      ]);
      expect(search.map((song) => song.title)).toStrictEqual(["Evening"]);
      await Effect.runPromise(reader.services.settleReadCaches);
    }
  );
});
