import type { SongHistoryEntry } from "@pcobooster/contracts/http/songs";
import {
  formatCalendarDateLabel,
  formatCalendarDayInTimeZone,
} from "@pcobooster/planning-center-models/calendar";
import {
  songHistoryCountLabel,
  songHistoryNote,
  summarizeSongHistory,
} from "@pcobooster/planning-center-models/song-library";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { useServiceTypes } from "@/hooks/use-service-types";
import { useSongHistory } from "@/hooks/use-song-history";

/** The calendar year in the org's zone, from its "YYYY-MM-DD" day. */
const yearOf = (instant: Date, timeZone: string) =>
  formatCalendarDayInTimeZone(instant, timeZone).slice(0, 4);

const HistoryRow = ({
  entry,
  note,
  planDate,
  timeZone,
}: {
  entry: SongHistoryEntry;
  note: string | null;
  planDate: Date;
  timeZone: string;
}) => (
  <li className="grid h-7 grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-sm">
    <span className="text-muted-foreground text-xs tabular-nums">
      {formatCalendarDateLabel(
        entry.sortDate,
        timeZone,
        yearOf(entry.sortDate, timeZone) === yearOf(planDate, timeZone)
          ? "monthDay"
          : "monthDayYear"
      )}
    </span>
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="truncate">
        {entry.serviceTypeName || "Unknown service"}
      </span>
      {note === null ? null : (
        <span className="text-muted-foreground shrink-0 text-xs">{note}</span>
      )}
    </span>
    <span className="text-muted-foreground text-right text-xs">
      {entry.startingKey ?? ""}
    </span>
  </li>
);

interface SongHistoryProps {
  songId: string;
  serviceTypeId: string | null;
  planId: string | null;
  /** The plan's service date, which "before" and "later" are counted from. */
  planDate: Date;
  /** Rows shown before "Show all". */
  previewRows: number;
}

/**
 * Every service that scheduled the song over the past year, newest first, with the key
 * each sang it in, counted from the plan's date: how often before it, and here.
 */
export const SongHistory = ({
  songId,
  serviceTypeId,
  planId,
  planDate,
  previewRows,
}: SongHistoryProps) => {
  const timeZone = useOrganizationTimeZone();
  const history = useSongHistory(songId);
  const serviceTypes = useServiceTypes();
  const serviceTypeName =
    serviceTypes.data?.find((type) => type.id === serviceTypeId)?.name ?? null;
  const [showAll, setShowAll] = useState(false);
  if (history.data === undefined) {
    return history.isError ? (
      <p className="text-muted-foreground text-sm">History didn&apos;t load.</p>
    ) : (
      <div className="flex flex-col gap-2 py-1" aria-busy>
        <Skeleton variant="text" className="h-3.5 w-full" />
        <Skeleton variant="text" className="h-3.5 w-4/5" />
        <Skeleton variant="text" className="h-3.5 w-3/5" />
      </div>
    );
  }
  const { entries } = history.data;
  const summary = summarizeSongHistory(entries, planDate, serviceTypeId);
  const rows = showAll ? entries : entries.slice(0, previewRows);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs tabular-nums">
        {songHistoryCountLabel(
          summary,
          serviceTypeName,
          history.data.truncated
        )}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Not scheduled in the past year.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((entry) => (
            <HistoryRow
              key={`${entry.planId ?? ""}-${entry.sortDate.toISOString()}`}
              entry={entry}
              note={songHistoryNote(entry, planId, planDate)}
              planDate={planDate}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}
      {entries.length > previewRows ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="self-start"
          onClick={() => {
            setShowAll((current) => !current);
          }}
        >
          {showAll ? "Show less" : `Show all ${entries.length}`}
        </Button>
      ) : null}
    </div>
  );
};
