import { useParams } from "@tanstack/react-router";

import { PageShell } from "@/components/page-shell";
import { PracticeTabSkeleton } from "@/components/practice/practice-tab";
import { LineupTabSkeleton } from "@/components/schedule/lineup-tab";
import { PlanItemListSkeleton } from "@/components/schedule/plan-item-list";
import { PlanOverviewSkeleton } from "@/components/schedule/plan-overview-tab";
import type { PlanRef } from "@/components/schedule/plan-overview-tab";
import {
  CandidateListSkeleton,
  PlanHeaderSkeleton,
} from "@/components/schedule/schedule-skeletons";
import { TeamRosterSkeleton } from "@/components/schedule/team-roster";
import { TimesTabSkeleton } from "@/components/schedule/times-tab";
import { PlanAgendaSkeleton } from "@/components/service-plan-table-selector";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the services selector: your services, filters, then the plan agenda. */
export const SchedulePlansFallback = () => (
  <PageShell label="Loading services" busy>
    <section className="flex shrink-0 flex-col gap-2.5">
      <Skeleton variant="text" className="h-3 w-24" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-[5.25rem] w-full" />
        <Skeleton className="hidden h-[5.25rem] w-full sm:block" />
        <Skeleton className="hidden h-[5.25rem] w-full lg:block" />
      </div>
    </section>
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-2 gap-2 py-2 md:grid-cols-[minmax(0,1fr)_180px_160px] md:pt-0 md:pb-1">
        <Skeleton variant="round" className="col-span-2 h-9 md:col-span-1" />
        <Skeleton variant="round" className="h-9" />
        <Skeleton variant="round" className="h-9" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PlanAgendaSkeleton />
      </div>
    </div>
  </PageShell>
);

/** The plan builder: its header, then the run sheet. */
const AssignSkeleton = () => (
  <div className="flex min-h-0 w-full flex-1 flex-col gap-3 sm:gap-4 lg:flex-row">
    <aside className="hidden min-h-0 w-[min(22rem,34vw)] shrink-0 overflow-hidden lg:block">
      <TeamRosterSkeleton layout="stack" />
    </aside>
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 sm:gap-4">
      <div className="flex flex-col gap-2 px-1 sm:gap-3">
        <Skeleton variant="control" className="h-6 w-40 sm:h-7" />
        <Skeleton variant="round" className="h-8 w-full sm:max-w-sm" />
      </div>
      <CandidateListSkeleton />
    </section>
  </div>
);

/** Each view's own loading state, so the page doesn't change shape as it loads. */
const ViewSkeleton = ({
  view,
  plan,
}: {
  view: string | undefined;
  plan: PlanRef;
}) => {
  if (view === "plan") {
    return <PlanItemListSkeleton />;
  }
  if (view === "lineup") {
    return <LineupTabSkeleton />;
  }
  if (view === "times") {
    return <TimesTabSkeleton />;
  }
  if (view === "assign") {
    return <AssignSkeleton />;
  }
  if (view === "practice") {
    return <PracticeTabSkeleton />;
  }
  return <PlanOverviewSkeleton plan={plan} />;
};

/** The plan header, then the skeleton of the view being opened. */
export const SchedulePlanWorkspaceFallback = () => {
  const {
    serviceTypeId = "",
    planId = "",
    view,
  } = useParams({ strict: false });
  return (
    <PageShell layout="fill" label="Loading plan" busy>
      <PlanHeaderSkeleton />
      <div className="flex min-h-0 flex-1 flex-col">
        <ViewSkeleton view={view} plan={{ serviceTypeId, planId }} />
      </div>
    </PageShell>
  );
};
