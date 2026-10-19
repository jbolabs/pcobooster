import type {
  PeopleDashboardMonth,
  PeopleDashboardMonthDay,
  PeopleDashboardPersonDetail,
  ServingRhythm,
} from "@pcobooster/contracts/http/people-schemas";
import { orgCalendarDaysRefMinusItem } from "@pcobooster/planning-center-models/calendar";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HeartHandshake,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  commitmentDot,
  commitmentDotClassName,
  commitmentStatusLabel,
  formatWeekday,
} from "@/components/people/calendar";
import { PersonMonthCalendar } from "@/components/people/person-month-calendar";
import { PersonSignalList } from "@/components/people/person-signal";
import {
  CommitmentEntryText,
  CommitmentLegend,
  Metric,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeCadence,
  describeDaysAgo,
  formatWeekdayDayKey,
} from "@/lib/team-health";
import type { PersonSignal } from "@/lib/team-health";
import { cn } from "@/lib/utils";

const SectionTitle = ({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) => (
  <CardTitle>
    <span className="flex items-center gap-2">
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      {children}
    </span>
  </CardTitle>
);

const metricKeys = ["served-30", "served-90", "scheduled-30", "declined"];

const RowsSkeleton = ({ rows }: { rows: number }) => (
  <div className="flex flex-col gap-2">
    {Array.from({ length: rows }, (_, index) => (
      <Skeleton key={index} variant="control" className="h-9" />
    ))}
  </div>
);

export const PersonDetailBodySkeleton = () => (
  <div
    className="grid grid-cols-1 items-start gap-3 @5xl:grid-cols-[minmax(0,1fr)_20rem]"
    aria-busy
    aria-label="Loading person"
  >
    <section className="flex min-w-0 flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        {metricKeys.map((key) => (
          <div
            key={key}
            className="border-border/40 rounded-lg border px-3 py-2"
          >
            <Skeleton variant="text" className="h-3 w-20" />
            <Skeleton variant="text" className="mt-2 h-4 w-6" />
          </div>
        ))}
      </div>
      <Card size="sm">
        <CardHeader>
          <Skeleton variant="text" className="h-4 w-36" />
          <Skeleton variant="text" className="mt-1 h-3.5 w-48 max-w-full" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: 35 }, (_, index) => (
                <Skeleton
                  key={index}
                  variant="control"
                  className="aspect-square min-h-7 w-full"
                />
              ))}
            </div>
            <RowsSkeleton rows={4} />
          </div>
        </CardContent>
      </Card>
    </section>
    <aside className="flex flex-col gap-3">
      {["signals", "rotation"].map((key) => (
        <Card key={key} size="sm">
          <CardHeader>
            <Skeleton variant="text" className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <RowsSkeleton rows={2} />
          </CardContent>
        </Card>
      ))}
    </aside>
  </div>
);

const countLabel = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

const describeMonth = (monthDays: readonly PeopleDashboardMonthDay[]) => {
  const services = new Set(
    monthDays.flatMap((entry) => (entry.kind === "service" ? [entry.day] : []))
  ).size;
  const rehearsals = new Set(
    monthDays.flatMap((entry) =>
      entry.kind === "rehearsal" ? [entry.day] : []
    )
  ).size;
  if (services === 0 && rehearsals === 0) {
    return "Nothing scheduled.";
  }
  const parts = [countLabel(services, "service day", "service days")];
  if (rehearsals > 0) {
    parts.push(countLabel(rehearsals, "rehearsal", "rehearsals"));
  }
  return parts.join(" · ");
};

