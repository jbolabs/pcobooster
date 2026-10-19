import type {
  ChordChartArrangement,
  ChordChartSongOutput,
} from "@pcobooster/contracts/http/chord-charts";
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { clearCachedSongOptionsForSong } from "@/lib/song-options-cache";
import { clearCachedSongSearch } from "@/lib/song-search-cache";

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
export const rememberWrittenArrangement = (
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
  void queryClient.invalidateQueries({
    queryKey: [queryKeys.planFiles("", "")[0]],
  });
  void queryClient.invalidateQueries({
    queryKey: [queryKeys.planFileLink("", "", "", "pdf")[0]],
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.songHistory(songId),
  });
};

/** Refresh the library and picker even if the saved song's follow-up arrangement failed. */
export const settleSongCreation = (queryClient: QueryClient) => {
  clearCachedSongSearch();
  void queryClient.invalidateQueries({ queryKey: queryKeys.songLibrary() });
  void queryClient.invalidateQueries({
    queryKey: [queryKeys.songSearch("")[0]],
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.songSuggestions() });
};
