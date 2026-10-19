import { Modal, ScrollView, StyleSheet, View } from "react-native";

import { AppText } from "../design/app-text";
import { colors } from "../design/colors";
import { Spacing } from "../design/metrics";
import { BottomActionBar } from "./bottom-action-bar";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surfaceCanvas,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  scroll: { flex: 1 },
});

export const ConfirmationSheet = ({
  title,
  message,
  action,
  visible,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  action: string;
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) => (
  <Modal
    visible={visible}
    animationType="slide"
    presentationStyle="pageSheet"
    onRequestClose={onCancel}
  >
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        testID="confirmation-content"
      >
        <AppText accessibilityRole="header" font="pageTitle">
          {title}
        </AppText>
        <AppText font="rowDetail" color={colors.inkSecondary}>
          {message}
        </AppText>
      </ScrollView>
      <BottomActionBar
        actions={[
          {
            title: action,
            role: "destructive",
            onPress: onConfirm,
            testID: "confirm-destructive",
          },
          { title: "Cancel", onPress: onCancel, testID: "cancel-destructive" },
        ]}
      />
    </View>
  </Modal>
);
