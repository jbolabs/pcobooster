import { NotFound } from "@pcobooster/contracts/faults/not-found";
import type { PeopleDashboardPerson } from "@pcobooster/contracts/http/people-schemas";
import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { planningCenterPersonUrl } from "@pcobooster/planning-center-models/planning-center-person-url";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";

import { PageShell } from "@/components/page-shell";
import {
  PersonDetailBody,
  PersonDetailBodySkeleton,
} from "@/components/people/detail-body";
import { PersonAvatar } from "@/components/people/shared-components";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { HoverLabel } from "@/components/ui/hover-card";
import { LoadingBar } from "@/components/ui/loading-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import {
  usePeopleDashboardPerson,
  usePersonDashboardContext,
} from "@/hooks/use-people-dashboard-person";
import { currentDate } from "@/lib/clock";
import { ReplayMask } from "@/lib/replay-mask";
import { personSignals } from "@/lib/team-health";

const PersonHeaderSkeleton = () => (
  <div className="flex min-w-0 items-center gap-3">
    <Skeleton variant="round" className="size-6 shrink-0" />
    <div className="flex min-w-0 flex-col gap-2">
      <Skeleton variant="control" className="h-6 w-44 md:h-7" />
      <Skeleton variant="text" className="h-3.5 w-64 max-w-full" />
    </div>
  </div>
);

export const PersonDetailPageSkeleton = () => (
  <PageShell label="Loading person" busy>
    <header className="flex shrink-0 items-center justify-between gap-3">
      <PersonHeaderSkeleton />
      <Skeleton variant="control" className="size-8 shrink-0" />
    </header>
    <PersonDetailBodySkeleton />
  </PageShell>
);

const PlanningCenterPersonLink = ({
  personId,
  name,
}: {
  personId: string;
  name: string;
}) => (
  <HoverLabel
    label="Open in Planning Center"
    side="bottom"
    align="end"
    sideOffset={8}
    render={
      <a
        href={planningCenterPersonUrl(personId)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${name} in Planning Center`}
        className={buttonVariants({
          variant: "outline",
          size: "icon-sm",
          className: "shrink-0 max-md:size-9 max-md:rounded-full",
        })}
      />
    }
  >
    <ExternalLink className="size-4" aria-hidden />
  </HoverLabel>
);

const PersonHeading = ({
  person,
  teams,
}: {
  person: PeopleDashboardPerson;
  teams: readonly string[];
}) => {
  const subtitle = [teams.join(", "), person.roles.join(", ")]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PersonAvatar person={person} />
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">
          <ReplayMask>{person.name}</ReplayMask>
        </h1>
        {subtitle === "" ? null : (
          <p className="text-muted-foreground truncate text-sm">{subtitle}</p>
        )}
      </div>
    </div>
  );
};

/** A person Planning Center Services has no record of: they are in People only. */
const NotInServices = () => (
  <div
    className="border-border/40 text-muted-foreground flex flex-col gap-1 rounded-lg border px-4 py-8 text-sm"
    aria-live="polite"
  >
    <span className="text-foreground font-medium">Not in Services yet</span>
    <span>
      They’re in Planning Center People but not on a Services team or schedule
      yet, so there’s no serving history to show.
    </span>
  </div>
);

/**
 * Why the person's details are missing: not in Services (nothing to retry), or a failed read.
 */
const PersonDetailFailure = ({
  error,
  isFetching,
  onRetry,
}: {
  error: Error;
  isFetching: boolean;
  onRetry: () => void;
}) =>
  // Planning Center Services has no record of them: they are in People only.
  error instanceof NotFound && error.resource === "services-person" ? (
    <NotInServices />
  ) : (
    <div
      className="border-border/40 text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-4 py-8 text-sm"
      aria-live="polite"
    >
      <span className="text-destructive">Person details failed to load.</span>
      <Button
        variant="outline"
        size="xs"
        disabled={isFetching}
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );

/**
 * Month paging only changes a search param; the query keeps the page populated while the
 * next month loads.
 */
export const PersonDetailPage = ({
  personId,
  month,
}: {
  personId: string;
  month: string | null;
}) => {
  const { data, error, isError, isFetching, isPlaceholderData, refetch } =
    usePeopleDashboardPerson(personId, month);
  const { rosterPerson, teamPace } = usePersonDashboardContext(personId);
  const orgTimeZone = useOrganizationTimeZone();
  const todayKey = formatCalendarDayInTimeZone(currentDate(), orgTimeZone);
  const person = data?.person ?? null;
  const rhythm = person?.rhythm ?? null;
  const signals = useMemo(
    () => (rhythm === null ? [] : personSignals(rhythm, todayKey, teamPace)),
    [rhythm, teamPace, todayKey]
  );

  return (
    <PageShell>
      <header className="flex shrink-0 flex-col gap-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          {person ? (
            <PersonHeading
              person={person}
              // The roster's team memberships, as the dashboard shows them; else the teams
              // they served on lately.
              teams={rosterPerson?.teams ?? person.teams}
            />
          ) : null}
          {person === null && !isError ? <PersonHeaderSkeleton /> : null}
          <PlanningCenterPersonLink
            personId={personId}
            name={person?.name ?? rosterPerson?.name ?? "this person"}
          />
        </div>
        <LoadingBar
          active={isPlaceholderData && !isError}
          className="-mt-1.5 -mb-1"
        />
      </header>

      {isError ? (
        <PersonDetailFailure
          error={error}
          isFetching={isFetching}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : null}
      {!isError && data === undefined ? <PersonDetailBodySkeleton /> : null}
      {!isError && data !== undefined ? (
        <PersonDetailBody
          data={data}
          signals={signals}
          todayKey={todayKey}
          isPlaceholderData={isPlaceholderData}
        />
      ) : null}
    </PageShell>
  );
};
