import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import * as WebBrowser from "expo-web-browser";
import { Modal, View } from "react-native";

import { useProductClient } from "../../../app-shell/queries";
import {
  useReadVisibility,
  useVisibleQuery,
} from "../../../app-shell/visible-queries";
import { PillButton } from "../../../components/pill-button";
import { AppText } from "../../../design/app-text";
import { colors } from "../../../design/colors";
import { useToasts } from "../../../lib/toasts";
import { PreviewDocumentView } from "../../songs/preview-document-view";
import { previewFiles } from "../../songs/preview-files";
import { PreviewMediaPlayer } from "../../songs/preview-media-player";
import { PreviewPdfView } from "../../songs/preview-pdf-view";
import { usePreviewRender } from "../../songs/use-preview-lifecycle";
import { ReadStatus } from "../read-status";
import type { PlanIds } from "../reads";
import { planFileKind } from "./model";
import { planFileRead } from "./reads";

/** Opening and closing a preview owns the signed link's lifetime. */
export const PlanFilePreview = ({
  ids,
  file,
  onClose,
}: {
  ids: PlanIds;
  file: PlanFile;
  onClose: () => void;
}) => {
  const context = useProductClient();
  const visible = useReadVisibility();
  const query = useVisibleQuery(planFileRead(context, previewFiles, ids, file));
  const toasts = useToasts();
  const kind = planFileKind(file);
  const render = usePreviewRender(
    query.data?.uri ?? "",
    query.dataUpdatedAt,
    async () => {
      await query.refetch({ throwOnError: true });
    }
  );
  const content = () => {
    if (query.data === undefined) {
      return (
        <View style={{ padding: 20 }}>
          <ReadStatus
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        </View>
      );
    }
    const { uri } = query.data;
    if (kind === "pdf") {
      return (
        <PreviewPdfView
          uri={uri}
          render={render}
          accessibilityLabel={file.name}
          testID="plan-file-pdf"
        />
      );
    }
    if (kind === "document") {
      return (
        <PreviewDocumentView
          uri={uri}
          render={render}
          accessibilityLabel={file.name}
        />
      );
    }
    if (kind === "audio" || kind === "video") {
      return (
        <PreviewMediaPlayer
          url={uri}
          title={file.name}
          video={kind === "video"}
          visible={visible}
          retry={() => {
            void query.refetch();
          }}
        />
      );
    }
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <AppText font="rowDetail" color={colors.inkSecondary}>
          This file opens in the browser.
        </AppText>
        <PillButton
          title="Open file"
          onPress={() => {
            void (async () => {
              try {
                await WebBrowser.openBrowserAsync(uri);
              } catch {
                toasts.showError("Couldn't open the file.");
              }
            })();
          }}
        />
      </View>
    );
  };
  return (
    <Modal
      visible
      presentationStyle="pageSheet"
      animationType="slide"
      allowSwipeDismissal
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.surfaceCanvas }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            padding: 16,
            gap: 12,
          }}
        >
          <AppText font="cardTitle" numberOfLines={2} style={{ flex: 1 }}>
            {file.name}
          </AppText>
          <PillButton
            title="Close"
            kind="secondary"
            size="small"
            onPress={onClose}
          />
        </View>
        {content()}
      </View>
    </Modal>
  );
};
