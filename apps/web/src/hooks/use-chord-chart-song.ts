import { callForQuery } from "@pcobooster/client/query";
import { Conflict } from "@pcobooster/contracts/faults/conflict";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import type {
  ChordChartArrangement,
  ChordChartCreateInput,
  ChordChartPdf,
  ChordChartSongCreateInput,
  ChordChartSongOutput,
  ChordChartUpdateInput,
  LyricsSearchResult,
} from "@pcobooster/contracts/http/chord-charts";
import type { SongLibrary } from "@pcobooster/contracts/http/songs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryFunctionContext } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { queryKeys } from "@/lib/query-keys";
import { clearCachedSongOptionsForSong } from "@/lib/song-options-cache";
import { productClient } from "@/product-client";

export const createChordChartSongQueryOptions = (songId: string) => ({
  queryKey: queryKeys.chordChartSong(songId),
  queryFn: async (context: QueryFunctionContext) =>
    await callForQuery(context, productClient, (api) =>
      api.chordCharts.song({ params: { songId } })
    ),
  staleTime: 30 * 1000,
});

export const useChordChartSong = (songId: string) =>
  useQuery<ChordChartSongOutput>(createChordChartSongQueryOptions(songId));

const readCachedSongTitle = (
  queryClient: QueryClient,
  songId: string
): string | null =>
  queryClient.getQueryData<ChordChartSongOutput>(
    queryKeys.chordChartSong(songId)
  )?.song.title ??
  queryClient
    .getQueryData<SongLibrary>(queryKeys.songLibrary())
    ?.songs.find((song) => song.id === songId)?.title ??
  null;

const noTitle = () => null;

/** A song's title for breadcrumbs, once the song or the library has it. */
export const useSongTitle = (songId: string | null): string | null => {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient]
  );
  const read = useCallback(
    () => (songId === null ? null : readCachedSongTitle(queryClient, songId)),
    [songId, queryClient]
  );
  return useSyncExternalStore(subscribe, read, noTitle);
};

/** A copy of the song read this recently when an arrangement opens counts as read on opening. */
const READ_ON_OPEN_MS = 5000;

const currentTime = () => Date.now();

/**
 * Whether Planning Center's copy of the song is current enough to start editing from: read
 * moments before this arrangement opened (as when the page just loaded it), or since. An older
 * copy, even one fresh enough to show, is read again first.
 */
export const useChordChartSongReadOnOpen = (songId: string): boolean => {
  const openedAt = useMemo(() => currentTime(), []);
  const song = useQuery<ChordChartSongOutput>({
    ...createChordChartSongQueryOptions(songId),
    refetchOnMount: (query) =>
      openedAt - query.state.dataUpdatedAt > READ_ON_OPEN_MS ? "always" : false,
  });
  return (
    song.isFetchedAfterMount || openedAt - song.dataUpdatedAt <= READ_ON_OPEN_MS
  );
};

/** Services' current copy of one arrangement, read past any cached one. */
export const fetchLatestChordChartArrangement = async (
  queryClient: QueryClient,
  songId: string,
  arrangementId: string
): Promise<ChordChartArrangement | null> => {
  const song = await queryClient.query({
    ...createChordChartSongQueryOptions(songId),
    staleTime: 0,
  });
  return (
    song.arrangements.find((candidate) => candidate.id === arrangementId) ??
    null
  );
};

const replaceArrangement = (
  current: ChordChartSongOutput | undefined,
  arrangement: ChordChartArrangement
): ChordChartSongOutput | undefined => {
  if (current === undefined) {
    return current;
  }
  const exists = current.arrangements.some(
    (candidate) => candidate.id === arrangement.id
  );
  return {
    ...current,
    arrangements: exists
      ? current.arrangements.map((candidate) =>
          candidate.id === arrangement.id ? arrangement : candidate
        )
      : [...current.arrangements, arrangement],
  };
};

/**
 * Keeps the editor's copy of the song current after a write, and makes the plan builder read
 * the song's arrangements again, here and in this browser's saved copy.
 */
const rememberWrittenArrangement = (
  queryClient: QueryClient,
  songId: string,
  arrangement: ChordChartArrangement
) => {
  queryClient.setQueryData<ChordChartSongOutput>(
    queryKeys.chordChartSong(songId),
    (current) => replaceArrangement(current, arrangement)
  );
  clearCachedSongOptionsForSong(songId);
  const [songOptionsScope] = queryKeys.songOptions(songId, null);
  void queryClient.invalidateQueries({ queryKey: [songOptionsScope, songId] });
};

export const isChordChartConflict = (error: Error): boolean =>
  error instanceof Conflict;

export type ChordChartLoadFailure = "not-found" | "no-access" | "failed";

/** Why a song didn't load, so the page can say what would help. */
export const chordChartLoadFailure = (error: Error): ChordChartLoadFailure => {
  if (error instanceof NotFound) {
    return "not-found";
  }
  if (error instanceof Forbidden) {
    return "no-access";
  }
  return "failed";
};

export const useSaveChordChart = (songId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChordChartUpdateInput) =>
      await productClient.run((api) =>
        api.chordCharts.update({ params: input, payload: input })
      ),
    onSuccess: (arrangement) => {
      rememberWrittenArrangement(queryClient, songId, arrangement);
    },
  });
};

export const useCreateChordChart = (songId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChordChartCreateInput) =>
      await productClient.run((api) =>
        api.chordCharts.create({ params: input, payload: input })
      ),
    onSuccess: (arrangement) => {
      rememberWrittenArrangement(queryClient, songId, arrangement);
    },
  });
};

/**
 * Lyrics searches reach an outside service, so one runs only for a submitted query (an empty
 * one runs nothing) and its answer stays cached.
 */
export const useLyricsSearch = (query: string) =>
  useQuery<LyricsSearchResult[]>({
    queryKey: queryKeys.lyricsSearch(query),
    queryFn: async (context: QueryFunctionContext) =>
      await callForQuery(context, productClient, (api) =>
        api.chordCharts.lyricsSearch({ query: { query } })
      ),
    enabled: query.length >= 2,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

/** Adds a song to Planning Center and primes the editor with it. */
export const useCreateSong = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChordChartSongCreateInput) =>
      await productClient.run((api) =>
        api.chordCharts.createSong({ payload: input })
      ),
    onSuccess: (created) => {
      queryClient.setQueryData(
        queryKeys.chordChartSong(created.song.id),
        created
      );
    },
  });
};

export interface ChordChartPdfTarget {
  readonly songId: string;
  readonly arrangementId: string;
  /** An arrangement key's chord chart, or null for the lyrics sheet. */
  readonly keyId: string | null;
  /** The saved version to render; Services renders only what is saved. */
  readonly updatedAt: string | null;
}

/** Planning Center's own PDF of the saved chart; a save changes the key and renders again. */
export const useChordChartPdf = (
  target: ChordChartPdfTarget,
  { enabled = true }: { readonly enabled?: boolean } = {}
) =>
  useQuery<ChordChartPdf>({
    enabled,
    queryKey: queryKeys.chordChartPdf(
      target.arrangementId,
      target.keyId,
      target.updatedAt
    ),
    queryFn: async (context: QueryFunctionContext) =>
      await callForQuery(context, productClient, (api) =>
        api.chordCharts.pdf({
          params: {
            songId: target.songId,
            arrangementId: target.arrangementId,
          },
          query: { keyId: target.keyId ?? undefined },
        })
      ),
    staleTime: Number.POSITIVE_INFINITY,
    // The last render stays up while the next save renders.
    placeholderData: (previous) => previous,
    retry: false,
  });
