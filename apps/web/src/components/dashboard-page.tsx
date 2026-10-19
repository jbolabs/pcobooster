import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import { formatPlanDate } from "@pcobooster/planning-center-models/service-plans";
import type { Plan } from "@pcobooster/planning-center-models/types";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PlanAccessNotice } from "@/components/access/access-notices";
import { MobileHeader } from "@/components/mobile-menu";
import { PageShell } from "@/components/page-shell";
import { MobilePlanViewTabs } from "@/components/plan-view-tabs";
import { PlanningCenterServicesIcon } from "@/components/planning-center-services-icon";
import { PracticeTab } from "@/components/practice/practice-tab";
import { QueryDataBoundary } from "@/components/query-data-boundary";
import { LineupTab } from "@/components/schedule/lineup-tab";
import { PlanOverviewTab } from "@/components/schedule/plan-overview-tab";
import { PlanTab } from "@/components/schedule/plan-tab";
import { PlanHeaderSkeleton } from "@/components/schedule/schedule-skeletons";
import { ScheduleViewTab } from "@/components/schedule/schedule-view-tab";
import { TimesTab } from "@/components/schedule/times-tab";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  HoverLabel,
} from "@/components/ui/hover-card";
import { Item } from "@/components/ui/item";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useDashboardController } from "@/hooks/use-dashboard-controller";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import {
  ADJACENT_PLANS_LIMIT,
  createAdjacentPlansQueryOptions,
} from "@/hooks/use-plans";
import { NEXT_PLAN_HOTKEY, PREVIOUS_PLAN_HOTKEY } from "@/lib/app-hotkeys";
import { queryKeys } from "@/lib/query-keys";
import type { DashboardView } from "@/lib/schedule-navigation";

const formatHeaderPlanDate = (
  date: Date | string | undefined,
  orgTimeZone: string
) => {
  if (date === undefined || date === "") {
    return "No date";
  }
  const dateObj = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dateObj.getTime())) {
    return "Invalid date";
  }

  return formatPlanDate(dateObj, orgTimeZone);
};

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const buildPlanSubtitle = (
  serviceTypeName: string,
  planTitle: string | undefined,
  seriesTitle: string | undefined
): string | null => {
  const rawSubtitle = (seriesTitle ?? planTitle ?? "").trim();
  if (!rawSubtitle) {
    return null;
  }

  const normalizedServiceTypeName = serviceTypeName.trim();
  if (!normalizedServiceTypeName) {
    return rawSubtitle;
  }

  if (
    rawSubtitle.localeCompare(normalizedServiceTypeName, undefined, {
      sensitivity: "accent",
    }) === 0
  ) {
    return null;
  }

  const serviceTypePrefixPattern = new RegExp(
    `^${escapeRegExp(normalizedServiceTypeName)}\\s*[-:|]\\s*`,
    "iu"
  );

  const withoutServiceTypePrefix = rawSubtitle
    .replace(serviceTypePrefixPattern, "")
    .trim();
  if (!withoutServiceTypePrefix) {
    return null;
  }

  if (
    withoutServiceTypePrefix.localeCompare(
      normalizedServiceTypeName,
      undefined,
      {
        sensitivity: "accent",
      }
    ) === 0
  ) {
    return null;
  }

  return withoutServiceTypePrefix;
};

const handleScheduleError = (message: string) => {
  toast.error(message);
};

const WorkspaceUnavailable = () => (
  <PageShell layout="center">
    <h1 className="text-xl font-semibold">Plan unavailable</h1>
    <p className="text-muted-foreground text-sm">
      This plan could not be loaded. Choose a plan from Services.
    </p>
    <Link to="/services" className={buttonVariants()}>
      Go to Services
    </Link>
  </PageShell>
);

const PlanningCenterLink = ({ href }: { href: string }) => (
  <HoverLabel
    label="Open in Planning Center"
    side="bottom"
    align="end"
    sideOffset={8}
    render={
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label="Open in Planning Center"
        data-tour="open-in-planning-center"
        className={buttonVariants({
          variant: "outline",
          size: "icon-sm",
          className: "shrink-0 max-md:size-9 max-md:rounded-full",
        })}
      />
    }
  >
    <PlanningCenterServicesIcon className="size-4" />
  </HoverLabel>
);

