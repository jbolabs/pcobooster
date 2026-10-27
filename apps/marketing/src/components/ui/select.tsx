import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

const Select = SelectPrimitive.Root;

const SelectGroup = ({ className, ...props }: SelectPrimitive.Group.Props) => (
  <SelectPrimitive.Group
    data-slot="select-group"
    className={cn("scroll-my-1.5", className)}
    {...props}
  />
);

const SelectValue = ({ className, ...props }: SelectPrimitive.Value.Props) => (
  <SelectPrimitive.Value
    data-slot="select-value"
    className={cn(
      "flex min-w-0 flex-1 items-center gap-2 text-left",
      className
    )}
    {...props}
  />
);

const selectTriggerVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring/30 flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-2xl border px-4 text-sm outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-border bg-background hover:bg-muted data-popup-open:bg-muted",
        // A filled field with no outline, for quiet layouts such as the key finder.
        soft: "bg-muted/70 hover:bg-muted data-popup-open:bg-muted border-transparent",
      },
      size: {
        default: "h-9",
        // A labelled field showing a large value, such as the key finder's song keys.
        field: "min-h-16 py-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const SelectTrigger = ({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props &
  VariantProps<typeof selectTriggerVariants>) => (
  <SelectPrimitive.Trigger
    data-slot="select-trigger"
    data-variant={variant}
    data-size={size}
    className={cn(selectTriggerVariants({ variant, size }), className)}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon
      render={
        <ChevronDownIcon
          aria-hidden="true"
          className="text-muted-foreground size-4"
        />
      }
    />
  </SelectPrimitive.Trigger>
);

const SelectContent = ({
  className,
  children,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Positioner
      side={side}
      sideOffset={sideOffset}
      align={align}
      alignOffset={alignOffset}
      alignItemWithTrigger={alignItemWithTrigger}
      className="isolate z-50 outline-none"
    >
      <SelectPrimitive.Popup
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/5 relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-3xl p-1.5 shadow-lg ring-1 duration-100 outline-none",
          className
        )}
        {...props}
      >
        <SelectPrimitive.List>{children}</SelectPrimitive.List>
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>
);

const SelectLabel = ({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) => (
  <SelectPrimitive.GroupLabel
    data-slot="select-label"
    className={cn("text-muted-foreground px-3 py-2 text-xs", className)}
    {...props}
  />
);

const SelectItem = ({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) => (
  <SelectPrimitive.Item
    data-slot="select-item"
    className={cn(
      "focus:bg-accent focus:text-accent-foreground active:bg-accent relative flex w-full cursor-default items-center gap-2.5 rounded-2xl py-2 pr-9 pl-3 text-sm font-medium outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 pointer-coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0",
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText className="flex flex-1 items-center gap-2">
      {children}
    </SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator
      render={
        <span className="pointer-events-none absolute right-3 flex items-center justify-center" />
      }
    >
      <CheckIcon aria-hidden="true" className="size-4" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
);

const SelectSeparator = ({
  className,
  ...props
}: SelectPrimitive.Separator.Props) => (
  <SelectPrimitive.Separator
    data-slot="select-separator"
    className={cn("bg-border -mx-1.5 my-1.5 h-px", className)}
    {...props}
  />
);

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
