import type {
  PeopleDashboardMonth,
  PeopleDashboardMonthDay,
  PeopleDashboardPerson,
  PeopleDashboardRosterPerson,
} from "@pcobooster/contracts/http/people-schemas";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import {
  buildCalendarCells,
  commitmentDot,
  commitmentDotClassName,
  commitmentStatusLabel,
  engagementLabel,
  formatMonthDay,
  formatWeekdayMonthDay,
  heatLevelTone,
  pickCalendarMarker,
  weekDayNames,
} from "@/components/people/calendar";
import type { CalendarCell } from "@/components/people/calendar";
import { PersonLineSkeletonList } from "@/components/people/people-skeletons";
import {
  CommitmentEntryText,
  CommitmentLegend,
  PersonAvatar,
  PersonRowButton,
} from "@/components/people/shared-components";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  buildMonthDays,
  MATRIX_DAY_COUNT,
  matrixPageStart,
  serviceDays,
} from "@/lib/people-dashboard";
import type { PeopleDashboardDay } from "@/lib/people-dashboard";
import { ReplayMask } from "@/lib/replay-mask";
import { cn } from "@/lib/utils";

interface PersonCallbacks {
  getPersonIntentProps: GetIntentPrefetchProps<PeopleDashboardRosterPerson>;
  onOpenPerson: (person: PeopleDashboardRosterPerson) => void;
}

const peopleCount = (count: number) =>
  `${count} ${count === 1 ? "person" : "people"}`;

const Dot = ({ entry }: { entry: PeopleDashboardMonthDay }) => (
  <span
    aria-hidden
    className={cn(
      "size-2 shrink-0 rounded-full",
      commitmentDotClassName[commitmentDot(entry.kind, entry.status)]
    )}
  />
);

/** "5 serving · 2 pending · 3 at rehearsal" for a day. */
const describeDay = (day: PeopleDashboardDay | undefined) => {
  if (
    day === undefined ||
    (day.serviceCount === 0 && day.rehearsalCount === 0)
  ) {
    return "No one is scheduled.";
  }
  const parts: string[] = [];
  if (day.serviceCount > 0) {
    parts.push(`${day.serviceCount} serving`);
  }
  if (day.pendingServiceCount > 0) {
    parts.push(`${day.pendingServiceCount} pending`);
  }
  if (day.rehearsalCount > 0) {
    parts.push(`${day.rehearsalCount} at rehearsal`);
  }
  return parts.join(" · ");
};

/** Everyone scheduled on a day, services first, with their position and status. */
const DayPeople = ({
  people,
  day,
  ...callbacks
}: PersonCallbacks & {
  people: readonly PeopleDashboardPerson[];
  day: number;
}) => {
  const scheduled = people.flatMap((person) => {
    const entries = person.monthDays.filter((entry) => entry.day === day);
    const marker = pickCalendarMarker(entries);
    return marker === null ? [] : [{ person, marker }];
  });
  if (scheduled.length === 0) {
    return (
      <p className="text-muted-foreground px-1.5 py-1 text-sm">
        No one is scheduled on this day.
      </p>
    );
  }
  const ordered = scheduled.toSorted(
    (a, b) =>
      Number(a.marker.kind === "rehearsal") -
      Number(b.marker.kind === "rehearsal")
  );
  return (
    <div className="flex flex-col">
      {ordered.map(({ person, marker }) => (
        <PersonRowButton
          key={person.id}
          person={person}
          size="row"
          {...callbacks}
        >
          <PersonAvatar person={person} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              <ReplayMask>{person.name}</ReplayMask>
            </span>
            <span className="text-muted-foreground block truncate text-xs">
              {marker.kind === "rehearsal"
                ? `Rehearsal · ${marker.positionName ?? "Scheduled"}`
                : (marker.positionName ?? "Scheduled")}
            </span>
          </span>
          <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
            <Dot entry={marker} />
            {marker.kind === "rehearsal"
              ? null
              : commitmentStatusLabel(marker.status)}
          </span>
        </PersonRowButton>
      ))}
    </div>
  );
};

