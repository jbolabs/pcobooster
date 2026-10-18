import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  cancelScheduleMutationQueries,
  isMissingPlanPersonError,
  isSavedPlanPersonId,
  optimisticallyUnschedulePlanPerson,
  restoreScheduleCaches,
  settleScheduleMutationQueries,
} from "@/hooks/use-schedule-cache-optimism";
import type { ScheduleMutationInvalidateContext } from "@/hooks/use-schedule-cache-optimism";
import { scheduleMutationKey } from "@/lib/query-keys";
import { productClient } from "@/product-client";

/** The fault's message (written for people), or the failure's own; never blank. */
const formatUnscheduleError = (error: Error): string =>
  error.message === "" ? "Failed to unschedule" : error.message;

export const useUnschedulePlanPerson = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void;
  onError?: (message: string) => void;
} = {}) => {
  const queryClient = useQueryClient();

  const unscheduleMutation = useMutation({
    mutationKey: scheduleMutationKey,
    mutationFn: async ({
      planPersonId,
      context,
    }: {
      planPersonId: string;
      context?: ScheduleMutationInvalidateContext & {
        personId?: string | null;
      };
    }) =>
      await productClient.run((api) =>
        api.schedule.remove({
          params: { planPersonId },
          query: {
            serviceTypeId: context?.serviceTypeId ?? undefined,
            personId: context?.personId ?? undefined,
            planId: context?.planId ?? undefined,
          },
        })
      ),
    onMutate: async ({ planPersonId, context }) => {
      await cancelScheduleMutationQueries(queryClient, context ?? {});
      return {
        snapshot: optimisticallyUnschedulePlanPerson(queryClient, planPersonId),
      };
    },
    onSuccess: (_result, variables) => {
      settleScheduleMutationQueries(queryClient, variables.context ?? {});
      onSuccess?.();
    },
    onError: (error, variables, context) => {
      restoreScheduleCaches(queryClient, context?.snapshot);
      if (isMissingPlanPersonError(error)) {
        settleScheduleMutationQueries(queryClient, variables.context ?? {});
      }
      onError?.(formatUnscheduleError(error));
    },
  });

  const handleUnschedule = (
    planPersonId: string | null | undefined,
    context?: ScheduleMutationInvalidateContext & { personId?: string | null }
  ) => {
    if (!isSavedPlanPersonId(planPersonId) || unscheduleMutation.isPending) {
      return;
    }
    unscheduleMutation.mutate({ planPersonId, context });
  };

  return { isUnscheduling: unscheduleMutation.isPending, handleUnschedule };
};
