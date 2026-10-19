import { moduleLog } from "@pcobooster/api/logging";
import type {
  PlanningCenterCoreClient,
  PlanningCenterError,
} from "@pcobooster/api/planning-center/core-client";
import { recoverPlanningCenterFailure } from "@pcobooster/api/planning-center/recover-failure";
import { cachedRead } from "@pcobooster/api/planning-center/services/cached-read";
import { PlanningCenterReadCache } from "@pcobooster/api/planning-center/services/read-cache";
import { isString } from "@pcobooster/planning-center-models/json";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import type { PCResource } from "@pcobooster/planning-center-models/types";
import { Effect } from "effect";

const log = moduleLog("planning-center/songs");
/** Catalog keys include the durable revision advanced whenever the app creates a song. */
const DEFAULT_CATALOG_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_CATALOG_MAX_PAGES = 15;
/** A year of weekly services, twice over, fits in one page. */
const SONG_SCHEDULES_PAGES = 1;

interface LastScheduledItem {
  data: PCResource | null;
  included: PCResource[];
}

interface SongArrangementsResponse {
  data: PCResource[];
  included: PCResource[];
}

/** The newest of a song's schedules, and whether Planning Center had more past the page read. */
export interface SongSchedules {
  readonly data: PCResource[];
  readonly truncated: boolean;
}

export interface ArrangementResponse {
  data: PCResource;
  included: PCResource[];
}

const buildArrangementPayload = (attributes: JsonObject, id?: string) => ({
  data: {
    type: "Arrangement",
    ...(id === undefined ? undefined : { id }),
    attributes,
  },
});

export interface PlanningCenterSongsServiceCaches {
  readonly catalogs: PlanningCenterReadCache<PCResource[]>;
}

export const createPlanningCenterSongsServiceCaches =
  (): PlanningCenterSongsServiceCaches => ({
    catalogs: new PlanningCenterReadCache<PCResource[]>(),
  });

export class PlanningCenterSongsService {
  private readonly core: PlanningCenterCoreClient;
  private readonly caches: PlanningCenterSongsServiceCaches;

  constructor(
    core: PlanningCenterCoreClient,
    caches: PlanningCenterSongsServiceCaches = createPlanningCenterSongsServiceCaches()
  ) {
    this.core = core;
    this.caches = caches;
  }

  getSongsCatalogCached(
    cacheKey: string,
    options?: {
      ttlMs?: number;
      maxPages?: number;
    }
  ): Effect.Effect<PCResource[], PlanningCenterError> {
    const ttlMs = options?.ttlMs ?? DEFAULT_CATALOG_TTL_MS;
    const maxPages = options?.maxPages ?? DEFAULT_CATALOG_MAX_PAGES;
    const scopedCacheKey = this.buildSongCacheKey(
      "catalog",
      cacheKey,
      String(maxPages)
    );
    const load = () =>
      this.core
        .fetchFirstPages("/services/v2/songs", { order: "title" }, maxPages)
        .pipe(
          Effect.map(({ data }) => data),
          Effect.tap((songs) =>
            log.info("Songs catalog cached", {
              cacheKey: scopedCacheKey,
              songCount: songs.length,
            })
          )
        );
    return cachedRead(this.caches.catalogs, scopedCacheKey, ttlMs, load).pipe(
      Effect.map((data) => structuredClone(data))
    );
  }

  getSong(songId: string): Effect.Effect<PCResource, PlanningCenterError> {
    return Effect.map(
      this.core.fetch(`/services/v2/songs/${songId}`),
      (response) => response.data
    );
  }

  /** Mutable arrangement choices must be current even when the last write hit another isolate. */
  getSongArrangementsWithKeys(
    songId: string
  ): Effect.Effect<SongArrangementsResponse, PlanningCenterError> {
    return this.core.fetchAllWithIncluded(
      `/services/v2/songs/${songId}/arrangements`,
      { include: "keys" },
      5
    );
  }

  /** Uncached, so an editor starts from what Services holds right now. */
  getSongArrangementsForEditing(
    songId: string
  ): Effect.Effect<SongArrangementsResponse, PlanningCenterError> {
    return this.core.fetchAllWithIncluded(
      `/services/v2/songs/${songId}/arrangements`,
      { include: "keys" },
      5
    );
  }

