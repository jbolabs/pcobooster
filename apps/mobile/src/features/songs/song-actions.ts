import { planningCenterSongUrl } from "@pcobooster/planning-center-models/song-detail";
import * as Clipboard from "expo-clipboard";
import { ActionSheetIOS, Linking } from "react-native";

import { playHaptic } from "../../design/haptics";

/** Copies a song's title (Swift "Copy Title"); success is a haptic, not a toast. */
export const copySongTitle = (title: string, onError: () => void): void => {
  void (async () => {
    try {
      await Clipboard.setStringAsync(title);
      playHaptic("success");
    } catch {
      onError();
    }
  })();
};

/**
 * A song row's long-press actions (Swift `contextMenu`): open it, its chord chart (with the
 * `chordCharts` flag), copy its title, and its page in Planning Center, where hiding a song
 * happens.
 */
export const showSongActions = ({
  title,
  songId,
  chartsEnabled,
  tidying,
  onOpen,
  onChart,
  onCopyError,
}: {
  title: string;
  songId: string;
  chartsEnabled: boolean;
  /** A tidy-up filter is on, so the Planning Center action is about hiding the song. */
  tidying: boolean;
  onOpen: () => void;
  onChart: () => void;
  onCopyError: () => void;
}): void => {
  const actions: { label: string; run: () => void }[] = [
    { label: "Open", run: onOpen },
  ];
  if (chartsEnabled) {
    actions.push({ label: "Chord Chart", run: onChart });
  }
  actions.push(
    {
      label: "Copy Title",
      run: () => {
        copySongTitle(title, onCopyError);
      },
    },
    {
      label: tidying ? "Hide in Planning Center" : "Open in Planning Center",
      run: () => {
        void Linking.openURL(planningCenterSongUrl(songId));
      },
    }
  );
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      options: [...actions.map((action) => action.label), "Cancel"],
      cancelButtonIndex: actions.length,
    },
    (index) => {
      actions[index]?.run();
    }
  );
};
