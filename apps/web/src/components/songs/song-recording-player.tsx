import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import {
  RecordingAudio,
  RecordingPlayer,
} from "@/components/practice/practice-player";
import type { RecordingAudioProps } from "@/components/practice/practice-player";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  useSongAttachmentLink,
  useSongAttachments,
} from "@/hooks/use-song-attachments";
import type { SongAttachment } from "@/hooks/use-song-attachments";
import { RECORDING_FAILURE } from "@/lib/practice";
import { songRecordings } from "@/lib/song-recordings";

const SongAudio = ({
  songId,
  arrangementId,
  ...props
}: RecordingAudioProps<SongAttachment> & {
  songId: string;
  arrangementId: string;
}) => {
  const link = useSongAttachmentLink(songId, arrangementId, props.file);
  const { onPlayback } = props;
  useEffect(() => {
    if (link.isError) {
      onPlayback(RECORDING_FAILURE);
    }
  }, [link.isError, onPlayback]);
  if (link.isError) {
    return null;
  }
  return (
    <RecordingAudio
      {...props}
      url={link.data?.url}
      onRetry={async () => {
        await link.refetch();
      }}
    />
  );
};

/** One source at a time; changing source unmounts and stops its audio/video element. */
export const SongRecordingPlayer = ({
  songId,
  arrangementId,
  keyId,
  songTitle,
  children,
}: {
  songId: string;
  arrangementId: string;
  keyId: string | null;
  songTitle: string;
  children: (video: ReactNode, controls: ReactNode) => ReactElement;
}) => {
  const files = useSongAttachments(songId, arrangementId);
  const scope = `${songId}:${arrangementId}:${keyId ?? "lyrics"}`;
  const [selected, setSelected] = useState<{
    scope: string;
    id: string;
  } | null>(null);
  const recordings = songRecordings(files.data?.attachments ?? [], keyId);
  const current =
    recordings.find(
      (entry) => selected?.scope === scope && entry.id === selected.id
    ) ?? recordings[0];
  if (files.isError) {
    return children(
      null,
      <p className="text-muted-foreground text-sm">
        Recordings couldn’t load.
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            void files.refetch();
          }}
        >
          Try again
        </Button>
      </p>
    );
  }
  if (current === undefined) {
    return children(
      null,
      files.data?.truncated === true ? (
        <p className="text-muted-foreground text-xs">
          Some files weren’t loaded. Check Planning Center for more recordings.
        </p>
      ) : null
    );
  }
  const playbackKey = `${scope}:${current.id}`;
  const picker = (
    <NativeSelect
      aria-label="Recording"
      className="w-full sm:max-w-sm"
      value={current.id}
      onChange={(event) => {
        setSelected({ scope, id: event.target.value });
      }}
    >
      {recordings.map((entry) => (
        <NativeSelectOption key={entry.id} value={entry.id}>
          {entry.attachment.name}
          {entry.embedUrl === null ? "" : " · YouTube"}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
  const video =
    current.embedUrl === null ? null : (
      <section
        aria-label="Linked video"
        className="flex shrink-0 flex-col gap-1"
      >
        <iframe
          key={playbackKey}
          // oxlint-disable-next-line react/iframe-missing-sandbox -- Validated youtube-nocookie.com is cross-origin; its player needs scripts and its own origin for media access.
          sandbox="allow-scripts allow-same-origin allow-presentation"
          title={current.attachment.name}
          src={current.embedUrl}
          allow="encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="aspect-video min-h-[200px] w-full"
        />
        <a
          href={current.attachment.linkUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground text-xs underline"
        >
          Open in YouTube
        </a>
      </section>
    );
  const controls = (
    <section
      aria-label="Song recordings"
      className="bg-background flex shrink-0 flex-col gap-2"
    >
      {current.embedUrl === null ? (
        <RecordingPlayer
          key={playbackKey}
          songTitle={songTitle}
          tracks={[current.attachment]}
          trackControl={picker}
          renderAudio={(props) => (
            <SongAudio
              {...props}
              songId={songId}
              arrangementId={arrangementId}
            />
          )}
        />
      ) : (
        <div className="flex min-w-0 items-center border-t pt-2 md:w-72">
          {picker}
        </div>
      )}
      {files.data?.truncated === true ? (
        <p className="text-muted-foreground text-xs">
          Some files weren’t loaded. More may be available in Planning Center.
        </p>
      ) : null}
    </section>
  );
  return children(video, controls);
};
