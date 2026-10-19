import type {
  PlanFileLink,
  PlanFileOpenInput,
} from "@pcobooster/contracts/http/plan-files";
import { queryOptions } from "@tanstack/react-query";
import type { QueryFunction } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-keys";

const PDF_CACHE_TIME_MS = 5 * 60 * 1000;

/** Keep downloaded PDFs in this session; signed links alone must be read fresh. */
export const createPlanFileQueryOptions = (
  input: PlanFileOpenInput,
  queryFn: QueryFunction<
    PlanFileLink,
    ReturnType<typeof queryKeys.planFileLink>
  >
) =>
  queryOptions({
    queryKey: queryKeys.planFileLink(
      input.serviceTypeId,
      input.planId,
      input.attachmentId,
      input.as ?? "link"
    ),
    queryFn,
    staleTime: (query) =>
      query.state.data?.data === undefined ? 0 : PDF_CACHE_TIME_MS,
    gcTime: input.as === "pdf" ? PDF_CACHE_TIME_MS : 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
