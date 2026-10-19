import type {
  ChartLine,
  ChartSegment,
} from "@pcobooster/planning-center-models/chord-chart-lines";
import { Platform, StyleSheet, View } from "react-native";

import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { displayKey } from "../../lib/song-keys";

/** Chord lines keep their columns over the lyrics, so they need a fixed-width face. */
const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

const styles = StyleSheet.create({
  chords: { fontFamily: MONOSPACE },
  comment: { fontStyle: "italic" },
  gap: { height: Spacing.md },
  heading: { paddingTop: Spacing.xs },
  lines: { gap: Spacing.xxs },
  lyric: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap" },
  segment: { flexShrink: 1 },
});

/** One inline chord over the lyric that follows it. */
const Segment = ({
  segment,
  hasChords,
}: {
  segment: ChartSegment;
  hasChords: boolean;
}) => (
  <View style={styles.segment}>
    {hasChords ? (
      <AppText
        color={colors.statusInfoText}
        font="rowDetail"
        numberOfLines={1}
        weight="semibold"
      >
        {segment.chord === null || segment.chord === ""
          ? " "
          : `${displayKey(segment.chord)} `}
      </AppText>
    ) : null}
    <AppText font="rowTitle">
      {segment.text === "" ? " " : segment.text}
    </AppText>
  </View>
);

/** Spoken text for a lyric line: the words, with each chord named before its words. */
const spokenLyric = (segments: readonly ChartSegment[]): string =>
  segments
    .map((segment) =>
      segment.chord === null || segment.chord === ""
        ? segment.text
        : `(${segment.chord}) ${segment.text}`
    )
    .join("");

/** Gives each item a key from its position: chart lines have no other identity. */
const positioned = <Item,>(items: readonly Item[]) =>
  items.map((item, position) => ({ item, key: `item-${position}` }));

const LyricLine = ({ segments }: { segments: readonly ChartSegment[] }) => {
  const hasChords = segments.some((segment) => segment.chord !== null);
  return (
    <View
      accessibilityLabel={spokenLyric(segments)}
      accessible
      style={styles.lyric}
    >
      {positioned(segments).map(({ item, key }) => (
        <Segment hasChords={hasChords} key={key} segment={item} />
      ))}
    </View>
  );
};

const Line = ({ line }: { line: ChartLine }) => {
  if (line.kind === "heading") {
    return (
      <AppText
        accessibilityRole="header"
        color={colors.inkSecondary}
        font="sectionLabel"
        style={styles.heading}
      >
        {line.text}
      </AppText>
    );
  }
  if (line.kind === "chords") {
    return (
      <AppText
        color={colors.statusInfoText}
        font="rowDetail"
        style={styles.chords}
        weight="semibold"
      >
        {line.text}
      </AppText>
    );
  }
  if (line.kind === "comment") {
    return (
      <AppText
        color={colors.inkSecondary}
        font="rowDetail"
        style={styles.comment}
      >
        {line.text}
      </AppText>
    );
  }
  if (line.kind === "lyric") {
    return <LyricLine segments={line.segments} />;
  }
  return <View style={styles.gap} />;
};

/** A chart reading as text: headings, chords over lyrics, and gaps between sections. */
export const ChartLines = ({
  lines,
  testID,
}: {
  lines: readonly ChartLine[];
  testID?: string;
}) => (
  <View style={styles.lines} testID={testID}>
    {positioned(lines).map(({ item, key }) => (
      <Line key={key} line={item} />
    ))}
  </View>
);
