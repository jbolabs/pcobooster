import {
  activeFirst,
  planningCenterArrangementUrl,
} from "@pcobooster/planning-center-models/song-detail";
import type { UseQueryResult } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { NativeStackHeaderItem } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import {
  ActionSheetIOS,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { useFeatures } from "../../app-shell/features";
import { failureMessage, useProductClient } from "../../app-shell/queries";
import { useVisibleQuery } from "../../app-shell/visible-queries";
import { EmptyState } from "../../components/empty-state";
import { Glyph } from "../../components/glyph";
import { Hairline } from "../../components/hairline";
import { InfoBanner } from "../../components/info-banner";
import { PillButton } from "../../components/pill-button";
import { SectionHeader } from "../../components/section-header";
import { Skeleton } from "../../components/skeleton";
import { SurfaceCard } from "../../components/surface-card";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Metrics, Spacing } from "../../design/metrics";
import { useToasts } from "../../lib/toasts";
import {
  attachmentDetail,
  attachmentPreview,
  attachmentSymbol,
  groupAttachments,
} from "./attachments";
import type { SongAttachment, SongAttachments } from "./attachments";
import { songLoadFailure, songLoadFailureCopy } from "./detail";
import type { ChordChartArrangement } from "./detail";
import { attachmentReads, songFileHref } from "./preview-reads";
import { songsReads } from "./reads";
import { useSongPath } from "./use-song-path";

/** Content stays readable on iPad instead of stretching across the screen. */
const READABLE_WIDTH = 680;
const SYMBOL_SIZE = 22;

const styles = StyleSheet.create({
  center: { flexGrow: 1, justifyContent: "center" },
  content: {
    alignSelf: "center",
    gap: Spacing.xl,
    maxWidth: READABLE_WIDTH,
    paddingBottom: Spacing.huge,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    width: "100%",
  },
  loading: { gap: Spacing.md, padding: Spacing.lg },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.md,
    minHeight: Metrics.minimumTapTarget + Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  rowText: { flex: 1, gap: Spacing.xxs },
  scroll: { backgroundColor: colors.surfaceCanvas },
  section: { gap: Spacing.sm },
});

/** Opens a file: links in the browser sheet, everything else in its preview screen. */
const useOpenAttachment = (songId: string, arrangementId: string) => {
  const router = useRouter();
  const songPath = useSongPath();
  const toasts = useToasts();
  return (attachment: SongAttachment) => {
    const preview = attachmentPreview(attachment);
    if (preview.kind !== "link") {
      router.push(songPath(songFileHref(songId, arrangementId, attachment)));
      return;
    }
    void (async () => {
      try {
        await WebBrowser.openBrowserAsync(preview.url);
      } catch {
        toasts.showError("Couldn’t open this link.");
      }
    })();
  };
};

const showAttachmentActions = (
  attachment: SongAttachment,
  open: () => void,
  planningCenterUrl: string
) => {
  const actions = [
    { label: "Open", run: open },
    {
      label: "Open in Planning Center",
      run: () => {
        void Linking.openURL(planningCenterUrl);
      },
    },
  ];
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: attachment.name,
      options: [...actions.map((action) => action.label), "Cancel"],
      cancelButtonIndex: actions.length,
    },
    (index) => {
      actions[index]?.run();
    }
  );
};

const AttachmentRow = ({
  attachment,
  open,
  planningCenterUrl,
}: {
  attachment: SongAttachment;
  open: (attachment: SongAttachment) => void;
  planningCenterUrl: string;
}) => {
  const detail = attachmentDetail(attachment);
  return (
    <Pressable
      accessibilityHint={
        attachment.kind === "link" ? "Opens the link" : "Opens a preview"
      }
      accessibilityLabel={`${attachment.name}, ${detail}`}
      accessibilityRole="button"
      onLongPress={() => {
        showAttachmentActions(
          attachment,
          () => {
            open(attachment);
          },
          planningCenterUrl
        );
      }}
      onPress={() => {
        open(attachment);
      }}
      style={({ pressed }) => [
        styles.row,
        pressed ? { backgroundColor: colors.surfaceHighlight } : null,
      ]}
      testID={`song-file-${attachment.id}`}
    >
      <Glyph
        color={colors.inkSecondary}
        size={SYMBOL_SIZE}
        symbol={attachmentSymbol(attachment)}
      />
      <View style={styles.rowText}>
        <AppText color={colors.ink} font="rowTitle" numberOfLines={2}>
          {attachment.name}
        </AppText>
        <AppText color={colors.inkSecondary} font="meta" numberOfLines={1}>
          {detail}
        </AppText>
      </View>
      <Glyph
        color={colors.inkTertiary}
        size={13}
        symbol={attachment.kind === "link" ? "arrowUpRight" : "chevronRight"}
        weight="semibold"
      />
    </Pressable>
  );
};

const FilesLoading = () => (
  <View accessibilityLabel="Loading files" accessible style={styles.loading}>
    <Skeleton height={16} variant="text" width={200} />
    <Skeleton height={16} variant="text" width={160} />
    <Skeleton height={16} variant="text" width={220} />
  </View>
);

