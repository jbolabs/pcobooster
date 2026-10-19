import { Link } from "@tanstack/react-router";

import { planViewIcons } from "@/components/plan-view-icons";
import { SidebarNavIcon } from "@/components/sidebar-nav-icon";
import { usePlanRoute } from "@/hooks/use-plan-route";
import { useEnabledPlanViews } from "@/hooks/use-plan-views";
import {
  getPlanViewLabel,
  phonePlanViews,
  phonePlanViewTab,
} from "@/lib/app-routes";
import { cn } from "@/lib/utils";

/**
 * The phone's plan view switcher: one even row of icon-over-label tabs pinned
 * under the plan header, so every view is a single tap away. Assign has no tab:
 * it opens from a Lineup position and keeps Lineup selected.
 */
export const MobilePlanViewTabs = () => {
  const planRoute = usePlanRoute();
  const views = useEnabledPlanViews(phonePlanViews);
  if (planRoute === null) {
    return null;
  }
  const activeTab = phonePlanViewTab(planRoute.view);
  return (
    <nav
      aria-label="Plan views"
      className="bg-background border-border/50 grid auto-cols-fr grid-flow-col border-b px-2"
    >
      {views.map((view) => {
        const active = activeTab === view;
        return (
          <Link
            key={view}
            to="/services/$serviceTypeId/plans/$planId/$view"
            params={{ ...planRoute, view }}
            // Keeps the selected slot across views.
            search
            replace
            aria-current={active ? "page" : undefined}
            data-tour={`plan-view-${view}`}
            className={cn(
              "focus-visible:ring-ring/50 relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-md text-xs font-medium outline-none select-none focus-visible:ring-2",
              active ? "text-foreground" : "text-muted-foreground"
            )}
          >
            <SidebarNavIcon icon={planViewIcons[view]} className="size-5" />
            {getPlanViewLabel(view)}
            {active ? (
              <span
                aria-hidden
                className="bg-foreground absolute inset-x-3 -bottom-px h-0.5 rounded-full"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
};
