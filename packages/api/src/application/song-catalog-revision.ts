import { PlanningCenterAccess } from "@pcobooster/api/application/planning-center-access";
import {
  advanceSongCatalogRevision,
  readSongCatalogCacheScope,
} from "@pcobooster/api/modules/planning-center/song-catalog-revision";
import { Server } from "@pcobooster/api/server";
import { PersistenceFailure } from "@pcobooster/contracts/faults/persistence-failure";
import { Effect } from "effect";

const failure = (operation: string) => (cause: unknown) =>
  new PersistenceFailure({
    detail: "Could not refresh the song catalog. Try again.",
    operation,
    cause,
  });

export const songCatalogCacheScope = Effect.gen(function* readCatalogScope() {
  const { database } = yield* Server;
  const { cacheScope } = yield* PlanningCenterAccess;
  return yield* Effect.tryPromise({
    try: async () => await readSongCatalogCacheScope(database, cacheScope),
    catch: failure("read-song-catalog-revision"),
  });
});

export const invalidateSongCatalog = Effect.gen(function* invalidateCatalog() {
  const { database } = yield* Server;
  const { cacheScope } = yield* PlanningCenterAccess;
  yield* Effect.tryPromise({
    try: async () => {
      await advanceSongCatalogRevision(database, cacheScope);
    },
    catch: failure("advance-song-catalog-revision"),
  });
});
