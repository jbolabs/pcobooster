import { callForQuery } from "@pcobooster/client/query";
import { buildServicePlanRows } from "@pcobooster/planning-center-models/service-plans";
import type { QueryFunctionContext } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { failureMessage, useProductClient } from "../../app-shell/queries";
import type { ProductClientContextValue } from "../../app-shell/queries";
import {
  useVisibleQuery as useQuery,
  useVisibleQueries as useQueries,
} from "../../app-shell/visible-queries";
import { launchOptions } from "../../harness/current-launch-options";
import {
  DEFAULT_WINDOW,
  initialServiceTypeSelection,
  serviceTypeSummary,
} from "./agenda";
import type { ServicesWindow } from "./agenda";
import { selectedLoading, selectedQueries } from "./loading";

/** Service types and past plans change rarely. */
const SLOW_STALE_MS = 600_000;

const reads = {
  serviceTypes: ({ client, scope }: ProductClientContextValue) => ({
    queryKey: [scope, "catalog.serviceTypes"] as const,
    queryFn: async (context: QueryFunctionContext) =>
      await callForQuery(context, client, (api) => api.catalog.serviceTypes()),
    staleTime: SLOW_STALE_MS,
  }),
  myPlans: ({ client, scope }: ProductClientContextValue) => ({
    queryKey: [scope, "people.myScheduledPlans"] as const,
    queryFn: async (context: QueryFunctionContext) =>
      await callForQuery(context, client, (api) =>
        api.people.myScheduledPlans()
      ),
  }),
  plans: (
    { client, scope }: ProductClientContextValue,
    serviceTypeId: string
  ) => ({
    queryKey: [scope, "catalog.plans", serviceTypeId] as const,
    queryFn: async (context: QueryFunctionContext) => {
      const input = { serviceTypeId };
      return await callForQuery(context, client, (api) =>
        api.catalog.plans({ params: input })
      );
    },
  }),
  previousPlans: (
    { client, scope }: ProductClientContextValue,
    serviceTypeId: string,
    planId: string
  ) => ({
    queryKey: [scope, "catalog.adjacentPlans", serviceTypeId, planId] as const,
    queryFn: async (context: QueryFunctionContext) => {
      const input = { serviceTypeId, planId, direction: "previous" as const };
      return await callForQuery(context, client, (api) =>
        api.catalog.adjacentPlans({ params: input, query: input })
      );
    },
    staleTime: SLOW_STALE_MS,
  }),
};

export interface AgendaFailure {
  readonly id: string;
  readonly title: string;
  readonly retry: () => void;
}

/** The parts of a query's state the agenda reads. */
interface QueryStatus {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly refetch: () => Promise<{ readonly isError: boolean }>;
}

interface NamedServiceType {
  readonly id: string;
  readonly name: string;
}

const retrying = (query: QueryStatus) => () => {
  void query.refetch();
};

/** Reads that failed, with the web's titles and a retry each. */
const agendaFailures = ({
  serviceTypes,
  selectedIds,
  myPlans,
  planQueries,
  recentQueries,
}: {
  readonly serviceTypes: readonly NamedServiceType[];
  readonly selectedIds: ReadonlySet<string>;
  readonly myPlans: QueryStatus;
  readonly planQueries: readonly QueryStatus[];
  /** Empty unless the window is recent plans. */
  readonly recentQueries: readonly QueryStatus[];
}): AgendaFailure[] => {
  const failures: AgendaFailure[] = [];
  if (myPlans.isError) {
    failures.push({
      id: "mine",
      title: "Couldn't load your services",
      retry: retrying(myPlans),
    });
  }
  for (const [index, serviceType] of serviceTypes.entries()) {
    const plans: QueryStatus | undefined = planQueries[index];
    const recent: QueryStatus | undefined = recentQueries[index];
    if (
      selectedIds.has(serviceType.id) &&
      plans !== undefined &&
      plans.isError
    ) {
      failures.push({
        id: serviceType.id,
        title: `Couldn't load ${serviceType.name} plans`,
        retry: retrying(plans),
      });
    }
    if (
      selectedIds.has(serviceType.id) &&
      recent !== undefined &&
      recent.isError
    ) {
      failures.push({
        id: `recent-${serviceType.id}`,
        title: `Couldn't load recent ${serviceType.name} plans`,
        retry: retrying(recent),
      });
    }
  }
  return failures;
};

/** The ids a selection change leaves selected, in service type order. */
const toggledSelection = (
  serviceTypes: readonly NamedServiceType[],
  selectedIds: ReadonlySet<string>,
  serviceTypeId: string,
  isOn: boolean
): string[] => {
  const ids: string[] = [];
  for (const { id } of serviceTypes) {
    if (id === serviceTypeId ? isOn : selectedIds.has(id)) {
      ids.push(id);
    }
  }
  return ids;
};

/**
 * The Services agenda's reads and filters (Swift `ServicesHomeModel`, the web's
 * `useServicePlanSelection`): `catalog.serviceTypes`, then `catalog.plans` for each selected
 * service type, `people.myScheduledPlans` for "Your services", and, for recent plans, one
 * `catalog.adjacentPlans` lookup back from each selected service type's first upcoming plan.
 * Nothing fans out per plan.
 */
