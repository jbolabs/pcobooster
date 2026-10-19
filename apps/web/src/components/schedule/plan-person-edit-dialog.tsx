import { formatWallTimeInTimeZone } from "@pcobooster/planning-center-models/calendar";
import { getInitials } from "@pcobooster/planning-center-models/initials";
import type {
  FilledPositionPerson,
  PlanTime,
} from "@pcobooster/planning-center-models/types";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { startTransition, useState } from "react";
import { toast } from "sonner";

import {
  getPlanPersonStatusValue,
  STATUS_ITEMS,
  STATUS_TO_CODE,
} from "@/components/schedule/plan-person-status";
import type { PlanPersonStatusValue } from "@/components/schedule/plan-person-status";
import { formatPlanTimeRangeLabel } from "@/components/schedule/plan-time-display";
import { SchedulingNotificationNote } from "@/components/schedule/scheduling-notification-mark";
import { ScheduleStatusDot } from "@/components/schedule/status-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  SelectionPickerCheckbox,
  SelectionPickerOption,
  SelectionPickerShell,
} from "@/components/ui/selection-picker";
import { selectionPickerSectionTitleClass } from "@/components/ui/selection-picker-styles";
import { Spinner } from "@/components/ui/spinner";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { invalidateCandidateHistoryQueries } from "@/hooks/use-schedule-cache-optimism";
import type { ScheduleMutationInvalidateContext } from "@/hooks/use-schedule-cache-optimism";
import { useUnschedulePlanPerson } from "@/hooks/use-unschedule-plan-person";
import { useUpdatePlanPersonStatus } from "@/hooks/use-update-plan-person-status";
import { queryKeys } from "@/lib/query-keys";
import { ReplayMask } from "@/lib/replay-mask";
import { productClient } from "@/product-client";

interface PlanPersonEditDialogProps {
  person: FilledPositionPerson;
  teamName: string;
  positionName: string;
  planTimes: PlanTime[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serviceTypeId: string | null;
  planId: string | null;
  seriesId: string | null;
  teamId: string;
  positionId: string;
}

const formatPlanTimeScheduleLabel = (
  planTime: PlanTime,
  timeZone: string
): string => {
  const starts = formatWallTimeInTimeZone(planTime.startsAt, timeZone);
  const ends = planTime.endsAt
    ? formatWallTimeInTimeZone(planTime.endsAt, timeZone)
    : null;

  return formatPlanTimeRangeLabel({
    startDate: starts.dateKey,
    startTime: starts.timeValue,
    endDate: ends?.dateKey ?? starts.dateKey,
    endTime: ends?.timeValue ?? "",
  });
};

const haveSameIds = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const aSet = new Set(a);
  return b.every((id) => aSet.has(id));
};

const toggleId = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];

const PlanPersonStatusPicker = ({
  value,
  disabled,
  onChange,
}: {
  value: PlanPersonStatusValue;
  disabled: boolean;
  onChange: (value: PlanPersonStatusValue) => void;
}) => (
  <section className="flex flex-col gap-2.5">
    <h3 className={selectionPickerSectionTitleClass}>Confirmation status</h3>
    <SelectionPickerShell layout="segment">
      {STATUS_ITEMS.map(({ value: itemValue, label, status }) => {
        const selected = value === itemValue;

        return (
          <SelectionPickerOption
            key={itemValue}
            selected={selected}
            layout="segment"
            disabled={disabled}
            onClick={() => {
              onChange(itemValue);
            }}
          >
            <ScheduleStatusDot status={status} aria-hidden />
            <span className="truncate">{label}</span>
          </SelectionPickerOption>
        );
      })}
    </SelectionPickerShell>
  </section>
);

const PlanPersonTimesPicker = ({
  planTimes,
  selectedTimeIds,
  canEdit,
  disabled,
  timeZone,
  onToggle,
}: {
  planTimes: PlanTime[];
  selectedTimeIds: string[];
  canEdit: boolean;
  disabled: boolean;
  timeZone: string;
  onToggle: (planTimeId: string) => void;
}) => {
  const selectedTimeIdSet = new Set(selectedTimeIds);

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className={selectionPickerSectionTitleClass}>Plan times</h3>
      <SelectionPickerShell>
        {planTimes.map((planTime) => {
          const selected = selectedTimeIdSet.has(planTime.id);

          return (
            <SelectionPickerOption
              key={planTime.id}
              selected={selected}
              disabled={!canEdit || disabled}
              onClick={() => {
                onToggle(planTime.id);
              }}
            >
              <SelectionPickerCheckbox selected={selected} />
              <span className="min-w-0 flex-1">
                <span className="block min-w-0 text-sm font-medium">
                  <MiddleTruncate text={planTime.name} />
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {formatPlanTimeScheduleLabel(planTime, timeZone)}
                </span>
              </span>
            </SelectionPickerOption>
          );
        })}
      </SelectionPickerShell>
      {canEdit ? null : (
        <p className="text-muted-foreground text-xs">
          Plan times cannot be edited for this assignment.
        </p>
      )}
    </section>
  );
};

