import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  cancelScheduleMutationQueries,
  isMissingPlanPersonError,
  isSavedPlanPersonId,
  optimisticallyUpdatePlanPersonStatus,
  restoreScheduleCaches,
  settleScheduleMutationQueries,
} from "@/hooks/use-schedule-cache-optimism";
import type { ScheduleMutationInvalidateContext } from "@/hooks/use-schedule-cache-optimism";
import { scheduleMutationKey } from "@/lib/query-keys";
import { productClient } from "@/product-client";

export type PlanPersonStatusCode = "C" | "U" | "D";

/** The fault's message (written for people), or the failure's own; never blank. */
const formatUpdateStatusError = (error: Error): string =>
  error.message === "" ? "Failed to update status" : error.message;

export const useUpdatePlanPersonStatus = ({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void;
  onError?: (message: string) => void;
} = {}) => {
  const queryClient = useQueryClient();
  const [updateError, setUpdateError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationKey: scheduleMutationKey,
    mutationFn: async ({
      planPersonId,
      status,
      context,
    }: {
      planPersonId: string;
      status: PlanPersonStatusCode;
      context?: ScheduleMutationInvalidateContext;
    }) =>
      await productClient.run((api) =>
        api.schedule.updateStatus({
          params: { planPersonId },
          payload: {
            status,
            serviceTypeId: context?.serviceTypeId ?? undefined,
            personId: context?.personId ?? undefined,
            planId: context?.planId ?? undefined,
          },
        })
      ),
    onMutate: async ({ planPersonId, status, context }) => {
      await cancelScheduleMutationQueries(queryClient, context ?? {});
      return {
        snapshot: optimisticallyUpdatePlanPersonStatus(
          queryClient,
          planPersonId,
          status
        ),
      };
    },
    onSuccess: (_result, variables) => {
      settleScheduleMutationQueries(queryClient, variables.context ?? {});
      onSuccess?.();
    },
    onError: (err, variables, context) => {
      restoreScheduleCaches(queryClient, context?.snapshot);
      if (isMissingPlanPersonError(err)) {
        settleScheduleMutationQueries(queryClient, variables.context ?? {});
      }
      const message = formatUpdateStatusError(err);
      setUpdateError(message);
      onError?.(message);
    },
  });

  const handleUpdate = (
    planPersonId: string | null | undefined,
    status: PlanPersonStatusCode,
    context?: ScheduleMutationInvalidateContext
  ) => {
    if (!isSavedPlanPersonId(planPersonId) || updateMutation.isPending) {
      return;
    }

    setUpdateError(null);
    updateMutation.mutate({ planPersonId, status, context });
  };

  return {
    isUpdating: updateMutation.isPending,
    updateError,
    handleUpdate,
    updateStatusAsync: async (
      planPersonId: string | null | undefined,
      status: PlanPersonStatusCode,
      context?: ScheduleMutationInvalidateContext
    ) => {
      if (!isSavedPlanPersonId(planPersonId)) {
        throw new Error("Missing plan person");
      }
      if (updateMutation.isPending) {
        throw new Error("Status update already in progress");
      }

      setUpdateError(null);
      await updateMutation.mutateAsync({ planPersonId, status, context });
    },
  };
};
