import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

const panelVariants = cva(
  "text-foreground ring-foreground/5 dark:ring-foreground/10 flex min-w-0 flex-col overflow-hidden rounded-xl ring-1",
  {
    variants: {
      variant: {
        default: "bg-background shadow-xs",
        /** Picked up and following the pointer, such as a team being dragged. */
        lifted: "bg-muted/80 shadow-2xl",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

/**
 * A titled block of rows on a page: a lineup team, a song's files, its schedule. The panel
 * clips its own corners, so headers and rows inside never round themselves; rows sit inset
 * (`PanelRows`), so their hover and selection keep their own rounded corners.
 */
const Panel = ({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"section"> & VariantProps<typeof panelVariants>) =>
  useRender({
    defaultTagName: "section",
    props: mergeProps<"section">(
      { className: cn(panelVariants({ variant, className })) },
      props
    ),
    render,
    state: { slot: "panel", variant },
  });

/** The panel's tinted top row: a title, or a trigger row that holds one. */
const PanelHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="panel-header"
    className={cn(
      "bg-muted/40 flex min-h-12 items-center gap-0.5 px-1.5 py-1.5",
      className
    )}
    {...props}
  />
);

const PanelTitle = ({
  className,
  children,
  ...props
}: React.ComponentProps<"h3">) => (
  <h3
    data-slot="panel-title"
    className={cn(
      "min-w-0 flex-1 truncate px-1.5 text-sm font-semibold tracking-tight",
      className
    )}
    {...props}
  >
    {children}
  </h3>
);

/** A quiet count or note beside the title. */
const PanelMeta = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span
    data-slot="panel-meta"
    className={cn(
      "text-muted-foreground shrink-0 px-1.5 text-xs tabular-nums",
      className
    )}
    {...props}
  />
);

/** The panel's body under a hairline; each direct child is a group of rows, divided. */
const PanelBody = ({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) =>
  useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "border-border/60 divide-border/60 flex flex-col divide-y border-t",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "panel-body" },
  });

/** Rows inset from the panel's edge, so a hovered or selected row shows its own corners. */
const PanelRows = ({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) =>
  useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "data-active:bg-muted flex min-w-0 flex-col px-1.5 py-1.5",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "panel-rows" },
  });

/** One quiet line for a panel with nothing to list. */
const PanelEmpty = ({ className, ...props }: React.ComponentProps<"p">) => (
  <p
    data-slot="panel-empty"
    className={cn("text-muted-foreground px-3 py-3 text-sm", className)}
    {...props}
  />
);

export {
  Panel,
  PanelBody,
  PanelEmpty,
  PanelHeader,
  PanelMeta,
  PanelRows,
  PanelTitle,
};
