import {
  arrangementRows,
  historyCountLine,
  historyDateLabel,
  historyNamesArrangements,
  historyRowDetail,
  planningCenterArrangementUrl,
  serviceTypeLabel,
  songFacts,
  splitSongHistory,
} from "@pcobooster/planning-center-models/song-detail";
import type {
  ArrangementRowData,
  SongFact,
} from "@pcobooster/planning-center-models/song-detail";
import { useRouter } from "expo-router";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  ActionSheetIOS,
  Linking,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { failureMessage } from "../../app-shell/queries";
import { Glyph } from "../../components/glyph";
import { Hairline } from "../../components/hairline";
import { KeyBadge } from "../../components/key-badge";
import { PillButton } from "../../components/pill-button";
import { SectionHeader } from "../../components/section-header";
import { Skeleton } from "../../components/skeleton";
import { StatusBadge } from "../../components/status-badge";
import { SurfaceCard } from "../../components/surface-card";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Metrics, Radius, Spacing } from "../../design/metrics";
import { useOrgTimeZone } from "../../lib/environment";
import { planHref } from "../plan/reads";
import {
  chartTargetId,
  chartTargetLabel,
  hasChart,
  readChart,
  resolveChartTarget,
} from "./chart";
import { ChartLines } from "./chart-lines";
import { keyOptionLabel } from "./detail";
import type { SongHistoryEntry } from "./detail";
import { songChartPdfHref, songFilesHref } from "./preview-reads";
import { songChartHref } from "./reads";
import type { SongDetailModel } from "./use-song-detail";

/** Text sizes from here up are accessibility sizes (Swift `isAccessibilitySize`). */
const ACCESSIBILITY_FONT_SCALE = 1.6;
/** History rows shown before "Show all". */
const HISTORY_PREVIEW = 8;
/** Chart lines the card shows before "View Chart". */
const CHART_PREVIEW_LINES = 8;

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  factCell: { flexBasis: "45%", flexGrow: 1, gap: Spacing.xs },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.lg },
  inline: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.md,
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.md,
    minHeight: Metrics.minimumTapTarget + Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  rowText: { flex: 1, gap: Spacing.xxs },
  section: { gap: Spacing.sm },
  sectionTitle: { paddingHorizontal: Spacing.xs },
  stack: { gap: Spacing.sm, padding: Spacing.lg },
  theme: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: Radius.capsule,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs + 1,
  },
});

const pressedFill = ({ pressed }: { pressed: boolean }) =>
  pressed ? { backgroundColor: colors.surfaceHighlight } : null;

const Chevron = () => (
  <Glyph
    color={colors.inkTertiary}
    size={13}
    symbol="chevronRight"
    weight="semibold"
    width={8}
  />
);

/** A message in place of a section's content, with Try again when it might help. */
const InlineFailure = ({
  message,
  retry,
  testID,
}: {
  message: string;
  retry?: () => void;
  testID?: string;
}) => (
  <View style={styles.inline} testID={testID}>
    <AppText color={colors.inkSecondary} font="rowDetail" style={{ flex: 1 }}>
      {message}
    </AppText>
    {retry === undefined ? null : (
      <PillButton
        kind="outline"
        onPress={retry}
        size="small"
        title="Try again"
      />
    )}
  </View>
);

const LoadingLines = ({ label }: { label: string }) => (
  <View accessibilityLabel={label} accessible style={styles.stack}>
    <Skeleton height={14} variant="text" width={160} />
    <Skeleton height={10} variant="text" width={110} />
    <Skeleton height={10} variant="text" width={220} />
  </View>
);