const servicesBackClassName = buttonVariants({
  variant: "ghost",
  size: "icon-lg",
  className: "-ml-2",
});

/** Phones go up one level: from a position to the position list, then to Services. */
const MobilePlanBack = ({ onBack }: { onBack: (() => void) | null }) =>
  onBack ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label="Back to lineup"
      className="-ml-2"
      onClick={onBack}
    >
      <ChevronLeft className="size-6" aria-hidden />
    </Button>
  ) : (
    <Link
      to="/services"
      aria-label="Back to services"
      className={servicesBackClassName}
    >
      <ChevronLeft className="size-6" aria-hidden />
    </Link>
  );

type PlanDirection = "previous" | "next";

interface PlanNeighbors {
  serviceTypeId: string;
  serviceTypeName: string;
  planId: string;
  view: DashboardView;
  /** Listed plans on each side, nearest first; short where the loaded list ends. */
  previousPlans: readonly Plan[];
  nextPlans: readonly Plan[];
}

const PLAN_STEP_LABELS = {
  previous: "Previous plan",
  next: "Next plan",
} as const;

const listedPlansOn = (neighbors: PlanNeighbors, direction: PlanDirection) =>
  direction === "previous" ? neighbors.previousPlans : neighbors.nextPlans;

/**
 * Steps to the plan before or after this one on the same view. Listed neighbors are
 * links; past the loaded list, one lookup finds the neighbor when someone asks for it.
 */
const usePlanStepper = (neighbors: PlanNeighbors) => {
  const { serviceTypeId, planId, view } = neighbors;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [ends, setEnds] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<PlanDirection | null>(null);
  const endKey = (direction: PlanDirection) => `${planId}:${direction}`;

  // A plan in hand already has its header details, so its page needn't fetch them.
  const seedPlanDetails = (plan: Plan) => {
    queryClient.setQueryData(
      queryKeys.planDetails(serviceTypeId, plan.id),
      plan
    );
  };

  const openPlan = (plan: Plan) => {
    seedPlanDetails(plan);
    void navigate({
      to: "/services/$serviceTypeId/plans/$planId/$view",
      params: { serviceTypeId, planId: plan.id, view },
    });
  };

  const step = async (direction: PlanDirection) => {
    const [nearest] = listedPlansOn(neighbors, direction);
    if (nearest !== undefined) {
      openPlan(nearest);
      return;
    }
    if (ends.has(endKey(direction)) || pending !== null) {
      return;
    }
    setPending(direction);
    let plans: Plan[];
    try {
      plans = await queryClient.query(
        createAdjacentPlansQueryOptions(serviceTypeId, planId, direction)
      );
    } catch {
      setPending(null);
      toast.error("Couldn't load that plan.");
      return;
    }
    setPending(null);
    const [plan] = plans;
    if (plan === undefined) {
      setEnds((current) => new Set(current).add(endKey(direction)));
      toast(`No ${direction === "previous" ? "earlier" : "later"} plan`);
      return;
    }
    openPlan(plan);
  };

  const onRequest = (direction: PlanDirection) => () => {
    void step(direction);
  };
  useHotkey(PREVIOUS_PLAN_HOTKEY, onRequest("previous"), {
    ignoreInputs: true,
  });
  useHotkey(NEXT_PLAN_HOTKEY, onRequest("next"), { ignoreInputs: true });

  return {
    isEnd: (direction: PlanDirection) => ends.has(endKey(direction)),
    pending,
    onRequest,
    seedPlanDetails,
  };
};

type PlanStepper = ReturnType<typeof usePlanStepper>;

const planListSkeletonKeys = ["a", "b", "c", "d"];

/**
 * The plans on one side of the open plan. The loaded list covers the upcoming weeks; where
 * it runs out on that side, the rest are looked up once the list opens.
 */
