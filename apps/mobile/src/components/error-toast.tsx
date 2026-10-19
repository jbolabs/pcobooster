import { GlassView } from "expo-glass-effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  Keyframe,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../design/app-text";
import { colors } from "../design/colors";
import { playHaptic } from "../design/haptics";
import { Radius, Spacing } from "../design/metrics";
import { snappy } from "../design/motion";
import { Curves } from "../design/motion-tokens";
import { hasLiquidGlass } from "../design/native-glass";
import { fontSize } from "../design/typography";
import { ToastContext, toastDuration } from "../lib/toasts";
import type { ErrorToastValue, ToastCenter } from "../lib/toasts";
import { GlassButton } from "./glass-button";
import { Glyph } from "./glyph";

/** An upward drag past this many points dismisses the toast. */
const SWIPE_DISMISS_DISTANCE = -24;
/** A drag shorter than this stays a tap. */
const DRAG_START_DISTANCE = 8;
const MAX_TOAST_WIDTH = 520;
const ENTER_DURATION = 320;
const ENTER_RISE = -24;
const ENTER_SCALE = 0.96;

const styles = StyleSheet.create({
  overlay: {
    left: 0,
    paddingHorizontal: Spacing.lg,
    position: "absolute",
    right: 0,
    top: 0,
  },
  text: { flex: 1, gap: Spacing.xxs },
  solidToast: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toast: {
    alignItems: "flex-start",
    alignSelf: "center",
    borderCurve: "continuous",
    borderRadius: Radius.card,
    flexDirection: "row",
    gap: Spacing.md,
    maxWidth: MAX_TOAST_WIDTH,
    overflow: "hidden",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    width: "100%",
  },
});

const entering = new Keyframe({
  0: {
    opacity: 0,
    transform: [{ translateY: ENTER_RISE }, { scale: ENTER_SCALE }],
  },
  100: {
    easing: Curves.snappy,
    opacity: 1,
    transform: [{ translateY: 0 }, { scale: 1 }],
  },
}).duration(ENTER_DURATION);

const exiting = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
  100: {
    easing: Curves.snappy,
    opacity: 0,
    transform: [{ translateY: ENTER_RISE }, { scale: ENTER_SCALE }],
  },
}).duration(ENTER_DURATION);

/**
 * The toast: a glass card (it floats over content, so it is control layer). Dragging up follows
 * the finger and dismisses past 24 pt; a shorter drag springs back. React Native's responder
 * system is enough for one vertical drag, so the toast needs no gesture handler root.
 */
const ErrorToastView = ({
  toast,
  onDismiss,
}: {
  toast: ErrorToastValue;
  onDismiss: () => void;
}) => {
  const reduceMotion = useReducedMotion();
  const drag = useSharedValue(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > DRAG_START_DISTANCE,
        onPanResponderMove: (_event, gesture) => {
          drag.set(Math.min(gesture.dy, 0));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy < SWIPE_DISMISS_DISTANCE) {
            onDismiss();
          } else {
            drag.set(withTiming(0, snappy()));
          }
        },
        onPanResponderTerminate: () => {
          drag.set(withTiming(0, snappy()));
        },
      }),
    [drag, onDismiss]
  );
  const dragged = useAnimatedStyle(() => ({
    transform: [{ translateY: drag.get() }],
  }));
  return (
    <Animated.View
      entering={reduceMotion ? FadeIn : entering}
      exiting={reduceMotion ? FadeOut : exiting}
      style={dragged}
      {...responder.panHandlers}
    >
      <Pressable
        accessibilityActions={[{ label: "Dismiss", name: "dismiss" }]}
        accessibilityRole="alert"
        onAccessibilityAction={onDismiss}
        onPress={onDismiss}
      >
        <GlassView
          glassEffectStyle="regular"
          style={[styles.toast, hasLiquidGlass ? undefined : styles.solidToast]}
        >
          <Glyph
            color={colors.destructive}
            size={fontSize("body")}
            symbol="errorFill"
            weight="semibold"
          />
          <View style={styles.text}>
            <AppText font="rowTitleEmphasized">{toast.message}</AppText>
            {toast.detail === undefined ? null : (
              <AppText color={colors.inkSecondary} font="rowDetail">
                {toast.detail}
              </AppText>
            )}
          </View>
          {toast.action === undefined ? null : (
            <GlassButton
              action={{
                onPress: () => {
                  toast.action?.perform();
                  onDismiss();
                },
                role: "secondary",
                title: toast.action.title,
              }}
              size="regular"
            />
          )}
        </GlassView>
      </Pressable>
    </Animated.View>
  );
};

/**
 * Provides `useToasts()` and draws error toasts at the top, below the status bar. A new error
 * replaces the visible one; the same message again restarts the timer. Toasts dismiss after a
 * reading-length delay, on tap, or on an upward swipe; VoiceOver announces each one and an error
 * haptic plays.
 */
export const ErrorToastProvider = ({ children }: { children: ReactNode }) => {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ErrorToastValue | null>(null);
  const visible = useRef<ErrorToastValue | null>(null);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback((toast: ErrorToastValue | null) => {
    visible.current = toast;
    setCurrent(toast);
  }, []);

  const dismiss = useCallback(() => {
    cancelTimer();
    show(null);
  }, [cancelTimer, show]);

  const showError = useCallback<ToastCenter["showError"]>(
    (message, options = {}) => {
      cancelTimer();
      const isRepeat =
        visible.current?.message === message &&
        visible.current.detail === options.detail;
      if (!isRepeat) {
        nextId.current += 1;
        show({
          action: options.action,
          detail: options.detail,
          id: nextId.current,
          message,
        });
        AccessibilityInfo.announceForAccessibility(
          [message, options.detail].filter(Boolean).join(". ")
        );
        playHaptic("error");
      }
      timer.current = setTimeout(
        () => {
          show(null);
        },
        toastDuration(message, options.detail)
      );
    },
    [cancelTimer, show]
  );

  useEffect(() => cancelTimer, [cancelTimer]);

  const center = useMemo<ToastCenter>(
    () => ({ dismiss, showError }),
    [dismiss, showError]
  );
  return (
    <ToastContext value={center}>
      {children}
      <View
        pointerEvents="box-none"
        style={[styles.overlay, { paddingTop: insets.top + Spacing.xs }]}
      >
        {current === null ? null : (
          <ErrorToastView
            key={current.id}
            onDismiss={dismiss}
            toast={current}
          />
        )}
      </View>
    </ToastContext>
  );
};
