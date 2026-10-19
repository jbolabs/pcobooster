import { Check, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  getPlanPersonStatusMeta,
  STATUS_ITEMS,
  STATUS_TO_CODE,
} from "@/components/schedule/plan-person-status";
import type { PlanPersonStatusValue } from "@/components/schedule/plan-person-status";
import { ScheduleStatusDot } from "@/components/schedule/status-dot";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { isSavedPlanPersonId } from "@/hooks/use-schedule-cache-optimism";
import { useUnschedulePlanPerson } from "@/hooks/use-unschedule-plan-person";
import { useUpdatePlanPersonStatus } from "@/hooks/use-update-plan-person-status";

export type { PlanPersonStatusValue } from "@/components/schedule/plan-person-status";

export interface PlanPersonStatusMenuProps {
  planPersonId: string | null | undefined;
  currentStatus: PlanPersonStatusValue;
  serviceTypeId?: string | null;
  personId?: string | null;
  planId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  personName: string;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export const PlanPersonStatusMenu = ({
  planPersonId,
  currentStatus,
  serviceTypeId,
  personId,
  planId,
  teamId,
  positionId,
  onSuccess,
  onError,
}: PlanPersonStatusMenuProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { isUpdating, handleUpdate } = useUpdatePlanPersonStatus({
    onSuccess,
    onError,
  });
  const { isUnscheduling, handleUnschedule } = useUnschedulePlanPerson({
    onSuccess,
    onError,
  });
  const isBusy = isUpdating || isUnscheduling;
  const currentItem = getPlanPersonStatusMeta(currentStatus);
  // Someone just assigned can't change until their assign lands.
  const isSaved = isSavedPlanPersonId(planPersonId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-icon="inline-start"
              className="shrink-0 max-sm:h-10"
              aria-label={`Change status: ${currentItem.label}`}
              disabled={!isSaved || isBusy}
            />
          }
        >
          {isBusy ? (
            <Spinner className="size-3.5" />
          ) : (
            <ScheduleStatusDot status={currentItem.status} aria-hidden />
          )}
          {currentItem.label}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {STATUS_ITEMS.map(({ value, label, status }) => (
            <DropdownMenuItem
              key={value}
              disabled={currentStatus === value}
              onSelect={() => {
                handleUpdate(planPersonId, STATUS_TO_CODE[value], {
                  serviceTypeId,
                  personId,
                  planId,
                  teamId,
                  positionId,
                });
              }}
            >
              <ScheduleStatusDot status={status} aria-hidden />
              <span className="flex-1">{label}</span>
              {currentStatus === value ? (
                <Check className="size-3.5 opacity-70" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator inset />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="size-3.5" aria-hidden />
            <span className="flex-1">Unschedule</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          setConfirmOpen(false);
          handleUnschedule(planPersonId, {
            serviceTypeId,
            personId,
            planId,
            teamId,
            positionId,
          });
        }}
        title="Unschedule this person?"
        description="They come off this position in Planning Center."
        confirmLabel="Unschedule"
      />
    </>
  );
};
