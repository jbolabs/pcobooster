import {
  activeFirst,
  planningCenterArrangementUrl,
} from "@pcobooster/planning-center-models/song-detail";
import type { UseQueryResult } from "@tanstack/react-query";
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

import { useFeatures } from "../../app-shell/features";
import { failureMessage, useProductClient } from "../../app-shell/queries";
import { useVisibleQuery } from "../../app-shell/visible-queries";
import { EmptyState } from "../../components/empty-state";
import { InfoBanner } from "../../components/info-banner";
import { PillButton } from "../../components/pill-button";
import { Skeleton } from "../../components/skeleton";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import {
  chartTargetId,
  chartTargetLabel,
  chartTargets,
  hasChart,
  readChart,
  resolveChartTarget,
} from "./chart";
import type { ChartTarget } from "./chart";
import { ChartLines } from "./chart-lines";
import { songLoadFailure, songLoadFailureCopy } from "./detail";
import type { ChordChartArrangement } from "./detail";
import { songDisplayTitle } from "./library";
import { songChartPdfHref, songFilesHref } from "./preview-reads";
import type { ChordChartSongOutput } from "./reads";
import { songsReads } from "./reads";
import { useSongPath } from "./use-song-path";

/** Lines stay a comfortable reading length on iPad. */
const READABLE_WIDTH = 720;

const styles = StyleSheet.create({
  center: { flexGrow: 1, justifyContent: "center" },
  content: {
    alignSelf: "center",
    gap: Spacing.lg,
    maxWidth: READABLE_WIDTH,
    paddingBottom: Spacing.huge,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    width: "100%",
  },
  loading: { gap: Spacing.md, padding: Spacing.lg },
  scroll: { backgroundColor: colors.surfaceCanvas },
});

const chartMenu = (
  arrangements: readonly ChordChartArrangement[],
  arrangement: ChordChartArrangement,
  targetId: string,
  songId: string,
  select: (arrangementId: string, target: string | null) => void,
  openPdf: () => void,
  openFiles: () => void
): NativeStackHeaderItem => ({
  type: "menu",
  label: "Chart",
  accessibilityLabel: "Choose the arrangement and key",
  icon: { type: "sfSymbol", name: "key" },
  menu: {
    items: [
      ...(arrangements.length > 1
        ? [
            {
              type: "submenu" as const,
              label: "Arrangement",
              inline: true,
              items: arrangements.map((option) => ({
                type: "action" as const,
                label: option.archived
                  ? `${option.name} (archived)`
                  : option.name,
                state:
                  option.id === arrangement.id
                    ? ("on" as const)
                    : ("off" as const),
                onPress: () => {
                  select(option.id, null);
                },
              })),
            },
          ]
        : []),
      {
        type: "submenu" as const,
        label: "Show",
        inline: true,
        items: chartTargets(arrangement).map((target) => ({
          type: "action" as const,
          label: chartTargetLabel(target),
          state:
            chartTargetId(target) === targetId
              ? ("on" as const)
              : ("off" as const),
          onPress: () => {
            select(arrangement.id, chartTargetId(target));
          },
        })),
      },
      {
        type: "submenu" as const,
        label: "",
        inline: true,
        items: [
          {
            type: "action" as const,
            label: "Planning Center PDF",
            icon: { type: "sfSymbol" as const, name: "doc.text" as const },
            onPress: openPdf,
          },
          {
            type: "action" as const,
            label: "Files",
            icon: { type: "sfSymbol" as const, name: "paperclip" as const },
            onPress: openFiles,
          },
          {
            type: "action" as const,
            label: "Open in Planning Center",
            icon: {
              type: "sfSymbol" as const,
              name: "arrow.up.right.square" as const,
            },
            onPress: () => {
              void Linking.openURL(
                planningCenterArrangementUrl(songId, arrangement.id)
              );
            },
          },
        ],
      },
    ],
  },
});

type ChartQuery = UseQueryResult<ChordChartSongOutput>;

const ChartLoading = () => (
  <View
    accessibilityLabel="Loading the chord chart"
    accessible
    style={styles.loading}
  >
    <Skeleton height={14} variant="text" width={120} />
    <Skeleton height={14} variant="text" width={240} />
    <Skeleton height={14} variant="text" width={200} />
    <Skeleton height={14} variant="text" width={260} />
  </View>
);

const ChartFailure = ({ chart }: { chart: ChartQuery }) => {
  const copy = songLoadFailureCopy(songLoadFailure(chart.error));
  return (
    <EmptyState
      actions={
        copy.canRetry ? (
          <PillButton
            kind="secondary"
            onPress={() => {
              void chart.refetch();
            }}
            testID="chart-retry"
            title="Try again"
          />
        ) : undefined
      }
      artwork="alert"
      description={
        copy.canRetry && chart.error !== null
          ? failureMessage(chart.error)
          : copy.message
      }
      title={copy.canRetry ? "The chart didn’t load" : copy.title}
    />
  );
};

const EmptyChart = ({
  songId,
  arrangement,
}: {
  songId: string;
  arrangement: ChordChartArrangement;
}) => (
  <EmptyState
    actions={
      <PillButton
        kind="secondary"
        onPress={() => {
          void Linking.openURL(
            planningCenterArrangementUrl(songId, arrangement.id)
          );
        }}
        symbol="openExternal"
        title="Open in Planning Center"
      />
    }
    artwork="chordChart"
    description={`${arrangement.name} has no lyrics or chords in Planning Center.`}
    title="No chart yet"
  />
);

