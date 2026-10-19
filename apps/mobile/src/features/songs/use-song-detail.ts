import {
  activeFirst,
  historyServiceTypeId,
} from "@pcobooster/planning-center-models/song-detail";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useFeatures } from "../../app-shell/features";
import { useProductClient } from "../../app-shell/queries";
import { useVisibleQuery } from "../../app-shell/visible-queries";
import { useClock } from "../../lib/environment";
import { songIdentity, songScreenFailure } from "./detail";
import type { SongHistoryEntry } from "./detail";
import type { RecentSong, SongLibraryEntry } from "./library";
import { recentSongsQuery, rememberRecentSong, songsReads } from "./reads";
import type { SongsReadContext } from "./reads";

/**
 * Reads `songs.options` under one service type, though the arrangements are the same for every
 * one: a cached service type, else the latest the song was sung at, else the organization's
 * first. The first choice stays, so a later answer doesn't read the options again.
 */
const useSongOptions = (
  context: SongsReadContext,
  cache: QueryClient,
  songId: string,
  history: readonly SongHistoryEntry[] | undefined,
  historySettled: boolean
) => {
  const cachedServiceTypeId = useMemo(
    () =>
      cache.getQueryData(songsReads.serviceTypes(context).queryKey)?.[0]?.id ??
      null,
    [cache, context]
  );
  const fromHistory = historyServiceTypeId(history);
  const serviceTypes = useVisibleQuery({
    ...songsReads.serviceTypes(context),
    enabled:
      cachedServiceTypeId === null && historySettled && fromHistory === null,
  });
  const candidate =
    cachedServiceTypeId ?? fromHistory ?? serviceTypes.data?.[0]?.id ?? null;
  const [serviceTypeId, setServiceTypeId] = useState<string | null>(null);
  if (serviceTypeId === null && candidate !== null) {
    setServiceTypeId(candidate);
  }
  const options = useVisibleQuery({
    ...songsReads.options(context, serviceTypeId ?? "", songId),
    enabled: serviceTypeId !== null,
  });
  const started = serviceTypeId !== null;
  return {
    options,
    started,
    failed:
      options.error !== null ||
      (!started && historySettled && serviceTypes.error !== null),
    retry: () => {
      if (started) {
        void options.refetch();
      } else {
        void serviceTypes.refetch();
      }
    },
  };
};

/** Keeps the song at the front of this account's recent list once something names it. */
const useRememberSong = (
  cache: QueryClient,
  scope: string,
  song: RecentSong | null
) => {
  const id = song?.id ?? "";
  const title = song?.title ?? null;
  const author = song?.author ?? "";
  useEffect(() => {
    if (title !== null) {
      rememberRecentSong(cache, scope, { id, title, author });
    }
  }, [cache, scope, id, title, author]);
};

/**
 * One song's reads (Swift `SongDetailModel`): where and when it was sung (`songs.schedule`), its
 * arrangements with keys, tempo, meter, length, and sequence (`songs.options`), and with the
 * `chordCharts` flag its charts (`chordCharts.song`). The library's cached row or this device's
 * recent list names the song at once. Facts only.
 */
export const useSongDetail = (songId: string) => {
  const context = useProductClient();
  const cache = useQueryClient();
  const features = useFeatures();
  const clock = useClock();
  // One "now" per song visit, so "last" and "next" don't move under the reader.
  const now = useMemo(() => clock.now(), [clock]);
  const chartsEnabled = features.chordCharts;

  const history = useVisibleQuery(songsReads.schedule(context, songId));
  const chart = useVisibleQuery({
    ...songsReads.chart(context, songId),
    enabled: chartsEnabled,
  });
  const recents = useVisibleQuery(recentSongsQuery(context.scope));
  const libraryEntry: SongLibraryEntry | undefined = useMemo(
    () =>
      cache
        .getQueryData(songsReads.library(context).queryKey)
        ?.songs.find((song) => song.id === songId),
    [cache, context, songId]
  );
  const historySettled = history.data !== undefined || history.error !== null;
  const options = useSongOptions(
    context,
    cache,
    songId,
    history.data?.entries,
    historySettled
  );
  const identity = songIdentity(
    [
      options.options.data?.song,
      chart.data?.song,
      libraryEntry,
      recents.data?.find((song) => song.id === songId),
    ],
    options.options.data?.song.themes ?? libraryEntry?.themes ?? ""
  );
  useRememberSong(
    cache,
    context.scope,
    identity.rawTitle === null
      ? null
      : { id: songId, title: identity.rawTitle, author: identity.author }
  );

  const refresh = async () => {
    await Promise.all([
      history.refetch(),
      chartsEnabled ? chart.refetch() : null,
      options.started ? options.options.refetch() : null,
    ]);
  };

  return {
    songId,
    now,
    chartsEnabled,
    history,
    chart,
    options: options.options,
    optionsFailed: options.failed,
    retryOptions: options.retry,
    ...identity,
    isHidden: options.options.data?.song.hidden ?? false,
    chartArrangements: activeFirst(chart.data?.arrangements ?? []),
    failure: songScreenFailure({
      titleKnown: identity.title !== null,
      history,
      options: options.started ? options.options : null,
      chart: chartsEnabled ? chart : null,
    }),
    refresh,
    retryAll: () => {
      void refresh();
      if (!options.started) {
        options.retry();
      }
    },
  };
};

export type SongDetailModel = ReturnType<typeof useSongDetail>;
