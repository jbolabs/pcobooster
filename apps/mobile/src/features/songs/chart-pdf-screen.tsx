import {
  activeFirst,
  planningCenterArrangementUrl,
} from "@pcobooster/planning-center-models/song-detail";
import { keepPreviousData } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { NativeStackHeaderItem } from "expo-router";
import { useRef } from "react";
import type { ReactNode, Ref, RefObject } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { useFeatures } from "../../app-shell/features";
import { failureMessage, useProductClient } from "../../app-shell/queries";
import {
  useReadVisibility,
  useVisibleQuery,
} from "../../app-shell/visible-queries";
import { EmptyState } from "../../components/empty-state";
import { PillButton } from "../../components/pill-button";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { useToasts } from "../../lib/toasts";
import {
  chartTargetId,
  chartTargetLabel,
  chartTargets,
  hasChart,
  resolveChartTarget,
} from "./chart";
import type { ChartTarget } from "./chart";
import { songLoadFailure, songLoadFailureCopy } from "./detail";
import type { ChordChartArrangement } from "./detail";
import { songDisplayTitle } from "./library";
import { hasNativePreview } from "./native-preview";
import type { PdfPreviewHandle } from "./native-preview";
import { printPreviewFile, sharePreviewFile } from "./preview-actions";
import { PDF_FILE_TYPE } from "./preview-file-types";
import { previewFiles } from "./preview-files";
import { PreviewPdfView } from "./preview-pdf-view";
import { previewReads, songFilesHref } from "./preview-reads";
import { PreviewError } from "./previews";
import type { PreviewFile } from "./previews";
import { songsReads } from "./reads";
import { useKeepAwakeWhile, usePreviewRender } from "./use-preview-lifecycle";

const styles = StyleSheet.create({
  center: { flexGrow: 1, justifyContent: "center" },
  fill: { backgroundColor: colors.surfaceMuted, flex: 1 },
  rendering: {
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
    justifyContent: "center",
  },
});

const pdfMenu = ({
  arrangements,
  arrangement,
  targetId,
  songId,
  select,
  openFiles,
}: {
  arrangements: readonly ChordChartArrangement[];
  arrangement: ChordChartArrangement;
  targetId: string;
  songId: string;
  select: (arrangementId: string, target: string | null) => void;
  openFiles: () => void;
}): NativeStackHeaderItem => ({
  type: "menu",
  label: "Chart",
  accessibilityLabel: "Chart to show",
  icon: { type: "sfSymbol", name: "key" },
  menu: {
    items: [
      ...(arrangements.length > 1
        ? [
            {
              type: "submenu" as const,
              label: "Arrangement",
              inline: true,
              items: arrangements.map((option) => ({
                type: "action" as const,
                label: option.archived
                  ? `${option.name} (archived)`
                  : option.name,
                state:
                  option.id === arrangement.id
                    ? ("on" as const)
                    : ("off" as const),
                onPress: () => {
                  select(option.id, null);
                },
              })),
            },
          ]
        : []),
      {
        type: "submenu" as const,
        label: "Show",
        inline: true,
        items: chartTargets(arrangement).map((target) => ({
          type: "action" as const,
          label: chartTargetLabel(target),
          state:
            chartTargetId(target) === targetId
              ? ("on" as const)
              : ("off" as const),
          onPress: () => {
            select(arrangement.id, chartTargetId(target));
          },
        })),
      },
      {
        type: "submenu" as const,
        label: "",
        inline: true,
        items: [
          {
            type: "action" as const,
            label: "Files",
            icon: { type: "sfSymbol" as const, name: "paperclip" as const },
            onPress: openFiles,
          },
          {
            type: "action" as const,
            label: "Open in Planning Center",
            icon: {
              type: "sfSymbol" as const,
              name: "arrow.up.right.square" as const,
            },
            onPress: () => {
              void Linking.openURL(
                planningCenterArrangementUrl(songId, arrangement.id)
              );
            },
          },
        ],
      },
    ],
  },
});

