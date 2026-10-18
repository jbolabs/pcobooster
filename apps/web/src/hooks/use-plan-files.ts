import { callForQuery } from "@pcobooster/client/query";
import type {
  PlanFile,
  PlanFileLink,
  PlanFileOpenMode,
  PlanFiles,
} from "@pcobooster/contracts/http/plan-files";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";
import { productClient } from "@/product-client";

/** The plan's files, a page of up to 100 at a time. */
export const usePlanFiles = (serviceTypeId: string, planId: string) =>
  useInfiniteQuery<
    PlanFiles,
    Error,
    InfiniteData<PlanFiles, number>,
    ReturnType<typeof queryKeys.planFiles>,
    number
  >({
    queryKey: queryKeys.planFiles(serviceTypeId, planId),
    initialPageParam: 0,
    queryFn: async (context) =>
      await callForQuery(context, productClient, (api) =>
        api.planFiles.list({
          params: { serviceTypeId, planId },
          query:
            context.pageParam > 0 ? { offset: String(context.pageParam) } : {},
        })
      ),
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    staleTime: 60_000,
  });

/** A fresh signed link each time a file opens: Planning Center's links expire quickly. */
export const usePlanFileLink = (
  serviceTypeId: string,
  planId: string,
  file: PlanFile,
  as: PlanFileOpenMode
) =>
  useQuery<PlanFileLink>({
    queryKey: queryKeys.planFileLink(serviceTypeId, planId, file.id, as),
    queryFn: async (context) =>
      await callForQuery(context, productClient, (api) =>
        api.planFiles.open({
          params: { serviceTypeId, planId, attachmentId: file.id },
          query: as === "link" ? {} : { as },
        })
      ),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
