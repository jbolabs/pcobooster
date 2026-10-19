import { formatCalendarDateLabel } from "@pcobooster/planning-center-models/calendar";
import { compactDate } from "@pcobooster/planning-center-models/song-detail";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { useOrgTimeZone } from "../../lib/environment";
import { neverScheduled } from "./library";
import type { SongRowData } from "./library";

/** Text sizes from here up are accessibility sizes (Swift `isAccessibilitySize`). */
const ACCESSIBILITY_FONT_SCALE = 1.6;

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  text: { flex: 1, gap: Spacing.xxs },
});

/** "Sep 27" this year, "Mar 10, 2024" before it, or "Never scheduled". */
const dateLabel = (
  row: SongRowData,
  now: Date,
  timeZone: string
): string | null => {
  if (!row.dated) {
    return null;
  }
  return row.lastScheduledAt === null
    ? "Never scheduled"
    : compactDate(row.lastScheduledAt, now, timeZone);
};

const detailLine = (
  row: SongRowData,
  date: string | null,
  includeDate: boolean,
  timeZone: string
): string | null => {
  const parts: string[] = [];
  if (includeDate && date !== null) {
    parts.push(date);
  }
  if (neverScheduled(row) && row.createdAt !== null) {
    parts.push(
      `Added ${formatCalendarDateLabel(row.createdAt, timeZone, "monthYear")}`
    );
  }
  if (row.author !== "") {
    parts.push(row.author);
  }
  return parts.length === 0 ? null : parts.join(" · ");
};

const spokenRow = (row: SongRowData, timeZone: string): string => {
  const parts = [row.title];
  if (row.author !== "") {
    parts.push(`by ${row.author}`);
  }
  if (row.dated) {
    parts.push(
      row.lastScheduledAt === null
        ? "never scheduled"
        : `last scheduled ${formatCalendarDateLabel(row.lastScheduledAt, timeZone, "monthDayYear")}`
    );
  }
  return parts.join(", ");
};

/**
 * A library row: the title, its writers (and when it was added, if never scheduled), and the
 * date of the latest plan with it. Facts only; nothing ranks or recommends. Long press opens
 * the row's actions.
 */
export const SongRow = ({
  row,
  now,
  onOpen,
  onActions,
}: {
  row: SongRowData;
  now: Date;
  onOpen: () => void;
  onActions: () => void;
}) => {
  const timeZone = useOrgTimeZone();
  const stacked = useWindowDimensions().fontScale >= ACCESSIBILITY_FONT_SCALE;
  const lines = stacked ? 3 : 1;
  const date = dateLabel(row, now, timeZone);
  const detail = detailLine(row, date, stacked, timeZone);
  return (
    <Pressable
      accessibilityActions={[{ name: "longpress", label: "Song actions" }]}
      accessibilityHint="Opens the song"
      accessibilityLabel={spokenRow(row, timeZone)}
      accessibilityRole="button"
      delayLongPress={350}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") {
          onActions();
        }
      }}
      onLongPress={onActions}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.row,
        pressed ? { backgroundColor: colors.surfaceHighlight } : null,
      ]}
      testID={`song-row-${row.id}`}
    >
      <View style={styles.text}>
        <AppText font="rowTitle" numberOfLines={lines}>
          {row.title}
        </AppText>
        {detail === null ? null : (
          <AppText
            color={colors.inkSecondary}
            font="rowDetail"
            numberOfLines={lines}
          >
            {detail}
          </AppText>
        )}
      </View>
      {stacked || date === null ? null : (
        <AppText
          color={neverScheduled(row) ? colors.inkTertiary : colors.inkSecondary}
          font="meta"
          numberOfLines={1}
          tabular
        >
          {date}
        </AppText>
      )}
    </Pressable>
  );
};
