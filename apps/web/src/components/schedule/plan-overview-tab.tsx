import type { Plan } from "@pcobooster/contracts/http/catalog";
import { formatCalendarDateLabel } from "@pcobooster/planning-center-models/calendar";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type {
  PlanOrder,
  PlanSchedule,
  PlanStaffing,
  ReadinessCheck,
  PlanView,
} from "@pcobooster/planning-center-models/plan-overview";
import {
  buildReadinessChecks,
  formatDuration,
  formatTimeOfDay,
  summarizeOrder,
  summarizeStaffing,
  summarizeTimes,
} from "@pcobooster/planning-center-models/plan-overview";
import type { SlotRef } from "@pcobooster/planning-center-models/scheduling-notifications";
import type {
  PlanTime,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  ListMusic,
  Users,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { PageScrollArea } from "@/components/page-shell";
import { QueryDataBoundary } from "@/components/query-data-boundary";
import type { ReadQueryState } from "@/components/query-data-boundary";
import { PlanFilesBrowser } from "@/components/schedule/plan-files-browser";
import { SongLink } from "@/components/songs/song-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { GetIntentPrefetchProps } from "@/hooks/use-intent-prefetch";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { usePlanItems } from "@/hooks/use-plan-items";
import { getPlanViewLabel } from "@/lib/app-routes";
import { queryKeys } from "@/lib/query-keys";
import { planSlotLink } from "@/lib/schedule-navigation";
import { cn } from "@/lib/utils";

export interface PlanRef {
  serviceTypeId: string;
  planId: string;
}

const viewLink = (plan: PlanRef, view: PlanView) =>
  planSlotLink({ ...plan, view, teamId: null, positionId: null });

const OpenViewLink = ({ plan, view }: { plan: PlanRef; view: PlanView }) => (
  <Link
    {...viewLink(plan, view)}
    className={buttonVariants({ variant: "ghost", size: "sm" })}
  >
    {getPlanViewLabel(view)}
    <ChevronRight className="size-4" aria-hidden data-icon="inline-end" />
  </Link>
);

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

const RowsSkeleton = ({ rows }: { rows: number }) => (
  <div className="flex flex-col gap-2">
    {Array.from({ length: rows }, (_, index) => (
      <Skeleton key={index} variant="control" className="h-9" />
    ))}
  </div>
);

const describeReadiness = (checks: readonly ReadinessCheck[]): string => {
  const todo = checks.filter((check) => check.state === "todo").length;
  if (todo === 0) {
    return "Everything we can check looks ready.";
  }
  return todo === 1 ? "1 thing left to do." : `${todo} things left to do.`;
};

/**
 * Planning Center's public API cannot send scheduling emails, so the notifications check hands
 * off to the plan there and rereads the roster when the scheduler comes back to this tab.
 */
const useRecheckRosterOnReturn = (
  plan: PlanRef & { seriesId: string | null }
) => {
  const queryClient = useQueryClient();
  const [armed, setArmed] = useState(false);
  const onReturn = useEffectEvent(() => {
    if (armed && document.visibilityState === "visible") {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.teamPositions(
          plan.serviceTypeId,
          plan.planId,
          plan.seriesId
        ),
        exact: true,
      });
    }
  });
  useEffect(() => {
    const handleReturn = () => {
      onReturn();
    };
    document.addEventListener("visibilitychange", handleReturn);
    window.addEventListener("focus", handleReturn);
    return () => {
      document.removeEventListener("visibilitychange", handleReturn);
      window.removeEventListener("focus", handleReturn);
    };
  }, []);
  return () => {
    setArmed(true);
  };
};

const ReadinessCheckIcon = ({ state }: { state: ReadinessCheck["state"] }) =>
  state === "done" ? (
    <CircleCheck
      className="text-status-confirmed size-4 shrink-0"
      aria-hidden
    />
  ) : (
    <CircleAlert
      className="text-status-scheduled size-4 shrink-0"
      aria-hidden
    />
  );

