import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isString } from "@pcobooster/planning-center-models/json";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "14rem";
const SIDEBAR_WIDTH_MOBILE = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

interface SidebarContextProps {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (value: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (value: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

type SidebarCSSProperties = React.CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

const mobileSidebarStyle: SidebarCSSProperties = {
  "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
};

const setSidebarCookie = (open: boolean): void => {
  // SAFETY: The sidebar state cookie is a client-only UI preference, and this
  // assignment is the browser-compatible fallback used by the generated
  // shadcn sidebar implementation.
  // eslint-disable-next-line unicorn/no-document-cookie
  document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

const useSidebar = () => {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
};

const SidebarProvider = ({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (setOpenProp) {
        setOpenProp(nextOpen);
      } else {
        setOpenState(nextOpen);
      }

      // This sets the cookie to keep the sidebar state.
      setSidebarCookie(nextOpen);
    },
    [setOpenProp]
  );

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((previousOpenMobile) => !previousOpenMobile);
      return;
    }

    setOpen(!open);
  }, [isMobile, open, setOpen, setOpenMobile]);

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleSidebar]);

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed";
  const sidebarWrapperStyle: SidebarCSSProperties = {
    "--sidebar-width": SIDEBAR_WIDTH,
    "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
    ...style,
  };

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={sidebarWrapperStyle}
        className={cn(
          "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-dvh w-full",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
};

const Sidebar = ({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  dir,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
}) => {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0 [&>button]:hidden"
          style={mobileSidebarStyle}
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-10 hidden h-dvh w-(--sidebar-width) data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] md:flex",
          // Adjust the padding for floating and inset variants; a landscape phone's notch
          // and home indicator stay clear (the insets are 0 everywhere else).
          variant === "floating" || variant === "inset"
            ? "p-2 pb-[max(--spacing(2),env(safe-area-inset-bottom,0px))] group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)] data-[side=left]:pl-[max(--spacing(2),env(safe-area-inset-left,0px))] data-[side=right]:pr-[max(--spacing(2),env(safe-area-inset-right,0px))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="bg-sidebar group-data-[variant=floating]:ring-sidebar-border flex size-full flex-col group-data-[variant=floating]:rounded-2xl group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1"
        >
          {children}
        </div>
      </div>
    </div>
  );
};

const SidebarTrigger = ({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) => {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <HugeiconsIcon icon={SidebarLeftIcon} strokeWidth={2} />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
};

const SidebarRail = ({
  className,
  ...props
}: React.ComponentProps<"button">) => {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  );
};

const SidebarInset = ({
  className,
  ...props
}: React.ComponentProps<"main">) => (
  <main
    data-slot="sidebar-inset"
    className={cn(
      "bg-background max-md:px-safe relative flex w-full flex-1 flex-col md:pr-[env(safe-area-inset-right,0px)] md:peer-data-[state=collapsed]:pl-[env(safe-area-inset-left,0px)] md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
      className
    )}
    {...props}
  />
);

const SidebarInput = ({
  className,
  ...props
}: React.ComponentProps<typeof Input>) => (
  <Input
    data-slot="sidebar-input"
    data-sidebar="input"
    className={cn("bg-input/50 h-8 w-full shadow-none", className)}
    {...props}
  />
);

const sidebarHeaderVariants = cva("flex flex-col [--radius:var(--radius-xl)]", {
  variants: {
    size: {
      default: "gap-2 p-2",
      chrome: "gap-0 p-0",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

const SidebarHeader = ({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof sidebarHeaderVariants>) => (
  <div
    data-slot="sidebar-header"
    data-sidebar="header"
    className={cn(sidebarHeaderVariants({ size }), className)}
    {...props}
  />
);

const SidebarFooter = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    data-slot="sidebar-footer"
    data-sidebar="footer"
    className={cn("flex flex-col gap-2 p-2", className)}
    {...props}
  />
);

const SidebarSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) => (
  <Separator
    data-slot="sidebar-separator"
    data-sidebar="separator"
    className={cn("bg-sidebar-border mx-2 data-horizontal:w-auto", className)}
    {...props}
  />
);

const SidebarContent = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    data-slot="sidebar-content"
    data-sidebar="content"
    className={cn(
      "no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-auto overscroll-contain [--radius:var(--radius-xl)] group-data-[collapsible=icon]:overflow-hidden",
      className
    )}
    {...props}
  />
);

const SidebarGroup = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="sidebar-group"
    data-sidebar="group"
    className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
    {...props}
  />
);

const SidebarGroupLabel = ({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div"> & React.ComponentProps<"div">) =>
  useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-xl px-3 text-xs font-medium outline-hidden transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-label",
      sidebar: "group-label",
    },
  });

const SidebarGroupAction = ({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & React.ComponentProps<"button">) =>
  useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-xl p-0 outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-group-action",
      sidebar: "group-action",
    },
  });

