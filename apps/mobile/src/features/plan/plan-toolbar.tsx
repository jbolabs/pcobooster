import type { NativeStackNavigationOptions } from "expo-router";
import { Stack } from "expo-router";
import { PlatformColor, Pressable, StyleSheet, View } from "react-native";

import { Glyph } from "../../components/glyph";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import type { PlanSegment } from "./reads";

const secondary = PlatformColor("secondaryLabel");
const styles = StyleSheet.create({
  title: { justifyContent: "center", maxWidth: 240 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  chevron: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PlatformColor("secondarySystemFill"),
    borderRadius: 8.5,
    height: 17,
    width: 17,
  },
});
const PlanTitle = ({
  title,
  subtitle,
  onMenu,
}: {
  title: string;
  subtitle: string;
  onMenu: () => void;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${title}, ${subtitle}`}
    accessibilityHint="Switch plans"
    onPress={onMenu}
    style={styles.title}
  >
    <View style={styles.titleRow}>
      <AppText font="subheadline" weight="semibold" numberOfLines={1}>
        {title}
      </AppText>
      <View style={styles.chevron}>
        <Glyph symbol="chevronDown" size={9} color={secondary} weight="bold" />
      </View>
    </View>
    <AppText
      font="caption"
      color={secondary}
      numberOfLines={1}
      style={{ marginTop: -1 }}
    >
      {subtitle}
    </AppText>
  </Pressable>
);

const toolbarOptions = ({
  header,
  segment,
  onTitleMenu,
  onCollapse,
  onExpand,
  onOpenPlanningCenter,
  rightItems,
}: {
  header: { title: string; subtitle: string };
  segment: PlanSegment;
  onTitleMenu: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onOpenPlanningCenter?: () => void;
  rightItems?: NativeStackNavigationOptions["unstable_headerRightItems"];
}): NativeStackNavigationOptions => ({
  title: "",
  headerStyle: { backgroundColor: colors.surfaceCanvas },
  headerBackVisible: true,
  unstable_headerLeftItems: () => [
    {
      type: "custom",
      hidesSharedBackground: true,
      element: <PlanTitle {...header} onMenu={onTitleMenu} />,
    },
  ],
  unstable_headerRightItems:
    rightItems ??
    (() =>
      segment !== "Lineup" && onOpenPlanningCenter === undefined
        ? []
        : [
            {
              type: "menu",
              label: "More",
              accessibilityLabel: "Plan options",
              icon: { type: "sfSymbol", name: "ellipsis" },
              menu: {
                items: [
                  ...(segment === "Lineup"
                    ? [
                        {
                          type: "action" as const,
                          label: "Collapse all teams",
                          onPress: onCollapse,
                        },
                        {
                          type: "action" as const,
                          label: "Expand all teams",
                          onPress: onExpand,
                        },
                      ]
                    : []),
                  ...(onOpenPlanningCenter === undefined
                    ? []
                    : [
                        {
                          type: "action" as const,
                          label: "Open in Planning Center",
                          onPress: onOpenPlanningCenter,
                        },
                      ]),
                ],
              },
            },
          ]),
});

export const PlanToolbar = (props: Parameters<typeof toolbarOptions>[0]) => (
  <Stack.Screen options={toolbarOptions(props)} />
);