/** Every service and rehearsal in the month, in date order. */
const CommitmentList = ({
  month,
  monthDays,
}: {
  month: PeopleDashboardMonth;
  monthDays: readonly PeopleDashboardMonthDay[];
}) => {
  if (monthDays.length === 0) {
    return (
      <p className="text-muted-foreground px-1.5 text-sm">
        Nothing scheduled in {month.label.split(" ")[0]}.
      </p>
    );
  }
  return (
    <ol className="flex flex-col">
      {monthDays.map((entry) => (
        <li
          key={`${entry.day}:${entry.kind}:${entry.positionName ?? ""}:${entry.serviceTypeName ?? ""}:${entry.status ?? ""}`}
          className="flex min-h-9 items-center gap-3 px-1.5 max-sm:items-start max-sm:py-1.5"
        >
          <span className="text-muted-foreground w-12 shrink-0 text-xs tabular-nums">
            {formatWeekday(month, entry.day)}{" "}
            <span className="text-foreground text-sm font-medium">
              {entry.day}
            </span>
          </span>
          {/* Phones wrap the position and service type instead of cutting them off. */}
          <span className="min-w-0 flex-1 text-sm sm:truncate">
            {entry.kind === "rehearsal" ? (
              <span className="text-muted-foreground">Rehearsal · </span>
            ) : null}
            <CommitmentEntryText entry={entry} />
          </span>
          <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs max-sm:mt-1.5">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                commitmentDotClassName[commitmentDot(entry.kind, entry.status)]
              )}
            />
            {/* The legend names each dot, so phones keep only the dot. */}
            <span className="max-sm:sr-only">
              {commitmentStatusLabel(entry.status)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
};

const MonthNavigation = ({
  personId,
  previousMonth,
  nextMonth,
}: {
  personId: string;
  previousMonth: string;
  nextMonth: string;
}) => (
  <div className="flex items-center gap-1">
    <Button
      nativeButton={false}
      render={
        <Link
          to="/people/$personId"
          params={{ personId }}
          search={{ month: previousMonth }}
          aria-label="Previous month"
        />
      }
      variant="outline"
      size="icon-sm"
    >
      <ChevronLeft />
    </Button>
    <Button
      nativeButton={false}
      render={
        <Link
          to="/people/$personId"
          params={{ personId }}
          search={{ month: nextMonth }}
          aria-label="Next month"
        />
      }
      variant="outline"
      size="icon-sm"
    >
      <ChevronRight />
    </Button>
  </div>
);

const RotationRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex min-h-8 items-baseline justify-between gap-3">
    <dt className="text-muted-foreground text-sm">{label}</dt>
    <dd className="text-right text-sm tabular-nums">{children}</dd>
  </div>
);

const Rotation = ({
  rhythm,
  todayKey,
}: {
  rhythm: ServingRhythm;
  todayKey: string;
}) => (
  <dl className="flex flex-col">
    <RotationRow label="Last served">
      {rhythm.lastServedOn === null ? (
        <span className="text-muted-foreground">Not in 6 months</span>
      ) : (
        <>
          {formatWeekdayDayKey(rhythm.lastServedOn)}
          <span className="text-muted-foreground block text-xs">
            {describeDaysAgo(
              orgCalendarDaysRefMinusItem(rhythm.lastServedOn, todayKey)
            )}
          </span>
        </>
      )}
    </RotationRow>
    <RotationRow label="Next serving">
      {rhythm.nextServingOn === null ? (
        <span className="text-muted-foreground">Not scheduled</span>
      ) : (
        formatWeekdayDayKey(rhythm.nextServingOn)
      )}
    </RotationRow>
    <RotationRow label="Usually serves">
      {rhythm.typicalGapDays === null ? (
        <span className="text-muted-foreground">Not enough history</span>
      ) : (
        describeCadence(rhythm.typicalGapDays)
      )}
    </RotationRow>
  </dl>
);

/** One-directional counts: served looks back, scheduled looks ahead. */
const ServingNumbers = ({ rhythm }: { rhythm: ServingRhythm }) => (
  // Sized by the page's own width (the inset is a container), so an open sidebar counts.
  <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
    <Metric label="Served, last 30 days" value={String(rhythm.servedDays30)} />
    <Metric label="Served, last 90 days" value={String(rhythm.servedDays90)} />
    <Metric
      label="Scheduled, next 30 days"
      value={String(rhythm.upcomingDays30)}
    />
    <Metric
      label="Declined, last 6 months"
      value={
        rhythm.requests180 === 0
          ? "-"
          : `${rhythm.declined180} of ${rhythm.requests180}`
      }
    />
  </div>
);

export const PersonDetailBody = ({
  data,
  signals,
  todayKey,
  isPlaceholderData,
}: {
  data: PeopleDashboardPersonDetail;
  /** The dashboard's signals for this person, from the same rules and rhythm. */
  signals: readonly PersonSignal[];
  todayKey: string;
  isPlaceholderData: boolean;
}) => {
  const { person, month } = data;
  return (
    <div
      className="stale-while-busy grid grid-cols-1 items-start gap-3 @5xl:grid-cols-[minmax(0,1fr)_20rem]"
      aria-busy={isPlaceholderData}
    >
      <section className="flex min-w-0 flex-col gap-3">
        <ServingNumbers rhythm={person.rhythm} />
        <Card size="sm">
          <CardHeader>
            <SectionTitle icon={<CalendarDays className="size-4" />}>
              {month.label}
            </SectionTitle>
            <CardDescription>{describeMonth(person.monthDays)}</CardDescription>
            <CardAction>
              <MonthNavigation
                personId={person.id}
                previousMonth={data.previousMonth}
                nextMonth={data.nextMonth}
              />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 items-start gap-4 @2xl:grid-cols-[15rem_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                <PersonMonthCalendar
                  month={month}
                  monthDays={person.monthDays}
                />
                <CommitmentLegend />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <CommitmentList month={month} monthDays={person.monthDays} />
                {data.requestBudget.unresolvedRehearsalTimes > 0 ? (
                  <p className="text-muted-foreground px-1.5 text-xs">
                    Planning Center doesn&apos;t list some rehearsal times, so
                    those show on the service date.
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <aside className="flex flex-col gap-3">
        <Card size="sm">
          <CardHeader>
            <SectionTitle icon={<HeartHandshake className="size-4" />}>
              Signals
            </SectionTitle>
          </CardHeader>
          <CardContent>
            {signals.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing needs attention.
              </p>
            ) : (
              <PersonSignalList signals={signals} />
            )}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <SectionTitle icon={<Clock3 className="size-4" />}>
              Rotation
            </SectionTitle>
          </CardHeader>
          <CardContent>
            <Rotation rhythm={person.rhythm} todayKey={todayKey} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
};
