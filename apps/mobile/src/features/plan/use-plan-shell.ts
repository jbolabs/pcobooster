import type { TeamPositionGroup } from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActionSheetIOS, AppState, Linking, Settings } from "react-native";

import {
  failureMessage,
  sharedReads,
  useProductClient,
} from "../../app-shell/queries";
import { useNavigationPath } from "../../app-shell/use-navigation-path";
import { useVisibleQuery as useQuery } from "../../app-shell/visible-queries";
import { playHaptic } from "../../design/haptics";
import { useClock, useOrgTimeZone } from "../../lib/environment";
import { useToasts } from "../../lib/toasts";
import { rosterAccess } from "./access";
import { listedNeighbors, planHeader } from "./header";
import {
  COLLAPSED_TEAMS_KEY,
  collapsedTeams,
  decodeCollapsedTeams,
  setCollapsedTeams,
} from "./preferences";
import { planHref, planReads, routeSegment, segmentLabels } from "./reads";
import type { PlanSegment } from "./reads";
import { refreshPlanReads } from "./refresh";

export const usePlanShell = () => {
  const params = useLocalSearchParams<{
    "service-type-id": string;
    "plan-id": string;
    segment?: string;
    tab?: string;
  }>();
  const serviceTypeId = params["service-type-id"];
  const planId = params["plan-id"];
  const baseIds = useMemo(
    () => ({ serviceTypeId, planId }),
    [serviceTypeId, planId]
  );
  const segment = routeSegment(params.tab ?? params.segment);
  const [refreshing, setRefreshing] = useState(false);
  const [savedCollapsed, setSavedCollapsed] = useState(() =>
    decodeCollapsedTeams(Settings.get(COLLAPSED_TEAMS_KEY))
  );
  const collapsed = collapsedTeams(savedCollapsed, planId);
  const setCollapsed = (teams: ReadonlySet<string>) => {
    setSavedCollapsed((previous) => {
      const next = setCollapsedTeams(previous, planId, teams);
      Settings.set({ [COLLAPSED_TEAMS_KEY]: next });
      return next;
    });
  };
  const context = useProductClient();
  const cache = useQueryClient();
  const plan = useQuery(planReads.plan(context, baseIds));
  const ids = useMemo(
    () => ({ ...baseIds, seriesId: plan.data?.seriesId ?? undefined }),
    [baseIds, plan.data?.seriesId]
  );
  const types = useQuery(planReads.serviceTypes(context));
  const plans = useQuery(planReads.plans(context, serviceTypeId));
  const access = useQuery(planReads.access(context));
  const zone = useOrgTimeZone();
  const clock = useClock();
  const router = useRouter();
  const navigationPath = useNavigationPath();
  const toasts = useToasts();
  const recheckOnReturn = useRef(false);
  const header = planHeader(
    plan.data,
    types.data?.find((type) => type.id === serviceTypeId)?.name ?? "",
    zone,
    clock.now()
  );
  const accounts = useQuery(sharedReads.accounts(context));
  const scheduling = rosterAccess(
    access.data,
    serviceTypeId,
    accounts.data?.demo ?? false
  );
  const { canSchedule, notice } = scheduling;

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active" && recheckOnReturn.current) {
        recheckOnReturn.current = false;
        void cache.invalidateQueries({
          queryKey: planReads.groups(context, ids).queryKey,
        });
      }
    });
    return () => {
      listener.remove();
    };
  }, [cache, context, ids]);

  const handleSend =
    plan.data?.planningCenterUrl === undefined
      ? undefined
      : () => {
          recheckOnReturn.current = true;
          void (async () => {
            try {
              await Linking.openURL(plan.data?.planningCenterUrl ?? "");
            } catch {
              toasts.showError("Couldn't open Planning Center.");
            }
          })();
        };
  const handleStep = (direction: "previous" | "next") => {
    void (async () => {
      try {
        const listed = listedNeighbors(plans.data ?? [], planId, direction);
        const input = { ...ids, direction };
        const found =
          listed.length > 0
            ? listed
            : await context.client.run((api) =>
                api.catalog.adjacentPlans({ params: input, query: input })
              );
        const [neighbor] = found;
        if (neighbor === undefined) {
          return;
        }
        cache.setQueryData(
          planReads.plan(context, { ...ids, planId: neighbor.id }).queryKey,
          neighbor
        );
        router.replace(
          navigationPath(planHref({ ...ids, planId: neighbor.id }, segment))
        );
      } catch (error) {
        toasts.showError("Couldn't load that plan.", {
          detail:
            error instanceof Error
              ? failureMessage(error)
              : "Something went wrong.",
        });
      }
    })();
  };
  const handleTitleMenu = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: header.title,
        message: header.subtitle,
        options: ["Cancel", "Previous plan", "Next plan", "All services"],
        cancelButtonIndex: 0,
      },
      (index) => {
        if (index === 1) {
          handleStep("previous");
        }
        if (index === 2) {
          handleStep("next");
        }
        if (index === 3) {
          router.dismissTo("/services");
        }
      }
    );
  };
  const handleCollapse = () => {
    const groups =
      cache.getQueryData<TeamPositionGroup[]>(
        planReads.groups(context, ids).queryKey
      ) ?? [];
    setCollapsed(new Set(groups.map((group) => group.teamId)));
  };
  const handleToggle = (teamId: string) => {
    const next = new Set(collapsed);
    if (next.has(teamId)) {
      next.delete(teamId);
    } else {
      next.add(teamId);
    }
    setCollapsed(next);
  };
  const handleRefresh = () => {
    setRefreshing(true);
    void (async () => {
      try {
        await refreshPlanReads([
          async () => await plan.refetch(),
          async () => {
            await cache.invalidateQueries(
              {
                queryKey: planReads.groups(context, ids).queryKey,
              },
              { throwOnError: true }
            );
          },
          async () => {
            await cache.invalidateQueries(
              {
                queryKey: planReads.items(context, ids).queryKey,
              },
              { throwOnError: true }
            );
          },
          async () => {
            await cache.invalidateQueries(
              {
                queryKey: planReads.times(context, ids).queryKey,
              },
              { throwOnError: true }
            );
          },
        ]);
      } catch (error) {
        toasts.showError("Couldn't refresh this plan.", {
          detail:
            error instanceof Error
              ? failureMessage(error)
              : "Something went wrong.",
        });
      }
      setRefreshing(false);
    })();
  };
  const handleSegment = (next: PlanSegment) => {
    playHaptic("selection");
    router.setParams({ tab: segmentLabels[next].toLowerCase() });
  };
  return {
    ids,
    header,
    plan,
    segment,
    collapsed,
    canSchedule,
    notice,
    refreshing,
    handleRefresh,
    handleSend,
    handleStep,
    handleTitleMenu,
    handleCollapse,
    handleExpand: () => {
      setCollapsed(new Set());
    },
    handleToggle,
    handleSegment,
  };
};