export const useServicesAgenda = () => {
  const context = useProductClient();
  const [window, setWindow] = useState<ServicesWindow>(DEFAULT_WINDOW);
  /** Chosen service type ids; null means all of them (the web's stored `null`). */
  const [storedSelection, setStoredSelection] = useState<
    readonly string[] | null
  >(() => initialServiceTypeSelection(launchOptions.serviceTypeId));
  const [searchText, setSearchText] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);

  const serviceTypes = useQuery(reads.serviceTypes(context));
  const myPlans = useQuery(reads.myPlans(context));
  const allServiceTypes = useMemo(
    () => serviceTypes.data ?? [],
    [serviceTypes.data]
  );

  const selectedIds = useMemo(() => {
    const all = allServiceTypes.map((serviceType) => serviceType.id);
    if (storedSelection === null) {
      return new Set(all);
    }
    const stored = new Set(storedSelection);
    return new Set(all.filter((id) => stored.has(id)));
  }, [allServiceTypes, storedSelection]);

  const planQueries = useQueries({
    queries: allServiceTypes.map((serviceType) => ({
      ...reads.plans(context, serviceType.id),
      enabled: selectedIds.has(serviceType.id),
    })),
  });
  const upcomingRows = useMemo(
    () =>
      buildServicePlanRows(
        allServiceTypes,
        (_serviceType, index) => planQueries[index]?.data,
        selectedIds
      ),
    [allServiceTypes, planQueries, selectedIds]
  );

  /** Each service type's first upcoming plan, which recent plans are looked up from. */
  const anchors = allServiceTypes.map(
    (_serviceType, index) =>
      planQueries[index]?.data?.find((plan) => plan.sortDate !== undefined)?.id
  );
  const isRecent = window === "recent";
  const recentQueries = useQueries({
    queries: allServiceTypes.map((serviceType, index) => ({
      ...reads.previousPlans(context, serviceType.id, anchors[index] ?? ""),
      enabled:
        isRecent &&
        selectedIds.has(serviceType.id) &&
        anchors[index] !== undefined,
    })),
  });
  const recentRows = useMemo(
    () =>
      buildServicePlanRows(
        allServiceTypes,
        (_serviceType, index) => recentQueries[index]?.data,
        selectedIds
      ),
    [allServiceTypes, recentQueries, selectedIds]
  );

  // The list waits for every selected service type and "Your services", so rows never reshuffle
  // under a finger; later loads keep the rows on screen.
  const plansLoading = selectedLoading(
    allServiceTypes,
    selectedIds,
    planQueries
  );
  const recentLoading =
    isRecent &&
    selectedLoading(allServiceTypes, selectedIds, recentQueries, anchors);
  const everythingLoaded =
    !serviceTypes.isPending && !myPlans.isPending && !plansLoading;
  if (everythingLoaded && !hasLoaded) {
    setHasLoaded(true);
  }
  const hasRecentAnswer = recentQueries.some(
    (query) => query.data !== undefined
  );

  const setSelected = useCallback(
    (serviceTypeId: string, isOn: boolean) => {
      const ids = toggledSelection(
        allServiceTypes,
        selectedIds,
        serviceTypeId,
        isOn
      );
      setStoredSelection(ids.length === allServiceTypes.length ? null : ids);
    },
    [allServiceTypes, selectedIds]
  );

  const selectsAllServiceTypes = selectedIds.size === allServiceTypes.length;
  const myPlanIds = useMemo(
    () => new Set(myPlans.data?.planIds),
    [myPlans.data?.planIds]
  );

  const refresh = useCallback(async () => {
    const queries = [
      serviceTypes,
      myPlans,
      ...selectedQueries(allServiceTypes, selectedIds, planQueries),
      ...(isRecent
        ? selectedQueries(allServiceTypes, selectedIds, recentQueries, anchors)
        : []),
    ];
    await Promise.all(queries.map(async (query) => await query.refetch()));
  }, [
    allServiceTypes,
    anchors,
    isRecent,
    myPlans,
    planQueries,
    recentQueries,
    selectedIds,
    serviceTypes,
  ]);

  return {
    window,
    setWindow,
    searchText,
    setSearchText,
    serviceTypes: {
      all: allServiceTypes,
      isLoaded: serviceTypes.data !== undefined,
      errorMessage:
        serviceTypes.error === null ? null : failureMessage(serviceTypes.error),
      retry: retrying(serviceTypes),
    },
    selectedIds,
    selectsAllServiceTypes,
    serviceTypeSummary: serviceTypeSummary(allServiceTypes, selectedIds),
    hasActiveFilters: !selectsAllServiceTypes || window !== DEFAULT_WINDOW,
    setSelected,
    selectAllServiceTypes: () => {
      setStoredSelection(null);
    },
    resetFilters: () => {
      setStoredSelection(null);
      setWindow(DEFAULT_WINDOW);
      setSearchText("");
    },
    upcomingRows,
    recentRows,
    myPlanIds,
    isLoaded: hasLoaded || everythingLoaded,
    isLoadingMore: hasLoaded && (plansLoading || recentLoading),
    /** Recent plans are still being looked up and there is nothing to show yet. */
    isLoadingRecent: recentLoading && !hasRecentAnswer,
    failures: agendaFailures({
      serviceTypes: allServiceTypes,
      selectedIds,
      myPlans,
      planQueries,
      recentQueries: isRecent ? recentQueries : [],
    }),
    refresh,
  };
};

export type ServicesAgenda = ReturnType<typeof useServicesAgenda>;
