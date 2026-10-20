import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import { useProductClient } from "../../../app-shell/queries";
import {
  useReadVisibility,
  useVisibleQuery,
} from "../../../app-shell/visible-queries";
import { EmptyState } from "../../../components/empty-state";
import { Glyph } from "../../../components/glyph";
import { PillButton } from "../../../components/pill-button";
import { AppText } from "../../../design/app-text";
import { colors } from "../../../design/colors";
import { ReadStatus } from "../read-status";
import { planReads } from "../reads";
import type { PlanIds } from "../reads";
import { groupPlanFiles, planFileKind } from "./model";
import { PlanFilePreview } from "./preview";
import { planFilesRead } from "./reads";

export const PlanFiles = ({ ids }: { ids: PlanIds }) => {
  const context = useProductClient();
  const visible = useReadVisibility();
  const query = useInfiniteQuery({
    ...planFilesRead(context, ids),
    enabled: visible,
    subscribed: visible,
  });
  const items = useVisibleQuery(planReads.items(context, ids));
  const [selected, setSelected] = useState<PlanFile | null>(null);
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (visible && hasNextPage && !isFetchingNextPage && !isError) {
      void fetchNextPage();
    }
  }, [visible, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  const files = query.data?.pages.flatMap((page) => page.files) ?? [];
  const groups = groupPlanFiles(files, items.data ?? []);
  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surfaceCanvas }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={() => {
              void query.refetch();
            }}
          />
        }
        testID="plan-files"
      >
        {query.data === undefined ? (
          <ReadStatus
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : null}
        {items.isError ? (
          <ReadStatus
            error={items.error}
            retry={() => {
              void items.refetch();
            }}
          />
        ) : null}
        {groups.map((group) => (
          <View key={group.id}>
            <AppText
              font="sectionLabel"
              color={colors.inkSecondary}
              style={{ marginBottom: 8 }}
            >
              {group.title}
            </AppText>
            {group.files.map((file) => (
              <Pressable
                key={file.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${file.name}`}
                testID={`plan-file-${file.id}`}
                onPress={() => {
                  setSelected(file);
                }}
                style={({ pressed }) => ({
                  minHeight: 56,
                  paddingVertical: 12,
                  paddingHorizontal: 4,
                  gap: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  borderBottomWidth: 0.5,
                  borderBottomColor: colors.hairline,
                  backgroundColor: pressed
                    ? colors.surfaceHighlight
                    : undefined,
                })}
              >
                <Glyph
                  symbol={planFileKind(file) === "audio" ? "audio" : "document"}
                  size={22}
                  color={colors.inkSecondary}
                />
                <View style={{ flex: 1, gap: 3 }}>
                  <AppText font="rowTitle" numberOfLines={2}>
                    {file.name}
                  </AppText>
                  <AppText font="meta" color={colors.inkSecondary}>
                    {file.filename || file.fileType || "File"}
                  </AppText>
                </View>
                <Glyph
                  symbol="chevronRight"
                  size={12}
                  color={colors.inkTertiary}
                />
              </Pressable>
            ))}
          </View>
        ))}
        {query.isSuccess && !hasNextPage && files.length === 0 ? (
          <EmptyState
            artwork="plan"
            title="No files yet"
            description="Files attached to this plan, its items, and its songs appear here."
          />
        ) : null}
        {query.data !== undefined && query.isError ? (
          <View style={{ gap: 8 }}>
            <AppText font="rowDetail" color={colors.inkSecondary}>
              Some files could not load. The list may be incomplete.
            </AppText>
            <PillButton
              title="Retry"
              kind="secondary"
              onPress={() => {
                void (hasNextPage ? query.fetchNextPage() : query.refetch());
              }}
            />
          </View>
        ) : null}
        {isFetchingNextPage ? (
          <AppText font="meta" color={colors.inkSecondary}>
            Loading more files…
          </AppText>
        ) : null}
      </ScrollView>
      {selected === null ? null : (
        <PlanFilePreview
          ids={ids}
          file={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
    </>
  );
};
