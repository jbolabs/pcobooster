import {
  Button,
  GlassEffectContainer,
  HStack,
  Host,
  Image,
  Namespace,
  Text,
} from "@expo/ui/swift-ui";
import {
  Animation,
  accessibilityIdentifier,
  accessibilityLabel,
  animation,
  background,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  glassEffectId,
  opacity,
  padding,
} from "@expo/ui/swift-ui/modifiers";
// SwiftUI's own names (`contentShape`, `shapes`), read as members.
import * as SwiftUIModifiers from "@expo/ui/swift-ui/modifiers";
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SFSymbol } from "sf-symbols-typescript";

import { resolvedTokenColor, useColorVariant } from "../design/colors";
import { Spacing } from "../design/metrics";
import { hasLiquidGlass } from "../design/native-glass";

export interface FloatingGlassAction {
  /** Stable and unique within the bar; it drives the glass morph. */
  readonly id: string;
  readonly title: string;
  readonly systemImage: SFSymbol;
  /** Icon only; the title stays the VoiceOver label. */
  readonly showsTitle?: boolean;
  /** Tints the one primary action ink. */
  readonly isProminent?: boolean;
  /** Dimmed and inert, such as while its last tap is still being saved. */
  readonly disabled?: boolean;
  readonly onPress: () => void;
  /** For UI tests. */
  readonly testID?: string;
}

const BUTTON_SIZE = 50;
const DISABLED_OPACITY = 0.5;

const justify = {
  leading: "flex-start",
  center: "center",
  trailing: "flex-end",
} as const;
const MORPH_DURATION = 0.35;
const MORPH_BOUNCE = 0.3;

const styles = StyleSheet.create({
  bar: {
    bottom: 0,
    left: 0,
    paddingHorizontal: Spacing.lg,
    position: "absolute",
    right: 0,
  },
});

interface FloatingGlassBarProps {
  readonly actions: readonly FloatingGlassAction[];
  readonly alignment?: "leading" | "center" | "trailing";
}

/**
 * A floating group of Liquid Glass buttons over content (the run sheet's add bar). Buttons share
 * one `GlassEffectContainer` and each has a `glassEffectID`, so adding or removing buttons morphs
 * the glass instead of popping. Control layer only; never inside a card.
 */
export const FloatingGlassBar = ({
  actions,
  alignment = "center",
}: FloatingGlassBarProps) => {
  const insets = useSafeAreaInsets();
  const variant = useColorVariant();
  const reduceMotion = useReducedMotion();
  const namespace = useId();
  const spacing = Spacing.sm + 2;
  const ink = resolvedTokenColor("ink", variant);
  const onInk = resolvedTokenColor("onInkFill", variant);
  const inkFill = resolvedTokenColor("inkFill", variant);
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.bar,
        {
          alignItems: justify[alignment],
          paddingBottom: insets.bottom + Spacing.sm,
        },
      ]}
    >
      <Host matchContents>
        <Namespace id={namespace}>
          <GlassEffectContainer
            modifiers={
              reduceMotion
                ? []
                : [
                    animation(
                      Animation.spring({
                        bounce: MORPH_BOUNCE,
                        duration: MORPH_DURATION,
                      }),
                      actions.length
                    ),
                  ]
            }
            spacing={spacing / 2}
          >
            <HStack spacing={spacing}>
              {actions.map((action) => {
                const showsTitle = action.showsTitle ?? true;
                const prominent = action.isProminent === true;
                return (
                  <Button
                    key={action.id}
                    modifiers={[
                      buttonStyle("plain"),
                      ...(hasLiquidGlass
                        ? [
                            glassEffect({
                              glass: {
                                interactive: true,
                                tint: prominent ? inkFill : undefined,
                                variant: "regular",
                              },
                            }),
                            glassEffectId(action.id, namespace),
                          ]
                        : [
                            background(
                              prominent
                                ? inkFill
                                : resolvedTokenColor("surfaceRaised", variant),
                              SwiftUIModifiers.shapes.capsule()
                            ),
                          ]),
                      accessibilityLabel(action.title),
                      disabled(action.disabled === true),
                      opacity(action.disabled === true ? DISABLED_OPACITY : 1),
                      ...(action.testID === undefined
                        ? []
                        : [accessibilityIdentifier(action.testID)]),
                    ]}
                    onPress={() => {
                      action.onPress();
                    }}
                  >
                    <HStack
                      modifiers={[
                        padding({
                          horizontal: showsTitle ? Spacing.lg + 2 : 0,
                        }),
                        frame({
                          minHeight: BUTTON_SIZE,
                          minWidth: BUTTON_SIZE,
                        }),
                        SwiftUIModifiers.contentShape(
                          SwiftUIModifiers.shapes.capsule()
                        ),
                      ]}
                      spacing={Spacing.sm}
                    >
                      <Image
                        modifiers={[
                          font({ textStyle: "body", weight: "semibold" }),
                          foregroundStyle(prominent ? onInk : ink),
                        ]}
                        systemName={action.systemImage}
                      />
                      {showsTitle ? (
                        <Text
                          modifiers={[
                            font({ textStyle: "body", weight: "medium" }),
                            foregroundStyle(prominent ? onInk : ink),
                          ]}
                        >
                          {action.title}
                        </Text>
                      ) : null}
                    </HStack>
                  </Button>
                );
              })}
            </HStack>
          </GlassEffectContainer>
        </Namespace>
      </Host>
    </View>
  );
};
