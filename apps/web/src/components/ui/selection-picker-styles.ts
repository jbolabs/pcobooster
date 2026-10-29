import { cn } from "@/lib/utils";

export const selectionPickerSectionTitleClass =
  "text-muted-foreground text-xs font-medium";

export const selectionPickerShellClass =
  "border-border bg-muted/40 rounded-2xl border p-1.5";

export const selectionPickerOptionClass = "rounded-lg outline-none";

export const selectionPickerOptionSelectedClass =
  "bg-background text-foreground shadow-xs ring-foreground/10 ring-1";

export const selectionPickerOptionIdleClass =
  "text-muted-foreground hover:bg-muted/30 hover:text-foreground";

export const selectionPickerShellListClass = "flex flex-col gap-1.5";

export const selectionPickerShellSegmentClass = "flex";

export const selectionPickerOptionSegmentClass =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium sm:text-sm pointer-coarse:min-h-11 pointer-coarse:text-sm";

export const selectionPickerOptionRowClass =
  "flex w-full items-start gap-3 px-3 py-2.5 text-left pointer-coarse:min-h-11";

export const selectionPickerOptionDisabledClass =
  "cursor-not-allowed opacity-60";

const getSelectionPickerLayoutClass = (layout: "segment" | "row"): string => {
  if (layout === "segment") {
    return selectionPickerOptionSegmentClass;
  }
  return selectionPickerOptionRowClass;
};

const getSelectionPickerStateClass = (selected: boolean): string => {
  if (selected) {
    return selectionPickerOptionSelectedClass;
  }
  return selectionPickerOptionIdleClass;
};

export const getSelectionPickerShellLayoutClass = (
  layout: "list" | "segment"
): string => {
  if (layout === "segment") {
    return selectionPickerShellSegmentClass;
  }
  return selectionPickerShellListClass;
};

export const getSelectionPickerOptionClassName = ({
  selected,
  layout = "row",
  disabled = false,
}: {
  selected: boolean;
  layout?: "segment" | "row";
  disabled?: boolean;
}) =>
  cn(
    selectionPickerOptionClass,
    getSelectionPickerLayoutClass(layout),
    getSelectionPickerStateClass(selected),
    disabled && selectionPickerOptionDisabledClass
  );
