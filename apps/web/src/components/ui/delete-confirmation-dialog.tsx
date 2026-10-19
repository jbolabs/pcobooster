import { startTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

interface DeleteConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  isPending?: boolean;
  itemLabel?: string | null;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export const DeleteConfirmationDialog = ({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
  itemLabel,
  title = "Delete item?",
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
}: DeleteConfirmationDialogProps) => {
  const resolvedDescription =
    description ??
    (itemLabel !== null && itemLabel !== undefined && itemLabel !== ""
      ? `Remove "${itemLabel}"? This action cannot be undone.`
      : "Remove this item? This action cannot be undone.");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md" showCloseButton={false}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {resolvedDescription}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className="max-md:pt-5">
          <Button
            type="button"
            variant="outline"

            onClick={() => {
              onOpenChange(false);
            }}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"

            onClick={() => {
              startTransition(onConfirm);
            }}
            disabled={isPending}
          >
            {confirmLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
