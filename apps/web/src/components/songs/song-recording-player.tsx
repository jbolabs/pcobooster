import { useState } from "react";

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
  const [failed, setFailed] = useState(false);
  if (link.isError || failed) {
    return (
      <p role="alert" className="text-muted-foreground text-sm">
        This recording couldn’t play. Check your access in Planning Center.
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            setFailed(false);
            void link.refetch();
          }}
        >
          Try again
        </Button>
      </p>
    );
  }
  return (
    <RecordingAudio
      {...props}
      url={link.data?.url}
      onRetry={async () => {
        await link.refetch();
      }}
      onFailed={() => {
        setFailed(true);
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
}: {
  songId: string;
  arrangementId: string;
  keyId: string | null;
  songTitle: string;
}) => {
  const files = useSongAttachments(songId, arrangementId);
  const [selected, setSelected] = useState<string | null>(null);
  const recordings = songRecordings(files.data?.attachments ?? [], keyId);
  const current =
    recordings.find((entry) => entry.id === selected) ?? recordings[0];
  if (files.isError) {
    return (
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
    return files.data?.truncated === true ? (
      <p className="text-muted-foreground text-xs">
        Some files weren’t loaded. Check Planning Center for more recordings.
      </p>
    ) : null;
  }
  return (
    <section
      aria-label="Song recordings"
      className="bg-background flex shrink-0 flex-col gap-2"
    >
      <NativeSelect
        aria-label="Recording"
        className="w-full sm:max-w-sm"
        value={current.id}
        onChange={(event) => {
          setSelected(event.target.value);
        }}
      >
        {recordings.map((entry) => (
          <NativeSelectOption key={entry.id} value={entry.id}>
            {entry.attachment.name}
            {entry.embedUrl === null ? "" : " · YouTube"}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {current.embedUrl === null ? (
        <RecordingPlayer
          key={current.id}
          songTitle={songTitle}
          tracks={[current.attachment]}
          renderAudio={(props) => (
            <SongAudio
              {...props}
              songId={songId}
              arrangementId={arrangementId}
            />
          )}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <iframe
            key={current.id}
            // oxlint-disable-next-line react/iframe-missing-sandbox -- Validated youtube-nocookie.com is cross-origin; its player needs scripts and its own origin for media access.
            sandbox="allow-scripts allow-same-origin allow-presentation"
            title={current.attachment.name}
            src={current.embedUrl}
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="aspect-video min-h-[200px] w-full sm:w-80"
          />
          <a
            href={current.attachment.linkUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground text-xs underline"
          >
            Open in YouTube
          </a>
        </div>
      )}
      {files.data?.truncated === true ? (
        <p className="text-muted-foreground text-xs">
          Some files weren’t loaded. More may be available in Planning Center.
        </p>
      ) : null}
    </section>
  );
};
