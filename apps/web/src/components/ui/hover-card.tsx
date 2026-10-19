import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

const hoverCardMotionClassName =
  "data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-100";

const hoverCardContentVariants = cva(
  cn(
    "bg-popover text-popover-foreground ring-foreground/5 dark:ring-foreground/10 z-50 origin-(--transform-origin) overflow-hidden shadow-md ring-1 outline-hidden",
    hoverCardMotionClassName
  ),
  {
    variants: {
      variant: {
        label:
          "w-fit max-w-xs rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        panel: "w-72 rounded-3xl p-3 text-sm shadow-lg",
      },
    },
    defaultVariants: {
      variant: "label",
    },
  }
);

const HoverCard = ({ ...props }: PreviewCardPrimitive.Root.Props) => (
  <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
);

const HoverCardTrigger = ({ ...props }: PreviewCardPrimitive.Trigger.Props) => (
  <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
);

const HoverCardContent = ({
  className,
  variant = "label",
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > &
  VariantProps<typeof hoverCardContentVariants>) => (
  <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
    <PreviewCardPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      className="isolate z-50"
    >
      <PreviewCardPrimitive.Popup
        data-slot="hover-card-content"
        className={cn(hoverCardContentVariants({ variant }), className)}
        {...props}
      />
    </PreviewCardPrimitive.Positioner>
  </PreviewCardPrimitive.Portal>
);

const HoverLabel = ({
  label,
  trigger,
  children,
  side = "top",
  align = "center",
  sideOffset = 4,
  alignOffset = 0,
  className,
  ...props
}: Omit<PreviewCardPrimitive.Trigger.Props, "render"> & {
  label: React.ReactNode;
  /**
   * The element people hover. It keeps its own classes: `className` styles the label, and
   * the trigger is not this component's root, so it is not a `render` replacement.
   */
  trigger?: PreviewCardPrimitive.Trigger.Props["render"];
} & Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > &
  Omit<
    React.ComponentProps<typeof HoverCardContent>,
    "children" | "render" | "variant"
  >) => (
  <HoverCard>
    <HoverCardTrigger render={trigger}>{children}</HoverCardTrigger>
    <HoverCardContent
      align={align}
      alignOffset={alignOffset}
      className={className}
      side={side}
      sideOffset={sideOffset}
      variant="label"
      {...props}
    >
      {label}
    </HoverCardContent>
  </HoverCard>
);

export { HoverCard, HoverCardTrigger, HoverCardContent, HoverLabel };
