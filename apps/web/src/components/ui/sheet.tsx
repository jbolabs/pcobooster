import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import * as React from "react";

import { Button } from "@/components/ui/button";

const Sheet = ({ ...props }: SheetPrimitive.Root.Props) => (
  <SheetPrimitive.Root data-slot="sheet" {...props} />
);

const SheetTrigger = ({ ...props }: SheetPrimitive.Trigger.Props) => (
  <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
);

const SheetClose = ({ ...props }: SheetPrimitive.Close.Props) => (
  <SheetPrimitive.Close data-slot="sheet-close" {...props} />
);

const SheetPortal = ({ ...props }: SheetPrimitive.Portal.Props) => (
  <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
);

const SheetOverlay = ({
  className,
  ...props
}: SheetPrimitive.Backdrop.Props) => (
  <SheetPrimitive.Backdrop
    data-slot="sheet-overlay"
    className={cn(
      "fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
      className
    )}
    {...props}
  />
);

const SheetContent = ({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Popup
      data-slot="sheet-content"
      data-side={side}
      className={cn(
        "bg-popover text-popover-foreground fixed z-50 flex flex-col bg-clip-padding text-sm shadow-xl transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0 data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem] data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
        // Edge-to-edge sheets pad their content clear of the notch and home indicator.
        "data-[side=bottom]:pb-safe data-[side=left]:pt-safe data-[side=left]:pb-safe data-[side=right]:pt-safe data-[side=right]:pb-safe data-[side=top]:pt-safe data-[side=left]:pl-[env(safe-area-inset-left,0px)] data-[side=right]:pr-[env(safe-area-inset-right,0px)]",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <SheetPrimitive.Close
          data-slot="sheet-close"
          render={
            <Button
              variant="ghost"
              className="bg-secondary absolute top-4 right-4 in-data-[side=left]:top-[calc(--spacing(4)+env(safe-area-inset-top,0px))] in-data-[side=right]:top-[calc(--spacing(4)+env(safe-area-inset-top,0px))] in-data-[side=right]:right-[calc(--spacing(4)+env(safe-area-inset-right,0px))] in-data-[side=top]:top-[calc(--spacing(4)+env(safe-area-inset-top,0px))]"
              size="icon-sm"
            />
          }
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      )}
    </SheetPrimitive.Popup>
  </SheetPortal>
);

const SheetHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="sheet-header"
    className={cn("flex flex-col gap-1.5 p-6", className)}
    {...props}
  />
);

const SheetFooter = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="sheet-footer"
    className={cn("mt-auto flex flex-col gap-2 p-6", className)}
    {...props}
  />
);

const SheetTitle = ({ className, ...props }: SheetPrimitive.Title.Props) => (
  <SheetPrimitive.Title
    data-slot="sheet-title"
    className={cn(
      "font-heading text-foreground text-base font-medium",
      className
    )}
    {...props}
  />
);

const SheetDescription = ({
  className,
  ...props
}: SheetPrimitive.Description.Props) => (
  <SheetPrimitive.Description
    data-slot="sheet-description"
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
);

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
