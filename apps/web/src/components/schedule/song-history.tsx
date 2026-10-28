import type { SongHistoryEntry } from "@pcobooster/contracts/http/songs";
import {
  formatCalendarDateLabel,
  formatCalendarDayInTimeZone,
} from "@pcobooster/planning-center-models/calendar";
import { historyRowFullLabel } from "@pcobooster/planning-center-models/song-detail";
import {
  songHistoryCountLabel,
  songHistoryNote,
  summarizeSongHistory,
} from "@pcobooster/planning-center-models/song-library";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { HoverLabel } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { useServiceTypes } from "@/hooks/use-service-types";
import { useSongHistory } from "@/hooks/use-song-history";
import { cn } from "@/lib/utils";

/** The calendar year in the org's zone, from its "YYYY-MM-DD" day. */
const yearOf = (instant: Date, timeZone: string) =>
  formatCalendarDayInTimeZone(instant, timeZone).slice(0, 4);

const HistoryRowContent = ({
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
  <>
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
  </>
);

const historyRowClassName =
  "grid h-7 grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-sm";

/** A row opens its plan, except the plan being edited. */
const HistoryRow = ({
  entry,
  note,
  planId,
  planDate,
  timeZone,
  onOpenPlan,
}: {
  entry: SongHistoryEntry;
  note: string | null;
  planId: string | null;
  planDate: Date;
  timeZone: string;
  onOpenPlan: (() => void) | undefined;
}) => {
  const content = (
    <HistoryRowContent
      entry={entry}
      note={note}
      planDate={planDate}
      timeZone={timeZone}
    />
  );
  if (
    entry.planId === null ||
    entry.serviceTypeId === null ||
    entry.planId === planId
  ) {
    return <li className={historyRowClassName}>{content}</li>;
  }
  return (
    <li>
      <HoverLabel
        label={historyRowFullLabel(entry, timeZone)}
        side="left"
        delay={400}
        trigger={
          <Link
            to="/services/$serviceTypeId/plans/$planId/$view"
            params={{
              serviceTypeId: entry.serviceTypeId,
              planId: entry.planId,
              view: "plan",
            }}
            className={cn(
              historyRowClassName,
              "hover:bg-muted focus-visible:ring-ring/50 -mx-1.5 rounded-md px-1.5 outline-none focus-visible:ring-2"
            )}
            onClick={onOpenPlan}
          />
        }
      >
        {content}
      </HoverLabel>
    </li>
  );
};

interface SongHistoryProps {
  songId: string;
  serviceTypeId: string | null;
  planId: string | null;
  /** The plan's service date, which "before" and "later" are counted from. */
  planDate: Date;
  /** Rows shown before "Show all". */
  previewRows: number;
  /** Runs as a row opens its plan, so a dialog showing the history can close. */
  onOpenPlan?: () => void;
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
  onOpenPlan,
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
              planId={planId}
              planDate={planDate}
              timeZone={timeZone}
              onOpenPlan={onOpenPlan}
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
