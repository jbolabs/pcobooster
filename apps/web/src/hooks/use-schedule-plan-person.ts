import { isProductFault } from "@pcobooster/contracts/faults";
import { AlreadyScheduled } from "@pcobooster/contracts/faults/already-scheduled";
import { PositionMismatch } from "@pcobooster/contracts/faults/position-mismatch";
import {
  isNonEmptyString,
  isString,
} from "@pcobooster/planning-center-models/json";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  cancelScheduleMutationQueries,
  optimisticallySchedulePerson,
  createOptimisticPlanPersonId,
  reconcileOptimisticPlanPersonId,
  restoreScheduleCaches,
  settleScheduleMutationQueries,
} from "@/hooks/use-schedule-cache-optimism";
import type { OptimisticSchedulePerson } from "@/hooks/use-schedule-cache-optimism";
import { scheduleMutationKey } from "@/lib/query-keys";
import { productClient } from "@/product-client";

const formatScheduleClientError = (error: Error): string => {
  if (error instanceof AlreadyScheduled) {
    return "ALREADY_SCHEDULED";
  }
  if (error instanceof PositionMismatch) {
    const { selected, created } = error.details;
    return `Created in "${created.teamPositionName}" instead of "${selected.teamName} - ${selected.positionName}".`;
  }
  if (isProductFault(error)) {
    return error.message || "Failed to schedule";
  }
  return error.message;
};

interface ScheduleFeedback {
  scope: string;
  success: boolean;
  error: string | null;
}

export const useSchedulePlanPerson = ({
  serviceTypeId,
  planId,
  teamId,
  positionId,
  teamName,
  positionName,
  canSchedule,
  onOptimisticSchedule,
  onScheduleSuccess,
  onScheduleError,
  oneOff = false,
}: {
  serviceTypeId: string | null | undefined;
  planId: string | null | undefined;
  teamId: string | null | undefined;
  positionId: string | null | undefined;
  teamName?: string | null | undefined;
  positionName?: string | null | undefined;
  canSchedule: boolean;
  onOptimisticSchedule?: () => void;
  onScheduleSuccess?: () => void;
  onScheduleError?: (message: string) => void;
  oneOff?: boolean;
}) => {
  const queryClient = useQueryClient();
  const scope = JSON.stringify([serviceTypeId, planId, teamId, positionId]);
  const [feedback, setFeedback] = useState<ScheduleFeedback | null>(null);
  const scheduleSuccess = feedback?.scope === scope && feedback.success;
  const scheduleError = feedback?.scope === scope ? feedback.error : null;
  const setScheduleSuccess = (success: boolean) => {
    setFeedback((current) => ({
      scope,
      success,
      error: current?.scope === scope ? current.error : null,
    }));
  };
  const setScheduleError = (error: string | null) => {
    setFeedback((current) => ({
      scope,
      error,
      success: current?.scope === scope && current.success,
    }));
  };

  const scheduleMutation = useMutation({
    mutationKey: scheduleMutationKey,
    mutationFn: async ({ person }: { person: OptimisticSchedulePerson }) => {
      if (
        !isNonEmptyString(serviceTypeId) ||
        !isNonEmptyString(planId) ||
        !isNonEmptyString(teamId) ||
        !isNonEmptyString(positionId)
      ) {
        throw new Error("Missing schedule assignment details");
      }

      return await productClient.run((api) =>
        api.schedule.assign({
          params: { serviceTypeId, planId },
          payload: {
            personId: person.id,
            teamId,
            positionId,
            teamName: teamName ?? undefined,
            positionName: positionName ?? undefined,
            oneOff,
          },
        })
      );
    },
    onMutate: async ({ person }) => {
      if (
        !isNonEmptyString(serviceTypeId) ||
        !isNonEmptyString(planId) ||
        !isNonEmptyString(teamId) ||
        !isNonEmptyString(positionId)
      ) {
        return {};
      }

      const optimisticPlanPersonId = createOptimisticPlanPersonId(
        { planId, teamId, positionId },
        person.id
      );
      await cancelScheduleMutationQueries(queryClient, {
        serviceTypeId,
        planId,
        teamId,
        positionId,
      });

      setScheduleSuccess(true);
      const snapshot = optimisticallySchedulePerson(
        queryClient,
        { serviceTypeId, planId, teamId, positionId },
        person,
        optimisticPlanPersonId
      );
      onOptimisticSchedule?.();

      return { optimisticPlanPersonId, snapshot };
    },
    onSuccess: (result, _variables, context) => {
      const planPersonId = result.data.id;
      if (
        isNonEmptyString(planPersonId) &&
        context.optimisticPlanPersonId !== undefined &&
        context.optimisticPlanPersonId !== ""
      ) {
        reconcileOptimisticPlanPersonId(
          queryClient,
          context.optimisticPlanPersonId,
          planPersonId
        );
      }
      settleScheduleMutationQueries(queryClient, {
        serviceTypeId,
        planId,
        teamId,
        positionId,
      });
      onScheduleSuccess?.();
    },
    onError: (err, _variables, context) => {
      if (err instanceof AlreadyScheduled) {
        setScheduleSuccess(true);
        settleScheduleMutationQueries(queryClient, {
          serviceTypeId,
          planId,
          teamId,
          positionId,
        });
        onScheduleSuccess?.();
        return;
      }

      restoreScheduleCaches(queryClient, context?.snapshot);
      if (err instanceof PositionMismatch) {
        settleScheduleMutationQueries(queryClient, { serviceTypeId, planId });
      }
      setScheduleSuccess(false);
      const message = formatScheduleClientError(err);
      setScheduleError(message);
      onScheduleError?.(message);
    },
  });

  const handleSchedule = (input: string | OptimisticSchedulePerson) => {
    if (
      !isNonEmptyString(serviceTypeId) ||
      !isNonEmptyString(planId) ||
      !isNonEmptyString(teamId) ||
      !isNonEmptyString(positionId) ||
      scheduleMutation.isPending ||
      !canSchedule
    ) {
      return;
    }

    setScheduleError(null);
    const person = isString(input)
      ? { id: input, fullName: "Unknown person", photoThumbnailUrl: null }
      : {
          id: input.id,
          firstName: "firstName" in input ? input.firstName : undefined,
          lastName: "lastName" in input ? input.lastName : undefined,
          fullName: input.fullName,
          photoUrl: "photoUrl" in input ? input.photoUrl : undefined,
          photoThumbnailUrl: input.photoThumbnailUrl,
        };

    scheduleMutation.mutate({ person });
  };

  return {
    isScheduling: scheduleMutation.isPending,
    scheduleSuccess,
    scheduleError,
    handleSchedule,
  };
};