/** Writers, themes, and whether Planning Center hides the song. */
export const SongHeader = ({ model }: { model: SongDetailModel }) => {
  if (model.author === "" && model.themes.length === 0 && !model.isHidden) {
    return model.title === null ? (
      <Skeleton height={12} variant="text" width={160} />
    ) : null;
  }
  return (
    <View style={styles.section}>
      {model.author === "" ? null : (
        <AppText
          color={colors.inkSecondary}
          font="rowDetail"
          testID="song-author"
        >
          {model.author}
        </AppText>
      )}
      {model.themes.length > 0 || model.isHidden ? (
        <View
          accessibilityLabel={[
            model.isHidden ? "Hidden in Planning Center" : null,
            model.themes.length > 0
              ? `Themes: ${model.themes.join(", ")}`
              : null,
          ]
            .filter((part) => part !== null)
            .join(". ")}
          accessible
          style={styles.chips}
        >
          {model.isHidden ? (
            <StatusBadge
              symbol="locked"
              title="Hidden in Planning Center"
              tone="neutral"
            />
          ) : null}
          {model.themes.map((theme) => (
            <View key={theme} style={styles.theme}>
              <AppText color={colors.inkSecondary} font="badgeLabel">
                {theme}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

/** The keys it was sung in, as badges. */
const FactKeys = ({ keys }: { keys: readonly string[] }) =>
  keys.length === 0 ? (
    <AppText color={colors.inkTertiary} font="title3" weight="semibold">
      No keys yet
    </AppText>
  ) : (
    <View style={styles.chips}>
      {keys.map((key) => (
        <KeyBadge key={key} songKey={key} />
      ))}
    </View>
  );

const FactCell = ({ fact }: { fact: SongFact }) => (
  <View
    accessibilityLabel={
      fact.kind === "keys"
        ? `${fact.label}, ${fact.keys.length === 0 ? "No keys yet" : fact.keys.join(", ")}`
        : [fact.label, fact.accessibilityValue, fact.caption]
            .filter((part) => part !== null)
            .join(", ")
    }
    accessible
    style={styles.factCell}
  >
    <AppText color={colors.inkSecondary} font="meta">
      {fact.label}
    </AppText>
    {fact.kind === "keys" ? (
      <FactKeys keys={fact.keys} />
    ) : (
      <>
        <AppText font="title3" tabular weight="semibold">
          {fact.value}
        </AppText>
        {fact.caption === null ? null : (
          <AppText color={colors.inkSecondary} font="meta" numberOfLines={2}>
            {fact.caption}
          </AppText>
        )}
      </>
    )}
  </View>
);

/** Last sung, next planned, how often in the past year and where, and its keys. Never advice. */
export const SongFactsCard = ({ model }: { model: SongDetailModel }) => {
  const timeZone = useOrgTimeZone();
  const { history } = model;
  if (history.data === undefined) {
    return (
      <SurfaceCard padding={history.error === null ? "regular" : "none"}>
        {history.error === null ? (
          <View
            accessibilityLabel="Loading history"
            accessible
            style={styles.facts}
          >
            {[0, 1, 2, 3].map((cell) => (
              <View key={cell} style={styles.factCell}>
                <Skeleton height={10} variant="text" width={64} />
                <Skeleton height={18} variant="text" width={96} />
              </View>
            ))}
          </View>
        ) : (
          <InlineFailure
            message={`History didn’t load. ${failureMessage(history.error)}`}
            retry={() => {
              void history.refetch();
            }}
            testID="song-history-failure"
          />
        )}
      </SurfaceCard>
    );
  }
  return (
    <SurfaceCard>
      <View style={styles.facts} testID="song-facts">
        {songFacts(history.data, model.now, timeZone).map((fact) => (
          <FactCell fact={fact} key={fact.label} />
        ))}
      </View>
    </SurfaceCard>
  );
};

/**
 * The chart of the first arrangement that has one, in its first key, as text drawn from the
 * saved Lyrics & Chords. "View Chart" opens it full screen with every arrangement and key; "PDF"
 * opens Planning Center's own render of it, and "Files" the arrangement's attachments.
 */
export const SongChartCard = ({ model }: { model: SongDetailModel }) => {
  const router = useRouter();
  const { chart } = model;
  if (!model.chartsEnabled) {
    return null;
  }
  let body: ReactNode = null;
  const arrangements = model.chartArrangements;
  const withChart = arrangements.find(hasChart);
  if (chart.data === undefined) {
    body =
      chart.error === null ? (
        <LoadingLines label="Loading the chord chart" />
      ) : (
        <InlineFailure
          message={`The chart didn’t load. ${failureMessage(chart.error)}`}
          retry={() => {
            void chart.refetch();
          }}
          testID="song-chart-failure"
        />
      );
  } else if (arrangements.length === 0) {
    body = (
      <InlineFailure message="This song has no arrangements in Planning Center yet." />
    );
  } else if (withChart === undefined) {
    body = (
      <InlineFailure message="No chart yet: no arrangement has lyrics or chords in Planning Center." />
    );
  } else {
    const target = resolveChartTarget(withChart, null);
    const reading = readChart(withChart, target);
    body = (
      <View style={styles.stack}>
        <AppText color={colors.inkSecondary} font="meta">
          {`${withChart.name} · ${chartTargetLabel(target)}`}
        </AppText>
        <ChartLines
          lines={reading.lines.slice(0, CHART_PREVIEW_LINES)}
          testID="song-chart-preview"
        />
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: Spacing.sm,
            paddingTop: Spacing.sm,
          }}
        >
          <PillButton
            onPress={() => {
              router.push(
                songChartHref(model.songId, withChart.id, chartTargetId(target))
              );
            }}
            size="small"
            symbol="chordChart"
            testID="song-view-chart"
            title="View Chart"
          />
          <PillButton
            accessibilityHint="Opens Planning Center's PDF of this chart"
            kind="secondary"
            onPress={() => {
              router.push(
                songChartPdfHref(
                  model.songId,
                  withChart.id,
                  chartTargetId(target)
                )
              );
            }}
            size="small"
            symbol="document"
            testID="song-view-chart-pdf"
            title="PDF"
          />
          <PillButton
            accessibilityHint="Lists the arrangement's attached files"
            kind="secondary"
            onPress={() => {
              router.push(songFilesHref(model.songId, withChart.id));
            }}
            size="small"
            symbol="attachment"
            testID="song-view-files"
            title="Files"
          />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitle}>
        <SectionHeader title="Chord chart" />
      </View>
      <SurfaceCard padding="none">{body}</SurfaceCard>
    </View>
  );
};

const showArrangementActions = (
  model: SongDetailModel,
  row: ArrangementRowData,
  openChart: () => void,
  openFiles: () => void
) => {
  const actions: { label: string; run: () => void }[] = [];
  if (model.chartsEnabled) {
    actions.push(
      { label: "Chord Chart", run: openChart },
      { label: "Files", run: openFiles }
    );
  }
  actions.push({
    label: "Open in Planning Center",
    run: () => {
      void Linking.openURL(planningCenterArrangementUrl(model.songId, row.id));
    },
  });
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: row.name,
      options: [...actions.map((action) => action.label), "Cancel"],
      cancelButtonIndex: actions.length,
    },
    (index) => {
      actions[index]?.run();
    }
  );
};

const ArrangementRow = ({
  model,
  row,
}: {
  model: SongDetailModel;
  row: ArrangementRowData;
}) => {
  const router = useRouter();
  const openChart = () => {
    router.push(songChartHref(model.songId, row.id));
  };
  const openFiles = () => {
    router.push(songFilesHref(model.songId, row.id));
  };
  const content = (
    <>
      <View style={styles.rowText}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: Spacing.sm,
          }}
        >
          <AppText
            color={row.archived ? colors.inkSecondary : colors.ink}
            font="rowTitleEmphasized"
            style={{ flexShrink: 1 }}
          >
            {row.name}
          </AppText>
          {row.archived ? (
            <StatusBadge title="Archived" tone="neutral" variant="plain" />
          ) : null}
        </View>
        {row.facts === null ? null : (
          <AppText color={colors.inkSecondary} font="meta" tabular>
            {row.facts}
          </AppText>
        )}
        {row.keys.length === 0 ? null : (
          <View style={styles.chips}>
            {row.keys.map((key) => (
              <View
                accessibilityLabel={`Key ${keyOptionLabel(key)}`}
                accessible
                key={key.id}
                style={{
                  alignItems: "center",
                  flexDirection: "row",
                  gap: Spacing.xs,
                }}
              >
                <KeyBadge songKey={key.startingKey} />
                {key.name === "" || key.name === key.startingKey ? null : (
                  <AppText color={colors.inkSecondary} font="meta">
                    {key.name}
                  </AppText>
                )}
              </View>
            ))}
          </View>
        )}
        {row.sequence.length === 0 ? null : (
          <AppText color={colors.inkTertiary} font="meta" numberOfLines={2}>
            {row.sequence.join(", ")}
          </AppText>
        )}
      </View>
      {model.chartsEnabled ? <Chevron /> : null}
    </>
  );
  return (
    <Pressable
      accessibilityHint={
        model.chartsEnabled ? "Opens its chord chart" : undefined
      }
      accessibilityRole={model.chartsEnabled ? "button" : undefined}
      onLongPress={() => {
        showArrangementActions(model, row, openChart, openFiles);
      }}
      onPress={model.chartsEnabled ? openChart : undefined}
      style={(state) => [styles.row, pressedFill(state)]}
      testID={`song-arrangement-${row.id}`}
    >
      {content}
    </Pressable>
  );
};

/** The arrangements as Planning Center holds them, archived ones last. */
export const SongArrangementsSection = ({
  model,
}: {
  model: SongDetailModel;
}) => {
  const rows = arrangementRows(
    model.options.data?.arrangements,
    model.chart.data?.arrangements
  );
  let body: ReactNode;
  if (rows.length > 0) {
    body = rows.map((row, index) => (
      <View key={row.id}>
        {index > 0 ? <Hairline inset={Spacing.lg} /> : null}
        <ArrangementRow model={model} row={row} />
      </View>
    ));
  } else if (model.optionsFailed && model.chart.data === undefined) {
    body = (
      <InlineFailure
        message="Arrangements didn’t load."
        retry={model.retryOptions}
        testID="song-arrangements-failure"
      />
    );
  } else if (
    model.options.data !== undefined ||
    model.chart.data !== undefined
  ) {
    body = <InlineFailure message="No arrangements in Planning Center yet." />;
  } else {
    body = <LoadingLines label="Loading arrangements" />;
  }
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitle}>
        <SectionHeader
          count={rows.length === 0 ? undefined : rows.length}
          title="Arrangements"
        />
      </View>
      <SurfaceCard padding="none">{body}</SurfaceCard>
    </View>
  );
};

