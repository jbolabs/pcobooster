import { failureMessage } from "@pcobooster/client/product-client";
import { callForQuery } from "@pcobooster/client/query";
import type { songAttachmentSchema } from "@pcobooster/contracts/http/songs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryKeys } from "@/lib/query-keys";
import { productClient } from "@/product-client";

export type SongAttachment = typeof songAttachmentSchema.Type;

const SONG_ATTACHMENTS_STALE_TIME_MS = 5 * 60 * 1000;

/** An arrangement's files and its keys' files; read only while the song page shows them. */
export const useSongAttachments = (songId: string, arrangementId: string) =>
  useQuery({
    queryKey: queryKeys.songAttachments(songId, arrangementId),
    queryFn: async (context) =>
      await callForQuery(context, productClient, (api) =>
        api.songs.attachments({ params: { songId, arrangementId } })
      ),
    staleTime: SONG_ATTACHMENTS_STALE_TIME_MS,
  });

/**
 * Opens a stored file in a new tab. The tab opens on the click, so the browser allows it, then
 * goes to Planning Center's short-lived signed link once the API answers. The link is never
 * cached or kept.
 */
export const useOpenSongAttachment = (
  songId: string,
  arrangementId: string
) => {
  const queryClient = useQueryClient();
  return async (attachment: SongAttachment): Promise<void> => {
    const tab = window.open("", "_blank");
    if (tab !== null) {
      tab.opener = null;
    }
    try {
      const { url } = await queryClient.query({
        queryKey: queryKeys.songAttachmentLink(
          songId,
          arrangementId,
          attachment.id
        ),
        queryFn: async (context) =>
          await callForQuery(context, productClient, (api) =>
            api.songs.attachmentLink({
              params: { songId, arrangementId, attachmentId: attachment.id },
              query: { keyId: attachment.keyId ?? undefined },
            })
          ),
        staleTime: 0,
        gcTime: 0,
        retry: false,
      });
      if (tab === null) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      tab.location.href = url;
    } catch (error) {
      tab?.close();
      const fallback = `${attachment.name || "The file"} didn’t open.`;
      toast.error(
        error instanceof Error ? failureMessage(error, fallback) : fallback
      );
    }
  };
};
