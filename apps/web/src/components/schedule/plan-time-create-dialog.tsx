import {
  getInvalidPlanTimeEditMessage,
  isValidPlanTimeEdit,
} from "@pcobooster/planning-center-models/plan-time-edits";
import type { EditablePlanTime } from "@pcobooster/planning-center-models/plan-time-edits";
import type { TeamPositionGroup } from "@pcobooster/planning-center-models/types";
import { useState } from "react";

import { PlanTimeFormFields } from "@/components/schedule/plan-time-form-fields";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Spinner } from "@/components/ui/spinner";

interface PlanTimeCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultEdit: EditablePlanTime;
  creating: boolean;
  assignmentGroups: TeamPositionGroup[];
  assignmentsLoading: boolean;
  onSave: (edit: EditablePlanTime) => Promise<boolean>;
}

interface PlanTimeCreateDialogFormProps {
  defaultEdit: EditablePlanTime;
  creating: boolean;
  assignmentGroups: TeamPositionGroup[];
  assignmentsLoading: boolean;
  onCancel: () => void;
  onSave: (edit: EditablePlanTime) => Promise<boolean>;
}

const PlanTimeCreateDialogForm = ({
  defaultEdit,
  creating,
  assignmentGroups,
  assignmentsLoading,
  onCancel,
  onSave,
}: PlanTimeCreateDialogFormProps) => {
  const [draft, setDraft] = useState(defaultEdit);
  const [saveError, setSaveError] = useState<string | null>(null);
  const valid = isValidPlanTimeEdit(draft);

  const updateDraft = (patch: Partial<EditablePlanTime>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const handleSave = async () => {
    if (creating) {
      return;
    }
    if (!valid) {
      setSaveError(getInvalidPlanTimeEditMessage(draft));
      return;
    }

    setSaveError(null);
    await onSave(draft);
  };

  return (
    <>
      <ResponsiveDialogHeader className="max-md:text-left">
        <ResponsiveDialogTitle>Add time</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          Set the schedule and assignments for this plan time.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <div className="flex min-h-0 flex-col gap-4 max-md:overflow-y-auto max-md:overscroll-contain max-md:px-4 max-md:py-4">
        <PlanTimeFormFields
          idPrefix="plan-time-create"
          edit={draft}
          valid={valid}
          assignmentGroups={assignmentGroups}
          assignmentsLoading={assignmentsLoading}
          rangeVariant="inline"
          onEditChange={updateDraft}
          onCommitEdit={updateDraft}
        />

        {saveError !== null && saveError !== "" ? (
          <p className="text-destructive text-sm">{saveError}</p>
        ) : null}
      </div>

      <ResponsiveDialogFooter>
        <Button
          type="button"
          variant="outline"

          disabled={creating}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"

          disabled={creating || !valid}
          onClick={() => {
            void handleSave();
          }}
        >
          {creating ? <Spinner /> : null}
          Save
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
};

export const PlanTimeCreateDialog = ({
  open,
  onOpenChange,
  defaultEdit,
  creating,
  assignmentGroups,
  assignmentsLoading,
  onSave,
}: PlanTimeCreateDialogProps) => (
  <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
    <ResponsiveDialogContent className="sm:max-w-md">
      {open ? (
        <PlanTimeCreateDialogForm
          key={JSON.stringify(defaultEdit)}
          defaultEdit={defaultEdit}
          creating={creating}
          assignmentGroups={assignmentGroups}
          assignmentsLoading={assignmentsLoading}
          onCancel={() => {
            onOpenChange(false);
          }}
          onSave={onSave}
        />
      ) : null}
    </ResponsiveDialogContent>
  </ResponsiveDialog>
);
