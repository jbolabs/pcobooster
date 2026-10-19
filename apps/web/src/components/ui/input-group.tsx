import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { coarseHitArea } from "@/components/ui/button-variants";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const InputGroup = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="input-group"
    /* eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- Input groups are generic layout wrappers around controls and addons. */
    role="group"
    className={cn(
      "group/input-group bg-input/50 has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30 has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-destructive/20 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 relative flex h-9 w-full min-w-0 items-center rounded-4xl border border-transparent transition-[color,box-shadow,background-color] outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-data-[align=block-end]:rounded-3xl has-data-[align=block-start]:rounded-3xl has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-3 has-[textarea]:rounded-2xl has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto pointer-coarse:h-11 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
      className
    )}
    {...props}
  />
);

const inputGroupAddonVariants = cva(
  "text-muted-foreground **:data-[slot=kbd]:bg-muted-foreground/10 flex h-auto cursor-text items-center justify-center gap-2 py-2 text-sm font-medium select-none group-data-[disabled=true]/input-group:opacity-50 **:data-[slot=kbd]:rounded-3xl **:data-[slot=kbd]:px-1.5 [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start": "order-first pl-3 has-[>button]:-ml-1 has-[>kbd]:-ml-1",
        "inline-end": "order-last pr-3 has-[>button]:-mr-1 has-[>kbd]:-mr-1",
        "block-start":
          "order-first w-full justify-start px-3 pt-3 group-has-[>input]/input-group:pt-3.5 [.border-b]:pb-3.5",
        "block-end":
          "order-last w-full justify-start px-3 pb-3 group-has-[>input]/input-group:pb-3.5 [.border-t]:pt-3.5",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
);

/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- The stock addon click behavior focuses its sibling input without making the layout wrapper interactive. */
const InputGroupAddon = ({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof inputGroupAddonVariants>) => (
  <div
    /* eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- Addons are generic layout wrappers that focus the associated input. */
    role="group"
    data-slot="input-group-addon"
    data-align={align}
    className={cn(inputGroupAddonVariants({ align }), className)}
    onClick={(e) => {
      if (e.target instanceof Element && e.target.closest("button") !== null) {
        return;
      }
      e.currentTarget.parentElement?.querySelector("input")?.focus();
    }}
    {...props}
  />
);
/* eslint-enable jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */

const inputGroupButtonVariants = cva(
  // Inside a field the field is the surface, so ghost buttons stay clear on touch screens too.
  "flex items-center gap-2 rounded-4xl text-sm shadow-none pointer-coarse:bg-transparent dark:pointer-coarse:bg-transparent",
  {
    variants: {
      size: {
        xs: `h-6 gap-1 rounded-xl px-1.5 pointer-coarse:h-8 pointer-coarse:px-2 [&>svg:not([class*='size-'])]:size-3.5 ${coarseHitArea}`,
        sm: `pointer-coarse:h-9 pointer-coarse:px-3 ${coarseHitArea}`,
        "icon-xs": `size-6 rounded-xl p-0 has-[>svg]:p-0 pointer-coarse:size-8 ${coarseHitArea}`,
        "icon-sm": `size-8 p-0 has-[>svg]:p-0 pointer-coarse:size-9 ${coarseHitArea}`,
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
);

const InputGroupButton = ({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset";
  }) => (
  <Button
    type={type}
    data-size={size}
    variant={variant}
    className={cn(inputGroupButtonVariants({ size }), className)}
    {...props}
  />
);

const InputGroupText = ({
  className,
  ...props
}: React.ComponentProps<"span">) => (
  <span
    className={cn(
      "text-muted-foreground flex items-center gap-2 text-sm [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
      className
    )}
    {...props}
  />
);

const InputGroupInput = ({
  className,
  ...props
}: React.ComponentProps<"input">) => (
  <Input
    data-slot="input-group-control"
    className={cn(
      "flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent",
      className
    )}
    {...props}
  />
);

const InputGroupTextarea = ({
  className,
  ...props
}: React.ComponentProps<"textarea">) => (
  <Textarea
    data-slot="input-group-control"
    className={cn(
      "flex-1 resize-none rounded-none border-0 bg-transparent py-2.5 shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent",
      className
    )}
    {...props}
  />
);

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
};
