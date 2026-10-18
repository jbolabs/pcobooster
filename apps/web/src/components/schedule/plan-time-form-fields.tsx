import { Clock01Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EditablePlanTime } from "@pcobooster/planning-center-models/plan-time-edits";
import type {
  PlanTimeType,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import { format } from "date-fns";
import { useState } from "react";

import {
  formatCalendarDay,
  formatPlanTimeRangeLabel,
  parseCalendarDay,
} from "@/components/schedule/plan-time-display";
import { TimeAssignmentSelector } from "@/components/time-assignment-selector";
import type { TimeAssignmentValue } from "@/components/time-assignment-selector";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import {
  SelectionPickerOption,
  SelectionPickerShell,
} from "@/components/ui/selection-picker";
import { selectionPickerSectionTitleClass } from "@/components/ui/selection-picker-styles";
import { usePersistOnClosePopover } from "@/hooks/use-persist-on-close-popover";
import { cn } from "@/lib/utils";

const timeTypeOptions: { value: PlanTimeType; label: string }[] = [
  { value: "rehearsal", label: "Rehearsal" },
  { value: "service", label: "Service" },
  { value: "other", label: "Other" },
];

interface DatePickerFieldProps {
  id: string;
  label: string;
  value: string;
  invalid?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (dateKey: string) => void;
}

const DatePickerField = ({
  id,
  label,
  value,
  invalid = false,
  open,
  onOpenChange,
  onChange,
}: DatePickerFieldProps) => {
  const selectedDate = parseCalendarDay(value);

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <ResponsivePopover open={open} onOpenChange={onOpenChange}>
        <ResponsivePopoverTrigger
          render={
            <Button
              type="button"
              variant="input"
              id={id}
              className="w-full justify-between"
              aria-invalid={invalid || undefined}
            />
          }
        >
          <span className="truncate">
            {selectedDate ? format(selectedDate, "MMM d, yyyy") : "Select date"}
          </span>
          <HugeiconsIcon
            icon={UnfoldMoreIcon}
            strokeWidth={2}
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
        </ResponsivePopoverTrigger>
        <ResponsivePopoverContent
          title="Pick a date"
          className="w-auto overflow-hidden"
          align="start"
        >
          <Calendar
            mode="single"
            selected={selectedDate}
            captionLayout="dropdown"
            defaultMonth={selectedDate}
            onSelect={(date) => {
              if (!date) {
                return;
              }
              onChange(formatCalendarDay(date));
              onOpenChange(false);
            }}
          />
        </ResponsivePopoverContent>
      </ResponsivePopover>
    </Field>
  );
};

interface TimePickerFieldProps {
  id: string;
  label: string;
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}

const TimePickerField = ({
  id,
  label,
  value,
  invalid = false,
  onChange,
}: TimePickerFieldProps) => (
  <Field className="min-w-0 flex-1">
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input
      type="time"
      id={id}
      value={value}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  </Field>
);

interface PlanTimeRangeFieldsProps {
  idPrefix: string;
  edit: EditablePlanTime;
  invalid?: boolean;
  onEditChange: (patch: Partial<EditablePlanTime>) => void;
}

