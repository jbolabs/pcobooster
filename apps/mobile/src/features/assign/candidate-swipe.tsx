import type { ReactNode } from "react";
import { useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ColorValue } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Glyph } from "../../components/glyph";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { playHaptic } from "../../design/haptics";
import { scheduleStatusSymbol } from "../../design/status";
import type { ScheduleStatus } from "../../design/status";
import type { AppSymbolName } from "../../design/symbols";

const ACTION_WIDTH = 88;
/** How far, in its own widths (about 40% of the row), a lone leading action is dragged to run. */
const FULL_SWIPE_PROGRESS = 1.6;
/** iOS draws swipe action titles and symbols white on their tint, in both appearances. */
const ACTION_LABEL = "#FFFFFF";
const styles = StyleSheet.create({
  actions: { flexDirection: "row" },
  action: {
    width: ACTION_WIDTH,
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  /** Fills the gap a full swipe opens beyond the lone leading action. */
  backdrop: { position: "absolute", top: 0, bottom: 0, right: 0, width: 1000 },
});

interface SwipeAction {
  key: string;
  title: string;
  symbol: AppSymbolName;
  tint: ColorValue;
  onPress: () => void;
}

const ActionButton = ({
  id,
  action,
  close,
}: {
  id: string;
  action: SwipeAction;
  close: () => void;
}) => (
  <Pressable
    testID={`assign-swipe-${action.key}-${id}`}
    accessibilityRole="button"
    accessibilityLabel={`${action.title} with swipe`}
    onPress={() => {
      close();
      action.onPress();
    }}
    style={[styles.action, { backgroundColor: action.tint }]}
  >
    <Glyph symbol={action.symbol} size={20} color={ACTION_LABEL} />
    <AppText font="footnote" weight="semibold" color={ACTION_LABEL}>
      {action.title}
    </AppText>
  </Pressable>
);

/** Gesture Handler 3 keeps both action containers mounted; closed actions must stay invisible. */
const ActionContainer = ({
  progress,
  children,
}: {
  progress: SharedValue<number>;
  children: ReactNode;
}) => {
  const visibility = useAnimatedStyle(() => ({
    opacity: progress.value === 0 ? 0 : 1,
  }));
  return (
    <Animated.View style={[styles.actions, visibility]}>
      {children}
    </Animated.View>
  );
};

/** The lone leading Add, which runs on a full swipe as Swift's `allowsFullSwipe` does. */
const FullSwipeAction = ({
  id,
  action,
  progress,
  onArm,
  close,
}: {
  id: string;
  action: SwipeAction;
  progress: SharedValue<number>;
  /** Whether releasing now runs the action. */
  onArm: (armed: boolean) => void;
  close: () => void;
}) => {
  useAnimatedReaction(
    () => progress.value >= FULL_SWIPE_PROGRESS,
    (now, before) => {
      if (now !== before) {
        scheduleOnRN(onArm, now);
      }
    }
  );
  return (
    <ActionContainer progress={progress}>
      <View style={[styles.backdrop, { backgroundColor: action.tint }]} />
      <ActionButton id={id} action={action} close={close} />
    </ActionContainer>
  );
};

/**
 * Swift's swipe actions on a candidate: leading Add (full swipe adds), or Confirm and Pending
 * once they're on the slot; trailing Unschedule and Decline.
 */
export const CandidateSwipe = ({
  children,
  id,
  canSchedule,
  canAdd,
  status,
  onAdd,
  onStatus,
  onRemove,
}: {
  children: ReactNode;
  id: string;
  canSchedule: boolean;
  canAdd: boolean;
  status?: ScheduleStatus;
  onAdd: () => void;
  onStatus: (status: ScheduleStatus) => void;
  onRemove: () => void;
}) => {
  const swipe = useRef<SwipeableMethods>(null);
  const armed = useRef(false);
  const close = () => {
    swipe.current?.close();
  };
  const statusAction = (
    next: ScheduleStatus,
    title: string,
    tint: ColorValue
  ): SwipeAction => ({
    key: next === "confirmed" ? "confirm" : next,
    title,
    symbol: scheduleStatusSymbol[next],
    tint,
    onPress: () => {
      onStatus(next);
    },
  });
  const add: SwipeAction = {
    key: "add",
    title: "Add",
    symbol: "addToSchedule",
    tint: colors.statusConfirmed,
    onPress: onAdd,
  };
  const leading =
    status === undefined
      ? []
      : [
          ...(status === "confirmed"
            ? []
            : [statusAction("confirmed", "Confirm", colors.statusConfirmed)]),
          ...(status === "pending"
            ? []
            : [statusAction("pending", "Pending", colors.statusPending)]),
        ];
  const trailing: SwipeAction[] =
    status === undefined
      ? []
      : [
          {
            key: "unschedule",
            title: "Unschedule",
            symbol: "delete",
            tint: colors.destructive,
            onPress: onRemove,
          },
          ...(status === "declined"
            ? []
            : [statusAction("declined", "Decline", colors.statusDeclined)]),
        ];
  const addsOnFullSwipe = status === undefined && canAdd;
  return (
    <ReanimatedSwipeable
      ref={swipe}
      enabled={canSchedule}
      overshootLeft={addsOnFullSwipe}
      overshootRight={false}
      onSwipeableWillOpen={() => {
        if (armed.current) {
          armed.current = false;
          close();
          onAdd();
        }
      }}
      onSwipeableClose={() => {
        armed.current = false;
      }}
      renderLeftActions={(progress) => {
        if (addsOnFullSwipe) {
          return (
            <FullSwipeAction
              id={id}
              action={add}
              progress={progress}
              onArm={(value) => {
                if (value && !armed.current) {
                  playHaptic("selection");
                }
                armed.current = value;
              }}
              close={close}
            />
          );
        }
        return leading.length === 0 ? null : (
          <ActionContainer progress={progress}>
            {leading.map((action) => (
              <ActionButton
                key={action.key}
                id={id}
                action={action}
                close={close}
              />
            ))}
          </ActionContainer>
        );
      }}
      renderRightActions={(progress) =>
        trailing.length === 0 ? null : (
          <ActionContainer progress={progress}>
            {trailing.map((action) => (
              <ActionButton
                key={action.key}
                id={id}
                action={action}
                close={close}
              />
            ))}
          </ActionContainer>
        )
      }
    >
      {children}
    </ReanimatedSwipeable>
  );
};
