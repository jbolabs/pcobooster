import { failureMessage } from "@pcobooster/client/product-client";
import { callForQuery } from "@pcobooster/client/query";
import type {
  PlanFile,
  PlanFileOpenMode,
  PlanFiles,
} from "@pcobooster/contracts/http/plan-files";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { createPlanFileQueryOptions } from "@/lib/plan-file-query";
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
