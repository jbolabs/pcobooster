import {
  songHistoryCountLabel,
  songHistoryNote,
  summarizeSongHistory,
} from "@pcobooster/planning-center-models/song-library";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { useProductClient } from "../../../app-shell/queries";
import { useVisibleQuery as useQuery } from "../../../app-shell/visible-queries";
import { AppText } from "../../../design/app-text";
import { colors } from "../../../design/colors";
import { useClock, useOrgTimeZone } from "../../../lib/environment";
import { displayKey } from "../../../lib/song-keys";
import { EditorSection } from "../editor-sheet";
import { ReadStatus } from "../read-status";
import { planReads } from "../reads";
import type { PlanIds } from "../reads";
import { songReads } from "./reads";
import { historyDateLabel } from "./song-facts";

/** The plan's service date, which song history and "later" are counted from. */
export const usePlanDate = (ids: PlanIds): Date => {
  const context = useProductClient();
  const clock = useClock();
  const plan = useQuery(planReads.plan(context, ids));
  return plan.data?.sortDate ?? clock.now();
};

/**
 * Every service that scheduled the song over the past year, newest first, with the key each
 * sang it in, counted from the plan's date: how often before it, and how often here. Facts only.
 */
export const SongHistory = ({
  songId,
  ids,
  planDate,
  previewRows,
}: {
  songId: string;
  ids: PlanIds;
  /** The plan's service date, which "before" and "later" are counted from. */
  planDate: Date;
  /** Rows shown before "Show All". */
  previewRows: number;
}) => {
  const context = useProductClient();
  const zone = useOrgTimeZone();
  const history = useQuery(songReads.schedule(context, songId));
  const serviceTypes = useQuery(planReads.serviceTypes(context));
  const [showsAll, setShowsAll] = useState(false);
  if (history.data === undefined) {
    return (
      <EditorSection title="History">
        <ReadStatus
          error={history.error}
          retry={() => {
            void history.refetch();
          }}
        />
      </EditorSection>
    );
  }
  const { entries, truncated } = history.data;
  const summary = summarizeSongHistory(entries, planDate, ids.serviceTypeId);
  const serviceTypeName =
    serviceTypes.data?.find((type) => type.id === ids.serviceTypeId)?.name ??
    null;
  const rows = showsAll ? entries : entries.slice(0, previewRows);
  return (
    <EditorSection title="History">
      <AppText font="meta" color={colors.inkSecondary} tabular>
        {songHistoryCountLabel(summary, serviceTypeName, truncated)}
      </AppText>
      {rows.length === 0 ? (
        <AppText font="rowDetail" color={colors.inkSecondary}>
          Not scheduled in the past year.
        </AppText>
      ) : (
        rows.map((entry) => {
          const note = songHistoryNote(entry, ids.planId, planDate);
          return (
            <View
              key={`${entry.serviceTypeId ?? ""}:${entry.planId ?? ""}:${entry.sortDate.toISOString()}`}
              accessible
              testID={`song-history-row-${entry.planId ?? ""}`}
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                gap: 12,
                minHeight: 30,
              }}
            >
              <AppText
                font="meta"
                color={colors.inkSecondary}
                tabular
                style={{ minWidth: 64 }}
              >
                {historyDateLabel(entry.sortDate, planDate, zone)}
              </AppText>
              <AppText font="rowDetail" numberOfLines={1} style={{ flex: 1 }}>
                {entry.serviceTypeName === ""
                  ? "Unknown service"
                  : entry.serviceTypeName}
                {note === null ? null : (
                  <AppText font="meta" color={colors.inkSecondary}>
                    {` ${note}`}
                  </AppText>
                )}
              </AppText>
              {entry.startingKey === null ? null : (
                <AppText font="meta" color={colors.inkSecondary}>
                  {displayKey(entry.startingKey)}
                </AppText>
              )}
            </View>
          );
        })
      )}
      {entries.length > previewRows ? (
        <Pressable
          accessibilityRole="button"
          testID="song-history-toggle"
          onPress={() => {
            setShowsAll(!showsAll);
          }}
        >
          <AppText font="meta" weight="medium">
            {showsAll ? "Show Less" : `Show All ${entries.length}`}
          </AppText>
        </Pressable>
      ) : null}
    </EditorSection>
  );
};
