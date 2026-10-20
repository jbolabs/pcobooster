import {
  RecordingAudio,
  RecordingPlayer,
} from "@/components/practice/practice-player";

/** File previews use the same audio timeline as Practice and chord charts. */
export const LoopingAudioPlayer = ({
  fileId,
  url,
  name,
  onRetry,
  onFailed,
}: {
  fileId: string;
  url: string;
  name: string;
  onRetry: () => Promise<void>;
  onFailed: () => void;
}) => (
  <RecordingPlayer
    songTitle={name}
    globalControls={false}
    tracks={[{ id: fileId, name }]}
    renderAudio={(props) => (
      <RecordingAudio
        {...props}
        url={url}
        onRetry={onRetry}
        onFailed={onFailed}
      />
    )}
  />
);
