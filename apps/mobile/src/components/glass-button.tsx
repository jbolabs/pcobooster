import {
  Button,
  HStack,
  Host,
  Image,
  ProgressView,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  resizable,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { SFSymbol } from "sf-symbols-typescript";

import { resolvedTokenColor, useColorVariant } from "../design/colors";
import type { ColorVariant } from "../design/colors";
import { actionButtonStyle } from "../design/glass-capability";
import { Spacing } from "../design/metrics";
import { hasLiquidGlass } from "../design/native-glass";

export interface GlassAction {
  readonly title: string;
  readonly onPress: () => void;
  /**
   * `prominent` (default): ink-tinted glass for the primary action. `secondary`: plain glass.
   * `destructive`: destructive text on plain glass, never a red slab. `cancel`: plain glass.
   */
  readonly role?: "prominent" | "secondary" | "destructive" | "cancel";
  /** An SF Symbol, or an image from the asset catalog, before the title. */
  readonly systemImage?: SFSymbol;
  readonly assetImage?: string;
  /** Replaces the image with a spinner and disables the button. */
  readonly isBusy?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

const ASSET_IMAGE_SIZE = 22;

/** The SwiftUI button role for each action role. */
const buttonRoles = {
  prominent: "default",
  secondary: "default",
  destructive: "destructive",
  cancel: "cancel",
} as const satisfies Record<NonNullable<GlassAction["role"]>, string>;

/**
 * The control-layer button (Swift `GlassActionButtonStyle`), as real SwiftUI Liquid Glass:
 * `.glassProminent` tinted ink for the primary action, `.glass` otherwise.
 */
const GlassActionButton = ({
  action,
  size,
  fills,
  variant,
}: {
  action: GlassAction;
  size: "regular" | "large" | "extraLarge";
  fills: boolean;
  variant: ColorVariant;
}) => {
  const role = action.role ?? "prominent";
  const handlePress = action.onPress;
  const isProminent = role === "prominent";
  const label = (() => {
    if (isProminent) {
      return resolvedTokenColor("onInkFill", variant);
    }
    return resolvedTokenColor(
      role === "destructive" ? "destructive" : "ink",
      variant
    );
  })();
  const image = (() => {
    if (action.isBusy === true) {
      return <ProgressView modifiers={[tint(label)]} />;
    }
    if (action.assetImage !== undefined) {
      return (
        <Image
          assetName={action.assetImage}
          modifiers={[
            resizable(),
            frame({ height: ASSET_IMAGE_SIZE, width: ASSET_IMAGE_SIZE }),
          ]}
        />
      );
    }
    return action.systemImage === undefined ? null : (
      <Image
        modifiers={[foregroundStyle(label)]}
        systemName={action.systemImage}
      />
    );
  })();
  return (
    <Button
      modifiers={[
        // Glass button styles are capsules by default.
        buttonStyle(actionButtonStyle(hasLiquidGlass, isProminent)),
        controlSize(size),
        tint(isProminent ? resolvedTokenColor("inkFill", variant) : label),
        disabledModifier(action.disabled === true || action.isBusy === true),
        // UI tests find the button itself, also inside a stack sharing one host.
        ...(action.testID === undefined
          ? []
          : [accessibilityIdentifier(action.testID)]),
      ]}
      onPress={handlePress}
      role={buttonRoles[role]}
    >
      <HStack
        modifiers={fills ? [frame({ maxWidth: Number.POSITIVE_INFINITY })] : []}
        spacing={Spacing.sm}
      >
        {image}
        <Text
          modifiers={[
            font({ textStyle: "body", weight: "semibold" }),
            foregroundStyle(label),
          ]}
        >
          {action.title}
        </Text>
      </HStack>
    </Button>
  );
};

interface GlassButtonProps {
  readonly action: GlassAction;
  /** Stretch to the available width (sign-in, sheet bottom actions). */
  readonly wide?: boolean;
  readonly size?: "regular" | "large" | "extraLarge";
}

/** One glass button in its own SwiftUI host. */
export const GlassButton = ({
  action,
  wide = false,
  size = "large",
}: GlassButtonProps) => {
  const variant = useColorVariant();
  return (
    <Host
      matchContents={wide ? { vertical: true } : true}
      style={wide ? { alignSelf: "stretch" } : undefined}
      testID={action.testID}
    >
      <GlassActionButton
        action={action}
        fills={wide}
        size={size}
        variant={variant}
      />
    </Host>
  );
};

/** Several full-width glass buttons stacked 10 pt apart, primary first. */
export const GlassButtonStack = ({
  actions,
}: {
  actions: readonly GlassAction[];
}) => {
  const variant = useColorVariant();
  return (
    <Host matchContents={{ vertical: true }} style={{ alignSelf: "stretch" }}>
      <VStack spacing={Spacing.sm + 2}>
        {actions.map((action) => (
          <GlassActionButton
            action={action}
            fills
            key={action.title}
            size="extraLarge"
            variant={variant}
          />
        ))}
      </VStack>
    </Host>
  );
};
