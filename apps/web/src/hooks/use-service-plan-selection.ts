import { callForQuery, speculativeQuery } from "@pcobooster/client/query";
import { formatCalendarDayInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { ServicePlanRow } from "@pcobooster/planning-center-models/service-plans";
import {
  buildServicePlanRows,
  formatPlanDate,
} from "@pcobooster/planning-center-models/service-plans";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useMemo, useState } from "react";

import { useBrowserStorage } from "@/hooks/use-browser-storage";
import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { useMyScheduledServices } from "@/hooks/use-my-scheduled-services";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { createPlanItemsQueryOptions } from "@/hooks/use-plan-items";
import { createPlanTimesQueryOptions } from "@/hooks/use-plan-times";
import { useServiceTypes } from "@/hooks/use-service-types";
import { createTeamPositionsQueryOptions } from "@/hooks/use-team-positions";
import { isQueryFresh } from "@/lib/intent-prefetch";
import { queryKeys } from "@/lib/query-keys";
import { planWorkspaceLink } from "@/lib/schedule-navigation";
import type { ServicePlanTableSelectorProps } from "@/lib/service-plan-selection";
import {
  readStoredServiceTypeIds,
  SERVICE_TYPE_FILTER_STORAGE_KEY,
  servicePlanWindows,
} from "@/lib/service-plan-selection";
import { productClient } from "@/product-client";

/** The positions, items, and times a plan's Overview is built from. */
const overviewQueryOptions = (row: ServicePlanRow) => ({
  teamPositions: createTeamPositionsQueryOptions(
    row.serviceTypeId,
    row.planId,
    row.seriesId
  ),
  planItems: createPlanItemsQueryOptions(row.serviceTypeId, row.planId),
  planTimes: createPlanTimesQueryOptions(row.serviceTypeId, row.planId),
});

