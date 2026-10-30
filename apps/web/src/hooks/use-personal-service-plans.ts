import { callForQuery } from "@pcobooster/client/query";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import { useInfiniteQuery } from "@tanstack/react-query";

import { personalServiceRows } from "@/lib/personal-service-rows";
import { queryKeys } from "@/lib/query-keys";
import { productClient } from "@/product-client";

export const usePersonalServicePlans = (
  enabled: boolean,
  selectedTypes: readonly string[] | null,
  pinnedServiceTypeId: string | null | undefined
) => {
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.myScheduledPlans(), "all"],
    initialPageParam: 0,
    queryFn: async (context) =>
      await callForQuery(context, productClient, (api) =>
        api.people.mySchedule({ query: { offset: context.pageParam } })
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled,
    staleTime: 60 * 1000,
  });
  // Default to every assigned service type, including archived types absent from the catalog.
  const selected = isNonEmptyString(pinnedServiceTypeId)
    ? [pinnedServiceTypeId]
    : selectedTypes;
  const rows = personalServiceRows(
    query.data?.pages.flatMap((page) => page.entries) ?? [],
    selected
  );
  return { query, rows };
};
