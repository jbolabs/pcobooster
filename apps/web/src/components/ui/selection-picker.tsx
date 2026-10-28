import { Check } from "lucide-react";
import type { ComponentProps } from "react";

import { CommandItem } from "@/components/ui/command";
import {
  getSelectionPickerOptionClassName,
  getSelectionPickerShellLayoutClass,
  selectionPickerShellClass,
} from "@/components/ui/selection-picker-styles";
import { cn } from "@/lib/utils";

export const SelectionPickerShell = ({
  className,
  layout = "list",
  ...props
}: ComponentProps<"div"> & { layout?: "list" | "segment" }) => (
  <div
    className={cn(
      selectionPickerShellClass,
      getSelectionPickerShellLayoutClass(layout),
      className
    )}
    {...props}
  />
);

export const SelectionPickerOption = ({
  selected,
  layout = "row",
  disabled = false,
  className,
  ...props
}: Omit<ComponentProps<"button">, "type"> & {
  selected: boolean;
  layout?: "segment" | "row";
  disabled?: boolean;
}) => (
  <button
    type="button"
    aria-pressed={selected}
    disabled={disabled}
    className={cn(
      getSelectionPickerOptionClassName({ selected, layout, disabled }),
      className
    )}
    {...props}
  />
);

/** Centered on the first line of the row's text, whether the row aligns to the top or center. */
export const SelectionPickerCheckbox = ({
  selected,
}: {
  selected: boolean;
}) => (
  <span aria-hidden className="flex h-lh shrink-0 items-center">
    <span
      className={cn(
        "border-border flex size-4 items-center justify-center rounded-sm border",
        selected
          ? "border-foreground bg-foreground text-background"
          : "bg-background"
      )}
    >
      {selected ? <Check className="size-2.5" /> : null}
    </span>
  </span>
);

export const SelectionPickerCommandItem = ({
  selected,
  ...props
}: ComponentProps<typeof CommandItem> & { selected: boolean }) => (
  <CommandItem
    data-assigned={selected ? "true" : "false"}
    className="text-muted-foreground hover:bg-muted/30 hover:text-foreground data-[assigned=true]:bg-background data-[assigned=true]:text-foreground data-[assigned=true]:ring-foreground/10 data-[selected=true]:bg-muted/30 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-normal outline-none data-[assigned=true]:shadow-xs data-[assigned=true]:ring-1 [&>svg:last-child]:hidden"
    {...props}
  />
);
