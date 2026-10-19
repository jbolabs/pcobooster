import { planningCenterSongUrl } from "@pcobooster/planning-center-models/song-detail";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { NativeStackHeaderItem } from "expo-router";
import { useState } from "react";
import {
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { EmptyState } from "../../components/empty-state";
import { PillButton } from "../../components/pill-button";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { useToasts } from "../../lib/toasts";
import { songLoadFailureCopy } from "./detail";
import { songChartHref } from "./reads";
import { copySongTitle } from "./song-actions";
import {
  SongArrangementsSection,
  SongChartCard,
  SongFactsCard,
  SongHeader,
  SongHistorySection,
} from "./song-detail-sections";
import { useSongDetail } from "./use-song-detail";
import type { SongDetailModel } from "./use-song-detail";

/** Content stays readable on iPad instead of stretching across the screen. */
const READABLE_WIDTH = 680;

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    gap: Spacing.xl,
    maxWidth: READABLE_WIDTH,
    paddingBottom: Spacing.huge,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    width: "100%",
  },
  failure: { flexGrow: 1, justifyContent: "center" },
  scroll: { backgroundColor: colors.surfaceCanvas },
});

const headerItems = (
  model: SongDetailModel,
  openChart: () => void,
  onCopyError: () => void
): NativeStackHeaderItem[] => [
  ...(model.chartsEnabled
    ? [
        {
          type: "button" as const,
          label: "Chord Chart",
          accessibilityLabel: "Chord chart",
          icon: { type: "sfSymbol" as const, name: "doc.richtext" as const },
          onPress: openChart,
        },
      ]
    : []),
  {
    type: "menu",
    label: "More",
    icon: { type: "sfSymbol", name: "ellipsis" },
    menu: {
      items: [
        ...(model.title === null
          ? []
          : [
              {
                type: "action" as const,
                label: "Copy Title",
                icon: {
                  type: "sfSymbol" as const,
                  name: "doc.on.doc" as const,
                },
                onPress: () => {
                  copySongTitle(model.title ?? "", onCopyError);
                },
              },
            ]),
        {
          type: "action",
          label: "Open in Planning Center",
          icon: { type: "sfSymbol", name: "arrow.up.right.square" },
          onPress: () => {
            void Linking.openURL(planningCenterSongUrl(model.songId));
          },
        },
      ],
    },
  },
];

/**
 * One song's facts (Swift `SongDetailView`): writers and themes, when it was last and next
 * sung, how often, its keys, its arrangements, every plan with it over the past year, and with
 * the `chordCharts` flag its chart. Facts only, never suggestions. Reachable without the flag
 * (from a link or the run sheet); chart parts hide when it is off. Pull to refresh.
 */
export const SongDetailScreen = () => {
  const params = useLocalSearchParams<{ songId: string }>();
  const { songId } = params;
  const model = useSongDetail(songId);
  const router = useRouter();
  const toasts = useToasts();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const openChart = () => {
    const [first] = model.chartArrangements;
    router.push(songChartHref(songId, first?.id));
  };
  const screen = (
    <Stack.Screen
      options={{
        title: model.title ?? "Song",
        headerLargeTitleEnabled: true,
        headerLargeTitleShadowVisible: false,
        headerTransparent: true,
        unstable_headerRightItems: () =>
          headerItems(model, openChart, () => {
            toasts.showError("Couldn't copy the song title.");
          }),
      }}
    />
  );
  if (model.failure !== null) {
    const copy = songLoadFailureCopy(model.failure);
    return (
      <>
        {screen}
        <ScrollView
          contentContainerStyle={styles.failure}
          contentInsetAdjustmentBehavior="automatic"
          style={styles.scroll}
          testID="song-failure"
        >
          <EmptyState
            actions={
              <View style={{ gap: Spacing.sm }}>
                {copy.canRetry ? (
                  <PillButton
                    onPress={() => {
                      model.retryAll();
                    }}
                    testID="song-retry"
                    title="Try again"
                  />
                ) : null}
                <PillButton
                  kind="secondary"
                  onPress={() => {
                    router.dismissTo("/songs");
                  }}
                  title="Back to Songs"
                />
              </View>
            }
            artwork="alert"
            description={copy.message}
            title={copy.title}
          />
        </ScrollView>
      </>
    );
  }
  return (
    <>
      {screen}
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            onRefresh={() => {
              setIsRefreshing(true);
              void (async () => {
                await model.refresh();
                setIsRefreshing(false);
              })();
            }}
            refreshing={isRefreshing}
          />
        }
        style={styles.scroll}
        testID={`song-detail-${songId}`}
      >
        <SongHeader model={model} />
        <SongFactsCard model={model} />
        <SongChartCard model={model} />
        <SongArrangementsSection model={model} />
        <SongHistorySection model={model} />
      </ScrollView>
    </>
  );
};