const PlanNeighborList = ({
  direction,
  neighbors,
  open,
  onOpenPlan,
}: {
  direction: PlanDirection;
  neighbors: PlanNeighbors;
  /** False while the list animates out, when the next plan may already be open. */
  open: boolean;
  onOpenPlan: (plan: Plan) => void;
}) => {
  const orgTimeZone = useOrganizationTimeZone();
  const listed = listedPlansOn(neighbors, direction);
  const needsLookup = listed.length < ADJACENT_PLANS_LIMIT;
  const lookup = useQuery({
    ...createAdjacentPlansQueryOptions(
      neighbors.serviceTypeId,
      neighbors.planId,
      direction
    ),
    enabled: needsLookup && open,
  });
  const plans = needsLookup ? (lookup.data ?? listed) : listed;
  const loadingCount =
    needsLookup && lookup.isPending ? ADJACENT_PLANS_LIMIT - listed.length : 0;
  const side = direction === "previous" ? "earlier" : "later";

  return (
    // Rows bring their own padding, so the list reaches into the panel's.
    <div className="-m-1.5 flex flex-col gap-0.5">
      {plans.map((plan) => {
        const subtitle = buildPlanSubtitle(
          neighbors.serviceTypeName,
          plan.title,
          plan.seriesTitle
        );
        return (
          <Item
            key={plan.id}
            size="row"
            className="flex-col items-start justify-center gap-0"
            render={
              <Link
                to="/services/$serviceTypeId/plans/$planId/$view"
                params={{
                  serviceTypeId: neighbors.serviceTypeId,
                  planId: plan.id,
                  view: neighbors.view,
                }}
                onClick={() => {
                  onOpenPlan(plan);
                }}
              />
            }
          >
            <span className="text-sm font-medium tabular-nums">
              {formatHeaderPlanDate(plan.sortDate, orgTimeZone)}
            </span>
            {isNonEmptyString(subtitle) ? (
              <span className="text-muted-foreground w-full truncate text-xs">
                {subtitle}
              </span>
            ) : null}
          </Item>
        );
      })}
      {planListSkeletonKeys.slice(0, loadingCount).map((key) => (
        <div
          key={key}
          className="flex min-h-10 flex-col justify-center gap-1.5 px-1.5"
        >
          <Skeleton variant="text" className="h-3.5 w-32" />
          <Skeleton variant="text" className="h-3 w-24" />
        </div>
      ))}
      {plans.length === 0 && loadingCount === 0 ? (
        <p className="text-muted-foreground px-1.5 py-2 text-sm">
          {lookup.isError ? "Couldn't load plans." : `No ${side} plans`}
        </p>
      ) : null}
    </div>
  );
};

/** Clicking steps one plan; hovering or right-clicking lists the next few on that side. */
const PlanStepButton = ({
  direction,
  neighbors,
  stepper,
}: {
  direction: PlanDirection;
  neighbors: PlanNeighbors;
  stepper: PlanStepper;
}) => {
  const [open, setOpen] = useState(false);
  const orgTimeZone = useOrganizationTimeZone();
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const label = PLAN_STEP_LABELS[direction];
  const [nearest] = listedPlansOn(neighbors, direction);
  const isEnd = stepper.isEnd(direction);
  const trigger =
    nearest === undefined ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={isEnd || stepper.pending !== null}
        aria-busy={stepper.pending === direction}
        aria-label={isEnd ? `No ${label.toLowerCase()}` : label}
        onClick={stepper.onRequest(direction)}
      />
    ) : (
      <Link
        to="/services/$serviceTypeId/plans/$planId/$view"
        params={{
          serviceTypeId: neighbors.serviceTypeId,
          planId: nearest.id,
          view: neighbors.view,
        }}
        aria-label={`${label}, ${formatHeaderPlanDate(nearest.sortDate, orgTimeZone)}`}
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
      />
    );

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        render={trigger}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {stepper.pending === direction ? (
          <Spinner />
        ) : (
          <Icon className="size-4" />
        )}
      </HoverCardTrigger>
      <HoverCardContent
        variant="panel"
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-64"
      >
        <PlanNeighborList
          direction={direction}
          neighbors={neighbors}
          open={open}
          onOpenPlan={(plan) => {
            stepper.seedPlanDetails(plan);
            setOpen(false);
          }}
        />
      </HoverCardContent>
    </HoverCard>
  );
};

