import { FEEDBACK_MESSAGE_MAX_LENGTH } from "@pcobooster/contracts/feedback";
import { usePathname, useRouter } from "expo-router";
import { useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import {
  failureMessage,
  sharedReads,
  useProductClient,
} from "../../app-shell/queries";
import { useVisibleQuery as useQuery } from "../../app-shell/visible-queries";
import { BottomActionBar } from "../../components/bottom-action-bar";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { useToasts } from "../../lib/toasts";
import { accessReview } from "./access-review";
import { AccountSection } from "./account-rows";
import { useFeedbackDraft } from "./feedback-draft";

const availabilityLabels = {
  full: "Available",
  limited: "Limited",
  none: "Unavailable",
} as const;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceCanvas },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  editor: {
    minHeight: 200,
    backgroundColor: colors.surfaceCard,
    color: colors.ink,
    padding: Spacing.md,
    borderRadius: 12,
    fontSize: 17,
  },
  fact: { padding: Spacing.lg, gap: Spacing.sm },
  keyboardAccessory: {
    alignItems: "flex-end",
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.hairline,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dismissKeyboard: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
});

export const AccountAccess = () => {
  const context = useProductClient();
  const access = useQuery(sharedReads.access(context));
  const features = useQuery(sharedReads.features(context));
  const review = accessReview(access.data, access.isError, features.data);
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <AppText font="rowDetail" color={colors.inkSecondary}>
        Your Planning Center permissions determine what you can do here.
      </AppText>
      {review.status === "loading" ? (
        <AppText font="rowTitle">Checking your access...</AppText>
      ) : null}
      {access.error === null ? null : (
        <AppText font="rowDetail">{failureMessage(access.error)}</AppText>
      )}
      {review.features.map((feature) => (
        <AccountSection key={feature.feature} title={feature.label}>
          <View style={styles.fact}>
            <AppText font="rowTitle">
              {availabilityLabels[feature.availability]}
            </AppText>
            {feature.detail === "" ? null : (
              <AppText font="rowDetail">{feature.detail}</AppText>
            )}
            {feature.ask === null ? null : (
              <AppText font="rowDetail" color={colors.inkSecondary}>
                {feature.ask}
              </AppText>
            )}
          </View>
        </AccountSection>
      ))}
    </ScrollView>
  );
};

export const AccountFeedback = () => {
  const { client } = useProductClient();
  const draft = useFeedbackDraft();
  const router = useRouter();
  const path = usePathname();
  const toasts = useToasts();
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const message = draft.text.trim();
  const canSend =
    message !== "" &&
    draft.text.length <= FEEDBACK_MESSAGE_MAX_LENGTH &&
    !sending;
  const send = async () => {
    if (!canSend) {
      return;
    }
    setSending(true);
    try {
      const input = { message, path, sessionId: null };
      await client.run((api) => api.feedback.submit({ payload: input }));
      draft.setText("");
      draft.setSentAt(Date.now());
      router.back();
    } catch (error) {
      toasts.showError(
        error instanceof Error
          ? failureMessage(error)
          : "Couldn't send feedback. Try again."
      );
    }
    setSending(false);
  };
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <AppText font="rowDetail" color={colors.inkSecondary}>
          Found a bug or something confusing? Tell us what happened.
        </AppText>
        <TextInput
          accessibilityLabel="What happened?"
          testID="feedback-editor"
          multiline
          onFocus={() => {
            setEditing(true);
          }}
          onBlur={() => {
            setEditing(false);
          }}
          value={draft.text}
          onChangeText={(text) => {
            draft.setText(text);
          }}
          placeholder="What happened?"
          placeholderTextColor={colors.inkTertiary}
          style={styles.editor}
        />
        <AppText font="meta" color={colors.inkSecondary}>
          We&apos;ll see the screen you were on, not your data.{" "}
          {draft.text.length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
        </AppText>
      </ScrollView>
      {editing ? (
        <View style={styles.keyboardAccessory}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
            onPress={() => {
              Keyboard.dismiss();
            }}
            style={styles.dismissKeyboard}
            testID="feedback-dismiss-keyboard"
          >
            <AppText font="rowTitleEmphasized">Done</AppText>
          </Pressable>
        </View>
      ) : null}
      <BottomActionBar
        actions={[
          {
            title: "Send",
            disabled: !canSend,
            isBusy: sending,
            onPress: () => {
              void send();
            },
            testID: "feedback-send-button",
          },
        ]}
      />
    </KeyboardAvoidingView>
  );
};