const HistoryRow = ({
  entry,
  now,
  namesArrangement,
}: {
  entry: SongHistoryEntry;
  now: Date;
  namesArrangement: boolean;
}) => {
  const router = useRouter();
  const timeZone = useOrgTimeZone();
  const stacked = useWindowDimensions().fontScale >= ACCESSIBILITY_FONT_SCALE;
  const date = historyDateLabel(entry.sortDate, now, timeZone);
  const detail = historyRowDetail(entry, namesArrangement);
  const { planId, serviceTypeId } = entry;
  const opens = planId !== null && serviceTypeId !== null;
  return (
    <Pressable
      accessibilityHint={opens ? "Opens the plan" : undefined}
      accessibilityLabel={[
        date,
        serviceTypeLabel(entry.serviceTypeName),
        detail,
        entry.startingKey === null ? null : `key ${entry.startingKey}`,
      ]
        .filter((part) => part !== null)
        .join(", ")}
      accessibilityRole={opens ? "button" : undefined}
      onPress={
        opens
          ? () => {
              router.push(planHref({ serviceTypeId, planId }, "Plan"));
            }
          : undefined
      }
      style={(state) => [styles.row, opens ? pressedFill(state) : null]}
      testID={`song-history-${planId ?? entry.sortDate.toISOString()}`}
    >
      {stacked ? null : (
        <AppText
          color={colors.inkSecondary}
          font="meta"
          style={{ width: 92 }}
          tabular
        >
          {date}
        </AppText>
      )}
      <View style={styles.rowText}>
        {stacked ? (
          <AppText color={colors.inkSecondary} font="meta" tabular>
            {date}
          </AppText>
        ) : null}
        <AppText font="rowTitle" numberOfLines={stacked ? 3 : 1}>
          {serviceTypeLabel(entry.serviceTypeName)}
        </AppText>
        {detail === null ? null : (
          <AppText color={colors.inkSecondary} font="meta" numberOfLines={1}>
            {detail}
          </AppText>
        )}
      </View>
      {entry.startingKey === null || entry.startingKey === "" ? null : (
        <KeyBadge songKey={entry.startingKey} />
      )}
      {opens ? <Chevron /> : null}
    </Pressable>
  );
};

