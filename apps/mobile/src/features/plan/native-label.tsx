import { Text } from "@expo/ui/swift-ui";
import {
  font as swiftFont,
  foregroundStyle,
  monospacedDigit,
  lineLimit,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";

import { resolvedTokenColor, useColorVariant } from "../../design/colors";
import type { ColorTokenName } from "../../design/colors.generated";
import { resolveFont } from "../../design/typography";
import type {
  FontName,
  FontWeight,
  TextStyleName,
} from "../../design/typography";

const nativeTextStyle = (
  ramp: ReturnType<typeof resolveFont>["metrics"]["ramp"]
) => {
  if (ramp === "title1") {
    return "title";
  }
  return ramp === "caption1" ? "caption" : ramp;
};
export const NativeLabel = ({
  children,
  font: textFont = "rowTitle",
  color = "ink",
  weight,
  tabular = false,
  lines,
}: {
  children: ReactNode;
  font?: FontName | TextStyleName;
  color?: ColorTokenName;
  weight?: FontWeight;
  tabular?: boolean;
  lines?: number;
}) => {
  const variant = useColorVariant();
  const resolved = resolveFont(textFont, weight);
  return (
    <Text
      modifiers={[
        swiftFont({
          textStyle: nativeTextStyle(resolved.metrics.ramp),
          weight: resolved.weight,
        }),
        foregroundStyle(resolvedTokenColor(color, variant)),
        ...(lines === undefined ? [] : [lineLimit(lines)]),
        ...(tabular ? [monospacedDigit()] : []),
      ]}
    >
      {children}
    </Text>
  );
};
