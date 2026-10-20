import {
  RecordingAudio,
  RecordingPlayer,
} from "@/components/practice/practice-player";

/** File previews use the same audio timeline as Practice and chord charts. */
export const LoopingAudioPlayer = ({
  url,
  name,
  onRetry,
  onFailed,
}: {
  url: string;
  name: string;
  onRetry: () => Promise<void>;
  onFailed: () => void;
}) => (
  <RecordingPlayer
    songTitle={name}
    tracks={[{ id: url, name }]}
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
