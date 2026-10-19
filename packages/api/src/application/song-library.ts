import type { ApplicationFault } from "@pcobooster/api/application/errors";
import type { PlanningCenterAccess } from "@pcobooster/api/application/planning-center-access";
import { withPlanningCenterFaults } from "@pcobooster/api/application/planning-center-access";
import { PlanningCenterSongs } from "@pcobooster/api/application/planning-center/songs";
import { songCatalogCacheScope } from "@pcobooster/api/application/song-catalog-revision";
import { getSongLibrary } from "@pcobooster/api/modules/planning-center/song-library";
import type { Server } from "@pcobooster/api/server";
import type { SongLibrary } from "@pcobooster/contracts/http/songs";
import { Effect } from "effect";

/** The Songs page's library; it exists only where the `chordCharts` flag is on. */
export const readSongLibrary = (): Effect.Effect<
  SongLibrary,
  ApplicationFault,
  PlanningCenterAccess | PlanningCenterSongs | Server
> =>
  Effect.gen(function* readLibrary() {
    const cacheScope = yield* songCatalogCacheScope;
    const songsService = yield* PlanningCenterSongs;
    return yield* getSongLibrary({
      cacheScope,
      songsService,
    });
  }).pipe(withPlanningCenterFaults);