/** A heatmap day: its number, how many serve, and a dot when some have not confirmed. */
const HeatmapDayContent = ({
  day,
  monthDay,
}: {
  day: number;
  monthDay: PeopleDashboardDay | undefined;
}) => {
  const serviceCount = monthDay?.serviceCount ?? 0;
  const rehearsalOnly =
    serviceCount === 0 && (monthDay?.rehearsalCount ?? 0) > 0;
  return (
    <>
      <span className="text-muted-foreground text-xs tabular-nums">{day}</span>
      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
        {serviceCount > 0 ? serviceCount : null}
        {(monthDay?.pendingServiceCount ?? 0) > 0 ? (
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              commitmentDotClassName.pending
            )}
          />
        ) : null}
        {rehearsalOnly ? (
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              commitmentDotClassName.rehearsal
            )}
          />
        ) : null}
      </span>
    </>
  );
};

const HeatmapCell = ({
  cell,
  month,
  monthDay,
  people,
  selectedDay,
  onSelectDay,
  ...callbacks
}: PersonCallbacks & {
  cell: CalendarCell;
  month: PeopleDashboardMonth;
  monthDay: PeopleDashboardDay | undefined;
  people: readonly PeopleDashboardPerson[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
}) => {
  // Phones cannot hover, so a tap opens the day's people as a sheet instead.
  const isMobile = useIsMobile();
  if (cell.day === null) {
    return <div className="aspect-square min-h-10 w-full sm:min-h-16" />;
  }
  const { day } = cell;
  const label = `${formatWeekdayMonthDay(month, day)}: ${describeDay(monthDay)}`;
  const button = (
    <MonthGridDay
      size="lg"
      tone={heatLevelTone(
        monthDay?.serviceCount ?? 0,
        monthDay?.rehearsalCount ?? 0
      )}
      selected={!isMobile && day === selectedDay}
      aria-label={label}
      onClick={() => {
        onSelectDay(day);
      }}
    >
      <HeatmapDayContent day={day} monthDay={monthDay} />
    </MonthGridDay>
  );
  if (isMobile) {
    return (
      <ResponsivePopover>
        <ResponsivePopoverTrigger render={button} />
        <ResponsivePopoverContent
          title={formatWeekdayMonthDay(month, day)}
          description={describeDay(monthDay)}
          showTitle
        >
          <div className="px-2 pb-4">
            <DayPeople people={people} day={day} {...callbacks} />
          </div>
        </ResponsivePopoverContent>
      </ResponsivePopover>
    );
  }
  return (
    <HoverCard>
      <HoverCardTrigger render={button} />
      <HoverCardContent side="top" variant="label">
        {label}
      </HoverCardContent>
    </HoverCard>
  );
};

const heatmapLegendLabels = {
  confirmed: "Everyone confirmed",
  pending: "Someone pending",
  rehearsal: "Rehearsal only",
};

const MonthHeatmap = ({
  month,
  monthDays,
  people,
  selectedDay,
  onSelectDay,
  coverageNote,
  ...callbacks
}: PersonCallbacks & {
  month: PeopleDashboardMonth;
  monthDays: readonly PeopleDashboardDay[];
  people: readonly PeopleDashboardPerson[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
  coverageNote: ReactNode;
}) => {
  const calendarCells = buildCalendarCells(
    month.startsOnWeekday,
    month.daysInMonth
  );
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <CalendarDays
              className="text-muted-foreground size-4"
              aria-hidden
            />
            {month.label}
          </span>
        </CardTitle>
        <CardDescription>
          How many people serve each day. {coverageNote}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground grid grid-cols-7 gap-1.5 pb-2 text-center text-xs">
          {weekDayNames.map((dayName) => (
            <div key={dayName}>{dayName}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {calendarCells.map((cell) => (
            <HeatmapCell
              key={cell.key}
              cell={cell}
              month={month}
              monthDay={cell.day === null ? undefined : monthDays[cell.day - 1]}
              people={people}
              selectedDay={selectedDay}
              onSelectDay={onSelectDay}
              {...callbacks}
            />
          ))}
        </div>
        <CommitmentLegend
          dots={["pending", "rehearsal"]}
          labels={heatmapLegendLabels}
          className="mt-3"
        >
          <span>Numbers count people serving.</span>
        </CommitmentLegend>
      </CardContent>
    </Card>
  );
};

const MatrixDay = ({
  person,
  month,
  day,
}: {
  person: PeopleDashboardPerson;
  month: PeopleDashboardMonth;
  day: number;
}) => {
  const isMobile = useIsMobile();
  const marker = pickCalendarMarker(
    person.monthDays.filter((entry) => entry.day === day)
  );
  if (marker === null) {
    return (
      <div className="flex justify-center px-2 py-2">
        <span aria-hidden className="bg-border/60 size-2 rounded-full" />
      </div>
    );
  }
  const commitmentSummary = `${formatMonthDay(month, day)}: ${engagementLabel(marker.kind, marker.status)}`;
  if (isMobile) {
    return (
      <div className="flex justify-center px-2 py-2">
        <Dot entry={marker} />
        <span className="sr-only">
          <ReplayMask>{person.name}</ReplayMask>
          {`, ${commitmentSummary}`}
        </span>
      </div>
    );
  }
  return (
    <div className="flex justify-center px-2 py-1">
      <HoverCard>
        <HoverCardTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={commitmentSummary}
            />
          }
        >
          <Dot entry={marker} />
        </HoverCardTrigger>
        <HoverCardContent side="top" variant="panel" className="w-64">
          <p className="text-xs font-medium">
            <ReplayMask>{person.name}</ReplayMask>
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {formatWeekdayMonthDay(month, day)}
            {" · "}
            <span className="text-foreground font-medium">
              {engagementLabel(marker.kind, marker.status)}
            </span>
            {" · "}
            <CommitmentEntryText entry={marker} />
          </p>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
};

type MatrixStyle = CSSProperties & { "--matrix-days": number };

/** A person column, then one column per service day on the page. */
const matrixGridClassName =
  "grid grid-cols-[minmax(10.5rem,1.2fr)_repeat(var(--matrix-days),minmax(3.5rem,1fr))]";

/** People against a page of service days, paged with the selected day. */
const PeopleMonthMatrix = ({
  people,
  month,
  days,
  selectedDay,
  onSelectDay,
  ...callbacks
}: PersonCallbacks & {
  people: readonly PeopleDashboardPerson[];
  month: PeopleDashboardMonth;
  days: readonly number[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
}) => {
  const start = matrixPageStart(days, selectedDay);
  const pageDays = days.slice(start, start + MATRIX_DAY_COUNT);
  const scheduled = people.filter((person) => person.monthDays.length > 0);
  const unscheduledCount = people.length - scheduled.length;
  const previousDay = days[start - MATRIX_DAY_COUNT];
  const nextDay = days[start + MATRIX_DAY_COUNT];
  const columns: MatrixStyle = { "--matrix-days": pageDays.length };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Who serves when</CardTitle>
        <CardDescription>
          {days.length <= MATRIX_DAY_COUNT
            ? `${days.length} service ${days.length === 1 ? "day" : "days"} this month.`
            : `Service days ${start + 1} to ${start + pageDays.length} of ${days.length}.`}
        </CardDescription>
        {days.length > MATRIX_DAY_COUNT ? (
          <CardAction>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Earlier service days"
                disabled={previousDay === undefined}
                onClick={() => {
                  if (previousDay !== undefined) {
                    onSelectDay(previousDay);
                  }
                }}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Later service days"
                disabled={nextDay === undefined}
                onClick={() => {
                  if (nextDay !== undefined) {
                    onSelectDay(nextDay);
                  }
                }}
              >
                <ChevronRight />
              </Button>
            </div>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {pageDays.length === 0 || scheduled.length === 0 ? (
          <p className="text-muted-foreground px-1.5 py-1 text-sm">
            No one is scheduled this month.
          </p>
        ) : (
          // `relative` keeps the cells' absolutely positioned screen-reader text in the scroller.
          <div
            className="relative overflow-x-auto overscroll-x-contain"
            style={columns}
          >
            <div className="min-w-fit">
              <div
                className={cn(
                  matrixGridClassName,
                  "border-border/40 text-muted-foreground border-b text-xs font-medium"
                )}
              >
                <div className="bg-card border-border/40 sticky left-0 z-[1] px-3 py-2 max-md:border-r md:static">
                  Person
                </div>
                {pageDays.map((day) => (
                  <div
                    key={day}
                    className={cn(
                      "px-2 py-2 text-center tabular-nums",
                      day === selectedDay && "text-foreground"
                    )}
                  >
                    {formatMonthDay(month, day)}
                  </div>
                ))}
              </div>
              <div className="divide-border/30 divide-y">
                {scheduled.map((person) => (
                  <div
                    key={person.id}
                    className={cn(
                      matrixGridClassName,
                      "group/matrix-row hover:bg-muted/50 w-full items-center text-left"
                    )}
                  >
                    <div className="bg-card group-hover/matrix-row:bg-muted/50 border-border/40 sticky left-0 z-[1] min-w-0 max-md:border-r md:static md:bg-transparent">
                      <PersonRowButton person={person} {...callbacks}>
                        <PersonAvatar person={person} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            <ReplayMask>{person.name}</ReplayMask>
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {person.roles.join(", ")}
                          </span>
                        </span>
                      </PersonRowButton>
                    </div>
                    {pageDays.map((day) => (
                      <MatrixDay
                        key={day}
                        person={person}
                        month={month}
                        day={day}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <CommitmentLegend className="mt-3">
          {unscheduledCount > 0 ? (
            <span>
              Not shown: {peopleCount(unscheduledCount)} with nothing this
              month.
            </span>
          ) : null}
        </CommitmentLegend>
      </CardContent>
    </Card>
  );
};

const SelectedDayPanel = ({
  month,
  day,
  monthDay,
  people,
  ...callbacks
}: PersonCallbacks & {
  month: PeopleDashboardMonth;
  day: number;
  monthDay: PeopleDashboardDay | undefined;
  people: readonly PeopleDashboardPerson[];
}) => (
  <Card size="sm" className="max-md:hidden">
    <CardHeader>
      <CardTitle>{formatWeekdayMonthDay(month, day)}</CardTitle>
      <CardDescription>{describeDay(monthDay)}</CardDescription>
    </CardHeader>
    <CardContent>
      <DayPeople people={people} day={day} {...callbacks} />
    </CardContent>
  </Card>
);

/** Before any activity loads: the month's shape with placeholders. */
export const MonthViewSkeleton = () => (
  <div
    className="grid shrink-0 grid-cols-1 items-start gap-3 @5xl:grid-cols-[minmax(0,1fr)_20rem]"
    aria-busy
    aria-label="Loading month view"
  >
    <div className="flex flex-col gap-3">
      <Card size="sm">
        <CardHeader>
          <Skeleton variant="text" className="h-4 w-36" />
          <Skeleton variant="text" className="mt-1 h-3.5 w-56 max-w-full" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 35 }, (_, index) => (
              <Skeleton
                key={index}
                variant="control"
                className="aspect-square min-h-10 w-full sm:min-h-16"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
    <Card size="sm" className="max-md:hidden">
      <CardHeader>
        <Skeleton variant="text" className="h-4 w-28" />
      </CardHeader>
      <CardContent>
        <PersonLineSkeletonList rows={5} />
      </CardContent>
    </Card>
  </div>
);

interface MonthViewProps extends PersonCallbacks {
  /** People to show, after search. */
  people: readonly PeopleDashboardPerson[];
  month: PeopleDashboardMonth;
  /** Today's day of the month, when the month is the current one. */
  today: number | null;
  /** "Based on 16 of 40 people so far", when the month covers only some of the scope. */
  coverageNote: ReactNode;
}

/** The month at a glance: how many serve each day, who serves when, and who is on a day. */
export const MonthView = ({
  people,
  month,
  today,
  coverageNote,
  ...callbacks
}: MonthViewProps) => {
  const monthDays = useMemo(() => buildMonthDays(people), [people]);
  const days = useMemo(() => serviceDays(monthDays), [monthDays]);
  const [chosenDay, setChosenDay] = useState<number | null>(null);
  // Until the viewer picks a day: the next service day from today, else the first.
  const selectedDay =
    chosenDay ??
    days.find((day) => today === null || day >= today) ??
    days[0] ??
    today ??
    1;

  return (
    <div className="grid shrink-0 grid-cols-1 items-start gap-3 @5xl:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="flex min-w-0 flex-col gap-3">
        <MonthHeatmap
          month={month}
          monthDays={monthDays}
          people={people}
          selectedDay={selectedDay}
          onSelectDay={setChosenDay}
          coverageNote={coverageNote}
          {...callbacks}
        />
        <PeopleMonthMatrix
          people={people}
          month={month}
          days={days}
          selectedDay={selectedDay}
          onSelectDay={setChosenDay}
          {...callbacks}
        />
      </section>
      <SelectedDayPanel
        month={month}
        day={selectedDay}
        monthDay={monthDays[selectedDay - 1]}
        people={people}
        {...callbacks}
      />
    </div>
  );
};