export const useServicePlanSelection = ({
  selectedServiceTypeId,
  onSelect,
}: ServicePlanTableSelectorProps) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const orgTimeZone = useOrganizationTimeZone();
  const serviceTypesQuery = useServiceTypes();
  const { data: serviceTypes, isLoading: serviceTypesLoading } =
    serviceTypesQuery;
  // Personal cards read their own assignments; the main agenda keeps its bounded windows.
  const myScheduledPlansQuery = useMyScheduledServices();
  const { rows: scheduledRows, isLoading: myScheduledPlansLoading } =
    myScheduledPlansQuery;
  const [searchValue, setSearchValue] = useState("");
  const deferredSearchValue = useDeferredValue(searchValue);
  const [storedIds, setStoredIds] = useBrowserStorage(
    SERVICE_TYPE_FILTER_STORAGE_KEY
  );
  const selectedServiceTypeIds = useMemo(
    () => readStoredServiceTypeIds(storedIds),
    [storedIds]
  );
  const setSelectedServiceTypeIds = useCallback(
    (ids: string[]) => {
      setStoredIds(JSON.stringify(ids));
    },
    [setStoredIds]
  );
  const [windows, setWindows] = useState(() => ({
    anchor: new Date(),
    future: 1,
    history: 0,
  }));
  const { anchor, future: futureWindows, history: historyWindows } = windows;
  const todayKey = formatCalendarDayInTimeZone(anchor, orgTimeZone);
  const requestedWindows = servicePlanWindows(
    todayKey,
    historyWindows,
    futureWindows
  );
  const startDays = requestedWindows.map((window) => window.startDay);

  const allServiceTypeIds = useMemo(
    () => (serviceTypes ?? []).map((serviceType) => serviceType.id),
    [serviceTypes]
  );
  const validServiceTypeIdSet = useMemo(
    () => new Set(allServiceTypeIds),
    [allServiceTypeIds]
  );
  const effectiveSelectedServiceTypeIds = useMemo(() => {
    if (isNonEmptyString(selectedServiceTypeId)) {
      return validServiceTypeIdSet.has(selectedServiceTypeId)
        ? [selectedServiceTypeId]
        : [];
    }

    if (selectedServiceTypeIds === null) {
      return allServiceTypeIds;
    }

    return selectedServiceTypeIds.filter((id) => validServiceTypeIdSet.has(id));
  }, [
    allServiceTypeIds,
    selectedServiceTypeId,
    selectedServiceTypeIds,
    validServiceTypeIdSet,
  ]);

  const selectedServiceTypeIdSet = useMemo(
    () => new Set(effectiveSelectedServiceTypeIds),
    [effectiveSelectedServiceTypeIds]
  );

  const selectedTypes = (serviceTypes ?? []).filter((type) =>
    selectedServiceTypeIdSet.has(type.id)
  );
  const planQueryOptions = requestedWindows.flatMap(({ startDay, days }) =>
    selectedTypes.map((serviceType) => ({
      queryKey: queryKeys.planWindow(serviceType.id, startDay, days),
      queryFn: async (context: QueryFunctionContext) =>
        await callForQuery(context, productClient, (api) =>
          api.catalog.planWindow({
            params: { serviceTypeId: serviceType.id },
            query: { startDay, days },
          })
        ),
      staleTime: 5 * 60 * 1000,
    }))
  );
  const planQueries = useQueries({ queries: planQueryOptions });
  // Reveal a window together, so service types cannot shuffle rows under the pointer.
  const completeWindows = new Set(
    startDays.filter((_day, windowIndex) =>
      selectedTypes.every(
        (_type, typeIndex) =>
          planQueries[windowIndex * selectedTypes.length + typeIndex]?.data !==
          undefined
      )
    )
  );
  const rows = buildServicePlanRows(
    selectedTypes,
    (_type, typeIndex) =>
      startDays.flatMap((startDay, windowIndex) =>
        completeWindows.has(startDay)
          ? (planQueries[windowIndex * selectedTypes.length + typeIndex]
              ?.data ?? [])
          : []
      ),
    selectedServiceTypeIdSet
  );
  const lastWindowQueries = planQueries.slice(-selectedTypes.length);
  const canAutoLoadMore =
    deferredSearchValue.trim() === "" &&
    selectedTypes.length > 0 &&
    lastWindowQueries.every(
      (query) => query.data !== undefined && !query.isError
    ) &&
    lastWindowQueries.some((query) => (query.data?.length ?? 0) > 0);
  const loadLaterWeeks = useCallback(() => {
    setWindows((current) => ({ ...current, future: current.future + 1 }));
  }, [setWindows]);
  const loadEarlierWeeks = useCallback(() => {
    setWindows((current) => ({ ...current, history: current.history + 1 }));
  }, [setWindows]);

  const myScheduledPlanIdSet = useMemo(
    () => new Set(scheduledRows.map((row) => row.planId)),
    [scheduledRows]
  );

  const plansLoading = planQueries.some((query) => query.isLoading);
  const failedQueries = [
    { title: "Couldn't load service types", query: serviceTypesQuery },
    { title: "Couldn't load your services", query: myScheduledPlansQuery },
    ...planQueries.map((query, index) => ({
      title: `Couldn't load ${selectedTypes[index % selectedTypes.length]?.name ?? "service"} plans for ${startDays[Math.floor(index / selectedTypes.length)]}`,
      query,
    })),
  ].filter(({ query }) => query.error !== null);
  const errorMessage = failedQueries[0]?.query.error ?? undefined;
  // Service types answer at different times, and each one's plans interleave by date, so
  // showing rows as they arrive reshuffles the list under the pointer. The page stays on its
  // skeleton until every selected service type and the "Your services" lookup have answered,
  // then shows them together. Later, a service type added to the filter keeps the current rows
  // on screen, with the loading bar, until its plans arrive.
  const everythingLoaded =
    !serviceTypesLoading && !plansLoading && !myScheduledPlansLoading;
  const [hasLoaded, setHasLoaded] = useState(everythingLoaded);
  if (everythingLoaded && !hasLoaded) {
    setHasLoaded(true);
  }
  const isInitialLoading = !hasLoaded;
  const isRefreshing = hasLoaded && plansLoading;

  const agendaByPlan = new Map(rows.map((row) => [row.planId, row]));
  const myScheduledRows = scheduledRows.flatMap((row) =>
    selectedServiceTypeIdSet.has(row.serviceTypeId)
      ? [agendaByPlan.get(row.planId) ?? row]
      : []
  );
  const normalizedSearch = deferredSearchValue.trim().toLowerCase();
  const visibleRows = rows.filter((row) => {
    if (!normalizedSearch) {
      return true;
    }
    const haystack = [
      row.serviceTypeName,
      row.planTitle,
      row.seriesTitle ?? "",
      formatPlanDate(row.sortDate, orgTimeZone),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });

  /** On hover: the positions, items, and times a plan opens with. */
  const prefetchPlanData = useCallback(
    async (row: ServicePlanRow) => {
      // Warm the route too, so its code is ready before the click.
      void router.preloadRoute(
        planWorkspaceLink(row.serviceTypeId, row.planId)
      );
      const { teamPositions, planItems, planTimes } = overviewQueryOptions(row);
      await Promise.allSettled([
        queryClient.query(speculativeQuery(teamPositions)),
        queryClient.query(speculativeQuery(planItems)),
        queryClient.query(speculativeQuery(planTimes)),
      ]);
    },
    [queryClient, router]
  );
  const isPlanDataFresh = useCallback(
    (row: ServicePlanRow) =>
      Object.values(overviewQueryOptions(row)).every((options) =>
        isQueryFresh(queryClient, options.queryKey, options.staleTime)
      ),
    [queryClient]
  );
  const { getIntentProps: getPlanIntentProps, cancelIntent } =
    useIntentPrefetch<ServicePlanRow>({
      keyOf: (row) => `${row.serviceTypeId}:${row.planId}`,
      isFresh: isPlanDataFresh,
      prefetch: prefetchPlanData,
    });
  /**
   * Opening a plan lands on its Plan items, so its data starts loading at the click, ahead of
   * the route's code. The workspace warms the other views in the speculative lane once it has
   * loaded.
   */
  const loadOpenedPlan = useCallback(
    async (row: ServicePlanRow) => {
      // The workspace's own queries own any visible loading error.
      const { teamPositions, planItems, planTimes } = overviewQueryOptions(row);
      await Promise.allSettled([
        queryClient.query(teamPositions),
        queryClient.query(planItems),
        queryClient.query(planTimes),
      ]);
    },
    [queryClient]
  );

  const handleSelectRow = useCallback(
    (row: ServicePlanRow) => {
      cancelIntent();
      const plan = planQueries
        .flatMap((query) => query.data ?? [])
        .find((item) => item.id === row.planId);
      if (plan !== undefined) {
        queryClient.setQueryData(
          queryKeys.planDetails(row.serviceTypeId, row.planId),
          plan
        );
      }
      void loadOpenedPlan(row);
      onSelect({
        serviceTypeId: row.serviceTypeId,
        planId: row.planId,
      });
    },
    [cancelIntent, loadOpenedPlan, onSelect, planQueries, queryClient]
  );

  return {
    searchValue,
    setSearchValue,
    serviceTypes,
    effectiveSelectedServiceTypeIds,
    setSelectedServiceTypeIds,
    loadLaterWeeks,
    loadEarlierWeeks,
    canAutoLoadMore,
    latestStartDay: startDays.at(-1),
    isInitialLoading,
    isRefreshing,
    errorMessage,
    failedQueries,
    visibleRows,
    myScheduledRows,
    myScheduledPlanIdSet,
    handleSelectRow,
    getPlanIntentProps,
    orgTimeZone,
  };
};