const fileItems = (
  file: PreviewFile,
  share: (file: PreviewFile) => void,
  print: (file: PreviewFile) => void,
  finder: RefObject<PdfPreviewHandle | null>
): NativeStackHeaderItem[] => [
  // Find needs PDFKit; a build without the native module draws in WebKit, without Find.
  ...(hasNativePreview
    ? [
        {
          type: "button" as const,
          label: "Find",
          accessibilityLabel: "Find in the PDF",
          icon: { type: "sfSymbol" as const, name: "magnifyingglass" as const },
          onPress: () => {
            void finder.current?.presentFind();
          },
        },
      ]
    : []),
  {
    type: "button",
    label: "Share",
    accessibilityLabel: "Share the PDF",
    icon: { type: "sfSymbol", name: "square.and.arrow.up" },
    onPress: () => {
      share(file);
    },
  },
  {
    type: "button",
    label: "Print",
    accessibilityLabel: "Print the PDF",
    icon: { type: "sfSymbol", name: "printer" },
    onPress: () => {
      print(file);
    },
  },
];

const Rendering = () => (
  <View
    accessibilityLabel="Rendering in Planning Center"
    accessible
    style={styles.rendering}
  >
    <ActivityIndicator />
    <AppText color={colors.inkSecondary} font="meta">
      Rendering in Planning Center
    </AppText>
  </View>
);

const Centered = ({ children }: { children: ReactNode }) => (
  <ScrollView
    contentContainerStyle={styles.center}
    contentInsetAdjustmentBehavior="automatic"
    style={styles.fill}
  >
    {children}
  </ScrollView>
);

const PdfFailure = ({ error, retry }: { error: Error; retry: () => void }) => {
  if (error instanceof PreviewError) {
    return (
      <EmptyState
        artwork="chordChart"
        description="The PDF from Planning Center could not be drawn."
        title="The chart couldn’t be drawn"
      />
    );
  }
  const copy = songLoadFailureCopy(songLoadFailure(error));
  return (
    <EmptyState
      actions={
        copy.canRetry ? (
          <PillButton
            kind="secondary"
            onPress={retry}
            testID="chart-pdf-retry"
            title="Try again"
          />
        ) : undefined
      }
      artwork="alert"
      description={copy.canRetry ? failureMessage(error) : copy.message}
      title={copy.canRetry ? "The preview didn’t load" : copy.title}
    />
  );
};

/** The saved PDF, drawn again after Try again or once a newer copy is saved. */
const PdfDocument = ({
  pdf,
  file,
  accessibilityLabel,
  finder,
}: {
  pdf: UseQueryResult<PreviewFile>;
  file: PreviewFile;
  accessibilityLabel: string;
  finder: Ref<PdfPreviewHandle>;
}) => {
  const render = usePreviewRender(file.uri, pdf.dataUpdatedAt, async () => {
    await pdf.refetch();
  });
  return (
    <PreviewPdfView
      accessibilityLabel={accessibilityLabel}
      ref={finder}
      render={render}
      testID="chart-pdf"
      uri={file.uri}
    />
  );
};

const PdfBody = ({
  chartsEnabled,
  featuresPending,
  chart,
  arrangement,
  pdf,
  title,
  target,
  finder,
}: {
  chartsEnabled: boolean;
  featuresPending: boolean;
  chart: UseQueryResult;
  arrangement: ChordChartArrangement | undefined;
  pdf: UseQueryResult<PreviewFile>;
  title: string;
  target: ChartTarget | null;
  finder: Ref<PdfPreviewHandle>;
}) => {
  if (featuresPending) {
    return <Rendering />;
  }
  if (!chartsEnabled) {
    return (
      <Centered>
        <EmptyState
          artwork="chordChart"
          description="Chord charts aren’t turned on for this account."
          title="Charts unavailable"
        />
      </Centered>
    );
  }
  if (chart.data === undefined) {
    return chart.error === null ? (
      <Rendering />
    ) : (
      <Centered>
        <PdfFailure
          error={chart.error}
          retry={() => {
            void chart.refetch();
          }}
        />
      </Centered>
    );
  }
  if (arrangement === undefined || target === null || !hasChart(arrangement)) {
    return (
      <Centered>
        <EmptyState
          artwork="chordChart"
          description={
            arrangement === undefined
              ? "This song has no arrangements in Planning Center yet."
              : `${arrangement.name} has no lyrics or chords in Planning Center.`
          }
          title="No chart yet"
        />
      </Centered>
    );
  }
  // A failed refresh of the same chart keeps its last PDF on screen.
  if (pdf.data === undefined) {
    return pdf.error === null ? (
      <Rendering />
    ) : (
      <Centered>
        <PdfFailure
          error={pdf.error}
          retry={() => {
            void pdf.refetch();
          }}
        />
      </Centered>
    );
  }
  return (
    <PdfDocument
      accessibilityLabel={`${title}, ${chartTargetLabel(target)}, chord chart from Planning Center`}
      file={pdf.data}
      finder={finder}
      pdf={pdf}
    />
  );
};

