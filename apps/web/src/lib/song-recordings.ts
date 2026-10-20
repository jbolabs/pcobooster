import type { SongAttachment } from "@/hooks/use-song-attachments";
import { youtubeEmbedUrl } from "@/lib/plan-files";

export interface SongRecording {
  id: string;
  attachment: SongAttachment;
  embedUrl: string | null;
}

/** Only the selected key's tracks and arrangement-wide recordings belong in this player. */
export const songRecordings = (
  attachments: readonly SongAttachment[],
  keyId: string | null
): SongRecording[] =>
  attachments.flatMap((attachment) => {
    if (attachment.keyId !== null && attachment.keyId !== keyId) {
      return [];
    }
    const embedUrl =
      attachment.kind === "link" && attachment.linkUrl !== null
        ? youtubeEmbedUrl(attachment.linkUrl)
        : null;
    if (
      !(attachment.kind === "audio" && attachment.streamable) &&
      embedUrl === null
    ) {
      return [];
    }
    return [
      {
        id: `${attachment.keyId ?? "arrangement"}:${attachment.id}`,
        attachment,
        embedUrl,
      },
    ];
  });