/** The chart itself, with a note when it couldn't refresh or can't move to the chosen key. */
const ChartReading = ({
  chart,
  arrangement,
  target,
}: {
  chart: ChartQuery;
  arrangement: ChordChartArrangement;
  target: ChartTarget;
}) => {
  const reading = readChart(arrangement, target);
  return (
    <View style={styles.content}>
      {chart.error === null ? null : (
        <InfoBanner
          action={
            <PillButton
              kind="outline"
              onPress={() => {
                void chart.refetch();
              }}
              size="small"
              title="Retry"
            />
          }
          message={`The chart didn’t refresh, so this is the last one loaded. ${failureMessage(chart.error)}`}
          tone="destructive"
        />
      )}
      <AppText color={colors.inkSecondary} font="meta" testID="chart-target">
        {`${arrangement.name} · ${chartTargetLabel(target)}${arrangement.archived ? " · Archived" : ""}`}
      </AppText>
      {reading.note === null ? null : <InfoBanner message={reading.note} />}
      {arrangement.keys.length === 0 ? (
        <InfoBanner message="This arrangement has no key in Planning Center." />
      ) : null}
      <ChartLines lines={reading.lines} testID="chart-lines" />
    </View>
  );
};

const ChartBody = ({
  chartsEnabled,
  featuresPending,
  chart,
  arrangement,
  target,
  songId,
}: {
  chartsEnabled: boolean;
  featuresPending: boolean;
  chart: ChartQuery;
  arrangement: ChordChartArrangement | undefined;
  target: ChartTarget | null;
  songId: string;
}) => {
  if (featuresPending) {
    return <ChartLoading />;
  }
  if (!chartsEnabled) {
    return (
      <EmptyState
        artwork="chordChart"
        description="Chord charts aren’t turned on for this account."
        title="Charts unavailable"
      />
    );
  }
  if (chart.data === undefined) {
    return chart.error === null ? (
      <ChartLoading />
    ) : (
      <ChartFailure chart={chart} />
    );
  }
  if (arrangement === undefined || target === null) {
    return (
      <EmptyState
        artwork="chordChart"
        description="This song has no arrangements in Planning Center yet."
        title="No chart yet"
      />
    );
  }
  return hasChart(arrangement) ? (
    <ChartReading arrangement={arrangement} chart={chart} target={target} />
  ) : (
    <EmptyChart arrangement={arrangement} songId={songId} />
  );
};

/**
 * An arrangement's chord chart, read only, for reading at a music stand: its saved Lyrics &
 * Chords in one of its keys (transposed from the key it is written in) or as lyrics. The menu
 * switches arrangement and key, and opens Planning Center's own PDF of the same chart and the
 * arrangement's files. Behind
 * the `chordCharts` flag.
 */
export const ChordChartScreen = () => {
  const params = useLocalSearchParams<{
    songId: string;
    arrangement?: string;
    target?: string;
  }>();
  const { songId } = params;
  const router = useRouter();
  const songPath = useSongPath();
  const context = useProductClient();
  const features = useFeatures();
  const chart = useVisibleQuery({
    ...songsReads.chart(context, songId),
    enabled: features.chordCharts,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const arrangements = activeFirst(chart.data?.arrangements ?? []);
  const arrangement =
    arrangements.find((option) => option.id === params.arrangement) ??
    arrangements[0];
  const target =
    arrangement === undefined
      ? null
      : resolveChartTarget(arrangement, params.target);
  const showsReading =
    chart.data !== undefined &&
    arrangement !== undefined &&
    hasChart(arrangement);

  const select = (arrangementId: string, nextTarget: string | null) => {
    router.setParams({
      arrangement: arrangementId,
      target: nextTarget ?? undefined,
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title:
            chart.data === undefined
              ? "Chord Chart"
              : songDisplayTitle(chart.data.song.title),
          unstable_headerRightItems: () =>
            arrangement === undefined || target === null
              ? []
              : [
                  chartMenu(
                    arrangements,
                    arrangement,
                    chartTargetId(target),
                    songId,
                    select,
                    () => {
                      router.push(
                        songPath(
                          songChartPdfHref(
                            songId,
                            arrangement.id,
                            chartTargetId(target)
                          )
                        )
                      );
                    },
                    () => {
                      router.push(
                        songPath(songFilesHref(songId, arrangement.id))
                      );
                    }
                  ),
                ],
        }}
      />
      <ScrollView
        contentContainerStyle={showsReading ? undefined : styles.center}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          features.chordCharts ? (
            <RefreshControl
              onRefresh={() => {
                setIsRefreshing(true);
                void (async () => {
                  await chart.refetch();
                  setIsRefreshing(false);
                })();
              }}
              refreshing={isRefreshing}
            />
          ) : undefined
        }
        style={styles.scroll}
        testID={`chart-${songId}`}
      >
        <ChartBody
          arrangement={arrangement}
          chart={chart}
          chartsEnabled={features.chordCharts}
          featuresPending={features.isPending}
          songId={songId}
          target={target}
        />
      </ScrollView>
    </>
  );
};