const FilesList = ({
  files,
  arrangement,
  songId,
  arrangementId,
}: {
  files: UseQueryResult<SongAttachments>;
  arrangement: ChordChartArrangement | undefined;
  songId: string;
  arrangementId: string;
}) => {
  const open = useOpenAttachment(songId, arrangementId);
  const planningCenterUrl = planningCenterArrangementUrl(songId, arrangementId);
  if (files.data === undefined) {
    if (files.error === null) {
      return <FilesLoading />;
    }
    const copy = songLoadFailureCopy(songLoadFailure(files.error));
    return (
      <EmptyState
        actions={
          copy.canRetry ? (
            <PillButton
              kind="secondary"
              onPress={() => {
                void files.refetch();
              }}
              testID="song-files-retry"
              title="Try again"
            />
          ) : undefined
        }
        artwork="alert"
        description={copy.canRetry ? failureMessage(files.error) : copy.message}
        title={copy.canRetry ? "Files didn’t load" : copy.title}
      />
    );
  }
  const groups = groupAttachments(
    files.data.attachments,
    arrangement?.keys ?? []
  );
  const notes = (
    <>
      {files.error === null ? null : (
        <InfoBanner
          message={`Files didn’t refresh, so these are the last ones loaded. ${failureMessage(files.error)}`}
          tone="destructive"
        />
      )}
      {files.data.truncated ? (
        <InfoBanner message="Some keys’ files weren’t read. Planning Center shows every file." />
      ) : null}
    </>
  );
  if (groups.length === 0) {
    return (
      <>
        {notes}
        <EmptyState
          actions={
            <PillButton
              kind="secondary"
              onPress={() => {
                void Linking.openURL(planningCenterUrl);
              }}
              symbol="openExternal"
              title="Open in Planning Center"
            />
          }
          artwork="attachment"
          description="This arrangement and its keys have no files in Planning Center."
          title="No files"
        />
      </>
    );
  }
  return (
    <>
      {notes}
      {groups.map((group) => (
        <View key={group.id} style={styles.section}>
          <SectionHeader count={group.attachments.length} title={group.title} />
          <SurfaceCard padding="none">
            {group.attachments.map((attachment, index) => (
              <View key={`${attachment.keyId ?? ""}-${attachment.id}`}>
                {index > 0 ? <Hairline inset={Spacing.lg} /> : null}
                <AttachmentRow
                  attachment={attachment}
                  open={open}
                  planningCenterUrl={planningCenterUrl}
                />
              </View>
            ))}
          </SurfaceCard>
        </View>
      ))}
    </>
  );
};

const arrangementMenu = (
  arrangements: readonly ChordChartArrangement[],
  arrangementId: string,
  select: (id: string) => void
): NativeStackHeaderItem => ({
  type: "menu",
  label: "Arrangement",
  accessibilityLabel: "Choose the arrangement",
  icon: { type: "sfSymbol", name: "music.note.list" },
  menu: {
    items: arrangements.map((option) => ({
      type: "action" as const,
      label: option.archived ? `${option.name} (archived)` : option.name,
      state: option.id === arrangementId ? ("on" as const) : ("off" as const),
      onPress: () => {
        select(option.id);
      },
    })),
  },
});

/**
 * The files attached to an arrangement and its keys, read only: PDFs, images, and documents
 * open in a preview, audio and video play, and links open in the browser. Planning Center's own
 * chart renders are the chart PDF view's. Its reads stop while it is hidden. Behind the
 * `chordCharts` flag.
 */
export const SongFilesScreen = () => {
  const params = useLocalSearchParams<{
    songId: string;
    arrangement?: string;
  }>();
  const { songId } = params;
  const router = useRouter();
  const context = useProductClient();
  const features = useFeatures();
  const chart = useVisibleQuery({
    ...songsReads.chart(context, songId),
    enabled: features.chordCharts,
  });
  const arrangements = activeFirst(chart.data?.arrangements ?? []);
  const arrangementId = params.arrangement ?? arrangements[0]?.id ?? null;
  const arrangement = arrangements.find(
    (option) => option.id === arrangementId
  );
  const files = useVisibleQuery({
    ...attachmentReads.list(context, songId, arrangementId ?? ""),
    enabled: features.chordCharts && arrangementId !== null,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);

  let body = <FilesLoading />;
  if (!(features.isPending || features.chordCharts)) {
    body = (
      <EmptyState
        artwork="attachment"
        description="Song files aren’t turned on for this account."
        title="Files unavailable"
      />
    );
  } else if (arrangementId === null && chart.data !== undefined) {
    body = (
      <EmptyState
        artwork="attachment"
        description="This song has no arrangements in Planning Center yet."
        title="No files"
      />
    );
  } else if (arrangementId === null && chart.error !== null) {
    body = (
      <EmptyState
        artwork="alert"
        description={failureMessage(chart.error)}
        title="Files didn’t load"
      />
    );
  } else if (arrangementId !== null) {
    body = (
      <FilesList
        arrangement={arrangement}
        arrangementId={arrangementId}
        files={files}
        songId={songId}
      />
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title:
            arrangement === undefined ? "Files" : `${arrangement.name} Files`,
          unstable_headerRightItems: () =>
            arrangements.length > 1 && arrangementId !== null
              ? [
                  arrangementMenu(arrangements, arrangementId, (id) => {
                    router.setParams({ arrangement: id });
                  }),
                ]
              : [],
        }}
      />
      <ScrollView
        contentContainerStyle={
          files.data === undefined ? styles.center : styles.content
        }
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          features.chordCharts ? (
            <RefreshControl
              onRefresh={() => {
                setIsRefreshing(true);
                void (async () => {
                  await Promise.all([files.refetch(), chart.refetch()]);
                  setIsRefreshing(false);
                })();
              }}
              refreshing={isRefreshing}
            />
          ) : undefined
        }
        style={styles.scroll}
        testID={`song-files-${songId}`}
      >
        {body}
      </ScrollView>
    </>
  );
};