const ReadinessCheckTitle = ({ check }: { check: ReadinessCheck }) => (
  <ItemContent className="min-w-0">
    <ItemTitle className="min-w-0">
      <span className={cn(check.state === "done" && "text-muted-foreground")}>
        {check.label}
      </span>
    </ItemTitle>
  </ItemContent>
);

const ReadinessCheckItem = ({
  plan,
  check,
  planningCenterUrl,
  onOpenPlanningCenter,
}: {
  plan: PlanRef;
  check: ReadinessCheck;
  planningCenterUrl: string | null;
  onOpenPlanningCenter: () => void;
}) => {
  if (check.id === "notifications" && isNonEmptyString(planningCenterUrl)) {
    return (
      <Item
        size="xs"
        render={
          <a
            href={planningCenterUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${check.label}. Send scheduling emails in Planning Center`}
            onClick={onOpenPlanningCenter}
          />
        }
      >
        <ReadinessCheckIcon state={check.state} />
        <ReadinessCheckTitle check={check} />
        <ExternalLink
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
      </Item>
    );
  }
  return (
    <Item
      size="xs"
      render={<Link {...viewLink(plan, check.view)} />}
      aria-label={`${check.label}. Open ${getPlanViewLabel(check.view)}`}
    >
      <ReadinessCheckIcon state={check.state} />
      <ReadinessCheckTitle check={check} />
      <ChevronRight
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
    </Item>
  );
};

const renderReadinessDescription = (
  checks: readonly ReadinessCheck[],
  isLoading: boolean,
  incomplete: boolean
): ReactNode => {
  if (incomplete) {
    return "Readiness could not be fully checked.";
  }
  if (checks.length === 0 && isLoading) {
    return <Skeleton variant="text" className="mt-0.5 h-3.5 w-48" />;
  }
  return describeReadiness(checks);
};

const ReadinessCard = ({
  plan,
  checks,
  isLoading,
  incomplete,
  planningCenterUrl,
  onOpenPlanningCenter,
}: {
  plan: PlanRef;
  checks: ReadinessCheck[];
  isLoading: boolean;
  incomplete: boolean;
  planningCenterUrl: string | null;
  onOpenPlanningCenter: () => void;
}) => (
  <Card size="sm" className="md:col-span-2">
    <CardHeader>
      <SectionTitle icon={<CircleCheck className="size-4" />}>
        Readiness
      </SectionTitle>
      <CardDescription>
        {renderReadinessDescription(checks, isLoading, incomplete)}
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {checks.map((check) => (
          <li key={check.id}>
            <ReadinessCheckItem
              plan={plan}
              check={check}
              planningCenterUrl={planningCenterUrl}
              onOpenPlanningCenter={onOpenPlanningCenter}
            />
          </li>
        ))}
        {isLoading
          ? Array.from({ length: 2 }, (_, index) => (
              <li key={`loading-${index}`}>
                <Skeleton variant="control" className="h-10" />
              </li>
            ))
          : null}
      </ul>
    </CardContent>
  </Card>
);

const share = (count: number, total: number) =>
  total === 0 ? "0%" : `${(count / total) * 100}%`;

type FilledBarStyle = CSSProperties & {
  "--confirmed-share": string;
  "--pending-share": string;
};

/** Confirmed, then pending, over an empty track for open slots. */
const FilledBar = ({
  confirmed,
  pending,
  total,
  className,
}: {
  confirmed: number;
  pending: number;
  total: number;
  className?: string;
}) => {
  const style: FilledBarStyle = {
    "--confirmed-share": share(confirmed, total),
    "--pending-share": share(pending, total),
  };
  return (
    <span
      aria-hidden
      className={cn("bg-muted flex overflow-hidden rounded-full", className)}
      style={style}
    >
      <span className="bg-status-confirmed h-full w-(--confirmed-share)" />
      <span className="bg-status-scheduled h-full w-(--pending-share)" />
    </span>
  );
};

const StaffingBar = ({ staffing }: { staffing: PlanStaffing }) => (
  <div className="flex flex-col gap-2">
    <FilledBar
      confirmed={staffing.confirmed}
      pending={staffing.pending}
      total={staffing.total}
      className="h-2"
    />
    <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
      <span className="flex items-center gap-1.5">
        <span className="bg-status-confirmed size-2 rounded-full" />
        {staffing.confirmed} confirmed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-status-scheduled size-2 rounded-full" />
        {staffing.pending} pending
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-muted-foreground/30 size-2 rounded-full" />
        {staffing.open} open
      </span>
    </p>
  </div>
);

const PeopleCard = ({
  plan,
  staffing,
  getSlotIntentProps,
}: {
  plan: PlanRef;
  staffing: PlanStaffing | null;
  getSlotIntentProps: GetIntentPrefetchProps<SlotRef>;
}) => (
  <Card size="sm" className="md:row-span-2">
    <CardHeader>
      <SectionTitle icon={<Users className="size-4" />}>People</SectionTitle>
      <CardDescription>
        {staffing === null ? (
          <Skeleton variant="text" className="mt-0.5 h-3.5 w-40" />
        ) : (
          `${staffing.confirmed + staffing.pending} of ${staffing.total} ${staffing.total === 1 ? "slot" : "slots"} filled`
        )}
      </CardDescription>
      <CardAction>
        <OpenViewLink plan={plan} view="lineup" />
      </CardAction>
    </CardHeader>
    <CardContent>
      {staffing === null ? (
        <RowsSkeleton rows={5} />
      ) : (
        <div className="flex flex-col gap-5">
          <StaffingBar staffing={staffing} />
          {staffing.openPositions.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h3 className="text-muted-foreground px-1 text-xs font-medium">
                Needs someone
              </h3>
              <ul className="flex flex-col">
                {staffing.openPositions.map((position) => {
                  const slot: SlotRef = {
                    teamId: position.teamId,
                    teamName: position.teamName,
                    positionId: position.positionId,
                    positionName: position.positionName,
                    source: position.source,
                  };
                  return (
                    <li key={`${position.teamId}:${position.positionId}`}>
                      <Item
                        size="row"
                        render={
                          <Link
                            {...planSlotLink({
                              ...plan,
                              view: "assign",
                              teamId: position.teamId,
                              positionId: position.positionId,
                            })}
                          />
                        }
                        aria-label={`Assign ${position.positionName} on ${position.teamName}`}
                        {...getSlotIntentProps(slot)}
                      >
                        <ItemContent className="min-w-0">
                          <ItemTitle className="min-w-0">
                            <span className="truncate">
                              {position.positionName}
                              <span className="text-muted-foreground font-normal">
                                {" "}
                                · {position.teamName}
                              </span>
                            </span>
                          </ItemTitle>
                        </ItemContent>
                        {position.openCount > 1 ? (
                          <Badge variant="outline">
                            {position.openCount} open
                          </Badge>
                        ) : null}
                        <ChevronRight
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden
                        />
                      </Item>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {staffing.teams.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h3 className="text-muted-foreground px-1 text-xs font-medium">
                Teams
              </h3>
              <ul className="flex flex-col">
                {staffing.teams.map((team) => {
                  const filled = team.confirmed + team.pending;
                  const total = filled + team.open;
                  return (
                    <li
                      key={team.teamId}
                      className="flex min-h-9 items-center gap-3 px-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {team.teamName}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {filled}/{total}
                      </span>
                      <FilledBar
                        confirmed={team.confirmed}
                        pending={team.pending}
                        total={total}
                        className="h-1.5 w-20 shrink-0"
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="text-muted-foreground text-sm">
              No positions are requested for this plan yet.
            </p>
          )}
        </div>
      )}
    </CardContent>
  </Card>
);

const describeOrder = (order: PlanOrder): string => {
  const length = formatDuration(order.serviceLength);
  const songs =
    order.songs.length === 1 ? "1 song" : `${order.songs.length} songs`;
  return length === null ? songs : `${songs} · ${length} service`;
};

const SongsCard = ({
  plan,
  order,
}: {
  plan: PlanRef;
  order: PlanOrder | null;
}) => (
  <Card size="sm">
    <CardHeader>
      <SectionTitle icon={<ListMusic className="size-4" />}>Songs</SectionTitle>
      <CardDescription>
        {order === null ? (
          <Skeleton variant="text" className="mt-0.5 h-3.5 w-32" />
        ) : (
          describeOrder(order)
        )}
      </CardDescription>
      <CardAction>
        <OpenViewLink plan={plan} view="plan" />
      </CardAction>
    </CardHeader>
    <CardContent>
      {order === null ? <RowsSkeleton rows={3} /> : null}
      {order !== null && order.songs.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No songs in the order of service yet.
        </p>
      ) : null}
      {order !== null && order.songs.length > 0 ? (
        <ol className="flex flex-col">
          {order.songs.map((song, index) => (
            <li
              key={song.id}
              className="flex min-h-9 items-center gap-3 px-1.5"
            >
              <span className="text-muted-foreground w-4 shrink-0 text-right text-xs tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {song.songId === null ? (
                  song.title
                ) : (
                  <SongLink
                    songId={song.songId}
                    arrangementId={song.arrangementId}
                  >
                    {song.title}
                  </SongLink>
                )}
              </span>
              {song.keyLabel === null ? (
                <span className="text-status-scheduled text-xs">No key</span>
              ) : (
                <Badge variant="outline">{song.keyLabel}</Badge>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </CardContent>
  </Card>
);

const timeTypeLabel: Record<PlanTime["timeType"], string> = {
  service: "Service",
  rehearsal: "Rehearsal",
  other: "Other",
};

const TimesCard = ({
  plan,
  schedule,
}: {
  plan: PlanRef;
  schedule: PlanSchedule | null;
}) => {
  const orgTimeZone = useOrganizationTimeZone();
  return (
    <Card size="sm">
      <CardHeader>
        <SectionTitle icon={<Clock3 className="size-4" />}>Times</SectionTitle>
        <CardDescription>
          {schedule === null ? (
            <Skeleton variant="text" className="mt-0.5 h-3.5 w-32" />
          ) : (
            `${schedule.times.length} ${schedule.times.length === 1 ? "time" : "times"}`
          )}
        </CardDescription>
        <CardAction>
          <OpenViewLink plan={plan} view="times" />
        </CardAction>
      </CardHeader>
      <CardContent>
        {schedule === null ? <RowsSkeleton rows={2} /> : null}
        {schedule !== null && schedule.times.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No times on this plan yet.
          </p>
        ) : null}
        {schedule !== null && schedule.times.length > 0 ? (
          <ul className="flex flex-col">
            {schedule.times.map((time) => (
              <li
                key={time.id}
                className="flex min-h-9 items-center gap-3 px-1.5"
              >
                <span className="min-w-0 flex-1 truncate tabular-nums">
                  {formatCalendarDateLabel(
                    time.startsAt,
                    orgTimeZone,
                    "weekdayMonthDay"
                  )}
                  <span className="text-muted-foreground">
                    {" · "}
                    {formatTimeOfDay(time.startsAt, orgTimeZone)}
                  </span>
                </span>
                <Badge
                  className="max-w-1/2"
                  variant={
                    time.timeType === "service" ? "secondary" : "outline"
                  }
                >
                  <span className="truncate">
                    {time.name.trim() === ""
                      ? timeTypeLabel[time.timeType]
                      : time.name}
                  </span>
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
};

interface PlanOverviewTabProps {
  serviceTypeId: string;
  planId: string;
  selectedPlan: Plan | null;
  teamPositionsQuery: ReadQueryState<TeamPositionGroup[]>;
  planTimesQuery: ReadQueryState<PlanTime[]>;
  getSlotIntentProps: GetIntentPrefetchProps<SlotRef>;
}

const overviewGridClassName =
  "pb-safe-4 grid grid-cols-1 gap-4 pt-1 md:grid-cols-2 md:pb-6";

/** A stand-in for handlers the loading overview never calls. */
const ignore = () => {
  // Nothing to prefetch or open while the plan loads.
};

const noIntent: GetIntentPrefetchProps<SlotRef> = () => ({
  onPointerEnter: ignore,
  onPointerLeave: ignore,
  onFocus: ignore,
  onBlur: ignore,
});

/** The overview's cards as they look before anything loads, for the route fallback. */
export const PlanOverviewSkeleton = ({ plan }: { plan: PlanRef }) => (
  <PageScrollArea>
    <div className={overviewGridClassName}>
      <ReadinessCard
        plan={plan}
        checks={buildReadinessChecks({
          staffing: null,
          order: null,
          schedule: null,
        })}
        isLoading
        incomplete={false}
        planningCenterUrl={null}
        onOpenPlanningCenter={ignore}
      />
      <PeopleCard plan={plan} staffing={null} getSlotIntentProps={noIntent} />
      <SongsCard plan={plan} order={null} />
      <TimesCard plan={plan} schedule={null} />
    </div>
  </PageScrollArea>
);

/** A plan's home: what's ready, what isn't, and a way into each view. */
export const PlanOverviewTab = ({
  serviceTypeId,
  planId,
  selectedPlan,
  teamPositionsQuery,
  planTimesQuery,
  getSlotIntentProps,
}: PlanOverviewTabProps) => {
  const plan: PlanRef = { serviceTypeId, planId };
  const armRosterRecheck = useRecheckRosterOnReturn({
    ...plan,
    seriesId: selectedPlan?.seriesId ?? null,
  });
  const planningCenterUrl = selectedPlan?.planningCenterUrl ?? null;
  const planItemsQuery = usePlanItems(serviceTypeId, planId);
  const { data: planItems } = planItemsQuery;
  const { data: teamPositionGroups } = teamPositionsQuery;
  const { data: planTimes } = planTimesQuery;

  const staffing =
    teamPositionGroups === undefined
      ? null
      : summarizeStaffing(teamPositionGroups);
  const order = planItems === undefined ? null : summarizeOrder(planItems);
  const schedule = planTimes === undefined ? null : summarizeTimes(planTimes);
  const checks = buildReadinessChecks({ staffing, order, schedule });
  const queries = [teamPositionsQuery, planItemsQuery, planTimesQuery];
  const isLoading = queries.some(
    (query) => query.data === undefined && query.error === null
  );
  const incomplete = queries.some((query) => query.error !== null);

  return (
    <PageScrollArea>
      <div className={overviewGridClassName}>
        <ReadinessCard
          plan={plan}
          checks={checks}
          isLoading={isLoading}
          incomplete={incomplete}
          planningCenterUrl={planningCenterUrl}
          onOpenPlanningCenter={armRosterRecheck}
        />
        <QueryDataBoundary
          query={teamPositionsQuery}
          title="Couldn't load people"
          className="md:row-span-2"
        >
          <PeopleCard
            plan={plan}
            staffing={staffing}
            getSlotIntentProps={getSlotIntentProps}
          />
        </QueryDataBoundary>
        <QueryDataBoundary query={planItemsQuery} title="Couldn't load songs">
          <SongsCard plan={plan} order={order} />
        </QueryDataBoundary>
        <QueryDataBoundary query={planTimesQuery} title="Couldn't load times">
          <TimesCard plan={plan} schedule={schedule} />
        </QueryDataBoundary>
        <PlanFilesBrowser
          key={`${serviceTypeId}:${planId}`}
          serviceTypeId={serviceTypeId}
          planId={planId}
          items={planItems ?? []}
        />
      </div>
    </PageScrollArea>
  );
};
