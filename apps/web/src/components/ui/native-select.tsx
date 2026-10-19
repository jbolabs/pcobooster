import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

const NativeSelect = ({
  className,
  size = "default",
  ...props
}: NativeSelectProps) => (
  <div
    className={cn(
      "group/native-select relative w-fit has-[select:disabled]:opacity-50",
      className
    )}
    data-slot="native-select-wrapper"
    data-size={size}
  >
    <select
      data-slot="native-select"
      data-size={size}
      className="bg-input/50 selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 h-9 w-full min-w-0 appearance-none rounded-3xl border border-transparent py-1 pr-8 pl-3 text-base transition-[color,box-shadow,background-color] outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:ring-3 data-[size=sm]:h-8 pointer-coarse:h-11 pointer-coarse:data-[size=sm]:h-10 md:pointer-fine:text-sm"
      {...props}
    />
    <HugeiconsIcon
      icon={UnfoldMoreIcon}
      strokeWidth={2}
      className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 select-none"
      aria-hidden="true"
      data-slot="native-select-icon"
    />
  </div>
);

const NativeSelectOption = ({
  className,
  ...props
}: React.ComponentProps<"option">) => (
  <option
    data-slot="native-select-option"
    className={cn("bg-[Canvas] text-[CanvasText]", className)}
    {...props}
  />
);

const NativeSelectOptGroup = ({
  className,
  ...props
}: React.ComponentProps<"optgroup">) => (
  <optgroup
    data-slot="native-select-optgroup"
    className={cn("bg-[Canvas] text-[CanvasText]", className)}
    {...props}
  />
);

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