const HistoryRows = ({
  entries,
  now,
  namesArrangement,
}: {
  entries: readonly SongHistoryEntry[];
  now: Date;
  namesArrangement: boolean;
}) =>
  entries.map((entry, index) => (
    <View key={`${entry.planId ?? ""}-${entry.sortDate.toISOString()}`}>
      {index > 0 ? <Hairline inset={Spacing.lg} /> : null}
      <HistoryRow entry={entry} namesArrangement={namesArrangement} now={now} />
    </View>
  ));

/**
 * Every plan with the song over the past year and the ones already planned, with the key each
 * sang it in (`songs.history`). A row opens its plan's run sheet in Services.
 */
export const SongHistorySection = ({ model }: { model: SongDetailModel }) => {
  const [showsAll, setShowsAll] = useState(false);
  const { history } = model;
  if (history.data === undefined) {
    return history.error === null ? (
      <View style={styles.section}>
        <View style={styles.sectionTitle}>
          <SectionHeader title="History" />
        </View>
        <SurfaceCard padding="none">
          <LoadingLines label="Loading history" />
        </SurfaceCard>
      </View>
    ) : null;
  }
  const { upcoming, past } = splitSongHistory(history.data, model.now);
  const namesArrangement = historyNamesArrangements(history.data);
  const shown = showsAll ? past : past.slice(0, HISTORY_PREVIEW);
  return (
    <>
      {upcoming.length === 0 ? null : (
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <SectionHeader count={upcoming.length} title="Planned" />
          </View>
          <SurfaceCard padding="none">
            <HistoryRows
              entries={upcoming}
              namesArrangement={namesArrangement}
              now={model.now}
            />
          </SurfaceCard>
        </View>
      )}
      <View style={styles.section}>
        <View style={styles.sectionTitle}>
          <SectionHeader
            count={past.length === 0 ? undefined : past.length}
            title="Past year"
          />
          <AppText color={colors.inkSecondary} font="meta">
            {historyCountLine(history.data, model.now)}
          </AppText>
        </View>
        <SurfaceCard padding="none">
          {past.length === 0 ? (
            <InlineFailure
              message={
                history.data.length > 0
                  ? "Not sung in the past year."
                  : "Not scheduled in the past year."
              }
            />
          ) : (
            <>
              <HistoryRows
                entries={shown}
                namesArrangement={namesArrangement}
                now={model.now}
              />
              {past.length > HISTORY_PREVIEW ? (
                <>
                  <Hairline />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setShowsAll(!showsAll);
                    }}
                    style={(state) => [
                      {
                        alignItems: "center",
                        minHeight: Metrics.minimumTapTarget,
                        justifyContent: "center",
                      },
                      pressedFill(state),
                    ]}
                    testID="song-history-toggle"
                  >
                    <AppText font="rowDetail" weight="medium">
                      {showsAll ? "Show less" : `Show all ${past.length}`}
                    </AppText>
                  </Pressable>
                </>
              ) : null}
            </>
          )}
        </SurfaceCard>
      </View>
    </>
  );
};
