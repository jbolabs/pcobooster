import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "cn";
import * as React from "react";

const ScrollBar = ({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) => (
  <ScrollAreaPrimitive.Scrollbar
    data-slot="scroll-area-scrollbar"
    data-orientation={orientation}
    orientation={orientation}
    className={cn(
      "pointer-events-none flex touch-none opacity-0 transition-opacity duration-150 select-none",
      "data-hovering:pointer-events-auto data-hovering:opacity-100",
      "data-scrolling:pointer-events-auto data-scrolling:opacity-100 data-scrolling:duration-0",
      "justify-center data-horizontal:h-3 data-horizontal:flex-col data-vertical:h-full data-vertical:w-3",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.Thumb
      data-slot="scroll-area-thumb"
      className="relative flex-1 rounded-full bg-(--scrollbar-thumb) data-[orientation=horizontal]:mx-1 data-[orientation=horizontal]:my-0.5 data-[orientation=vertical]:mx-0.5 data-[orientation=vertical]:my-1 data-[orientation=vertical]:w-full"
    />
  </ScrollAreaPrimitive.Scrollbar>
);

const ScrollArea = ({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props) => (
  <ScrollAreaPrimitive.Root
    data-slot="scroll-area"
    className={cn("relative", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      data-slot="scroll-area-viewport"
      className="focus-visible:ring-ring/50 size-full overscroll-contain rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
);

export { ScrollArea, ScrollBar };
