import { Host, Slider } from "@expo/ui/swift-ui";
import { accessibilityLabel } from "@expo/ui/swift-ui/modifiers";
import { useEvent } from "expo";
import { VideoAirPlayButton, VideoView, useVideoPlayer } from "expo-video";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { EmptyState } from "../../components/empty-state";
import { Glyph } from "../../components/glyph";
import { PillButton } from "../../components/pill-button";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { applyPlaybackPolicy } from "./preview-lifecycle";

const VIDEO_ASPECT = 16 / 9;
const ARTWORK_SIZE = 64;

const styles = StyleSheet.create({
  audio: {
    alignItems: "center",
    gap: Spacing.lg,
    paddingTop: Spacing.xxl,
  },
  transport: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
  },
  video: { aspectRatio: VIDEO_ASPECT, width: "100%" },
});

const playbackTime = (seconds: number): string => {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * Audio or video streamed by the system player (AVPlayer) from Planning Center's signed link,
 * with visible audio transport controls and system controls and full screen for video. The link carries no credentials of
 * this app and is never saved. Playback starts when the person presses play, and follows
 * `applyPlaybackPolicy`: it pauses whenever its screen is hidden or the app leaves the
 * foreground, and nothing plays in the background or on the lock screen.
 */
export const PreviewMediaPlayer = ({
  url,
  video,
  title,
  visible,
  retry,
}: {
  url: string;
  video: boolean;
  title: string;
  /** Its screen is focused and the app active (`useReadVisibility`). */
  visible: boolean;
  /** Reads a fresh link: Planning Center's links expire. */
  retry: () => void;
}) => {
  const player = useVideoPlayer(
    { uri: url, metadata: { title } },
    (instance) => {
      instance.timeUpdateEventInterval = 1;
    }
  );
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const progress = useEvent(player, "timeUpdate");
  useEffect(() => {
    applyPlaybackPolicy(player, visible);
  }, [player, visible]);
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  if (status === "error") {
    return (
      <EmptyState
        actions={
          <PillButton
            kind="secondary"
            onPress={retry}
            testID="media-retry"
            title="Try again"
          />
        }
        artwork="alert"
        description="The file didn’t play. Its link may have expired, or this device can’t play its format."
        title="Couldn’t play this file"
      />
    );
  }
  if (video) {
    return (
      <VideoView
        accessibilityLabel={`${title}, ${video ? "video" : "audio"} player`}
        allowsPictureInPicture={false}
        contentFit="contain"
        fullscreenOptions={{ enable: video }}
        nativeControls
        player={player}
        style={styles.video}
        testID="media-player"
      />
    );
  }
  return (
    <View style={styles.audio} testID="media-player">
      <Glyph color={colors.inkSecondary} size={ARTWORK_SIZE} symbol="audio" />
      <AppText font="rowDetail" color={colors.inkSecondary}>
        {playbackTime(progress?.currentTime ?? player.currentTime)} /{" "}
        {playbackTime(player.duration)}
      </AppText>
      <View style={{ width: "100%", maxWidth: 480, paddingHorizontal: 24 }}>
        <Host matchContents={{ vertical: true }} style={{ width: "100%" }}>
          <Slider
            min={0}
            max={Math.max(1, player.duration)}
            value={progress?.currentTime ?? player.currentTime}
            onValueChange={(value) => {
              player.seekBy(value - player.currentTime);
            }}
            modifiers={[accessibilityLabel("Playback position")]}
          />
        </Host>
      </View>
      <View style={styles.transport}>
        <PillButton
          title="Back 15s"
          size="large"
          kind="secondary"
          onPress={() => {
            player.seekBy(-15);
          }}
        />
        <PillButton
          title={isPlaying ? "Pause" : "Play"}
          size="large"
          testID="audio-play-pause"
          disabled={status !== "readyToPlay" || !visible}
          onPress={() => {
            if (isPlaying) {
              player.pause();
            } else {
              if (
                player.duration > 0 &&
                player.currentTime >= player.duration
              ) {
                player.replay();
              }
              player.play();
            }
          }}
        />
        <PillButton
          title="Forward 15s"
          size="large"
          kind="secondary"
          onPress={() => {
            player.seekBy(15);
          }}
        />
      </View>
      <VideoAirPlayButton
        accessibilityLabel="AirPlay"
        prioritizeVideoDevices={false}
        tint={colors.inkSecondary}
        style={{ width: 44, height: 44 }}
      />
    </View>
  );
};