export const PlanTimeRangeInlineFields = ({
  idPrefix,
  edit,
  invalid = false,
  onEditChange,
}: PlanTimeRangeFieldsProps) => {
  const [dateOpen, setDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const sameDay = !edit.endDate || edit.endDate === edit.startDate;

  return (
    <section className="flex flex-col gap-2">
      <h3 className={selectionPickerSectionTitleClass}>When</h3>
      <FieldGroup data-invalid={invalid || undefined}>
        <DatePickerField
          id={`${idPrefix}-date`}
          label="Date"
          value={edit.startDate}
          invalid={invalid}
          open={dateOpen}
          onOpenChange={setDateOpen}
          onChange={(dateKey) => {
            onEditChange({
              startDate: dateKey,
              endDate: edit.endDate || dateKey,
            });
          }}
        />

        <div className="flex gap-3">
          <TimePickerField
            id={`${idPrefix}-start-time`}
            label="Start"
            value={edit.startTime}
            invalid={invalid}
            onChange={(nextStartTime) => {
              onEditChange({ startTime: nextStartTime });
            }}
          />
          <TimePickerField
            id={`${idPrefix}-end-time`}
            label="End"
            value={edit.endTime}
            invalid={invalid}
            onChange={(nextEndTime) => {
              onEditChange({ endTime: nextEndTime });
            }}
          />
        </div>

        {sameDay ? null : (
          <DatePickerField
            id={`${idPrefix}-end-date`}
            label="End date"
            value={edit.endDate || edit.startDate}
            invalid={invalid}
            open={endDateOpen}
            onOpenChange={setEndDateOpen}
            onChange={(dateKey) => {
              onEditChange({ endDate: dateKey });
            }}
          />
        )}
      </FieldGroup>
    </section>
  );
};

export interface PlanTimeDetailsFieldsProps {
  idPrefix: string;
  edit: EditablePlanTime;
  valid: boolean;
  assignmentGroups: TeamPositionGroup[];
  assignmentsLoading: boolean;
  onEditChange: (patch: Partial<EditablePlanTime>) => void;
  onCommitEdit: (patch: Partial<EditablePlanTime>) => void;
}

export const PlanTimeDetailsFields = ({
  idPrefix,
  edit,
  valid,
  assignmentGroups,
  assignmentsLoading,
  onEditChange,
  onCommitEdit,
}: PlanTimeDetailsFieldsProps) => {
  const assignmentValue: TimeAssignmentValue = {
    teamIds: edit.assignedTeamIds,
    positionIds: edit.assignedPositionIds,
    neededPositionIds: edit.assignedNeededPositionIds,
    planPersonIds: edit.assignedPlanPersonIds,
  };

  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className={selectionPickerSectionTitleClass}>Name</h3>
        <Input
          id={`${idPrefix}-name`}
          value={edit.name}
          placeholder="Untitled time"
          aria-label="Time name"
          enterKeyHint="done"
          aria-invalid={!valid || undefined}
          onChange={(event) => {
            onEditChange({ name: event.target.value });
          }}
          onBlur={(event) => {
            onCommitEdit({ name: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </section>

      <section className="flex flex-col gap-2.5">
        <h3 className={selectionPickerSectionTitleClass}>Type</h3>
        <SelectionPickerShell layout="segment">
          {timeTypeOptions.map((option) => (
            <SelectionPickerOption
              key={option.value}
              selected={edit.timeType === option.value}
              layout="segment"
              onClick={() => {
                onCommitEdit({ timeType: option.value });
              }}
            >
              {option.label}
            </SelectionPickerOption>
          ))}
        </SelectionPickerShell>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={selectionPickerSectionTitleClass}>Assignments</h3>
        <TimeAssignmentSelector
          groups={assignmentGroups}
          value={assignmentValue}
          disabled={assignmentsLoading}
          onChange={(assignment) => {
            onCommitEdit({
              assignedTeamIds: assignment.teamIds,
              assignedPositionIds: assignment.positionIds,
              assignedNeededPositionIds: assignment.neededPositionIds,
              assignedPlanPersonIds: assignment.planPersonIds,
            });
          }}
        />
      </section>
    </>
  );
};

interface PlanTimeRangePopoverEditorProps extends PlanTimeRangeFieldsProps {
  onCommitEdit: (patch: Partial<EditablePlanTime>) => void;
  onPersist: () => void;
}

export const PlanTimeRangePopoverEditor = ({
  idPrefix,
  edit,
  invalid = false,
  onEditChange,
  onCommitEdit,
  onPersist,
}: PlanTimeRangePopoverEditorProps) => {
  const [dateOpen, setDateOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const sameDay = !edit.endDate || edit.endDate === edit.startDate;
  const displayLabel = formatPlanTimeRangeLabel({
    startDate: edit.startDate,
    startTime: edit.startTime,
    endDate: edit.endDate,
    endTime: edit.endTime,
  });
  const nestedPickerOpen = dateOpen || endDateOpen;

  const { open, handleOpenChange, contentRef } = usePersistOnClosePopover({
    onClose: () => {
      onPersist();
      setDateOpen(false);
      setEndDateOpen(false);
    },
    enterToClose: { disabled: nestedPickerOpen },
  });

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={handleOpenChange}
      modal={false}
    >
      <ResponsivePopoverTrigger
        render={
          <Button
            type="button"
            variant="input"
            className="h-auto min-h-10 w-full justify-start whitespace-normal"
            data-invalid={invalid || undefined}
            aria-label={`Edit time, ${displayLabel}`}
            aria-expanded={open}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <HugeiconsIcon
            icon={Clock01Icon}
            strokeWidth={2}
            className="text-muted-foreground size-4 shrink-0"
          />
          <span
            className={cn(
              "min-w-0 flex-1 py-2 text-left text-base font-medium",
              invalid && "text-destructive"
            )}
          >
            {displayLabel}
          </span>
        </span>
        <HugeiconsIcon
          icon={UnfoldMoreIcon}
          strokeWidth={2}
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
      </ResponsivePopoverTrigger>

      <ResponsivePopoverContent
        title="Edit time"
        showTitle
        ref={contentRef}
        align="start"
        className="w-80"
      >
        <div className="p-3">
          <FieldGroup data-invalid={invalid || undefined}>
            <DatePickerField
              id={`${idPrefix}-date`}
              label="Date"
              value={edit.startDate}
              invalid={invalid}
              open={dateOpen}
              onOpenChange={setDateOpen}
              onChange={(dateKey) => {
                onCommitEdit({
                  startDate: dateKey,
                  endDate: edit.endDate || dateKey,
                });
              }}
            />

            <div className="flex gap-3">
              <TimePickerField
                id={`${idPrefix}-start-time`}
                label="Start"
                value={edit.startTime}
                invalid={invalid}
                onChange={(nextStartTime) => {
                  onEditChange({ startTime: nextStartTime });
                }}
              />
              <TimePickerField
                id={`${idPrefix}-end-time`}
                label="End"
                value={edit.endTime}
                invalid={invalid}
                onChange={(nextEndTime) => {
                  onEditChange({ endTime: nextEndTime });
                }}
              />
            </div>

            {sameDay ? null : (
              <DatePickerField
                id={`${idPrefix}-end-date`}
                label="End date"
                value={edit.endDate || edit.startDate}
                invalid={invalid}
                open={endDateOpen}
                onOpenChange={setEndDateOpen}
                onChange={(dateKey) => {
                  onCommitEdit({ endDate: dateKey });
                }}
              />
            )}
          </FieldGroup>
        </div>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
};

export interface PlanTimeFormFieldsProps {
  idPrefix: string;
  edit: EditablePlanTime;
  valid: boolean;
  assignmentGroups: TeamPositionGroup[];
  assignmentsLoading: boolean;
  rangeVariant: "inline" | "popover";
  onEditChange: (patch: Partial<EditablePlanTime>) => void;
  onCommitEdit: (patch: Partial<EditablePlanTime>) => void;
  onPersist?: () => void;
}

export const PlanTimeFormFields = ({
  idPrefix,
  edit,
  valid,
  assignmentGroups,
  assignmentsLoading,
  rangeVariant,
  onEditChange,
  onCommitEdit,
  onPersist,
}: PlanTimeFormFieldsProps) => (
  <div className="flex flex-col gap-4">
    {rangeVariant === "inline" ? (
      <PlanTimeRangeInlineFields
        idPrefix={idPrefix}
        edit={edit}
        invalid={!valid}
        onEditChange={onEditChange}
      />
    ) : (
      <PlanTimeRangePopoverEditor
        idPrefix={idPrefix}
        edit={edit}
        invalid={!valid}
        onEditChange={onEditChange}
        onCommitEdit={onCommitEdit}
        onPersist={() => {
          onPersist?.();
        }}
      />
    )}

    <PlanTimeDetailsFields
      idPrefix={idPrefix}
      edit={edit}
      valid={valid}
      assignmentGroups={assignmentGroups}
      assignmentsLoading={assignmentsLoading}
      onEditChange={onEditChange}
      onCommitEdit={onCommitEdit}
    />
  </div>
);
