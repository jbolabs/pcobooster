import { SearchIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "cn";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";

const Command = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) => (
  <CommandPrimitive
    data-slot="command"
    className={cn(
      "bg-popover text-popover-foreground flex size-full flex-col overflow-hidden rounded-4xl p-1",
      className
    )}
    {...props}
  />
);

const CommandDialog = ({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  children: React.ReactNode;
}) => (
  <Dialog {...props}>
    <DialogHeader className="sr-only">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
    <DialogContent
      className={cn(
        "top-1/3 translate-y-0 overflow-hidden rounded-4xl! p-0",
        className
      )}
      showCloseButton={showCloseButton}
    >
      {children}
    </DialogContent>
  </Dialog>
);

const CommandInput = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) => (
  <div data-slot="command-input-wrapper" className="p-1 pb-0">
    <InputGroup className="bg-input/50 h-9">
      {/* Every command input searches a list, so the phone keyboard fits a query. */}
      <CommandPrimitive.Input
        data-slot="command-input"
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "w-full text-base outline-hidden disabled:cursor-not-allowed disabled:opacity-50 md:pointer-fine:text-sm",
          className
        )}
        {...props}
      />
      <InputGroupAddon>
        <HugeiconsIcon
          icon={SearchIcon}
          strokeWidth={2}
          className="size-4 shrink-0 opacity-50"
        />
      </InputGroupAddon>
    </InputGroup>
  </div>
);

const CommandList = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List
    data-slot="command-list"
    className={cn(
      "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain outline-none",
      className
    )}
    {...props}
  />
);

const CommandEmpty = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty
    data-slot="command-empty"
    className={cn("py-6 text-center text-sm", className)}
    {...props}
  />
);

const CommandGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) => (
  <CommandPrimitive.Group
    data-slot="command-group"
    className={cn(
      "text-foreground **:[[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1.5 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium",
      className
    )}
    {...props}
  />
);

const CommandSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) => (
  <CommandPrimitive.Separator
    data-slot="command-separator"
    className={cn("bg-border/50 my-1.5 h-px", className)}
    {...props}
  />
);

const CommandItem = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) => (
  <CommandPrimitive.Item
    data-slot="command-item"
    className={cn(
      "group/command-item data-selected:bg-muted data-selected:text-foreground data-selected:*:[svg]:text-foreground relative flex cursor-default items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium outline-hidden select-none in-data-[slot=dialog-content]:rounded-3xl data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 pointer-coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
      className
    )}
    {...props}
  >
    {children}
    <HugeiconsIcon
      icon={Tick02Icon}
      strokeWidth={2}
      className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100"
    />
  </CommandPrimitive.Item>
);

const CommandShortcut = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    data-slot="command-shortcut"
    className={cn(
      "text-muted-foreground group-data-selected/command-item:text-foreground ml-auto text-xs tracking-widest",
      className
    )}
    {...props}
  />
);

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
