import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { useEffect, useMemo } from "react";

import { usePlanFiles } from "@/hooks/use-plan-files";

const NO_FILES: readonly PlanFile[] = [];

/**
 * Every file on the plan: reads Planning Center's pages one after another while the view is
 * open, so a song's files are never missing for want of a "load more".
 */
export const useAllPlanFiles = (serviceTypeId: string, planId: string) => {
  const query = usePlanFiles(serviceTypeId, planId);
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  const files = useMemo(
    () => query.data?.pages.flatMap((page) => page.files) ?? NO_FILES,
    [query.data]
  );
  return {
    files,
    /** Some pages are still on their way. */
    loading: query.isPending || hasNextPage,
    failed: isError,
  };
};
