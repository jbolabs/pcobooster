import {
  RecordingAudio,
  RecordingPlayer,
} from "@/components/practice/practice-player";

/** File previews play as a now-playing screen on the same timeline as Practice and chord charts. */
export const LoopingAudioPlayer = ({
  fileId,
  url,
  name,
  autoPlay = false,
  onRetry,
  onFailed,
}: {
  fileId: string;
  url: string;
  name: string;
  autoPlay?: boolean;
  onRetry: () => Promise<void>;
  onFailed: () => void;
}) => (
  <RecordingPlayer
    songTitle={name}
    globalControls={false}
    layout="stage"
    autoPlay={autoPlay}
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