const DashboardPlanHeader = ({
  serviceTypeName,
  planSubtitle,
  sortDate,
  planningCenterUrl,
  onBack,
  neighbors,
  stepper,
}: {
  serviceTypeName: string;
  planSubtitle: string | null;
  sortDate: Date | string | undefined;
  planningCenterUrl: string | null | undefined;
  onBack: (() => void) | null;
  neighbors: PlanNeighbors;
  stepper: PlanStepper;
}) => {
  const orgTimeZone = useOrganizationTimeZone();
  const planDate = formatHeaderPlanDate(sortDate, orgTimeZone);
  return (
    <>
      <MobileHeader className="-mx-4" subbar={<MobilePlanViewTabs />}>
        <MobilePlanBack onBack={onBack} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="min-w-0 text-base leading-tight font-semibold tracking-tight">
            <MiddleTruncate
              text={
                isNonEmptyString(planSubtitle) ? planSubtitle : serviceTypeName
              }
            />
          </h1>
          <p className="text-muted-foreground truncate text-xs tabular-nums">
            {planDate}
            {isNonEmptyString(planSubtitle) ? ` · ${serviceTypeName}` : null}
          </p>
        </div>
        {isNonEmptyString(planningCenterUrl) ? (
          <PlanningCenterLink href={planningCenterUrl} />
        ) : null}
      </MobileHeader>
      <header className="mb-3 shrink-0 max-md:hidden sm:mb-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Long service types and titles truncate; the date always shows. */}
            <h1 className="flex min-w-0 text-xl leading-tight font-semibold tracking-tight md:text-2xl">
              <span className="truncate">
                {serviceTypeName}
                {isNonEmptyString(planSubtitle) ? (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    / {planSubtitle}
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground shrink-0 font-light whitespace-pre tabular-nums">
                {" "}
                / {planDate}
              </span>
            </h1>
            <div
              data-tour="plan-stepper"
              className="flex shrink-0 items-center"
            >
              <PlanStepButton
                direction="previous"
                neighbors={neighbors}
                stepper={stepper}
              />
              <PlanStepButton
                direction="next"
                neighbors={neighbors}
                stepper={stepper}
              />
            </div>
          </div>
          {isNonEmptyString(planningCenterUrl) ? (
            <PlanningCenterLink href={planningCenterUrl} />
          ) : null}
        </div>
      </header>
    </>
  );
};

const DashboardPlanHeaderFallback = () => (
  <>
    <MobileHeader className="-mx-4" subbar={<MobilePlanViewTabs />}>
      <MobilePlanBack onBack={null} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton variant="text" className="h-4 w-40" />
        <Skeleton variant="text" className="h-3 w-28" />
      </div>
    </MobileHeader>
    <div className="max-md:hidden">
      <PlanHeaderSkeleton />
    </div>
  </>
);

type DashboardController = ReturnType<typeof useDashboardController>;

const DashboardPlanHeaderSlot = ({
  serviceType,
  plan,
  onBack,
  neighbors,
}: {
  serviceType: DashboardController["selectedServiceType"];
  plan: DashboardController["selectedPlan"];
  onBack: (() => void) | null;
  neighbors: PlanNeighbors;
}) => {
  const stepper = usePlanStepper(neighbors);
  if (!serviceType || !plan) {
    return <DashboardPlanHeaderFallback />;
  }
  return (
    <DashboardPlanHeader
      serviceTypeName={serviceType.name}
      planSubtitle={buildPlanSubtitle(
        serviceType.name,
        plan.title,
        plan.seriesTitle
      )}
      sortDate={plan.sortDate}
      planningCenterUrl={plan.planningCenterUrl}
      onBack={onBack}
      neighbors={neighbors}
      stepper={stepper}
    />
  );
};

export const DashboardPage = ({
  serviceTypeId,
  planId,
  view,
}: {
  serviceTypeId: string;
  planId: string;
  view: DashboardView;
}) => {
  const {
    workspaceUnavailable,
    workspaceFailedQuery,
    hasPlanUrlSelection,
    hasSelectedPlanMetadata,
    selectedServiceType,
    selectedPlan,
    previousPlans,
    nextPlans,
    activeView,
    teamPositionsQuery,
    planTimesQuery,
    teamPositionsLoading,
    teamPositionGroups,
    collapsedTeams,
    selectedTeam,
    selectedPosition,
    selectedPositionUsesRoster,
    candidateList,
    routeServiceTypeId,
    routePlanId,
    toggleTeamCollapsed,
    handleSlotSelect,
    handleSlotClear,
    getSlotIntentProps,
    handleAddCustomPosition,
    planTimes,
  } = useDashboardController({ serviceTypeId, planId, view });
  const planReferenceDate = selectedPlan?.sortDate ?? null;
  if (workspaceFailedQuery !== undefined) {
    return (
      <PageShell layout="center">
        <QueryDataBoundary
          query={workspaceFailedQuery}
          title="Couldn't load this plan"
        >
          {null}
        </QueryDataBoundary>
      </PageShell>
    );
  }
  if (workspaceUnavailable) {
    return <WorkspaceUnavailable />;
  }

  return (
    <PageShell layout="fill">
      <DashboardPlanHeaderSlot
        serviceType={hasSelectedPlanMetadata ? selectedServiceType : null}
        plan={hasSelectedPlanMetadata ? selectedPlan : null}
        onBack={
          activeView === "assign" && isNonEmptyString(selectedPosition)
            ? handleSlotClear
            : null
        }
        neighbors={{
          serviceTypeId: routeServiceTypeId,
          serviceTypeName: selectedServiceType?.name ?? "",
          planId: routePlanId,
          view: activeView,
          previousPlans,
          nextPlans,
        }}
      />

      {hasPlanUrlSelection ? (
        <PlanAccessNotice
          serviceTypeId={routeServiceTypeId}
          view={activeView}
        />
      ) : null}

      {hasPlanUrlSelection ? (
        <Tabs value={activeView} className="flex min-h-0 flex-1 flex-col">
          <TabsContent
            value="overview"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            <PlanOverviewTab
              serviceTypeId={routeServiceTypeId}
              planId={routePlanId}
              selectedPlan={selectedPlan}
              teamPositionsQuery={teamPositionsQuery}
              planTimesQuery={planTimesQuery}
              getSlotIntentProps={getSlotIntentProps}
            />
          </TabsContent>

          <TabsContent
            value="assign"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            <QueryDataBoundary
              query={teamPositionsQuery}
              title="Couldn't load people"
              className="min-h-0 flex-1"
            >
              <ScheduleViewTab
                teamPositionsLoading={teamPositionsLoading}
                teamPositionGroups={teamPositionGroups}
                collapsedTeams={collapsedTeams}
                selectedTeam={selectedTeam}
                selectedPosition={selectedPosition}
                candidateList={
                  selectedPositionUsesRoster ? candidateList : null
                }
                selectedServiceTypeId={routeServiceTypeId}
                selectedPlanId={routePlanId}
                planReferenceDate={planReferenceDate}
                onToggleTeam={toggleTeamCollapsed}
                onSelectSlot={handleSlotSelect}
                onClearSlot={handleSlotClear}
                getSlotIntentProps={getSlotIntentProps}
                onAddPosition={handleAddCustomPosition}
                onScheduleError={handleScheduleError}
              />
            </QueryDataBoundary>
          </TabsContent>

          <TabsContent
            value="lineup"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            <QueryDataBoundary
              query={teamPositionsQuery}
              title="Couldn't load people"
              className="min-h-0 flex-1"
            >
              <LineupTab
                groups={teamPositionGroups ?? []}
                isLoading={teamPositionsLoading}
                serviceTypeId={routeServiceTypeId}
                planId={routePlanId}
                seriesId={selectedPlan?.seriesId ?? null}
                planTimes={planTimes ?? []}
                collapsedTeams={collapsedTeams}
                onToggleTeam={toggleTeamCollapsed}
                onSelectPosition={handleSlotSelect}
                getSlotIntentProps={getSlotIntentProps}
                onAddPosition={handleAddCustomPosition}
              />
            </QueryDataBoundary>
          </TabsContent>

          <TabsContent
            value="plan"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            <PlanTab
              serviceTypeId={routeServiceTypeId}
              planId={routePlanId}
              planDate={planReferenceDate}
            />
          </TabsContent>

          <TabsContent
            value="times"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            <TimesTab
              serviceTypeId={routeServiceTypeId}
              planId={routePlanId}
              seriesId={selectedPlan?.seriesId ?? null}
            />
          </TabsContent>

          <TabsContent
            value="practice"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            <PracticeTab
              serviceTypeId={routeServiceTypeId}
              planId={routePlanId}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
          <span>No plan selected · use Services to choose one.</span>
        </div>
      )}
    </PageShell>
  );
};
