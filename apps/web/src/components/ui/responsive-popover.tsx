import * as React from "react";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ResponsivePopoverContext = React.createContext<{ isMobile: boolean }>({
  isMobile: false,
});

/** Whether the surrounding responsive popover renders as a phone sheet. */
const useResponsivePopover = () => React.useContext(ResponsivePopoverContext);

interface ResponsivePopoverProps {
  children: React.ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Applies to the desktop popover; phone sheets are always modal. */
  modal?: React.ComponentProps<typeof Popover>["modal"];
}

/** A popover on wider screens and a swipeable bottom sheet on phones. */
const ResponsivePopover = ({
  children,
  open,
  defaultOpen,
  onOpenChange,
  modal,
}: ResponsivePopoverProps) => {
  const isMobile = useIsMobile();
  const contextValue = React.useMemo(() => ({ isMobile }), [isMobile]);
  const handleOpenChange = onOpenChange
    ? (nextOpen: boolean) => {
        onOpenChange(nextOpen);
      }
    : undefined;

  return (
    <ResponsivePopoverContext.Provider value={contextValue}>
      {isMobile ? (
        <Drawer
          open={open}
          defaultOpen={defaultOpen}
          onOpenChange={handleOpenChange}
          showSwipeHandle
        >
          {children}
        </Drawer>
      ) : (
        <Popover
          open={open}
          defaultOpen={defaultOpen}
          onOpenChange={handleOpenChange}
          modal={modal}
        >
          {children}
        </Popover>
      )}
    </ResponsivePopoverContext.Provider>
  );
};

const ResponsivePopoverTrigger = (
  props: Omit<React.ComponentProps<typeof PopoverTrigger>, "handle">
) => {
  const { isMobile } = useResponsivePopover();
  if (isMobile) {
    return <DrawerTrigger {...props} />;
  }
  return <PopoverTrigger {...props} />;
};

type ResponsivePopoverContentProps = React.ComponentProps<
  typeof PopoverContent
> & {
  /**
   * Sheet heading on phones; screen-reader only unless `showTitle` is set.
   * Omit it when the content renders its own `ResponsivePopoverTitle`.
   */
  title?: React.ReactNode;
  description?: React.ReactNode;
  showTitle?: boolean;
};

const ResponsivePopoverContent = ({
  title,
  description,
  showTitle = false,
  className,
  children,
  ref,
  ...popoverProps
}: ResponsivePopoverContentProps) => {
  const { isMobile } = useResponsivePopover();

  if (isMobile) {
    return (
      <DrawerContent ref={ref}>
        {title === undefined ? null : (
          <DrawerHeader className={cn("text-left", !showTitle && "sr-only")}>
            <DrawerTitle className="text-left">{title}</DrawerTitle>
            {description === undefined ? null : (
              <DrawerDescription className="text-left">
                {description}
              </DrawerDescription>
            )}
          </DrawerHeader>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pt-2">
          {children}
        </div>
      </DrawerContent>
    );
  }

  return (
    <PopoverContent ref={ref} className={className} {...popoverProps}>
      {children}
    </PopoverContent>
  );
};

const ResponsivePopoverTitle = (
  props: React.ComponentProps<typeof PopoverTitle>
) => {
  const { isMobile } = useResponsivePopover();
  if (isMobile) {
    return <DrawerTitle {...props} />;
  }
  return <PopoverTitle {...props} />;
};

/** A heading block inside the content: the sheet's header on phones. */
const ResponsivePopoverHeader = ({
  className,
  ...props
}: React.ComponentProps<"div">) => {
  const { isMobile } = useResponsivePopover();
  if (isMobile) {
    return <DrawerHeader className={cn("text-left", className)} {...props} />;
  }
  return <PopoverHeader className={className} {...props} />;
};

const ResponsivePopoverDescription = (
  props: React.ComponentProps<typeof PopoverDescription>
) => {
  const { isMobile } = useResponsivePopover();
  if (isMobile) {
    return <DrawerDescription {...props} />;
  }
  return <PopoverDescription {...props} />;
};

export {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverDescription,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
  useResponsivePopover,
};