const PlanPersonEditDialogBody = ({
  person,
  teamName,
  positionName,
  planTimes,
  onOpenChange,
  serviceTypeId,
  planId,
  seriesId,
  teamId,
  positionId,
}: Omit<PlanPersonEditDialogProps, "open">) => {
  const queryClient = useQueryClient();
  const timeZone = useOrganizationTimeZone();
  const initialStatus = getPlanPersonStatusValue(person);
  const initialTimeIds = person.assignedTimeIds ?? [];
  const [draftStatus, setDraftStatus] =
    useState<PlanPersonStatusValue>(initialStatus);
  const [draftTimeIds, setDraftTimeIds] = useState(initialTimeIds);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmUnscheduleOpen, setConfirmUnscheduleOpen] = useState(false);

  const mutationContext: ScheduleMutationInvalidateContext & {
    personId?: string | null;
    teamId?: string | null;
    positionId?: string | null;
  } = {
    serviceTypeId,
    personId: person.id,
    planId,
    teamId,
    positionId,
  };

  const canEditTimes =
    serviceTypeId !== null &&
    serviceTypeId !== "" &&
    planId !== null &&
    planId !== "" &&
    person.personId !== null &&
    person.personId !== undefined &&
    person.personId !== "" &&
    planTimes.length > 0;

  const { updateStatusAsync, isUpdating } = useUpdatePlanPersonStatus({
    onError: (message) => {
      setSaveError(message);
    },
  });

  const { handleUnschedule, isUnscheduling } = useUnschedulePlanPerson({
    onSuccess: () => {
      onOpenChange(false);
    },
    onError: (message) => {
      toast.error(message);
    },
  });

  const isBusy = isSaving || isUpdating || isUnscheduling;
  const statusChanged = draftStatus !== initialStatus;
  const timesChanged = !haveSameIds(draftTimeIds, initialTimeIds);
  const hasChanges = statusChanged || timesChanged;

  const persistTimes = async (timeIds: string[]) => {
    const { personId } = person;
    if (!canEditTimes || personId === null || personId === undefined) {
      return;
    }

    await productClient.run((api) =>
      api.planPeople.updateTimes({
        params: { planPersonId: person.planPersonId, serviceTypeId, planId },
        payload: { personId, planTimeIds: timeIds },
      })
    );

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.teamPositions(serviceTypeId, planId, seriesId),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.planTimes(serviceTypeId, planId),
      }),
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "people" && query.queryKey.includes(planId),
      }),
      invalidateCandidateHistoryQueries(queryClient),
    ]);
  };

  const handleSave = async () => {
    if (!hasChanges || isBusy) {
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      if (statusChanged) {
        await updateStatusAsync(
          person.planPersonId,
          STATUS_TO_CODE[draftStatus],
          mutationContext
        );
      }
      if (timesChanged) {
        await persistTimes(draftTimeIds);
      }
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save changes";
      setSaveError(message);
    }

    setIsSaving(false);
  };

  return (
    <ResponsiveDialogContent className="sm:max-w-md">
      <ResponsiveDialogHeader className="max-md:text-left">
        <div className="flex items-center gap-2.5 md:pr-8">
          <Avatar className="max-md:size-10" size="sm">
            <AvatarImage src={person.photoThumbnailUrl ?? undefined} alt="" />
            <AvatarFallback>{getInitials(person.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <ResponsiveDialogTitle>
              <ReplayMask>{person.name}</ReplayMask>
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {teamName} · {positionName}
            </ResponsiveDialogDescription>
          </div>
        </div>
      </ResponsiveDialogHeader>
      <div className="flex min-h-0 flex-col gap-3 max-md:overflow-y-auto max-md:overscroll-contain max-md:px-4 max-md:pt-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <PlanPersonStatusPicker
              value={draftStatus}
              disabled={isBusy}
              onChange={setDraftStatus}
            />
            <SchedulingNotificationNote notification={person.notification} />
          </div>
          {planTimes.length > 0 ? (
            <div className="border-border border-t pt-4">
              <PlanPersonTimesPicker
                planTimes={planTimes}
                selectedTimeIds={draftTimeIds}
                canEdit={canEditTimes}
                disabled={isBusy}
                timeZone={timeZone}
                onToggle={(planTimeId) => {
                  setDraftTimeIds((current) => toggleId(current, planTimeId));
                }}
              />
            </div>
          ) : null}
        </div>

        {saveError !== null && saveError !== "" ? (
          <p className="text-destructive text-sm">{saveError}</p>
        ) : null}
      </div>
      {/* Phones stack Save, Unschedule, Cancel; wider screens put Unschedule on the left. */}
      <ResponsiveDialogFooter className="max-md:mt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="sm:order-first sm:mr-auto"
          disabled={isBusy}
          onClick={() => {
            setConfirmUnscheduleOpen(true);
          }}
        >
          {isUnscheduling ? (
            <Spinner />
          ) : (
            <Trash2 className="size-4" aria-hidden />
          )}
          Unschedule
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isBusy || !hasChanges}
          onClick={() => {
            startTransition(handleSave);
          }}
        >
          {isSaving || isUpdating ? <Spinner /> : null}
          Save
        </Button>
      </ResponsiveDialogFooter>
      <DeleteConfirmationDialog
        open={confirmUnscheduleOpen}
        onOpenChange={setConfirmUnscheduleOpen}
        onConfirm={() => {
          setConfirmUnscheduleOpen(false);
          handleUnschedule(person.planPersonId, mutationContext);
        }}
        title="Unschedule this person?"
        description="They come off this position in Planning Center."
        confirmLabel="Unschedule"
      />
    </ResponsiveDialogContent>
  );
};

export const PlanPersonEditDialog = ({
  open,
  onOpenChange,
  person,
  ...rest
}: PlanPersonEditDialogProps) => (
  <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
    {open ? (
      <PlanPersonEditDialogBody
        key={person.planPersonId}
        person={person}
        onOpenChange={onOpenChange}
        {...rest}
      />
    ) : null}
  </ResponsiveDialog>
);
