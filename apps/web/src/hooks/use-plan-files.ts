import { failureMessage } from "@pcobooster/client/product-client";
import { callForQuery, speculativeQuery } from "@pcobooster/client/query";
import type {
  PlanFile,
  PlanFileOpenMode,
  PlanFiles,
} from "@pcobooster/contracts/http/plan-files";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { createPlanFileQueryOptions } from "@/lib/plan-file-query";
import { queryKeys } from "@/lib/query-keys";
import { requestScheduler } from "@/lib/request-priority";
import { productClient } from "@/product-client";

/** The plan's files, a page of up to 100 at a time. */
export const createPlanFilesQueryOptions = (
  serviceTypeId: string,
  planId: string
) =>
  infiniteQueryOptions<
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

export const usePlanFiles = (serviceTypeId: string, planId: string) =>
  useInfiniteQuery(createPlanFilesQueryOptions(serviceTypeId, planId));

/** Plans past this many pages of files finish loading once their list is open. */
const PREFETCHED_PLAN_FILE_PAGES = 5;

/**
 * Reads the plan's files in the speculative lane while the run sheet is open, so an item's
 * files are there when it opens rather than arriving seconds later.
 */
export const usePrefetchPlanFiles = (
  serviceTypeId: string | null,
  planId: string | null
) => {
  const queryClient = useQueryClient();
  useEffect(() => {
    const leave = new AbortController();
    if (isNonEmptyString(serviceTypeId) && isNonEmptyString(planId)) {
      void requestScheduler.runSpeculative(async () => {
        try {
          await queryClient.infiniteQuery({
            ...speculativeQuery(
              createPlanFilesQueryOptions(serviceTypeId, planId)
            ),
            pages: PREFETCHED_PLAN_FILE_PAGES,
          });
        } catch {
          // The files list surfaces its own failures; prefetching is best effort.
        }
      }, leave.signal);
    }
    return () => {
      leave.abort();
    };
  }, [queryClient, serviceTypeId, planId]);
};

/** Every page of the plan's files, loaded one after another: the list is only useful whole. */
export const useAllPlanFiles = (serviceTypeId: string, planId: string) => {
  const query = usePlanFiles(serviceTypeId, planId);
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  return {
    query,
    files: query.data?.pages.flatMap((page) => page.files) ?? [],
    /** Still loading pages, so counts would be short. */
    complete: query.isSuccess && !hasNextPage,
  };
};

/** Reuse PDF bytes between visits; other media still gets a fresh signed link. */
export const usePlanFileLink = (
  serviceTypeId: string,
  planId: string,
  file: PlanFile,
  as: PlanFileOpenMode
) => {
  const input = { serviceTypeId, planId, attachmentId: file.id, as };
  return useQuery(
    createPlanFileQueryOptions(
      input,
      async (context) =>
        await callForQuery(context, productClient, (api) =>
          api.planFiles.open({
            params: { serviceTypeId, planId, attachmentId: file.id },
            query: as === "link" ? {} : { as },
          })
        )
    )
  );
};

/** A cached PDF's original URL may have expired. Resolve a fresh link on the click. */
export const useOpenPlanFileOriginal = (
  serviceTypeId: string,
  planId: string,
  file: PlanFile
) => {
  const queryClient = useQueryClient();
  return async (): Promise<void> => {
    const tab = window.open("", "_blank");
    if (tab !== null) {
      tab.opener = null;
    }
    const input = { serviceTypeId, planId, attachmentId: file.id };
    try {
      const { url } = await queryClient.query(
        createPlanFileQueryOptions(
          input,
          async (context) =>
            await callForQuery(context, productClient, (api) =>
              api.planFiles.open({ params: input, query: {} })
            )
        )
      );
      if (tab === null) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        tab.location.href = url;
      }
    } catch (error) {
      tab?.close();
      const fallback = "The original file didn’t open.";
      toast.error(
        error instanceof Error ? failureMessage(error, fallback) : fallback
      );
    }
  };
};