const SidebarGroupContent = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    data-slot="sidebar-group-content"
    data-sidebar="group-content"
    className={cn("w-full text-sm", className)}
    {...props}
  />
);

const SidebarMenu = ({ className, ...props }: React.ComponentProps<"ul">) => (
  <ul
    data-slot="sidebar-menu"
    data-sidebar="menu"
    className={cn("flex w-full min-w-0 flex-col gap-0.5", className)}
    {...props}
  />
);

const SidebarMenuItem = ({
  className,
  ...props
}: React.ComponentProps<"li">) => (
  <li
    data-slot="sidebar-menu-item"
    data-sidebar="menu-item"
    className={cn("group/menu-item relative", className)}
    {...props}
  />
);

const sidebarMenuButtonVariants = cva(
  "peer/menu-button group/menu-button ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground flex w-full items-center gap-2 overflow-hidden rounded-xl px-2 py-1.5 text-left outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:font-medium [&_svg]:size-[1.125rem] [&_svg]:shrink-0 [&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shadow-[0_0_0_1px_var(--sidebar-border)] hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-9 text-sm",
        sm: "h-8 text-xs",
        lg: "h-11 px-3 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const SidebarMenuButton = ({
  render,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    isActive?: boolean;
    tooltip?: string | React.ComponentProps<typeof HoverCardContent>;
  } & VariantProps<typeof sidebarMenuButtonVariants>) => {
  const { isMobile, state } = useSidebar();
  const comp = useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props
    ),
    render:
      tooltip === undefined ? (
        render
      ) : (
        // The hover-card trigger defaults to an anchor; keep a real button.
        <HoverCardTrigger
          render={render ?? <button type="button">{props.children}</button>}
        />
      ),
    state: {
      slot: "sidebar-menu-button",
      sidebar: "menu-button",
      size,
      active: isActive,
    },
  });

  if (tooltip === undefined) {
    return comp;
  }

  const tooltipProps = isString(tooltip) ? { children: tooltip } : tooltip;

  return (
    <HoverCard>
      {comp}
      <HoverCardContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltipProps}
      />
    </HoverCard>
  );
};

const SidebarMenuAction = ({
  className,
  render,
  showOnHover = false,
  ...props
}: useRender.ComponentProps<"button"> &
  React.ComponentProps<"button"> & {
    showOnHover?: boolean;
  }) =>
  useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(
      {
        className: cn(
          "text-sidebar-foreground ring-sidebar-ring peer-hover/menu-button:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-xl p-0 outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-data-[size=default]/menu-button:top-2 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
          showOnHover &&
            "peer-data-active/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 aria-expanded:opacity-100 md:opacity-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-action",
      sidebar: "menu-action",
    },
  });

const SidebarMenuBadge = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    data-slot="sidebar-menu-badge"
    data-sidebar="menu-badge"
    className={cn(
      "text-sidebar-foreground peer-hover/menu-button:text-sidebar-accent-foreground peer-data-active/menu-button:text-sidebar-accent-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-xl px-1 text-xs font-medium tabular-nums select-none group-data-[collapsible=icon]:hidden peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1",
      className
    )}
    {...props}
  />
);

const SidebarMenuSkeleton = ({
  className,
  showIcon = false,
  width = "70%",
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean;
  width?: string;
}) => {
  const skeletonStyle: SidebarCSSProperties = {
    "--skeleton-width": width,
  };

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-xl px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          variant="control"
          className="size-4"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={skeletonStyle}
      />
    </div>
  );
};

const SidebarMenuSub = ({
  className,
  ...props
}: React.ComponentProps<"ul">) => (
  <ul
    data-slot="sidebar-menu-sub"
    data-sidebar="menu-sub"
    className={cn(
      "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 px-2.5 py-0.5 group-data-[collapsible=icon]:hidden",
      className
    )}
    {...props}
  />
);

const SidebarMenuSubItem = ({
  className,
  ...props
}: React.ComponentProps<"li">) => (
  <li
    data-slot="sidebar-menu-sub-item"
    data-sidebar="menu-sub-item"
    className={cn("group/menu-sub-item relative", className)}
    {...props}
  />
);

const SidebarMenuSubButton = ({
  render,
  size = "md",
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<"a"> &
  React.ComponentProps<"a"> & {
    size?: "sm" | "md";
    isActive?: boolean;
  }) =>
  useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn(
          "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-8 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-xl px-2 outline-hidden group-data-[collapsible=icon]:hidden focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:font-medium data-[size=md]:text-sm data-[size=sm]:text-xs [&>span:last-child]:truncate [&>svg]:size-[1.125rem] [&>svg]:shrink-0",
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "sidebar-menu-sub-button",
      sidebar: "menu-sub-button",
      size,
      active: isActive,
    },
  });

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
