import { callForQuery, speculativeQuery } from "@pcobooster/client/query";
import type { chordChartSongOutputSchema } from "@pcobooster/contracts/http/chord-charts";
import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import type { ProductClientContextValue } from "../../app-shell/queries";
import { planReads } from "../plan/reads";
import type { PlanReadContext } from "../plan/reads";
import { songReads as runSheetSongReads } from "../plan/runsheet/reads";
import type { RecentSong } from "./library";

/**
 * The Songs tab's reads. Every key starts with the account scope, so nothing crosses accounts
 * or the demo. History, options, and service types share the run sheet's keys, so a song
 * opened from either place reads once.
 */
export type SongsReadContext = PlanReadContext;

export type ChordChartSongOutput = typeof chordChartSongOutputSchema.Type;

/** The library is cached for an hour (the Swift and web library). */
const LIBRARY_STALE_MS = 3_600_000;
/** A chart changes when someone saves it; a minute keeps a just-saved web edit close. */
const CHART_STALE_MS = 60_000;
/** Plans change as services are built, not while someone reads one song. */
const SCHEDULE_STALE_MS = 60_000;

export const songsReads = {
  /** `songs.library`: every visible song, behind the `chordCharts` flag. */
  library: ({ client, scope }: SongsReadContext) =>
    queryOptions({
      queryKey: [scope, "songs.library"] as const,
      queryFn: async (context) =>
        await callForQuery(context, client, (api) => api.songs.library()),
      staleTime: LIBRARY_STALE_MS,
    }),
  /** `songs.schedule`: the song's plans, and whether Planning Center had more than were read. */
  schedule: ({ client, scope }: SongsReadContext, songId: string) =>
    queryOptions({
      queryKey: [scope, "songs.schedule", songId] as const,
      queryFn: async (context) =>
        await callForQuery(context, client, (api) =>
          api.songs.schedule({ params: { songId } })
        ),
      staleTime: SCHEDULE_STALE_MS,
    }),
  options: runSheetSongReads.options,
  serviceTypes: planReads.serviceTypes,
  /** `chordCharts.song`: the song's arrangements with their chart text, behind the flag. */
  chart: ({ client, scope }: SongsReadContext, songId: string) =>
    queryOptions({
      queryKey: [scope, "chordCharts.song", songId] as const,
      queryFn: async (context) =>
        await callForQuery(context, client, (api) =>
          api.chordCharts.song({ params: { songId } })
        ),
      staleTime: CHART_STALE_MS,
    }),
};

const MAX_RECENT_SONGS = 8;

/**
 * Songs this device opened most recently, newest first (`recent-songs.ts`). They live in the
 * account-scoped query cache, so each account and the demo keep their own list, it persists
 * only where that cache does, and signing out forgets it with the rest.
 */
export const recentSongsQuery = (scope: string) => {
  const queryKey = [scope, "songs.recent"] as const;
  return queryOptions({
    queryKey,
    // Local data: a refetch returns what is already cached.
    queryFn: ({ client }): RecentSong[] =>
      client.getQueryData<RecentSong[]>(queryKey) ?? [],
    staleTime: Number.POSITIVE_INFINITY,
  });
};

/** Moves `song` to the front of the scope's recent list. */
export const rememberRecentSong = (
  cache: QueryClient,
  scope: string,
  song: RecentSong
): void => {
  if (song.id === "") {
    return;
  }
  const { queryKey } = recentSongsQuery(scope);
  const current = cache.getQueryData<RecentSong[]>(queryKey) ?? [];
  const next = [
    { id: song.id, title: song.title, author: song.author },
    ...current.filter((recent) => recent.id !== song.id),
  ].slice(0, MAX_RECENT_SONGS);
  const unchanged =
    next.length === current.length &&
    next.every(
      (recent, index) =>
        recent.id === current[index]?.id &&
        recent.title === current[index]?.title &&
        recent.author === current[index]?.author
    );
  if (!unchanged) {
    cache.setQueryData(queryKey, next);
  }
};

/**
 * A deliberate long press is clear intent: load what the song screen shows first, in the
 * speculative lane, so it waits behind what is on screen.
 */
export const prefetchSong = async (
  cache: QueryClient,
  context: ProductClientContextValue,
  songId: string,
  chartsEnabled: boolean,
  signal?: AbortSignal
): Promise<void> => {
  await context.scheduler.runSpeculative(async () => {
    // Best effort: the song screen's own reads show any failure.
    await Promise.allSettled([
      cache.query(speculativeQuery(songsReads.schedule(context, songId))),
      chartsEnabled
        ? cache.query(speculativeQuery(songsReads.chart(context, songId)))
        : null,
    ]);
  }, signal);
};

/**
 * Stable destinations, for the library, the run sheet, and app-wide search: a song by its
 * Planning Center id, and its chart by arrangement and target (`key-<id>` or `lyrics`).
 */
export const songHref = (songId: string): string =>
  `/songs/${encodeURIComponent(songId)}`;

export const songChartHref = (
  songId: string,
  arrangementId?: string | null,
  target?: string | null
): string => {
  const query = new URLSearchParams();
  if (arrangementId !== undefined && arrangementId !== null) {
    query.set("arrangement", arrangementId);
  }
  if (target !== undefined && target !== null) {
    query.set("target", target);
  }
  const encoded = query.toString();
  return `${songHref(songId)}/chart${encoded === "" ? "" : `?${encoded}`}`;
};
