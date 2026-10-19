import type {
  PeopleDashboardMonth,
  PeopleDashboardMonthDay,
} from "@pcobooster/contracts/http/people-schemas";

import {
  buildCalendarCells,
  commitmentCellTone,
  commitmentDot,
  commitmentDotClassName,
  engagementLabel,
  formatWeekdayMonthDay,
  pickCalendarMarker,
  weekDayNames,
} from "@/components/people/calendar";
import { CommitmentEntryText } from "@/components/people/shared-components";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { MonthGridDay } from "@/components/ui/month-grid-day";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const entryKey = (entry: PeopleDashboardMonthDay) =>
  `${entry.day}:${entry.kind}:${entry.positionName ?? ""}:${entry.serviceTypeName ?? ""}:${entry.status ?? ""}`;

/** A compact month with each commitment day tinted; hover or tap a day for its details. */
export const PersonMonthCalendar = ({
  month,
  monthDays,
}: {
  month: PeopleDashboardMonth;
  monthDays: readonly PeopleDashboardMonthDay[];
}) => {
  // Phones cannot hover, so a tap opens the day as a sheet instead.
  const isMobile = useIsMobile();
  const calendarCells = buildCalendarCells(
    month.startsOnWeekday,
    month.daysInMonth
  );
  return (
    <div>
      <div className="text-muted-foreground grid grid-cols-7 gap-0.5 pb-1.5 text-center text-xs">
        {weekDayNames.map((dayName) => (
          <div key={dayName}>{dayName.slice(0, 2)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {calendarCells.map((cell) => {
          if (cell.day === null) {
            return (
              <div key={cell.key} className="aspect-square min-h-7 w-full" />
            );
          }
          const { day } = cell;
          const entries = monthDays.filter((entry) => entry.day === day);
          const marker = pickCalendarMarker(entries);
          const dateLabel = formatWeekdayMonthDay(month, day);
          const button = (
            <MonthGridDay
              key={cell.key}
              size="sm"
              tone={
                marker
                  ? commitmentCellTone(marker.kind, marker.status)
                  : "empty"
              }
              aria-label={
                marker
                  ? `${dateLabel}: ${entries
                      .map((entry) => engagementLabel(entry.kind, entry.status))
                      .join(", ")}`
                  : dateLabel
              }
            >
              {day}
            </MonthGridDay>
          );
          if (!marker) {
            return button;
          }
          const details = (
            <div className="text-muted-foreground mt-1 grid grid-cols-1 gap-1 text-xs max-md:gap-2 max-md:text-sm">
              {entries.map((entry) => (
                <div key={entryKey(entry)} className="flex items-start gap-2">
                  <span aria-hidden className="flex h-lh shrink-0 items-center">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        commitmentDotClassName[
                          commitmentDot(entry.kind, entry.status)
                        ]
                      )}
                    />
                  </span>
                  <p>
                    <span className="text-foreground font-medium">
                      {engagementLabel(entry.kind, entry.status)}
                    </span>
                    {" · "}
                    <CommitmentEntryText entry={entry} />
                  </p>
                </div>
              ))}
            </div>
          );
          if (isMobile) {
            return (
              <ResponsivePopover key={cell.key}>
                <ResponsivePopoverTrigger render={button} />
                <ResponsivePopoverContent title={dateLabel} showTitle>
                  <div className="px-3 pb-4">{details}</div>
                </ResponsivePopoverContent>
              </ResponsivePopover>
            );
          }
          return (
            <HoverCard key={cell.key}>
              <HoverCardTrigger render={button} />
              <HoverCardContent side="top" variant="panel" className="w-72">
                <p className="text-xs font-medium">{dateLabel}</p>
                {details}
              </HoverCardContent>
            </HoverCard>
          );
        })}
      </div>
    </div>
  );
};