  /** Uncached, to compare against the version an edit started from. */
  getArrangement(
    songId: string,
    arrangementId: string
  ): Effect.Effect<ArrangementResponse, PlanningCenterError> {
    return this.core
      .fetch(
        `/services/v2/songs/${songId}/arrangements/${arrangementId}?include=keys`
      )
      .pipe(
        Effect.map((response) => ({
          data: response.data,
          included: response.included ?? [],
        }))
      );
  }

  updateArrangement(
    songId: string,
    arrangementId: string,
    attributes: JsonObject
  ): Effect.Effect<ArrangementResponse, PlanningCenterError> {
    return this.core
      .fetch(
        `/services/v2/songs/${songId}/arrangements/${arrangementId}?include=keys`,
        {
          method: "PATCH",
          body: buildArrangementPayload(attributes, arrangementId),
        }
      )
      .pipe(
        Effect.map((response) => ({
          data: response.data,
          included: response.included ?? [],
        }))
      );
  }

  createArrangement(
    songId: string,
    attributes: JsonObject
  ): Effect.Effect<ArrangementResponse, PlanningCenterError> {
    return this.core
      .fetch(`/services/v2/songs/${songId}/arrangements?include=keys`, {
        method: "POST",
        body: buildArrangementPayload(attributes),
      })
      .pipe(
        Effect.map((response) => ({
          data: response.data,
          included: response.included ?? [],
        }))
      );
  }

  /** The application advances the durable catalog revision after this write succeeds. */
  createSong(
    attributes: JsonObject
  ): Effect.Effect<PCResource, PlanningCenterError> {
    return this.core
      .fetch("/services/v2/songs", {
        method: "POST",
        body: { data: { type: "Song", attributes } },
      })
      .pipe(Effect.map((response) => response.data));
  }

  /**
   * The first page of an attachments collection: an arrangement's own files or one key's.
   * `next` is set when Planning Center has more.
   */
  getAttachmentsPage(
    attachmentsPath: string
  ): Effect.Effect<
    { data: PCResource[]; next: string | null },
    PlanningCenterError
  > {
    return this.core
      .fetchFirstPages(attachmentsPath, {}, 1)
      .pipe(Effect.map(({ data, next }) => ({ data, next })));
  }

  /**
   * A short-lived URL for an attachment: a chart Services renders, such as
   * `chord_chart-{keyId}--` on a key or `lyric_chart-{arrangementId}` on an arrangement, or a
   * file someone attached. Opening logs a view and changes nothing, so the read-only demo client
   * may send it. Callers build `attachmentPath` only from validated ids.
   */
  openChartAttachment(
    attachmentPath: string
  ): Effect.Effect<string, PlanningCenterError> {
    return this.core
      .fetch(`${attachmentPath}/open`, {
        method: "POST",
        body: {},
        readAction: true,
      })
      .pipe(
        Effect.map((response) => {
          const url = response.data.attributes.attachment_url;
          return isString(url) ? url : "";
        })
      );
  }

  /**
   * Every plan, in any service type, that scheduled the song from `afterDayKey` on,
   * newest first, up to one page. Without a filter Planning Center lists only upcoming ones.
   */
  getSongSchedules(
    songId: string,
    afterDayKey: string
  ): Effect.Effect<SongSchedules, PlanningCenterError> {
    return this.core
      .fetchFirstPages(
        `/services/v2/songs/${songId}/song_schedules`,
        { filter: "after", after: afterDayKey, order: "-plan_sort_date" },
        SONG_SCHEDULES_PAGES
      )
      .pipe(Effect.map(({ data, next }) => ({ data, truncated: next !== null })));
  }

  /** A song never scheduled for the service type has no last item. */
  getSongLastScheduledItem(
    songId: string,
    serviceTypeId: string
  ): Effect.Effect<LastScheduledItem, PlanningCenterError> {
    return this.core
      .fetch(
        `/services/v2/songs/${songId}/last_scheduled_item?service_type=${serviceTypeId}&include=arrangement,key`
      )
      .pipe(
        Effect.map((response): LastScheduledItem => ({
          data: response.data,
          included: response.included ?? [],
        })),
        recoverPlanningCenterFailure({
          kinds: ["not-found"],
          reason:
            "Song has no last scheduled item for the service type; reading none",
          details: { songId, serviceTypeId },
          fallback: (): LastScheduledItem => ({ data: null, included: [] }),
        })
      );
  }

  private buildSongCacheKey(kind: "catalog", ...parts: string[]): string {
    return [
      this.core.getCacheScope(),
      "songs",
      kind,
      ...parts.map((part) => encodeURIComponent(part)),
    ].join(":");
  }
}
