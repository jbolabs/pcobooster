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
          attachment.id,
          attachment.keyId
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

const SONG_PDF_CACHE_TIME_MS = 5 * 60 * 1000;

/**
 * A stored PDF, fetched through the API so the app can show it: Planning Center's signed links
 * download PDFs instead. `data` is absent when the file turns out not to be a PDF.
 */
export const useSongAttachmentPdf = (
  songId: string,
  arrangementId: string,
  attachment: SongAttachment
) =>
  useQuery({
    queryKey: queryKeys.songAttachmentPdf(
      songId,
      arrangementId,
      attachment.id,
      attachment.keyId
    ),
    queryFn: async (context) =>
      await callForQuery(context, productClient, (api) =>
        api.songs.attachmentLink({
          params: { songId, arrangementId, attachmentId: attachment.id },
          query: { keyId: attachment.keyId ?? undefined, as: "pdf" },
        })
      ),
    staleTime: SONG_PDF_CACHE_TIME_MS,
    gcTime: SONG_PDF_CACHE_TIME_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });

/** Mounted only after Play; short-lived streaming links never survive the player. */
export const useSongAttachmentLink = (
  songId: string,
  arrangementId: string,
  attachment: SongAttachment
) =>
  useQuery({
    queryKey: queryKeys.songAttachmentLink(
      songId,
      arrangementId,
      attachment.id,
      attachment.keyId
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
    refetchOnWindowFocus: false,
  });
