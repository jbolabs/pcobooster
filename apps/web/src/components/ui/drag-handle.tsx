import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { GripVertical } from "lucide-react";
import type * as React from "react";

const dragHandleVariants = cva(
  "text-muted-foreground/55 hover:text-foreground focus-visible:ring-ring/50 inline-flex shrink-0 cursor-grab touch-manipulation items-center justify-center self-stretch rounded-lg border-0 bg-transparent outline-none focus-visible:ring-3 active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      size: {
        default: "w-9 pointer-coarse:w-11",
        sm: "w-8 pointer-coarse:w-10",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

/** Grip for dnd-kit sortables; spread the sortable attributes and listeners onto it. */
const DragHandle = ({
  className,
  size,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof dragHandleVariants>) => (
  <button
    data-slot="drag-handle"
    type="button"
    className={cn(dragHandleVariants({ size }), className)}
    {...props}
  >
    <GripVertical className="size-4" aria-hidden />
  </button>
);

export { DragHandle };