/** The arrangement's chart PDF for `target`, read while its screen is visible. */
const useChartPdf = (
  context: ReturnType<typeof useProductClient>,
  songId: string,
  songTitle: string,
  arrangement: ChordChartArrangement | undefined,
  target: ChartTarget | null,
  chartsEnabled: boolean
): UseQueryResult<PreviewFile> => {
  const input =
    arrangement === undefined || target === null
      ? null
      : {
          songId,
          songTitle,
          arrangementId: arrangement.id,
          updatedAt: arrangement.updatedAt,
          target,
        };
  return useVisibleQuery({
    ...previewReads.chartPdf(
      context,
      previewFiles,
      input ?? {
        songId,
        songTitle: "",
        arrangementId: "",
        updatedAt: null,
        target: { kind: "lyrics" },
      }
    ),
    enabled:
      chartsEnabled &&
      input !== null &&
      arrangement !== undefined &&
      hasChart(arrangement),
    placeholderData: keepPreviousData,
  });
};

/**
 * Planning Center's own PDF of an arrangement's saved chart (Swift `ChordChartPDFViewer`), for
 * reading at a music stand: PDFKit with pinch to zoom and Find, Share, and Print, and the screen
 * stays awake while it is on screen (not from another tab, in the background, or with the flag
 * off). The menu switches arrangement and between its keys and its lyrics sheet; while the next
 * PDF renders the last one stays up. Its reads stop while it is hidden. Behind the
 * `chordCharts` flag.
 */
export const ChartPdfScreen = () => {
  const visible = useReadVisibility();
  const finder = useRef<PdfPreviewHandle>(null);
  const params = useLocalSearchParams<{
    songId: string;
    arrangement?: string;
    target?: string;
  }>();
  const { songId } = params;
  const router = useRouter();
  const toasts = useToasts();
  const context = useProductClient();
  const features = useFeatures();
  useKeepAwakeWhile(visible && features.chordCharts);
  const chart = useVisibleQuery({
    ...songsReads.chart(context, songId),
    enabled: features.chordCharts,
  });
  const arrangements = activeFirst(chart.data?.arrangements ?? []);
  const arrangement =
    arrangements.find((option) => option.id === params.arrangement) ??
    arrangements[0];
  const target =
    arrangement === undefined
      ? null
      : resolveChartTarget(arrangement, params.target);
  const title = songDisplayTitle(chart.data?.song.title ?? "");
  const pdf = useChartPdf(
    context,
    songId,
    chart.data?.song.title ?? "",
    arrangement,
    target,
    features.chordCharts
  );

  const select = (arrangementId: string, nextTarget: string | null) => {
    router.setParams({
      arrangement: arrangementId,
      target: nextTarget ?? undefined,
    });
  };
  const share = (file: PreviewFile) => {
    void (async () => {
      try {
        if (!(await sharePreviewFile(file, PDF_FILE_TYPE))) {
          toasts.showError("Sharing isn’t available on this device.");
        }
      } catch {
        toasts.showError("Couldn’t share this chart.");
      }
    })();
  };
  const print = (file: PreviewFile) => {
    void (async () => {
      try {
        await printPreviewFile(file);
      } catch {
        toasts.showError("Couldn’t print this chart.");
      }
    })();
  };
  const shownFile =
    pdf.data !== undefined && !pdf.isPlaceholderData ? pdf.data : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: chart.data === undefined ? "Chord Chart" : title,
          unstable_headerRightItems: () => [
            ...(shownFile === null
              ? []
              : fileItems(shownFile, share, print, finder)),
            ...(arrangement === undefined || target === null
              ? []
              : [
                  pdfMenu({
                    arrangements,
                    arrangement,
                    targetId: chartTargetId(target),
                    songId,
                    select,
                    openFiles: () => {
                      router.push(songFilesHref(songId, arrangement.id));
                    },
                  }),
                ]),
          ],
        }}
      />
      <View style={styles.fill} testID={`chart-pdf-${songId}`}>
        {pdf.isPlaceholderData && pdf.isFetching ? (
          <View
            accessibilityLabel="Rendering in Planning Center"
            accessible
            style={{ alignItems: "center", padding: Spacing.sm }}
          >
            <ActivityIndicator />
          </View>
        ) : null}
        <PdfBody
          arrangement={arrangement}
          chart={chart}
          chartsEnabled={features.chordCharts}
          featuresPending={features.isPending}
          finder={finder}
          pdf={pdf}
          target={target}
          title={title}
        />
      </View>
    </>
  );
};
