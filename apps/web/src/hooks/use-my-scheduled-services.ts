import { callForQuery } from "@pcobooster/client/query";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { personalServiceRows } from "@/lib/personal-service-rows";
import { queryKeys } from "@/lib/query-keys";
import { productClient } from "@/product-client";

/** Read only the signed-in person's upcoming assignments, one provider page per call. */
export const useMyScheduledServices = () => {
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.myScheduledPlans(), "services"],
    initialPageParam: 0,
    queryFn: async (context) =>
      await callForQuery(context, productClient, (api) =>
        api.people.mySchedule({ query: { offset: context.pageParam } })
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    staleTime: 60 * 1000,
  });
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  // "Your services" loads the person's whole upcoming schedule, without listing other plans.
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetching, isError, fetchNextPage]);
  return {
    ...query,
    rows: personalServiceRows(
      query.data?.pages.flatMap((page) => page.entries) ?? []
    ),
  };
};
