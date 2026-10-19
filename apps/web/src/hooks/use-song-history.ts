import { callForQuery } from "@pcobooster/client/query";
import type { SongHistory } from "@pcobooster/contracts/http/songs";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { productClient } from "@/product-client";

const SONG_HISTORY_STALE_TIME_MS = 10 * 60 * 1000;

/** Where and when one song was sung across every service, for the song panel's facts. */
export const useSongHistory = (songId: string | null) =>
  useQuery<SongHistory>({
    queryKey: queryKeys.songHistory(songId),
    queryFn: async (context) => {
      if (!isNonEmptyString(songId)) {
        throw new Error("A song is required.");
      }
      return await callForQuery(context, productClient, (api) =>
        api.songs.schedule({ params: { songId } })
      );
    },
    enabled: isNonEmptyString(songId),
    staleTime: SONG_HISTORY_STALE_TIME_MS,
  });
